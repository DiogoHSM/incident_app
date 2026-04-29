import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teams, type Team, type NewTeam } from '@/lib/db/schema/teams';
import { teamMemberships, type NewTeamMembership } from '@/lib/db/schema/team-memberships';
import { requireAdmin } from '@/lib/authz';

export async function createTeamAsAdmin(
  db: DB,
  callerId: string,
  input: Pick<NewTeam, 'name' | 'slug'>,
): Promise<Team> {
  await requireAdmin(db, callerId);
  const [row] = await db.insert(teams).values(input).returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export async function addMembershipAsAdmin(
  db: DB,
  callerId: string,
  input: Pick<NewTeamMembership, 'teamId' | 'userId' | 'role'>,
): Promise<void> {
  await requireAdmin(db, callerId);
  await db
    .insert(teamMemberships)
    .values(input)
    .onConflictDoUpdate({
      target: [teamMemberships.teamId, teamMemberships.userId],
      set: { role: input.role ?? 'member' },
    });
}

export async function removeMembershipAsAdmin(
  db: DB,
  callerId: string,
  input: { teamId: string; userId: string },
): Promise<void> {
  await requireAdmin(db, callerId);
  await db
    .delete(teamMemberships)
    .where(and(eq(teamMemberships.teamId, input.teamId), eq(teamMemberships.userId, input.userId)));
}

export async function listTeamsWithMemberships(
  db: DB,
  callerId: string,
): Promise<Array<Team & { members: Array<{ userId: string; role: 'lead' | 'member' }> }>> {
  await requireAdmin(db, callerId);
  const allTeams = await db.select().from(teams);
  const memberships = await db.select().from(teamMemberships);
  return allTeams.map((t) => ({
    ...t,
    members: memberships
      .filter((m) => m.teamId === t.id)
      .map((m) => ({ userId: m.userId, role: m.role })),
  }));
}
