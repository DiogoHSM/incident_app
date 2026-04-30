import { and, desc, eq, getTableColumns, gte, inArray } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import {
  incidents,
  incidentServices,
  type Incident,
  type IncidentStatus,
} from '@/lib/db/schema/incidents';
import { services, type Severity, type Service } from '@/lib/db/schema/services';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember, ForbiddenError } from '@/lib/authz';
import { generateIncidentSlug } from '@/lib/incidents/slug';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { TimelineEventBodySchema, type IncidentRole } from '@/lib/timeline/body';
import { notifyIncidentUpdate } from '@/lib/realtime/notify';
import { recomputeAllSnapshotsForTeam } from '@/lib/db/queries/status-snapshot';
import { notifySnapshotUpdated } from '@/lib/realtime/notify-snapshot';

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
    await recomputeAllSnapshotsForTeam(tx as unknown as DB, input.teamId);
    await notifySnapshotUpdated(tx as unknown as DB, 'public');
    await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: input.teamId });
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

    const scopeTeams = filters.teamId ? myTeamIds.filter((t) => t === filters.teamId) : myTeamIds;
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

export interface IncidentDetail {
  incident: Incident;
  affectedServices: Service[];
}

export async function findIncidentBySlugForUser(
  db: DB,
  userId: string,
  slug: string,
): Promise<IncidentDetail | null> {
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

  const affectedServices = await db
    .select(getTableColumns(services))
    .from(incidentServices)
    .innerJoin(services, eq(incidentServices.serviceId, services.id))
    .where(eq(incidentServices.incidentId, incident.id));

  return { incident, affectedServices };
}

export class IncidentStateMachineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentStateMachineError';
  }
}

const ALLOWED_TRANSITIONS: Record<IncidentStatus, ReadonlySet<IncidentStatus>> = {
  triaging: new Set<IncidentStatus>(['investigating', 'resolved']),
  investigating: new Set<IncidentStatus>(['identified', 'monitoring', 'resolved']),
  identified: new Set<IncidentStatus>(['monitoring', 'investigating', 'resolved']),
  monitoring: new Set<IncidentStatus>(['investigating', 'resolved']),
  resolved: new Set<IncidentStatus>(['investigating']),
};

export interface ChangeIncidentStatusOptions {
  reason?: string;
  assignIcUserId?: string;
}

export async function changeIncidentStatus(
  db: DB,
  actorUserId: string,
  incidentId: string,
  toStatus: IncidentStatus,
  options: ChangeIncidentStatusOptions = {},
): Promise<{ incident: Incident; statusEvent: typeof timelineEvents.$inferSelect } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as unknown as DB, actorUserId, current.teamId);

    if (current.status === toStatus) return null;

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.has(toStatus)) {
      throw new IncidentStateMachineError(
        `Cannot transition incident from ${current.status} to ${toStatus}`,
      );
    }

    let assigningIcId: string | null = null;
    if (current.status === 'triaging' && toStatus !== 'resolved') {
      if (!current.icUserId && !options.assignIcUserId) {
        throw new IncidentStateMachineError(
          'An Incident Commander must be assigned when leaving triaging',
        );
      }
      if (options.assignIcUserId && options.assignIcUserId !== current.icUserId) {
        await requireTeamMember(tx as unknown as DB, options.assignIcUserId, current.teamId);
        assigningIcId = options.assignIcUserId;
      }
    }

    const nextResolvedAt =
      toStatus === 'resolved' ? new Date() : current.status === 'resolved' ? null : current.resolvedAt;

    const updateValues: Partial<typeof incidents.$inferInsert> = {
      status: toStatus,
      resolvedAt: nextResolvedAt,
      updatedAt: new Date(),
    };
    if (assigningIcId) updateValues.icUserId = assigningIcId;

    const [updated] = await tx
      .update(incidents)
      .set(updateValues)
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    if (assigningIcId) {
      const roleBody = TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'ic' satisfies IncidentRole,
        fromUserId: current.icUserId,
        toUserId: assigningIcId,
      });
      const [roleEvent] = await tx
        .insert(timelineEvents)
        .values({
          incidentId,
          authorUserId: actorUserId,
          kind: 'role_change',
          body: roleBody,
        })
        .returning();
      if (!roleEvent) throw new Error('Insert returned no rows');
      await notifyIncidentUpdate(tx as unknown as DB, {
        incidentId: roleEvent.incidentId,
        eventId: roleEvent.id,
        kind: 'role_change',
        occurredAt: roleEvent.occurredAt.toISOString(),
      });
    }

    const statusBody = TimelineEventBodySchema.parse({
      kind: 'status_change',
      from: current.status,
      to: toStatus,
      reason: options.reason,
    });
    const [statusEvent] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'status_change',
        body: statusBody,
      })
      .returning();
    if (!statusEvent) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: statusEvent.incidentId,
      eventId: statusEvent.id,
      kind: 'status_change',
      occurredAt: statusEvent.occurredAt.toISOString(),
    });

    await recomputeAllSnapshotsForTeam(tx as unknown as DB, current.teamId);
    await notifySnapshotUpdated(tx as unknown as DB, 'public');
    await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: current.teamId });

    return { incident: updated, statusEvent };
  });
}

