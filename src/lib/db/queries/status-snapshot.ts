import { and, desc, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { services } from '@/lib/db/schema/services';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { users } from '@/lib/db/schema/users';
import { postmortems } from '@/lib/db/schema/postmortems';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import {
  buildPublicSnapshot,
  buildTeamSnapshot,
  worstSeverityFromIncidents,
} from '@/lib/status/snapshot';
import {
  StatusSnapshotPayloadSchema,
  type SnapshotDayCell,
  type StatusSnapshotPayload,
} from '@/lib/status/payload';
import { compute30dUptime } from '@/lib/status/uptime';

export type SnapshotScope = 'public' | { type: 'team'; teamId: string };

function scopeKey(scope: SnapshotScope): string {
  if (scope === 'public') return 'public';
  return `team:${scope.teamId}`;
}

/**
 * Public reader — no actor authz. Returns the validated snapshot payload
 * for the given scope, or null if none persisted yet OR if the persisted
 * payload fails schema validation (defensive — manual edits or mid-rollout
 * data shouldn't crash the page).
 */
export async function readSnapshotForScope(
  db: DB,
  scope: SnapshotScope,
): Promise<StatusSnapshotPayload | null> {
  const key = scopeKey(scope);
  const [row] = await db
    .select()
    .from(statusSnapshots)
    .where(eq(statusSnapshots.scope, key))
    .limit(1);
  if (!row) return null;
  const parsed = StatusSnapshotPayloadSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  return parsed.data;
}

interface BuilderInputs {
  services: Array<{ id: string; slug: string; name: string; teamId: string; uptime30d: number }>;
  activeIncidents: Array<{
    slug: string;
    title: string;
    severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
    status: 'triaging' | 'investigating' | 'identified' | 'monitoring' | 'resolved';
    declaredAt: Date;
    affectedServiceIds: string[];
    latestPublicUpdate?: { body: string; postedAt: Date; author?: string | null };
  }>;
  severityByDay: SnapshotDayCell[];
}

async function loadBuilderInputs(db: DB, now: Date): Promise<BuilderInputs> {
  // 1) services + 30d uptime per service
  const allServices = await db.select().from(services);
  const servicesWithUptime: BuilderInputs['services'] = [];
  for (const s of allServices) {
    const uptime30d = await compute30dUptime(db, s.id, now);
    servicesWithUptime.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      teamId: s.teamId,
      uptime30d,
    });
  }

  // 2) active incidents (status != 'resolved')
  const activeRows = await db
    .select()
    .from(incidents)
    .where(ne(incidents.status, 'resolved'))
    .orderBy(desc(incidents.declaredAt));

  const incIds = activeRows.map((r) => r.id);
  const links = incIds.length
    ? await db
        .select()
        .from(incidentServices)
        .where(inArray(incidentServices.incidentId, incIds))
    : [];
  const linksByIncident = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByIncident.get(l.incidentId) ?? [];
    arr.push(l.serviceId);
    linksByIncident.set(l.incidentId, arr);
  }

  const latestUpdates = new Map<
    string,
    { body: string; postedAt: Date; authorUserId: string | null }
  >();
  if (incIds.length > 0) {
    const updates = await db
      .select({
        incidentId: timelineEvents.incidentId,
        body: timelineEvents.body,
        occurredAt: timelineEvents.occurredAt,
        authorUserId: timelineEvents.authorUserId,
      })
      .from(timelineEvents)
      .where(
        and(
          inArray(timelineEvents.incidentId, incIds),
          eq(timelineEvents.kind, 'status_update_published'),
        ),
      )
      .orderBy(desc(timelineEvents.occurredAt));
    for (const u of updates) {
      if (latestUpdates.has(u.incidentId)) continue;
      const body = u.body as { message: string };
      latestUpdates.set(u.incidentId, {
        body: body.message,
        postedAt: u.occurredAt,
        authorUserId: u.authorUserId,
      });
    }
  }

  const authorIds = [
    ...new Set(
      [...latestUpdates.values()].map((u) => u.authorUserId).filter((x): x is string => !!x),
    ),
  ];
  const authorMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const authorRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, authorIds));
    for (const r of authorRows) authorMap.set(r.id, r.name ?? null);
  }

  const activeIncidents: BuilderInputs['activeIncidents'] = activeRows.map((r) => {
    const upd = latestUpdates.get(r.id);
    return {
      slug: r.publicSlug,
      title: r.title,
      severity: r.severity,
      status: r.status,
      declaredAt: r.declaredAt,
      affectedServiceIds: linksByIncident.get(r.id) ?? [],
      ...(upd
        ? {
            latestPublicUpdate: {
              body: upd.body,
              postedAt: upd.postedAt,
              author: upd.authorUserId ? authorMap.get(upd.authorUserId) ?? null : null,
            },
          }
        : {}),
    };
  });

  const severityByDay = await loadSeverityByDay(db, now);

  return { services: servicesWithUptime, activeIncidents, severityByDay };
}

