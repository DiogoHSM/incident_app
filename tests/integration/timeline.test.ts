import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { ForbiddenError } from '@/lib/authz';
import { declareIncident } from '@/lib/db/queries/incidents';
import {
  appendNote,
  listTimelineEventsForIncident,
} from '@/lib/db/queries/timeline';

interface World {
  adminId: string;
  memberAId: string;
  memberBId: string;
  outsiderId: string;
  teamAId: string;
  teamBId: string;
  incidentAId: string;
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
  const inc = await declareIncident(db, memberA!.id, {
    teamId: teamA!.id,
    title: 'incident A',
    summary: '',
    severity: 'SEV2',
    affectedServiceIds: [],
  });
  return {
    adminId: admin!.id,
    memberAId: memberA!.id,
    memberBId: memberB!.id,
    outsiderId: outsider!.id,
    teamAId: teamA!.id,
    teamBId: teamB!.id,
    incidentAId: inc.id,
  };
}

describe('appendNote', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('team member can append a note', async () => {
    const db = getTestDb();
    const ev = await appendNote(db, world.memberAId, world.incidentAId, 'rolling back deploy');
    expect(ev.kind).toBe('note');
    expect(ev.authorUserId).toBe(world.memberAId);
    expect(ev.incidentId).toBe(world.incidentAId);
    expect(ev.body).toEqual({ kind: 'note', markdown: 'rolling back deploy' });

    const rows = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.incidentAId));
    expect(rows).toHaveLength(1);
  });

  test('admin can append even without team membership', async () => {
    const db = getTestDb();
    const ev = await appendNote(db, world.adminId, world.incidentAId, 'admin checking in');
    expect(ev.authorUserId).toBe(world.adminId);
  });

  test('outsider cannot append', async () => {
    const db = getTestDb();
    await expect(
      appendNote(db, world.outsiderId, world.incidentAId, 'sneaky'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('member of another team cannot append', async () => {
    const db = getTestDb();
    await expect(
      appendNote(db, world.memberBId, world.incidentAId, 'wrong team'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('empty note rejected before authz', async () => {
    const db = getTestDb();
    await expect(appendNote(db, world.memberAId, world.incidentAId, '')).rejects.toThrow();
  });

  test('unknown incident throws', async () => {
    const db = getTestDb();
    await expect(
      appendNote(db, world.memberAId, '00000000-0000-0000-0000-000000000000', 'x'),
    ).rejects.toThrow();
  });
});

describe('listTimelineEventsForIncident', () => {
  useTestDb();
  let world: World;
  let firstAt: Date;
  let secondAt: Date;
  let thirdAt: Date;

  beforeEach(async () => {
    world = await seed();
    const db = getTestDb();
    firstAt = new Date(Date.now() - 1000 * 60 * 30);
    secondAt = new Date(Date.now() - 1000 * 60 * 15);
    thirdAt = new Date();
    await db.insert(timelineEvents).values([
      {
        incidentId: world.incidentAId,
        authorUserId: world.memberAId,
        kind: 'note',
        body: { kind: 'note', markdown: 'first' },
        occurredAt: firstAt,
      },
      {
        incidentId: world.incidentAId,
        authorUserId: world.memberAId,
        kind: 'note',
        body: { kind: 'note', markdown: 'second' },
        occurredAt: secondAt,
      },
      {
        incidentId: world.incidentAId,
        authorUserId: world.memberAId,
        kind: 'note',
        body: { kind: 'note', markdown: 'third' },
        occurredAt: thirdAt,
      },
    ]);
  });

  test('returns events newest-first', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.memberAId,
      world.incidentAId,
    );
    expect(events.map((e) => (e.body as { markdown: string }).markdown)).toEqual([
      'third',
      'second',
      'first',
    ]);
  });

  test('admin sees all without team membership', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.adminId,
      world.incidentAId,
    );
    expect(events).toHaveLength(3);
  });

  test('outsider denied', async () => {
    await expect(
      listTimelineEventsForIncident(getTestDb(), world.outsiderId, world.incidentAId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('member of another team denied', async () => {
    await expect(
      listTimelineEventsForIncident(getTestDb(), world.memberBId, world.incidentAId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('limit caps the result count', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.memberAId,
      world.incidentAId,
      { limit: 2 },
    );
    expect(events).toHaveLength(2);
    expect((events[0]!.body as { markdown: string }).markdown).toBe('third');
    expect((events[1]!.body as { markdown: string }).markdown).toBe('second');
  });

  test('before cursor returns older events only', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.memberAId,
      world.incidentAId,
      { before: secondAt },
    );
    expect(events.map((e) => (e.body as { markdown: string }).markdown)).toEqual(['first']);
  });
});
