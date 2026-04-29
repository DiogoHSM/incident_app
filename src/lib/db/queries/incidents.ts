import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import {
  incidents,
  incidentServices,
  type Incident,
  type IncidentStatus,
} from '@/lib/db/schema/incidents';
import { services, type Severity } from '@/lib/db/schema/services';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember, ForbiddenError } from '@/lib/authz';
import { generateIncidentSlug } from '@/lib/incidents/slug';

export interface DeclareIncidentInput {
  teamId: string;
  title: string;
  summary: string;
  severity: Severity;
  affectedServiceIds: string[];
}

export async function declareIncident(
  db: DB,
  callerId: string,
  input: DeclareIncidentInput,
): Promise<Incident> {
  await requireTeamMember(db, callerId, input.teamId);
  await assertCanAttachServices(db, callerId, input.affectedServiceIds);

  return db.transaction(async (tx) => {
    let incident: Incident | undefined;
    for (let attempt = 0; attempt < 3 && !incident; attempt++) {
      const slug = generateIncidentSlug();
      try {
        const [row] = await tx
          .insert(incidents)
          .values({
            publicSlug: slug,
            teamId: input.teamId,
            declaredBy: callerId,
            severity: input.severity,
            title: input.title,
            summary: input.summary,
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

    if (input.affectedServiceIds.length > 0) {
      await tx
        .insert(incidentServices)
        .values(
          input.affectedServiceIds.map((sid) => ({ incidentId: incident!.id, serviceId: sid })),
        );
    }
    return incident;
  });
}

async function assertCanAttachServices(
  db: DB,
  callerId: string,
  serviceIds: string[],
): Promise<void> {
  if (serviceIds.length === 0) return;
  const user = await findUserById(db, callerId);
  if (!user) throw new ForbiddenError('Unknown user');
  if (user.role === 'admin') return;

  const myTeamIds = (
    await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, callerId))
  ).map((r) => r.teamId);

  if (myTeamIds.length === 0) throw new ForbiddenError('Cannot attach services');

  const allowed = await db
    .select({ id: services.id })
    .from(services)
    .where(inArray(services.teamId, myTeamIds));
  const allowedSet = new Set(allowed.map((s) => s.id));
  for (const id of serviceIds) {
    if (!allowedSet.has(id)) throw new ForbiddenError('Cannot attach service from another team');
  }
}

export interface ListIncidentFilters {
  status?: IncidentStatus;
  severity?: Severity;
  teamId?: string;
  daysBack?: number;
}

export async function listIncidentsForUser(
  db: DB,
  userId: string,
  filters: ListIncidentFilters,
): Promise<Incident[]> {
  const user = await findUserById(db, userId);
  if (!user) return [];

  const days = filters.daysBack ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conditions = [gte(incidents.declaredAt, since)];

  if (filters.status) conditions.push(eq(incidents.status, filters.status));
  if (filters.severity) conditions.push(eq(incidents.severity, filters.severity));

  if (user.role !== 'admin') {
    const myTeamIds = (
      await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(eq(teamMemberships.userId, userId))
    ).map((r) => r.teamId);
    if (myTeamIds.length === 0) return [];

    const scopeTeams = filters.teamId
      ? myTeamIds.filter((t) => t === filters.teamId)
      : myTeamIds;
    if (scopeTeams.length === 0) return [];
    conditions.push(inArray(incidents.teamId, scopeTeams));
  } else if (filters.teamId) {
    conditions.push(eq(incidents.teamId, filters.teamId));
  }

  return db
    .select()
    .from(incidents)
    .where(and(...conditions))
    .orderBy(desc(incidents.declaredAt));
}

// Implemented in Task 6.
export async function findIncidentBySlugForUser(): Promise<never> {
  throw new Error('Not implemented yet — see Task 6');
}
