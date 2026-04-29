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

describe('listIncidentsForUser', () => {
  let world: World;
  beforeEach(async () => {
    world = await seed();
    const db = getTestDb();
    await declareIncident(db, world.memberAId, {
      teamId: world.teamAId,
      title: 'A sev1',
      summary: '',
      severity: 'SEV1',
      affectedServiceIds: [],
    });
    await declareIncident(db, world.memberAId, {
      teamId: world.teamAId,
      title: 'A sev3',
      summary: '',
      severity: 'SEV3',
      affectedServiceIds: [],
    });
    const [old] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-old00000',
        teamId: world.teamAId,
        declaredBy: world.memberAId,
        severity: 'SEV4',
        title: 'A old',
        summary: '',
        declaredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60),
      })
      .returning();
    expect(old).toBeTruthy();
    await declareIncident(db, world.memberBId, {
      teamId: world.teamBId,
      title: 'B sev2',
      summary: '',
      severity: 'SEV2',
      affectedServiceIds: [],
    });
  });

  test('member sees only their team and only the last 30 days by default', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.memberAId, {});
    const titles = list.map((r) => r.title).sort();
    expect(titles).toEqual(['A sev1', 'A sev3']);
  });

  test('admin sees everything across teams within the window', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.adminId, {});
    expect(list.map((r) => r.title).sort()).toEqual(['A sev1', 'A sev3', 'B sev2']);
  });

  test('daysBack=90 includes the old one', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.memberAId, { daysBack: 90 });
    expect(list.map((r) => r.title).sort()).toEqual(['A old', 'A sev1', 'A sev3']);
  });

  test('severity filter narrows the list', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.adminId, { severity: 'SEV1' });
    expect(list.map((r) => r.title)).toEqual(['A sev1']);
  });

  test('teamId filter for admin', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.adminId, { teamId: world.teamBId });
    expect(list.map((r) => r.title)).toEqual(['B sev2']);
  });

  test('teamId filter ignored if member tries to peek another team', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.memberAId, {
      teamId: world.teamBId,
    });
    expect(list).toEqual([]);
  });

  test('outsider sees nothing', async () => {
    const list = await listIncidentsForUser(getTestDb(), world.outsiderId, {});
    expect(list).toEqual([]);
  });
});

describe('findIncidentBySlugForUser', () => {
  let world: World;
  let aSlug: string;

  beforeEach(async () => {
    world = await seed();
    const a = await declareIncident(getTestDb(), world.memberAId, {
      teamId: world.teamAId,
      title: 'detail-a',
      summary: 'sum',
      severity: 'SEV2',
      affectedServiceIds: [world.serviceA1Id],
    });
    aSlug = a.publicSlug;
  });

  test('team member sees their own team incident with affected services', async () => {
    const found = await findIncidentBySlugForUser(getTestDb(), world.memberAId, aSlug);
    expect(found).not.toBeNull();
    expect(found!.incident.title).toBe('detail-a');
    expect(found!.affectedServices.map((s) => s.slug)).toEqual(['a1']);
  });

  test('admin sees any incident', async () => {
    const found = await findIncidentBySlugForUser(getTestDb(), world.adminId, aSlug);
    expect(found?.incident.title).toBe('detail-a');
  });

  test('outsider cannot see', async () => {
    const found = await findIncidentBySlugForUser(getTestDb(), world.outsiderId, aSlug);
    expect(found).toBeNull();
  });

  test('member of another team cannot see', async () => {
    const found = await findIncidentBySlugForUser(getTestDb(), world.memberBId, aSlug);
    expect(found).toBeNull();
  });

  test('unknown slug returns null', async () => {
    const found = await findIncidentBySlugForUser(getTestDb(), world.adminId, 'inc-zzzzzzzz');
    expect(found).toBeNull();
  });
});
