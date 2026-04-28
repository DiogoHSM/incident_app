import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teamMemberships } from '@/lib/db/schema/team-memberships';

export async function isTeamMember(db: DB, userId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}
