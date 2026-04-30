import { and, eq, gte, lte, inArray, sql, asc } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { services, type Severity } from '@/lib/db/schema/services';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember } from '@/lib/authz';

export interface MetricsRange {
  from: Date;
  to: Date;
  teamId?: string;
}

async function teamScope(
  db: DB,
  actorUserId: string,
  teamId: string | undefined,
): Promise<{ kind: 'all' } | { kind: 'teams'; teamIds: string[] } | { kind: 'none' }> {
  const user = await findUserById(db, actorUserId);
  if (!user) return { kind: 'none' };

  if (user.role === 'admin') {
    return teamId ? { kind: 'teams', teamIds: [teamId] } : { kind: 'all' };
  }

  if (teamId) {
    await requireTeamMember(db, actorUserId, teamId);
    return { kind: 'teams', teamIds: [teamId] };
  }

  const myTeams = (
    await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, actorUserId))
  ).map((r) => r.teamId);

  if (myTeams.length === 0) return { kind: 'none' };
  return { kind: 'teams', teamIds: myTeams };
}

export interface ResolvedIncidentRow {
  incidentId: string;
  declaredAt: Date;
  resolvedAt: Date;
  severity: Severity;
  dismissed: boolean;
}

export async function listResolvedIncidentsInRange(
  db: DB,
  actorUserId: string,
  range: MetricsRange,
): Promise<ResolvedIncidentRow[]> {
  const scope = await teamScope(db, actorUserId, range.teamId);
  if (scope.kind === 'none') return [];

  const dismissedExists = sql<boolean>`EXISTS (
    SELECT 1 FROM timeline_events te
    WHERE te.incident_id = incidents.id
      AND te.kind = 'status_change'
      AND te.body->>'dismissed' = 'true'
  )`;

  const conditions = [
    eq(incidents.status, 'resolved'),
    gte(incidents.resolvedAt, range.from),
    lte(incidents.resolvedAt, range.to),
  ];

  if (scope.kind === 'teams') {
    conditions.push(inArray(incidents.teamId, scope.teamIds));
  }

  const rows = await db
    .select({
      incidentId: incidents.id,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
      severity: incidents.severity,
      dismissed: dismissedExists,
    })
    .from(incidents)
    .where(and(...conditions))
    .orderBy(asc(incidents.resolvedAt));

  return rows.map((r) => {
    if (!r.resolvedAt) throw new Error('resolved incident missing resolved_at');
    return {
      incidentId: r.incidentId,
      declaredAt: r.declaredAt,
      resolvedAt: r.resolvedAt,
      severity: r.severity,
      dismissed: Boolean(r.dismissed),
    };
  });
}

export interface AcknowledgedIncidentRow {
  incidentId: string;
  declaredAt: Date;
  acknowledgedAt: Date | null;
}

export async function listAcknowledgedIncidentsInRange(
  db: DB,
  actorUserId: string,
  range: MetricsRange,
): Promise<AcknowledgedIncidentRow[]> {
  const scope = await teamScope(db, actorUserId, range.teamId);
  if (scope.kind === 'none') return [];

  const ackSubquery = sql<string | null>`(
    SELECT MIN(te.occurred_at) FROM timeline_events te
    WHERE te.incident_id = incidents.id
      AND te.kind = 'status_change'
      AND te.body->>'from' = 'triaging'
      AND te.body->>'to' <> 'triaging'
  )`;

  const conditions = [
    sql`${incidents.declaredBy} IS NULL`,
    gte(incidents.declaredAt, range.from),
    lte(incidents.declaredAt, range.to),
  ];

  if (scope.kind === 'teams') {
    conditions.push(inArray(incidents.teamId, scope.teamIds));
  }

  const rows = await db
    .select({
      incidentId: incidents.id,
      declaredAt: incidents.declaredAt,
      acknowledgedAt: ackSubquery,
    })
    .from(incidents)
    .where(and(...conditions))
    .orderBy(asc(incidents.declaredAt));

  return rows.map((r) => ({
    incidentId: r.incidentId,
    declaredAt: r.declaredAt,
    acknowledgedAt: r.acknowledgedAt != null ? new Date(r.acknowledgedAt) : null,
  }));
}

export interface DeclaredIncidentRow {
  incidentId: string;
  declaredAt: Date;
  severity: Severity;
}

export async function listDeclaredIncidentsInRange(
  db: DB,
  actorUserId: string,
  range: MetricsRange,
): Promise<DeclaredIncidentRow[]> {
  const scope = await teamScope(db, actorUserId, range.teamId);
  if (scope.kind === 'none') return [];

  const conditions = [
    gte(incidents.declaredAt, range.from),
    lte(incidents.declaredAt, range.to),
  ];

  if (scope.kind === 'teams') {
    conditions.push(inArray(incidents.teamId, scope.teamIds));
  }

  const rows = await db
    .select({
      incidentId: incidents.id,
      declaredAt: incidents.declaredAt,
      severity: incidents.severity,
    })
    .from(incidents)
    .where(and(...conditions))
    .orderBy(asc(incidents.declaredAt));

  return rows.map((r) => ({
    incidentId: r.incidentId,
    declaredAt: r.declaredAt,
    severity: r.severity,
  }));
}

export interface ServiceIncidentCountRow {
  serviceId: string;
  serviceName: string;
  severity: Severity;
  count: number;
}

export async function listIncidentsByServiceInRange(
  db: DB,
  actorUserId: string,
  range: MetricsRange,
): Promise<ServiceIncidentCountRow[]> {
  const scope = await teamScope(db, actorUserId, range.teamId);
  if (scope.kind === 'none') return [];

  const conditions = [
    gte(incidents.declaredAt, range.from),
    lte(incidents.declaredAt, range.to),
  ];

  if (scope.kind === 'teams') {
    conditions.push(inArray(incidents.teamId, scope.teamIds));
  }

  const rows = await db
    .select({
      serviceId: services.id,
      serviceName: services.name,
      severity: incidents.severity,
      count: sql<number>`count(${incidents.id})::int`,
    })
    .from(incidents)
    .innerJoin(incidentServices, eq(incidentServices.incidentId, incidents.id))
    .innerJoin(services, eq(incidentServices.serviceId, services.id))
    .where(and(...conditions))
    .groupBy(services.id, services.name, incidents.severity)
    .orderBy(asc(services.name), asc(incidents.severity));

  return rows.map((r) => ({
    serviceId: r.serviceId,
    serviceName: r.serviceName,
    severity: r.severity,
    count: Number(r.count),
  }));
}
