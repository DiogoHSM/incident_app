import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { requireAdmin, requireTeamMember, ForbiddenError } from '@/lib/authz';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('authz helpers', () => {
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

  async function seed() {
    const [admin] = await ctx.db
      .insert(users)
      .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
      .returning();
    expect(admin).toBeDefined();
    const [member] = await ctx.db
      .insert(users)
      .values({ email: 'm@x.co', name: 'M', ssoSubject: 's|m' })
      .returning();
    expect(member).toBeDefined();
    const [outsider] = await ctx.db
      .insert(users)
      .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
      .returning();
    expect(outsider).toBeDefined();
    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    expect(team).toBeDefined();
    await ctx.db.insert(teamMemberships).values({ teamId: team!.id, userId: member!.id });
    return { admin: admin!, member: member!, outsider: outsider!, team: team! };
  }

  it('requireAdmin allows admin users', async () => {
    const { admin } = await seed();
    await expect(requireAdmin(ctx.db, admin.id)).resolves.toBeUndefined();
  });

  it('requireAdmin throws ForbiddenError for non-admins', async () => {
    const { member } = await seed();
    await expect(requireAdmin(ctx.db, member.id)).rejects.toThrow(ForbiddenError);
  });

  it('requireTeamMember allows team members', async () => {
    const { member, team } = await seed();
    await expect(requireTeamMember(ctx.db, member.id, team.id)).resolves.toBeUndefined();
  });

  it('requireTeamMember allows admins even without membership', async () => {
    const { admin, team } = await seed();
    await expect(requireTeamMember(ctx.db, admin.id, team.id)).resolves.toBeUndefined();
  });

  it('requireTeamMember throws ForbiddenError for outsiders', async () => {
    const { outsider, team } = await seed();
    await expect(requireTeamMember(ctx.db, outsider.id, team.id)).rejects.toThrow(ForbiddenError);
  });
});
