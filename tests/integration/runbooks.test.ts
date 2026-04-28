import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import { runbooks } from '@/lib/db/schema/runbooks';
import {
  DB_ERR_UNIQUE,
  expectDbError,
  startTestDb,
  truncateAll,
  type TestDBContext,
} from '../setup/db';

describe('runbooks schema', () => {
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

  it('enforces one runbook per (service, severity)', async () => {
    const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(team).toBeDefined();
    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId: team!.id, name: 'api', slug: 'api' })
      .returning();
    expect(svc).toBeDefined();
    await ctx.db
      .insert(runbooks)
      .values({ serviceId: svc!.id, severity: 'SEV2', markdownBody: '' });
    await expect(
      ctx.db.insert(runbooks).values({ serviceId: svc!.id, severity: 'SEV2', markdownBody: 'x' }),
    ).rejects.toMatchObject(expectDbError(DB_ERR_UNIQUE));
  });

  it('cascades delete with the parent service', async () => {
    const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(team).toBeDefined();
    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId: team!.id, name: 'api', slug: 'api' })
      .returning();
    expect(svc).toBeDefined();
    await ctx.db
      .insert(runbooks)
      .values({ serviceId: svc!.id, severity: 'SEV1', markdownBody: 'x' });
    await ctx.db.delete(services).where(eq(services.id, svc!.id));
    const remaining = await ctx.db.select().from(runbooks);
    expect(remaining).toHaveLength(0);
  });
});
