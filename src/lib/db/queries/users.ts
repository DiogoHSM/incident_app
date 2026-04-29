import { eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { users, type User } from '@/lib/db/schema/users';

export async function findUserById(db: DB, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function findUserByEmail(db: DB, email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return row ?? null;
}
