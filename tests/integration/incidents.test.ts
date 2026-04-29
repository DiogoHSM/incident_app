import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb, getTestDb, expectDbError, DB_ERR_FK } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { ForbiddenError } from '@/lib/authz';
import {
  declareIncident,
  listIncidentsForUser,
  findIncidentBySlugForUser,
} from '@/lib/db/queries/incidents';

useTestDb();

interface World {
  adminId: string;
  memberAId: string;
  memberBId: string;
  outsiderId: string;
  teamAId: string;
  teamBId: string;
  serviceA1Id: string;
  serviceB1Id: string;
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
  const [memberB] = await db
    .insert(users)
    .values({ email: 'b@x.co', name: 'B', ssoSubject: 's|b' })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
    .returning();
  const [teamA] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  const [teamB] = await db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
  await db.insert(teamMemberships).values([
    { userId: memberA!.id, teamId: teamA!.id, role: 'member' },
    { userId: memberB!.id, teamId: teamB!.id, role: 'member' },
  ]);
  const [serviceA1] = await db
    .insert(services)
    .values({ teamId: teamA!.id, name: 'a1', slug: 'a1' })
    .returning();
  const [serviceB1] = await db
    .insert(services)
    .values({ teamId: teamB!.id, name: 'b1', slug: 'b1' })
    .returning();
  return {
    adminId: admin!.id,
    memberAId: memberA!.id,
    memberBId: memberB!.id,
    outsiderId: outsider!.id,
    teamAId: teamA!.id,
    teamBId: teamB!.id,
    serviceA1Id: serviceA1!.id,
    serviceB1Id: serviceB1!.id,
  };
}

describe('declareIncident', () => {
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('team member can declare with affected services from their own team', async () => {
    const db = getTestDb();
    const inc = await declareIncident(db, world.memberAId, {
      teamId: world.teamAId,
      title: 'API down',
      summary: '500s on /v1/login',
      severity: 'SEV2',
      affectedServiceIds: [world.serviceA1Id],
    });
    expect(inc.publicSlug).toMatch(/^inc-[a-z0-9]{8}$/);
    expect(inc.status).toBe('investigating');
    expect(inc.severity).toBe('SEV2');
    expect(inc.declaredBy).toBe(world.memberAId);
    expect(inc.teamId).toBe(world.teamAId);
    expect(inc.resolvedAt).toBeNull();

    const links = await db
      .select()
      .from(incidentServices)
      .where(eq(incidentServices.incidentId, inc.id));
    expect(links).toHaveLength(1);
    expect(links[0]!.serviceId).toBe(world.serviceA1Id);
  });

  test('team member cannot attach services from another team', async () => {
    const db = getTestDb();
    await expect(
      declareIncident(db, world.memberAId, {
        teamId: world.teamAId,
        title: 'cross-team',
        summary: '',
        severity: 'SEV3',
        affectedServiceIds: [world.serviceA1Id, world.serviceB1Id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('admin can declare on any team and attach any services', async () => {
    const db = getTestDb();
    const inc = await declareIncident(db, world.adminId, {
      teamId: world.teamAId,
      title: 'admin cross',
      summary: '',
      severity: 'SEV1',
      affectedServiceIds: [world.serviceA1Id, world.serviceB1Id],
    });
    expect(inc.severity).toBe('SEV1');
    const links = await db
      .select()
      .from(incidentServices)
      .where(eq(incidentServices.incidentId, inc.id));
    expect(links.map((l) => l.serviceId).sort()).toEqual(
      [world.serviceA1Id, world.serviceB1Id].sort(),
    );
  });

  test('outsider cannot declare on any team', async () => {
    const db = getTestDb();
    await expect(
      declareIncident(db, world.outsiderId, {
        teamId: world.teamAId,
        title: 'nope',
        summary: '',
        severity: 'SEV3',
        affectedServiceIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('declaring with zero services is allowed', async () => {
    const db = getTestDb();
    const inc = await declareIncident(db, world.memberAId, {
      teamId: world.teamAId,
      title: 'unknown blast radius',
      summary: '',
      severity: 'SEV3',
      affectedServiceIds: [],
    });
    expect(inc.id).toBeTruthy();
  });

  test('referenced service that does not exist surfaces a FK error', async () => {
    const db = getTestDb();
    await expect(
      declareIncident(db, world.adminId, {
        teamId: world.teamAId,
        title: 'fk',
        summary: '',
        severity: 'SEV3',
        affectedServiceIds: ['00000000-0000-0000-0000-000000000000'],
      }),
    ).rejects.toThrow(expectDbError(DB_ERR_FK));
  });
});