const ROLE_COLUMN: Record<IncidentRole, 'icUserId' | 'scribeUserId' | 'commsUserId'> = {
  ic: 'icUserId',
  scribe: 'scribeUserId',
  comms: 'commsUserId',
};

export async function assignIncidentRole(
  db: DB,
  actorUserId: string,
  incidentId: string,
  role: IncidentRole,
  toUserId: string | null,
): Promise<{ incident: Incident; event: typeof timelineEvents.$inferSelect } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as unknown as DB, actorUserId, current.teamId);

    const column = ROLE_COLUMN[role];
    const fromUserId = current[column];

    if (fromUserId === toUserId) return null;

    if (toUserId !== null) {
      await requireTeamMember(tx as unknown as DB, toUserId, current.teamId);
    }

    const [updated] = await tx
      .update(incidents)
      .set({ [column]: toUserId, updatedAt: new Date() })
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'role_change',
      role,
      fromUserId,
      toUserId,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'role_change',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'role_change',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { incident: updated, event };
  });
}

export async function postPublicStatusUpdate(
  db: DB,
  actorUserId: string,
  incidentId: string,
  message: string,
): Promise<typeof timelineEvents.$inferSelect> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    const user = await findUserById(tx as unknown as DB, actorUserId);
    if (!user) throw new ForbiddenError('Unknown user');
    const isAdmin = user.role === 'admin';
    const hasRole =
      current.icUserId === actorUserId ||
      current.scribeUserId === actorUserId ||
      current.commsUserId === actorUserId;
    if (!isAdmin && !hasRole) {
      throw new ForbiddenError('Only IC/Scribe/Comms or admin can post public updates');
    }

    const body = TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message,
      postedToScope: 'public',
    });

    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'status_update_published',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await recomputeAllSnapshotsForTeam(tx as unknown as DB, current.teamId);
    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'status_update_published',
      occurredAt: event.occurredAt.toISOString(),
    });
    await notifySnapshotUpdated(tx as unknown as DB, 'public');
    await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: current.teamId });

    return event;
  });
}

export async function changeIncidentSeverity(
  db: DB,
  actorUserId: string,
  incidentId: string,
  toSeverity: Severity,
): Promise<{ incident: Incident; event: typeof timelineEvents.$inferSelect } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as unknown as DB, actorUserId, current.teamId);

    if (current.severity === toSeverity) return null;

    const [updated] = await tx
      .update(incidents)
      .set({ severity: toSeverity, updatedAt: new Date() })
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'severity_change',
      from: current.severity,
      to: toSeverity,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'severity_change',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'severity_change',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { incident: updated, event };
  });
}
