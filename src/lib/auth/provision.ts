import { eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { users, type User } from '@/lib/db/schema/users';

export interface ProvisionInput {
  email: string;
  name: string;
  ssoSubject: string;
  adminEmails: string[];
}

export async function provisionUserOnSignIn(db: DB, input: ProvisionInput): Promise<User> {
  const email = input.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ name: input.name, ssoSubject: input.ssoSubject })
      .where(eq(users.id, existing.id))
      .returning();
    if (!updated) throw new Error('Update returned no rows');
    return updated;
  }

  const role = input.adminEmails.includes(email) ? 'admin' : 'member';
  const [created] = await db
    .insert(users)
    .values({ email, name: input.name, ssoSubject: input.ssoSubject, role })
    .returning();
  if (!created) throw new Error('Insert returned no rows');
  return created;
}
