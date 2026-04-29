import { describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { requireAdmin, requireTeamMember, ForbiddenError } from '@/lib/authz';
import { getTestDb, useTestDb } from '../setup/db';

describe('authz helpers', () => {
  useTestDb();

  async function seed() {
    const db = getTestDb();
    const [admin] = await db
      .insert(users)
      .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
      .returning();
    expect(admin).toBeDefined();
    const [member] = await db
      .insert(users)
      .values({ email: 'm@x.co', name: 'M', ssoSubject: 's|m' })
      .returning();
    expect(member).toBeDefined();
    const [outsider] = await db
      .insert(users)
      .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
      .returning();
    expect(outsider).toBeDefined();
    const [team] = await db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    expect(team).toBeDefined();
    await db.insert(teamMemberships).values({ teamId: team!.id, userId: member!.id });
    return { admin: admin!, member: member!, outsider: outsider!, team: team! };
  }

  it('requireAdmin allows admin users', async () => {
    const { admin } = await seed();
    await expect(requireAdmin(getTestDb(), admin.id)).resolves.toBeUndefined();
  });

  it('requireAdmin throws ForbiddenError for non-admins', async () => {
    const { member } = await seed();
    await expect(requireAdmin(getTestDb(), member.id)).rejects.toThrow(ForbiddenError);
  });

  it('requireTeamMember allows team members', async () => {
    const { member, team } = await seed();
    await expect(requireTeamMember(getTestDb(), member.id, team.id)).resolves.toBeUndefined();
  });

  it('requireTeamMember allows admins even without membership', async () => {
    const { admin, team } = await seed();
    await expect(requireTeamMember(getTestDb(), admin.id, team.id)).resolves.toBeUndefined();
  });

  it('requireTeamMember throws ForbiddenError for outsiders', async () => {
    const { outsider, team } = await seed();
    await expect(requireTeamMember(getTestDb(), outsider.id, team.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
