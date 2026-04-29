import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { postmortems, type Postmortem } from '@/lib/db/schema/postmortems';
import { incidents, type Incident } from '@/lib/db/schema/incidents';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember } from '@/lib/authz';
import { TimelineEventBodySchema } from '@/lib/timeline/body';
import { notifyIncidentUpdate } from '@/lib/realtime/notify';
import { buildStarterTemplate } from '@/lib/postmortems/template';

async function loadIncidentOrThrow(db: DB, incidentId: string): Promise<Incident> {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
  if (!row) throw new Error('Incident not found');
  return row;
}

async function authorMapForIncident(
  db: DB,
  incidentId: string,
): Promise<Map<string, string>> {
  const events = await db
    .select({ authorUserId: timelineEvents.authorUserId })
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId));
  const ids = new Set<string>();
  for (const e of events) if (e.authorUserId) ids.add(e.authorUserId);
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name ?? 'unknown']));
}

export async function createDraftForIncident(
  db: DB,
  callerId: string,
  incidentId: string,
): Promise<Postmortem> {
  const incident = await loadIncidentOrThrow(db, incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [existing] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.incidentId, incidentId))
    .limit(1);
  if (existing) return existing;

  const events = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId))
    .orderBy(asc(timelineEvents.occurredAt));
  const authorById = await authorMapForIncident(db, incidentId);
  const markdownBody = buildStarterTemplate(incident, events, authorById);

  const [row] = await db
    .insert(postmortems)
    .values({ incidentId, markdownBody })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export async function findPostmortemByIdForUser(
  db: DB,
  userId: string,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) return null;

  const incident = await loadIncidentOrThrow(db, pm.incidentId);

  if (user.role !== 'admin') {
    const isMember =
      (
        await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(
            and(
              eq(teamMemberships.userId, userId),
              eq(teamMemberships.teamId, incident.teamId),
            ),
          )
          .limit(1)
      ).length > 0;
    if (!isMember) return null;
  }

  return { postmortem: pm, incident };
}

export async function findPostmortemForIncidentSlug(
  db: DB,
  userId: string,
  slug: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.publicSlug, slug))
    .limit(1);
  if (!incident) return null;

  if (user.role !== 'admin') {
    const isMember =
      (
        await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(
            and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, incident.teamId)),
          )
          .limit(1)
      ).length > 0;
    if (!isMember) return null;
  }

  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.incidentId, incident.id))
    .limit(1);
  if (!pm) return null;

  return { postmortem: pm, incident };
}

export async function updatePostmortemMarkdown(
  db: DB,
  callerId: string,
  postmortemId: string,
  markdownBody: string,
): Promise<Postmortem> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) throw new Error('Postmortem not found');
  const incident = await loadIncidentOrThrow(db, pm.incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [updated] = await db
    .update(postmortems)
    .set({ markdownBody, updatedAt: new Date() })
    .where(eq(postmortems.id, postmortemId))
    .returning();
  if (!updated) throw new Error('Update returned no rows');
  return updated;
}

export async function publishPostmortem(
  db: DB,
  callerId: string,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incidentId: string }> {
  return db.transaction(async (tx) => {
    const [pm] = await tx
      .select()
      .from(postmortems)
      .where(eq(postmortems.id, postmortemId))
      .limit(1);
    if (!pm) throw new Error('Postmortem not found');
    const incident = await loadIncidentOrThrow(tx as unknown as DB, pm.incidentId);
    await requireTeamMember(tx as unknown as DB, callerId, incident.teamId);

    if (pm.status === 'published') {
      return { postmortem: pm, incidentId: incident.id };
    }

    const now = new Date();
    const [updated] = await tx
      .update(postmortems)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(eq(postmortems.id, postmortemId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'postmortem_link',
      postmortemId: updated.id,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId: incident.id,
        authorUserId: callerId,
        kind: 'postmortem_link',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'postmortem_link',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { postmortem: updated, incidentId: incident.id };
  });
}

export async function setPostmortemPublicVisibility(
  db: DB,
  callerId: string,
  postmortemId: string,
  publicOnStatusPage: boolean,
): Promise<Postmortem> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) throw new Error('Postmortem not found');
  const incident = await loadIncidentOrThrow(db, pm.incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [updated] = await db
    .update(postmortems)
    .set({ publicOnStatusPage, updatedAt: new Date() })
    .where(eq(postmortems.id, postmortemId))
    .returning();
  if (!updated) throw new Error('Update returned no rows');
  return updated;
}
