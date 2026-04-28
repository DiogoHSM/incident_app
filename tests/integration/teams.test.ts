import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { eq } from 'drizzle-orm';
import {
  DB_ERR_UNIQUE,
  expectDbError,
  startTestDb,
  truncateAll,
  type TestDBContext,
} from '../setup/db';

describe('teams + memberships', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('creates a team with a unique slug', async () => {
    await ctx.db.insert(teams).values({ name: 'Payments', slug: 'payments' });
    await expect(
      ctx.db.insert(teams).values({ name: 'Payments 2', slug: 'payments' }),
    ).rejects.toMatchObject(expectDbError(DB_ERR_UNIQUE));
  });

  it('cascades delete: removing a team removes its memberships', async () => {
    const [team] = await ctx.db.insert(teams).values({ name: 'Infra', slug: 'infra' }).returning();
    const [user] = await ctx.db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 'idp|9' })
      .returning();
    expect(team).toBeDefined();
    expect(user).toBeDefined();
    await ctx.db.insert(teamMemberships).values({ teamId: team!.id, userId: user!.id });

    await ctx.db.delete(teams).where(eq(teams.id, team!.id));

    const remaining = await ctx.db.select().from(teamMemberships);
    expect(remaining).toHaveLength(0);
  });

  it('cascades delete: removing a user removes their memberships', async () => {
    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Search', slug: 'search' })
      .returning();
    expect(team).toBeDefined();
    const [user] = await ctx.db
      .insert(users)
      .values({ email: 'u2@x.co', name: 'U2', ssoSubject: 'idp|10' })
      .returning();
    expect(user).toBeDefined();
    await ctx.db.insert(teamMemberships).values({ teamId: team!.id, userId: user!.id });

    await ctx.db.delete(users).where(eq(users.id, user!.id));

    const remaining = await ctx.db.select().from(teamMemberships);
    expect(remaining).toHaveLength(0);
  });
});
