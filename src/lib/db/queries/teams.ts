import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { teams } from '@/lib/db/schema/teams';
import { users, type User } from '@/lib/db/schema/users';

export async function isTeamMember(db: DB, userId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}

export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
}

export async function listMyTeams(db: DB, userId: string): Promise<TeamSummary[]> {
  return db
    .select({ id: teams.id, name: teams.name, slug: teams.slug })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, userId));
}

export async function listTeamMembersWithUsers(
  db: DB,
  teamId: string,
): Promise<Array<Pick<User, 'id' | 'name' | 'email'>>> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(teamMemberships)
    .innerJoin(users, eq(teamMemberships.userId, users.id))
    .where(eq(teamMemberships.teamId, teamId))
    .orderBy(users.name);
  return rows;
}
