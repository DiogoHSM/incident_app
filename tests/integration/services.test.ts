import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { listServicesForUser, createService } from '@/lib/db/queries/services';
import { ForbiddenError } from '@/lib/authz';
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

  it('listServicesForUser returns only services from teams the user belongs to', async () => {
    const [u1] = await ctx.db
      .insert(users)
      .values({ email: 'u1@x.co', name: 'U1', ssoSubject: 's|1' })
      .returning();
    expect(u1).toBeDefined();
    const [t1] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(t1).toBeDefined();
    const [t2] = await ctx.db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
    expect(t2).toBeDefined();
    await ctx.db.insert(teamMemberships).values({ teamId: t1!.id, userId: u1!.id });
    await ctx.db.insert(services).values({ teamId: t1!.id, name: 'mine', slug: 'mine' });
    await ctx.db.insert(services).values({ teamId: t2!.id, name: 'other', slug: 'other' });

    const out = await listServicesForUser(ctx.db, u1!.id);
    expect(out.map((s) => s.slug)).toEqual(['mine']);
  });

  it('createService rejects callers who are not members of the team', async () => {
    const [u1] = await ctx.db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
      .returning();
    expect(u1).toBeDefined();
    const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(team).toBeDefined();
    await expect(
      createService(ctx.db, u1!.id, { teamId: team!.id, name: 'svc', slug: 'svc' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('createService inserts when caller is a team member', async () => {
    const [u1] = await ctx.db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
      .returning();
    expect(u1).toBeDefined();
    const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    expect(team).toBeDefined();
    await ctx.db.insert(teamMemberships).values({ teamId: team!.id, userId: u1!.id });
    const created = await createService(ctx.db, u1!.id, {
      teamId: team!.id,
      name: 'svc',
      slug: 'svc',
    });
    expect(created.id).toBeTruthy();
    expect(created.slug).toBe('svc');
  });
});
