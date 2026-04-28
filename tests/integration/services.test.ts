import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import {
  DB_ERR_UNIQUE,
  expectDbError,
  startTestDb,
  truncateAll,
  type TestDBContext,
} from '../setup/db';

describe('services schema', () => {
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

  it('enforces unique (team_id, slug)', async () => {
    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    expect(team).toBeDefined();
    await ctx.db.insert(services).values({ teamId: team!.id, name: 'Checkout', slug: 'checkout' });
    await expect(
      ctx.db.insert(services).values({ teamId: team!.id, name: 'Checkout 2', slug: 'checkout' }),
    ).rejects.toMatchObject(expectDbError(DB_ERR_UNIQUE));
  });

  it('allows the same slug across different teams', async () => {
    const [t1] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(t1).toBeDefined();
    const [t2] = await ctx.db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
    expect(t2).toBeDefined();
    await ctx.db.insert(services).values({ teamId: t1!.id, name: 'api', slug: 'api' });
    await ctx.db.insert(services).values({ teamId: t2!.id, name: 'api', slug: 'api' });
    const all = await ctx.db.select().from(services);
    expect(all).toHaveLength(2);
  });
});
