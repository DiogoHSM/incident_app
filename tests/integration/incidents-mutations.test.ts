import { beforeEach, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents, type IncidentStatus } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { ForbiddenError } from '@/lib/authz';
import {
  declareIncident,
  changeIncidentStatus,
  changeIncidentSeverity,
  assignIncidentRole,
  IncidentStateMachineError,
} from '@/lib/db/queries/incidents';

interface World {
  adminId: string;
  memberAId: string;
  memberA2Id: string;
  outsiderId: string;
  teamAId: string;
  triagingId: string;
  investigatingId: string;
}

async function seed(): Promise<World> {
  const db = getTestDb();
  const [admin] = await db
    .insert(users)
    .values({ email: 'admin@x.co', name: 'Admin', ssoSubject: 's|admin', role: 'admin' })
    .returning();
  const [memberA] = await db
    .insert(users)
    .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a' })
    .returning();
  const [memberA2] = await db
    .insert(users)
    .values({ email: 'a2@x.co', name: 'A2', ssoSubject: 's|a2' })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
    .returning();
  const [teamA] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  await db.insert(teamMemberships).values([
    { userId: memberA!.id, teamId: teamA!.id, role: 'member' },
    { userId: memberA2!.id, teamId: teamA!.id, role: 'member' },
  ]);

  const investigating = await declareIncident(db, memberA!.id, {
    teamId: teamA!.id,
    title: 'live one',
    summary: '',
    severity: 'SEV2',
    affectedServiceIds: [],
  });
  // declareIncident now defaults to 'triaging'; force this fixture to 'investigating' so
  // the tests that depend on a non-triaging starting state continue to work.
  await db.update(incidents).set({ status: 'investigating' }).where(eq(incidents.id, investigating.id));

  // Insert a triaging-state incident directly.
  const [triaging] = await db
    .insert(incidents)
    .values({
      publicSlug: 'inc-triag001',
      teamId: teamA!.id,
      declaredBy: memberA!.id,
      severity: 'SEV3',
      status: 'triaging',
      title: 'unconfirmed alert',
      summary: '',
    })
    .returning();

  return {
    adminId: admin!.id,
    memberAId: memberA!.id,
    memberA2Id: memberA2!.id,
    outsiderId: outsider!.id,
    teamAId: teamA!.id,
    triagingId: triaging!.id,
    investigatingId: investigating.id,
  };
}

describe('changeIncidentStatus — allowed transitions', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  const allowed: Array<[IncidentStatus, IncidentStatus]> = [
    ['investigating', 'identified'],
    ['investigating', 'monitoring'],
    ['investigating', 'resolved'],
    ['identified', 'monitoring'],
    ['identified', 'investigating'],
    ['identified', 'resolved'],
    ['monitoring', 'resolved'],
    ['monitoring', 'investigating'],
    ['resolved', 'investigating'],
  ];

  test.each(allowed)('%s → %s succeeds and writes status_change event', async (from, to) => {
    const db = getTestDb();
    await db
      .update(incidents)
      .set({ status: from, resolvedAt: from === 'resolved' ? new Date() : null })
      .where(eq(incidents.id, world.investigatingId));

    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      to,
      {},
    );
    expect(result).not.toBeNull();
    expect(result!.incident.status).toBe(to);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.investigatingId));
    expect(events.some((e) => e.kind === 'status_change')).toBe(true);
  });

  test('same-status call is a no-op (returns null, writes no event)', async () => {
    const db = getTestDb();
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      'investigating',
      {},
    );
    expect(result).toBeNull();
    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.investigatingId));
    expect(events).toHaveLength(0);
  });

  test('→ resolved sets resolvedAt; resolved → investigating clears it', async () => {
    const db = getTestDb();
    const r1 = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      'resolved',
      {},
    );
    expect(r1!.incident.resolvedAt).toBeInstanceOf(Date);

    const r2 = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      'investigating',
      {},
    );
    expect(r2!.incident.resolvedAt).toBeNull();
  });
});

describe('changeIncidentStatus — forbidden transitions', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  const forbidden: Array<[IncidentStatus, IncidentStatus]> = [
    ['triaging', 'identified'],
    ['triaging', 'monitoring'],
    ['investigating', 'triaging'],
    ['identified', 'triaging'],
    ['monitoring', 'triaging'],
    ['monitoring', 'identified'],
    ['resolved', 'triaging'],
    ['resolved', 'identified'],
    ['resolved', 'monitoring'],
  ];

  test.each(forbidden)('%s → %s rejected with IncidentStateMachineError', async (from, to) => {
    const db = getTestDb();
    await db.update(incidents).set({ status: from }).where(eq(incidents.id, world.triagingId));
    await expect(
      changeIncidentStatus(db, world.memberAId, world.triagingId, to, {}),
    ).rejects.toBeInstanceOf(IncidentStateMachineError);
  });
});

