import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { users } from '@/lib/db/schema/users';
import { getTestDb, useTestDb } from '../setup/db';

describe('provisionUserOnSignIn', () => {
  useTestDb();

  it('creates a new user with role=member by default', async () => {
    const db = getTestDb();
    const result = await provisionUserOnSignIn(db, {
      email: 'NEW@x.co',
      name: 'New',
      ssoSubject: 'sub|1',
      adminEmails: [],
    });
    expect(result.role).toBe('member');
    expect(result.email).toBe('new@x.co');
  });

  it('creates a new user with role=admin if email matches allowlist', async () => {
    const db = getTestDb();
    const result = await provisionUserOnSignIn(db, {
      email: 'admin@x.co',
      name: 'Admin',
      ssoSubject: 'sub|2',
      adminEmails: ['admin@x.co'],
    });
    expect(result.role).toBe('admin');
  });

  it('updates name and ssoSubject on subsequent sign-in but does not change role', async () => {
    const db = getTestDb();
    await provisionUserOnSignIn(db, {
      email: 'p@x.co',
      name: 'Old Name',
      ssoSubject: 'sub|old',
      adminEmails: [],
    });
    const updated = await provisionUserOnSignIn(db, {
      email: 'p@x.co',
      name: 'New Name',
      ssoSubject: 'sub|new',
      adminEmails: ['p@x.co'],
    });
    expect(updated.name).toBe('New Name');
    expect(updated.ssoSubject).toBe('sub|new');
    expect(updated.role).toBe('member');

    const [row] = await db.select().from(users).where(eq(users.email, 'p@x.co'));
    expect(row).toBeDefined();
    expect(row!.role).toBe('member');
  });
});
