import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { teams } from '@/lib/db/schema/teams';

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