describe('changeIncidentStatus — triaging requires IC', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('leaving triaging without IC throws', async () => {
    const db = getTestDb();
    await expect(
      changeIncidentStatus(db, world.memberAId, world.triagingId, 'investigating', {}),
    ).rejects.toBeInstanceOf(IncidentStateMachineError);
  });

  test('leaving triaging with assignIcUserId works and writes role_change + status_change', async () => {
    const db = getTestDb();
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.triagingId,
      'investigating',
      { assignIcUserId: world.memberA2Id },
    );
    expect(result).not.toBeNull();
    expect(result!.incident.status).toBe('investigating');
    expect(result!.incident.icUserId).toBe(world.memberA2Id);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.triagingId));
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(['role_change', 'status_change']);
  });

  test('leaving triaging when IC already set works without assignIcUserId', async () => {
    const db = getTestDb();
    await db
      .update(incidents)
      .set({ icUserId: world.memberAId })
      .where(eq(incidents.id, world.triagingId));
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.triagingId,
      'investigating',
      {},
    );
    expect(result!.incident.status).toBe('investigating');
  });

  test('triaging → resolved (false-positive close) does NOT require IC', async () => {
    const db = getTestDb();
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.triagingId,
      'resolved',
      {},
    );
    expect(result!.incident.status).toBe('resolved');
    expect(result!.incident.resolvedAt).toBeInstanceOf(Date);
  });

  test('assignIcUserId for a non-team-member is rejected', async () => {
    const db = getTestDb();
    await expect(
      changeIncidentStatus(db, world.memberAId, world.triagingId, 'investigating', {
        assignIcUserId: world.outsiderId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('changeIncidentStatus — authz', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('outsider cannot change status', async () => {
    await expect(
      changeIncidentStatus(getTestDb(), world.outsiderId, world.investigatingId, 'identified', {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('admin can change status without team membership', async () => {
    const result = await changeIncidentStatus(
      getTestDb(),
      world.adminId,
      world.investigatingId,
      'identified',
      {},
    );
    expect(result!.incident.status).toBe('identified');
  });
});

describe('changeIncidentSeverity', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('member can change SEV2 → SEV1 and writes severity_change event', async () => {
    const db = getTestDb();
    const result = await changeIncidentSeverity(
      db,
      world.memberAId,
      world.investigatingId,
      'SEV1',
    );
    expect(result!.incident.severity).toBe('SEV1');
    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.investigatingId));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('severity_change');
    expect(events[0]!.body).toMatchObject({ from: 'SEV2', to: 'SEV1' });
  });

  test('same-tier call is a no-op', async () => {
    const result = await changeIncidentSeverity(
      getTestDb(),
      world.memberAId,
      world.investigatingId,
      'SEV2',
    );
    expect(result).toBeNull();
  });

  test('outsider rejected', async () => {
    await expect(
      changeIncidentSeverity(getTestDb(), world.outsiderId, world.investigatingId, 'SEV1'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('admin can change without membership', async () => {
    const result = await changeIncidentSeverity(
      getTestDb(),
      world.adminId,
      world.investigatingId,
      'SEV4',
    );
    expect(result!.incident.severity).toBe('SEV4');
  });
});

describe('assignIncidentRole', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  for (const role of ['ic', 'scribe', 'comms'] as const) {
    test(`assigning ${role} writes role_change event and updates the column`, async () => {
      const db = getTestDb();
      const result = await assignIncidentRole(
        db,
        world.memberAId,
        world.investigatingId,
        role,
        world.memberA2Id,
      );
      expect(result).not.toBeNull();
      const column = ({ ic: 'icUserId', scribe: 'scribeUserId', comms: 'commsUserId' } as const)[
        role
      ];
      expect(result!.incident[column]).toBe(world.memberA2Id);

      const events = await db
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.incidentId, world.investigatingId),
            eq(timelineEvents.kind, 'role_change'),
          ),
        );
      expect(events).toHaveLength(1);
      expect(events[0]!.body).toMatchObject({
        kind: 'role_change',
        role,
        toUserId: world.memberA2Id,
      });
    });
  }

  test('unassigning (toUserId = null) is allowed and writes an event', async () => {
    const db = getTestDb();
    await assignIncidentRole(db, world.memberAId, world.investigatingId, 'ic', world.memberA2Id);
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'ic',
      null,
    );
    expect(result!.incident.icUserId).toBeNull();
    const events = await db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.incidentId, world.investigatingId),
          eq(timelineEvents.kind, 'role_change'),
        ),
      );
    expect(events).toHaveLength(2);
  });

  test('assigning the same user is a no-op', async () => {
    const db = getTestDb();
    await assignIncidentRole(db, world.memberAId, world.investigatingId, 'ic', world.memberA2Id);
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'ic',
      world.memberA2Id,
    );
    expect(result).toBeNull();
  });

  test('null → null on an unassigned role is a no-op (no event written)', async () => {
    const db = getTestDb();
    // The investigating incident has no IC initially.
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'ic',
      null,
    );
    expect(result).toBeNull();
    const events = await db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.incidentId, world.investigatingId),
          eq(timelineEvents.kind, 'role_change'),
        ),
      );
    expect(events).toHaveLength(0);
  });

  test('assigning a non-team-member is rejected', async () => {
    await expect(
      assignIncidentRole(
        getTestDb(),
        world.memberAId,
        world.investigatingId,
        'scribe',
        world.outsiderId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('assigning an admin (who is not on the team) is allowed because admins pass requireTeamMember', async () => {
    const db = getTestDb();
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'comms',
      world.adminId,
    );
    expect(result!.incident.commsUserId).toBe(world.adminId);
  });

  test('outsider actor rejected', async () => {
    await expect(
      assignIncidentRole(
        getTestDb(),
        world.outsiderId,
        world.investigatingId,
        'ic',
        world.memberAId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
