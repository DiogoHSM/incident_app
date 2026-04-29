import { type DB } from '@/lib/db/client';
import { findUserById } from '@/lib/db/queries/users';
import { isTeamMember } from '@/lib/db/queries/teams';

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function requireAdmin(db: DB, userId: string): Promise<void> {
  const user = await findUserById(db, userId);
  if (!user || user.role !== 'admin') {
    throw new ForbiddenError('Admin role required');
  }
}

export async function requireTeamMember(db: DB, userId: string, teamId: string): Promise<void> {
  const user = await findUserById(db, userId);
  if (!user) throw new ForbiddenError('Unknown user');
  if (user.role === 'admin') return;
  const ok = await isTeamMember(db, userId, teamId);
  if (!ok) throw new ForbiddenError('Not a member of this team');
}
