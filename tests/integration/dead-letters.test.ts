import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import {
  recordDeadLetter,
  listDeadLetters,
} from '@/lib/db/queries/dead-letters';
import { createWebhookSource } from '@/lib/db/queries/webhook-sources';
import { ForbiddenError } from '@/lib/authz';

describe('dead-letters queries', () => {
  useTestDb();
  let alice: { id: string };
  let admin: { id: string };
  let teamId: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });
    admin = await provisionUserOnSignIn(db, {
      email: 'admin@example.test',
      name: 'Admin',
      ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });
    const [t] = await db.insert(teams).values({ name: 'Platform', slug: 'platform' }).returning();
    if (!t) throw new Error('team');
    teamId = t.id;
  });

  test('recordDeadLetter persists the row with sourceId, headers, body, error', async () => {
    const db = getTestDb();
    const { source } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'g',
      defaultSeverity: 'SEV3',
    });
    const row = await recordDeadLetter(db, {
      sourceId: source.id,
      headers: { 'x-signature': 'sha256=ffff' },
      body: '{"foo":"bar"}',
      error: 'adapter threw: malformed',
    });
    expect(row.sourceId).toBe(source.id);
    expect(row.error).toContain('malformed');
  });

  test('recordDeadLetter accepts null sourceId (route fell over before lookup)', async () => {
    const db = getTestDb();
    const row = await recordDeadLetter(db, {
      sourceId: null,
      headers: {},
      body: '',
      error: 'no source matched',
    });
    expect(row.sourceId).toBeNull();
  });

  test('listDeadLetters (admin) returns rows newest-first respecting limit', async () => {
    const db = getTestDb();
    await recordDeadLetter(db, { sourceId: null, headers: {}, body: 'a', error: 'a' });
    await recordDeadLetter(db, { sourceId: null, headers: {}, body: 'b', error: 'b' });
    await recordDeadLetter(db, { sourceId: null, headers: {}, body: 'c', error: 'c' });
    const rows = await listDeadLetters(db, admin.id, { limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0]?.body).toBe('c');
    expect(rows[1]?.body).toBe('b');
  });

  test('listDeadLetters rejects non-admin', async () => {
    const db = getTestDb();
    await expect(listDeadLetters(db, alice.id, { limit: 10 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
