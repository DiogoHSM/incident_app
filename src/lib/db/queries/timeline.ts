import { and, desc, eq, lt } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import {
  timelineEvents,
  type TimelineEvent,
} from '@/lib/db/schema/timeline';
import { incidents } from '@/lib/db/schema/incidents';
import { ForbiddenError, requireTeamMember } from '@/lib/authz';
import { TimelineEventBodySchema } from '@/lib/timeline/body';
import { notifyIncidentUpdate } from '@/lib/realtime/notify';

async function loadIncidentForActor(
  db: DB,
  actorUserId: string,
  incidentId: string,
): Promise<{ id: string; teamId: string }> {
  const [row] = await db
    .select({ id: incidents.id, teamId: incidents.teamId })
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  if (!row) throw new Error('Incident not found');
  await requireTeamMember(db, actorUserId, row.teamId);
  return row;
}

export async function appendNote(
  db: DB,
  actorUserId: string,
  incidentId: string,
  markdown: string,
): Promise<TimelineEvent> {
  const body = TimelineEventBodySchema.parse({ kind: 'note', markdown });
  const inc = await loadIncidentForActor(db, actorUserId, incidentId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(timelineEvents)
      .values({
        incidentId: inc.id,
        authorUserId: actorUserId,
        kind: 'note',
        body,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: row.incidentId,
      eventId: row.id,
      kind: row.kind,
      occurredAt: row.occurredAt.toISOString(),
    });

    return row;
  });
}

export interface ListTimelineOptions {
  limit?: number;
  before?: Date;
}

export async function listTimelineEventsForIncident(
  db: DB,
  actorUserId: string,
  incidentId: string,
  opts: ListTimelineOptions = {},
): Promise<TimelineEvent[]> {
  await loadIncidentForActor(db, actorUserId, incidentId);

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conditions = [eq(timelineEvents.incidentId, incidentId)];
  if (opts.before) conditions.push(lt(timelineEvents.occurredAt, opts.before));

  return db
    .select()
    .from(timelineEvents)
    .where(and(...conditions))
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(limit);
}

export { ForbiddenError };
