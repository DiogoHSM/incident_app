import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { eq } from 'drizzle-orm';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

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
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/duplicate|unique/i) }),
    });
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
});
