import { and, count, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import {
  incidents,
  incidentServices,
  type Incident,
} from '@/lib/db/schema/incidents';
import { services } from '@/lib/db/schema/services';
import { timelineEvents } from '@/lib/db/schema/timeline';
import type { Severity } from '@/lib/db/schema/services';
import type { WebhookSource } from '@/lib/db/schema/webhook-sources';
import type { NormalizedAlert } from '@/lib/ingest/types';
import { TimelineEventBodySchema } from '@/lib/timeline/body';
import { generateIncidentSlug } from '@/lib/incidents/slug';
import { notifyIncidentUpdate } from '@/lib/realtime/notify';
import { requireTeamMember, ForbiddenError } from '@/lib/authz';

function bumpSeverity(current: Severity): Severity | null {
  if (current === 'SEV1') return null;
  if (current === 'SEV2') return 'SEV1';
  if (current === 'SEV3') return 'SEV2';
  return 'SEV3'; // SEV4 → SEV3
}

export async function findOpenIncidentByFingerprint(
  db: DB,
  teamId: string,
  fingerprint: string,
): Promise<Incident | null> {
  const [row] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.teamId, teamId),
        ne(incidents.status, 'resolved'),
        sql`${incidents.externalFingerprints} @> ARRAY[${fingerprint}]::text[]`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface IngestResult {
  incidentId: string;
  eventId: string;
  action: 'matched' | 'created' | 'auto_bumped';
}

export async function ingestWebhookAlert(
  db: DB,
  source: WebhookSource,
  alert: NormalizedAlert,
): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const existing = await findOpenIncidentByFingerprint(
      tx as unknown as DB,
      source.teamId,
      alert.fingerprint,
    );

    if (existing) {
      const body = TimelineEventBodySchema.parse({
        kind: 'webhook',
        sourceId: source.id,
        sourceType: source.type,
        sourceName: source.name,
        fingerprint: alert.fingerprint,
        ...(alert.sourceUrl ? { sourceUrl: alert.sourceUrl } : {}),
        summary: alert.title,
      });
      const [event] = await tx
        .insert(timelineEvents)
        .values({
          incidentId: existing.id,
          authorUserId: null,
          kind: 'webhook',
          body,
        })
        .returning();
      if (!event) throw new Error('Insert returned no rows');

      if (!existing.externalFingerprints.includes(alert.fingerprint)) {
        await tx
          .update(incidents)
          .set({
            externalFingerprints: sql`array_append(${incidents.externalFingerprints}, ${alert.fingerprint})`,
            updatedAt: new Date(),
          })
          .where(eq(incidents.id, existing.id));
      }

      await notifyIncidentUpdate(tx as unknown as DB, {
        incidentId: event.incidentId,
        eventId: event.id,
        kind: 'webhook',
        occurredAt: event.occurredAt.toISOString(),
      });

      const windowStart = new Date(Date.now() - source.autoPromoteWindowSeconds * 1000);
      const [webhookCountRow] = (await tx
        .select({ value: count() })
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.incidentId, existing.id),
            eq(timelineEvents.kind, 'webhook'),
            gt(timelineEvents.occurredAt, windowStart),
          ),
        )) as [{ value: number }];

      const [sevChangesRow] = (await tx
        .select({ value: count() })
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.incidentId, existing.id),
            eq(timelineEvents.kind, 'severity_change'),
            gt(timelineEvents.occurredAt, windowStart),
          ),
        )) as [{ value: number }];

      const webhookCount = webhookCountRow?.value ?? 0;
      const recentSevChanges = sevChangesRow?.value ?? 0;
      const next = bumpSeverity(existing.severity);
      const shouldBump =
        webhookCount >= source.autoPromoteThreshold && recentSevChanges === 0 && next !== null;

      if (shouldBump && next) {
        const [updated] = await tx
          .update(incidents)
          .set({ severity: next, updatedAt: new Date() })
          .where(eq(incidents.id, existing.id))
          .returning();
        if (!updated) throw new Error('Update returned no rows');

        const sevBody = TimelineEventBodySchema.parse({
          kind: 'severity_change',
          from: existing.severity,
          to: next,
        });
        const [sevEvent] = await tx
          .insert(timelineEvents)
          .values({
            incidentId: existing.id,
            authorUserId: null,
            kind: 'severity_change',
            body: sevBody,
          })
          .returning();
        if (!sevEvent) throw new Error('Insert returned no rows');

        await notifyIncidentUpdate(tx as unknown as DB, {
          incidentId: sevEvent.incidentId,
          eventId: sevEvent.id,
          kind: 'severity_change',
          occurredAt: sevEvent.occurredAt.toISOString(),
        });

        return { incidentId: existing.id, eventId: sevEvent.id, action: 'auto_bumped' as const };
      }

      return { incidentId: existing.id, eventId: event.id, action: 'matched' as const };
    }

    // No match → create.
    const severity: Severity = alert.severity ?? source.defaultSeverity;

    let resolvedServiceIds: string[] = [];
    if (alert.serviceSlugs.length > 0) {
      const rows = await tx
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.teamId, source.teamId), inArray(services.slug, alert.serviceSlugs)));
      resolvedServiceIds = rows.map((r) => r.id);
    }
    if (resolvedServiceIds.length === 0 && source.defaultServiceId) {
      resolvedServiceIds = [source.defaultServiceId];
    }

    let incident: Incident | undefined;
    for (let attempt = 0; attempt < 3 && !incident; attempt++) {
      const slug = generateIncidentSlug();
      try {
        const [row] = await tx
          .insert(incidents)
          .values({
            publicSlug: slug,
            teamId: source.teamId,
            declaredBy: null,
            severity,
            status: 'triaging',
            title: alert.title,
            summary: '',
            externalFingerprints: [alert.fingerprint],
          })
          .returning();
        if (!row) throw new Error('Insert returned no rows');
        incident = row;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        const causeMsg = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
        const isUnique = /duplicate|unique/i.test(`${msg} ${causeMsg}`);
        if (!isUnique || attempt === 2) throw e;
      }
    }
    if (!incident) throw new Error('Could not allocate unique slug after 3 attempts');

    if (resolvedServiceIds.length > 0) {
      await tx
        .insert(incidentServices)
        .values(resolvedServiceIds.map((sid) => ({ incidentId: incident!.id, serviceId: sid })));
    }

    const body = TimelineEventBodySchema.parse({
      kind: 'webhook',
      sourceId: source.id,
      sourceType: source.type,
      sourceName: source.name,
      fingerprint: alert.fingerprint,
      ...(alert.sourceUrl ? { sourceUrl: alert.sourceUrl } : {}),
      summary: alert.title,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId: incident.id,
        authorUserId: null,
        kind: 'webhook',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'webhook',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { incidentId: incident.id, eventId: event.id, action: 'created' as const };
  });
}

/**
 * Dismiss a triaging incident as a false positive.
 *
 * Only valid when the current status is `triaging`. Sets status='resolved'
 * and resolved_at=now(), then writes a status_change event with
 * body.dismissed=true so the timeline reflects the manual decision (vs.
 * a real "we resolved the incident"). Reuses the same authz + notify
 * machinery as changeIncidentStatus.
 */
export async function dismissTriagingIncident(
  db: DB,
  actorUserId: string,
  incidentId: string,
): Promise<{
  incident: Incident;
  event: typeof timelineEvents.$inferSelect;
}> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as unknown as DB, actorUserId, current.teamId);

    if (current.status !== 'triaging') {
      throw new ForbiddenError(
        `Can only dismiss triaging incidents (current status: ${current.status})`,
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(incidents)
      .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'status_change',
      from: 'triaging',
      to: 'resolved',
      dismissed: true,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'status_change',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'status_change',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { incident: updated, event };
  });
}