async function loadSeverityByDay(db: DB, now: Date): Promise<SnapshotDayCell[]> {
  const days: SnapshotDayCell[] = [];
  const startMs = now.getTime() - 6 * 24 * 60 * 60 * 1000;
  const dayStart = new Date(new Date(startMs).setUTCHours(0, 0, 0, 0));

  const windowStart = dayStart;
  const windowEnd = new Date(now.getTime());
  const rows = await db
    .select({
      severity: incidents.severity,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .where(
      and(
        lte(incidents.declaredAt, windowEnd),
        or(isNull(incidents.resolvedAt), gte(incidents.resolvedAt, windowStart)),
      ),
    );

  for (let i = 0; i < 7; i++) {
    const day = new Date(dayStart.getTime() + i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const overlapping = rows.filter(
      (r) => r.declaredAt < dayEnd && (r.resolvedAt === null || r.resolvedAt >= day),
    );
    const worst = worstSeverityFromIncidents(overlapping);
    days.push({
      date: day.toISOString().slice(0, 10),
      worstSeverity: worst,
    });
  }
  return days;
}

/**
 * Public mutation — writes the snapshot row. Called from inside other
 * mutations' transactions (changeIncidentStatus, declareIncident,
 * dismissTriagingIncident, postPublicStatusUpdate). No actor authz.
 */
export async function recomputeAndPersistSnapshot(
  db: DB,
  scope: SnapshotScope,
  now: Date = new Date(),
): Promise<StatusSnapshotPayload> {
  const inputs = await loadBuilderInputs(db, now);
  const payload =
    scope === 'public'
      ? buildPublicSnapshot(inputs)
      : buildTeamSnapshot(scope.teamId, inputs);
  const validated = StatusSnapshotPayloadSchema.parse(payload);

  const key = scopeKey(scope);
  await db
    .insert(statusSnapshots)
    .values({ scope: key, payload: validated, updatedAt: now })
    .onConflictDoUpdate({
      target: statusSnapshots.scope,
      set: { payload: validated, updatedAt: now },
    });

  return validated;
}

/**
 * Public mutation — refreshes both 'public' and 'team:<uuid>' rows after
 * a state change in `teamId`. v1: only the affected team's row + public.
 * Cross-team incidents touching multiple teams' services would warrant a
 * per-team set; deferred.
 */
export async function recomputeAllSnapshotsForTeam(
  db: DB,
  teamId: string,
  now: Date = new Date(),
): Promise<void> {
  await recomputeAndPersistSnapshot(db, 'public', now);
  await recomputeAndPersistSnapshot(db, { type: 'team', teamId }, now);
}

export interface PublicPostmortemListItem {
  id: string;
  incidentSlug: string;
  incidentTitle: string;
  publishedAt: Date;
}

/**
 * Public reader — no actor authz. Returns published-AND-public postmortems,
 * newest first. Optional teamId filter for /status/[teamSlug].
 */
export async function listPublicPostmortems(
  db: DB,
  opts: { teamId?: string; limit?: number } = {},
): Promise<PublicPostmortemListItem[]> {
  const limit = opts.limit ?? 5;
  const conditions = [
    eq(postmortems.status, 'published'),
    eq(postmortems.publicOnStatusPage, true),
  ];

  if (opts.teamId) {
    const rows = await db
      .select({
        id: postmortems.id,
        publishedAt: postmortems.publishedAt,
        incidentSlug: incidents.publicSlug,
        incidentTitle: incidents.title,
      })
      .from(postmortems)
      .innerJoin(incidents, eq(postmortems.incidentId, incidents.id))
      .where(and(...conditions, eq(incidents.teamId, opts.teamId)))
      .orderBy(desc(postmortems.publishedAt))
      .limit(limit);
    return rows
      .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
      .map((r) => ({
        id: r.id,
        incidentSlug: r.incidentSlug,
        incidentTitle: r.incidentTitle,
        publishedAt: r.publishedAt,
      }));
  }

  const rows = await db
    .select({
      id: postmortems.id,
      publishedAt: postmortems.publishedAt,
      incidentSlug: incidents.publicSlug,
      incidentTitle: incidents.title,
    })
    .from(postmortems)
    .innerJoin(incidents, eq(postmortems.incidentId, incidents.id))
    .where(and(...conditions))
    .orderBy(desc(postmortems.publishedAt))
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
    .map((r) => ({
      id: r.id,
      incidentSlug: r.incidentSlug,
      incidentTitle: r.incidentTitle,
      publishedAt: r.publishedAt,
    }));
}

export interface PublicPostmortem {
  id: string;
  markdownBody: string;
  publishedAt: Date;
  incidentTitle: string;
  incidentSlug: string;
}

/**
 * Public reader — no actor authz. Returns the postmortem only if status='published'
 * AND public_on_status_page=true. Otherwise null.
 */
export async function findPublicPostmortemById(
  db: DB,
  postmortemId: string,
): Promise<PublicPostmortem | null> {
  const [row] = await db
    .select({
      id: postmortems.id,
      markdownBody: postmortems.markdownBody,
      status: postmortems.status,
      publicOnStatusPage: postmortems.publicOnStatusPage,
      publishedAt: postmortems.publishedAt,
      incidentTitle: incidents.title,
      incidentSlug: incidents.publicSlug,
    })
    .from(postmortems)
    .innerJoin(incidents, eq(postmortems.incidentId, incidents.id))
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!row) return null;
  if (row.status !== 'published') return null;
  if (!row.publicOnStatusPage) return null;
  if (!row.publishedAt) return null;
  return {
    id: row.id,
    markdownBody: row.markdownBody,
    publishedAt: row.publishedAt,
    incidentTitle: row.incidentTitle,
    incidentSlug: row.incidentSlug,
  };
}
