import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema/users';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('users schema', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('inserts and reads a user', async () => {
    const [created] = await ctx.db
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

    const [fetched] = await ctx.db.select().from(users).where(eq(users.email, 'ana@acme.co'));
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Ana');
  });

  it('rejects duplicate emails', async () => {
    await ctx.db.insert(users).values({ email: 'a@b.co', name: 'A', ssoSubject: 'idp|1' });
    await expect(
      ctx.db.insert(users).values({ email: 'a@b.co', name: 'A2', ssoSubject: 'idp|2' }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/duplicate|unique/i) }),
    });
  });
});
