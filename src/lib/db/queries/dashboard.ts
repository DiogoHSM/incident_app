import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { incidents, type Incident } from '@/lib/db/schema/incidents';
import { postmortems, type Postmortem } from '@/lib/db/schema/postmortems';
import { actionItems, type ActionItem } from '@/lib/db/schema/action-items';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { findUserById } from '@/lib/db/queries/users';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ActorScope {
  kind: 'admin' | 'teams' | 'none';
  teamIds: string[];
}

async function actorScope(db: DB, userId: string): Promise<ActorScope> {
  const user = await findUserById(db, userId);
  if (!user) return { kind: 'none', teamIds: [] };
  if (user.role === 'admin') return { kind: 'admin', teamIds: [] };
  const teamIds = (
    await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, userId))
  ).map((r) => r.teamId);
  return { kind: teamIds.length === 0 ? 'none' : 'teams', teamIds };
}

export async function countActiveIncidentsForUser(db: DB, userId: string): Promise<number> {
  const scope = await actorScope(db, userId);
  if (scope.kind === 'none') return 0;
  const conditions = [ne(incidents.status, 'resolved')];
  if (scope.kind === 'teams') conditions.push(inArray(incidents.teamId, scope.teamIds));
  const [row] = await db
    .select({ count: sql<number>`count(${incidents.id})::int` })
    .from(incidents)
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

export async function countOpenRcasForUser(db: DB, userId: string): Promise<number> {
  const scope = await actorScope(db, userId);
  if (scope.kind === 'none') return 0;
  const conditions = [eq(postmortems.status, 'draft')];
  if (scope.kind === 'teams') {
    conditions.push(inArray(incidents.teamId, scope.teamIds));
  }
  const [row] = await db
    .select({ count: sql<number>`count(${postmortems.id})::int` })
    .from(postmortems)
    .innerJoin(incidents, eq(incidents.id, postmortems.incidentId))
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

export async function countOpenActionItemsForUser(
  db: DB,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(${actionItems.id})::int` })
    .from(actionItems)
    .where(
      and(
        eq(actionItems.assigneeUserId, userId),
        inArray(actionItems.status, ['open', 'in_progress']),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function mttr7dForUser(
  db: DB,
  userId: string,
): Promise<number | null> {
  const scope = await actorScope(db, userId);
  if (scope.kind === 'none') return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);

  const conditions = [
    eq(incidents.status, 'resolved'),
    gte(incidents.resolvedAt, sevenDaysAgo),
  ];
  if (scope.kind === 'teams') conditions.push(inArray(incidents.teamId, scope.teamIds));

  const [row] = await db
    .select({
      meanMs: sql<number | null>`AVG(EXTRACT(EPOCH FROM (${incidents.resolvedAt} - ${incidents.declaredAt})) * 1000)::float`,
    })
    .from(incidents)
    .where(and(...conditions));

  if (!row || row.meanMs === null) return null;
  return Number(row.meanMs);
}

export async function listActiveIncidentsForUser(
  db: DB,
  userId: string,
  limit: number,
): Promise<Incident[]> {
  const scope = await actorScope(db, userId);
  if (scope.kind === 'none') return [];
  const conditions = [ne(incidents.status, 'resolved')];
  if (scope.kind === 'teams') conditions.push(inArray(incidents.teamId, scope.teamIds));
  return db
    .select()
    .from(incidents)
    .where(and(...conditions))
    .orderBy(desc(incidents.declaredAt))
    .limit(limit);
}

export async function listMyOpenActionItems(
  db: DB,
  userId: string,
  limit: number,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.assigneeUserId, userId),
        inArray(actionItems.status, ['open', 'in_progress']),
      ),
    )
    .orderBy(desc(actionItems.createdAt))
    .limit(limit);
}

export interface RecentPostmortemRow {
  postmortem: Postmortem;
  incident: Incident;
}

export async function listRecentPostmortemsForUser(
  db: DB,
  userId: string,
  limit: number,
): Promise<RecentPostmortemRow[]> {
  const scope = await actorScope(db, userId);
  if (scope.kind === 'none') return [];

  const conditions = [];
  if (scope.kind === 'teams') conditions.push(inArray(incidents.teamId, scope.teamIds));

  const rows = await db
    .select({ postmortem: postmortems, incident: incidents })
    .from(postmortems)
    .innerJoin(incidents, eq(incidents.id, postmortems.incidentId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(postmortems.updatedAt))
    .limit(limit);

  return rows.map((r) => ({ postmortem: r.postmortem, incident: r.incident }));
}
