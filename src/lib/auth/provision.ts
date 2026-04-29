import { sql } from 'drizzle-orm';
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
  const role = input.adminEmails.includes(email) ? 'admin' : 'member';

  const [row] = await db
    .insert(users)
    .values({ email, name: input.name, ssoSubject: input.ssoSubject, role })
    .onConflictDoUpdate({
      target: users.email,
      // Intentionally omit role from SET so re-login never demotes/promotes;
      // role transitions go through the admin UI.
      set: {
        name: sql`excluded.name`,
        ssoSubject: sql`excluded.sso_subject`,
      },
    })
    .returning();

  if (!row) throw new Error('Upsert returned no rows');
  return row;
}
