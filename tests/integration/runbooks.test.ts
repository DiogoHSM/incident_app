import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import { runbooks } from '@/lib/db/schema/runbooks';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { upsertRunbook, getRunbook } from '@/lib/db/queries/runbooks';
import { ForbiddenError } from '@/lib/authz';
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

  async function seedUserAndService() {
    const [u] = await ctx.db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
      .returning();
    expect(u).toBeDefined();
    const [t] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(t).toBeDefined();
    await ctx.db.insert(teamMemberships).values({ teamId: t!.id, userId: u!.id });
    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId: t!.id, name: 'api', slug: 'api' })
      .returning();
    expect(svc).toBeDefined();
    return { user: u!, team: t!, service: svc! };
  }

  it('upsertRunbook creates then updates the same row', async () => {
    const { user, service } = await seedUserAndService();
    const a = await upsertRunbook(ctx.db, user.id, {
      serviceId: service.id,
      severity: 'SEV2',
      markdownBody: 'first',
    });
    const b = await upsertRunbook(ctx.db, user.id, {
      serviceId: service.id,
      severity: 'SEV2',
      markdownBody: 'second',
    });
    expect(a.id).toBe(b.id);
    expect(b.markdownBody).toBe('second');
  });

  it('upsertRunbook denies non-team-members', async () => {
    const { service } = await seedUserAndService();
    const [outsider] = await ctx.db
      .insert(users)
      .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
      .returning();
    expect(outsider).toBeDefined();
    await expect(
      upsertRunbook(ctx.db, outsider!.id, {
        serviceId: service.id,
        severity: 'SEV2',
        markdownBody: 'x',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('getRunbook returns null when none exists', async () => {
    const { user, service } = await seedUserAndService();
    const got = await getRunbook(ctx.db, user.id, service.id, 'SEV1');
    expect(got).toBeNull();
  });
});
