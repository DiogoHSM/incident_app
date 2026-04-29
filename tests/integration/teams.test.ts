import { describe, expect, it, test } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { eq } from 'drizzle-orm';
import { DB_ERR_UNIQUE, expectDbError, getTestDb, useTestDb } from '../setup/db';
import {
  createTeamAsAdmin,
  addMembershipAsAdmin,
  removeMembershipAsAdmin,
} from '@/lib/db/queries/teams-admin';
import { listTeamMembersWithUsers } from '@/lib/db/queries/teams';
import { ForbiddenError } from '@/lib/authz';

describe('teams + memberships', () => {
  useTestDb();

  it('creates a team with a unique slug', async () => {
    const db = getTestDb();
    await db.insert(teams).values({ name: 'Payments', slug: 'payments' });
    await expect(
      db.insert(teams).values({ name: 'Payments 2', slug: 'payments' }),
    ).rejects.toMatchObject(expectDbError(DB_ERR_UNIQUE));
  });

  it('cascades delete: removing a team removes its memberships', async () => {
    const db = getTestDb();
    const [team] = await db.insert(teams).values({ name: 'Infra', slug: 'infra' }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 'idp|9' })
      .returning();
    expect(team).toBeDefined();
    expect(user).toBeDefined();
    await db.insert(teamMemberships).values({ teamId: team!.id, userId: user!.id });

    await db.delete(teams).where(eq(teams.id, team!.id));

    const remaining = await db.select().from(teamMemberships);
    expect(remaining).toHaveLength(0);
  });

  it('cascades delete: removing a user removes their memberships', async () => {
    const db = getTestDb();
    const [team] = await db.insert(teams).values({ name: 'Search', slug: 'search' }).returning();
    expect(team).toBeDefined();
    const [user] = await db
      .insert(users)
      .values({ email: 'u2@x.co', name: 'U2', ssoSubject: 'idp|10' })
      .returning();
    expect(user).toBeDefined();
    await db.insert(teamMemberships).values({ teamId: team!.id, userId: user!.id });

    await db.delete(users).where(eq(users.id, user!.id));

    const remaining = await db.select().from(teamMemberships);
    expect(remaining).toHaveLength(0);
  });

  it('createTeamAsAdmin requires admin role', async () => {
    const db = getTestDb();
    const [member] = await db
      .insert(users)
      .values({ email: 'm@x.co', name: 'M', ssoSubject: 's|m' })
      .returning();
    expect(member).toBeDefined();
    await expect(createTeamAsAdmin(db, member!.id, { name: 'X', slug: 'x' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('createTeamAsAdmin creates a team for admin caller', async () => {
    const db = getTestDb();
    const [admin] = await db
      .insert(users)
      .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
      .returning();
    expect(admin).toBeDefined();
    const team = await createTeamAsAdmin(db, admin!.id, { name: 'Payments', slug: 'payments' });
    expect(team.slug).toBe('payments');
  });

  it('add + remove membership round-trips', async () => {
    const db = getTestDb();
    const [admin] = await db
      .insert(users)
      .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
      .returning();
    expect(admin).toBeDefined();
    const [u] = await db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
      .returning();
    expect(u).toBeDefined();
    const [team] = await db.insert(teams).values({ name: 'X', slug: 'x' }).returning();
    expect(team).toBeDefined();
    await addMembershipAsAdmin(db, admin!.id, {
      teamId: team!.id,
      userId: u!.id,
      role: 'member',
    });
    const after = await db.select().from(teamMemberships);
    expect(after).toHaveLength(1);
    await removeMembershipAsAdmin(db, admin!.id, { teamId: team!.id, userId: u!.id });
    const after2 = await db.select().from(teamMemberships);
    expect(after2).toHaveLength(0);
  });
});

describe('listTeamMembersWithUsers', () => {
  useTestDb();

  test('returns alphabetized members of the given team only', async () => {
    const db = getTestDb();
    const [t1] = await db.insert(teams).values({ name: 'T1', slug: 't1' }).returning();
    const [t2] = await db.insert(teams).values({ name: 'T2', slug: 't2' }).returning();
    const [u1] = await db
      .insert(users)
      .values({ email: 'b@x.co', name: 'Bob', ssoSubject: 's|b' })
      .returning();
    const [u2] = await db
      .insert(users)
      .values({ email: 'a@x.co', name: 'Alice', ssoSubject: 's|a' })
      .returning();
    const [u3] = await db
      .insert(users)
      .values({ email: 'c@x.co', name: 'Carla', ssoSubject: 's|c' })
      .returning();
    await db.insert(teamMemberships).values([
      { userId: u1!.id, teamId: t1!.id, role: 'member' },
      { userId: u2!.id, teamId: t1!.id, role: 'member' },
      { userId: u3!.id, teamId: t2!.id, role: 'member' },
    ]);

    const list = await listTeamMembersWithUsers(db, t1!.id);
    expect(list.map((m) => m.name)).toEqual(['Alice', 'Bob']);
  });
});
