import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema/users';
import {
  DB_ERR_NOT_NULL,
  DB_ERR_UNIQUE,
  expectDbError,
  getTestDb,
  useTestDb,
} from '../setup/db';

describe('users schema', () => {
  useTestDb();

  it('inserts and reads a user', async () => {
    const db = getTestDb();
    const [created] = await db
      .insert(users)
      .values({
        email: 'ana@acme.co',
        name: 'Ana',
        ssoSubject: 'idp|123',
      })
      .returning();

    expect(created).toBeDefined();
    expect(created!.id).toBeTruthy();
    expect(created!.role).toBe('member');
    expect(created!.createdAt).toBeInstanceOf(Date);

    const [fetched] = await db.select().from(users).where(eq(users.email, 'ana@acme.co'));
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Ana');
  });

  it('rejects duplicate emails', async () => {
    const db = getTestDb();
    await db.insert(users).values({ email: 'a@b.co', name: 'A', ssoSubject: 'idp|1' });
    await expect(
      db.insert(users).values({ email: 'a@b.co', name: 'A2', ssoSubject: 'idp|2' }),
    ).rejects.toMatchObject(expectDbError(DB_ERR_UNIQUE));
  });

  it('rejects insert without name (NOT NULL)', async () => {
    const db = getTestDb();
    await expect(
      db
        .insert(users)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ email: 'no-name@x.co', ssoSubject: 'idp|0' } as any),
    ).rejects.toMatchObject(expectDbError(DB_ERR_NOT_NULL));
  });

  it('rejects invalid role enum value', async () => {
    const db = getTestDb();
    await expect(
      db
        .insert(users)
        .values({
          email: 'bad-role@x.co',
          name: 'X',
          ssoSubject: 'idp|11',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          role: 'superadmin' as any,
        })
        .returning(),
    ).rejects.toMatchObject(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: expect.stringMatching(/invalid input value for enum/i),
        }),
      }),
    );
  });
});
