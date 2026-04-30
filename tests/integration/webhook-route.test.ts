import { describe, expect, test, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { incidents } from '@/lib/db/schema/incidents';
import { deadLetterWebhooks } from '@/lib/db/schema/dead-letters';
import { createWebhookSource } from '@/lib/db/queries/webhook-sources';
import { POST } from '@/app/api/webhooks/[sourceId]/route';

function makeRequest(opts: {
  url: string;
  body: string;
  headers?: Record<string, string>;
}): Request {
  return new Request(opts.url, {
    method: 'POST',
    body: opts.body,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
}

describe('POST /api/webhooks/[sourceId]', () => {
  useTestDb();
  let admin: { id: string };
  let teamId: string;

  beforeEach(async () => {
    const db = getTestDb();
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

  test('happy path → 202 + creates triaging incident', async () => {
    const db = getTestDb();
    const { source, plaintextSecret } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'g',
      defaultSeverity: 'SEV3',
    });
    const body = JSON.stringify({
      title: 'Test',
      fingerprint: 'fp-route-1',
      severity: 'SEV2',
    });
    const sig = createHmac('sha256', plaintextSecret).update(body).digest('hex');
    const req = makeRequest({
      url: `https://app.test/api/webhooks/${source.id}`,
      body,
      headers: { 'x-signature': `sha256=${sig}` },
    });
    const res = await POST(req, { params: Promise.resolve({ sourceId: source.id }) });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { action: string; incidentId: string };
    expect(json.action).toBe('created');

    const [row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, json.incidentId))
      .limit(1);
    expect(row?.status).toBe('triaging');
  });

  test('unknown sourceId → 404 + no DB writes', async () => {
    const req = makeRequest({
      url: 'https://app.test/api/webhooks/00000000-0000-4000-8000-000000000000',
      body: '{}',
    });
    const res = await POST(req, {
      params: Promise.resolve({ sourceId: '00000000-0000-4000-8000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  test('bad HMAC → 401 + no incident, no dead letter', async () => {
    const db = getTestDb();
    const { source } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'g',
      defaultSeverity: 'SEV3',
    });
    const body = JSON.stringify({ title: 'X', fingerprint: 'fp' });
    const req = makeRequest({
      url: `https://app.test/api/webhooks/${source.id}`,
      body,
      headers: { 'x-signature': 'sha256=00000000' },
    });
    const res = await POST(req, { params: Promise.resolve({ sourceId: source.id }) });
    expect(res.status).toBe(401);

    const dlq = await db.select().from(deadLetterWebhooks);
    expect(dlq.length).toBe(0);
  });

  test('adapter throws (malformed JSON) → 422 + dead letter row', async () => {
    const db = getTestDb();
    const { source, plaintextSecret } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'g',
      defaultSeverity: 'SEV3',
    });
    const body = '{not json';
    const sig = createHmac('sha256', plaintextSecret).update(body).digest('hex');
    const req = makeRequest({
      url: `https://app.test/api/webhooks/${source.id}`,
      body,
      headers: { 'x-signature': `sha256=${sig}` },
    });
    const res = await POST(req, { params: Promise.resolve({ sourceId: source.id }) });
    expect(res.status).toBe(422);

    const dlq = await db.select().from(deadLetterWebhooks);
    expect(dlq.length).toBe(1);
    expect(dlq[0]?.sourceId).toBe(source.id);
    expect(dlq[0]?.error).toMatch(/json|adapter/i);
  });

  test('adapter throws (zod validation) → 422 + dead letter row', async () => {
    const db = getTestDb();
    const { source, plaintextSecret } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'g',
      defaultSeverity: 'SEV3',
    });
    const body = JSON.stringify({ this: 'is the wrong shape' });
    const sig = createHmac('sha256', plaintextSecret).update(body).digest('hex');
    const req = makeRequest({
      url: `https://app.test/api/webhooks/${source.id}`,
      body,
      headers: { 'x-signature': `sha256=${sig}` },
    });
    const res = await POST(req, { params: Promise.resolve({ sourceId: source.id }) });
    expect(res.status).toBe(422);

    const dlq = await db.select().from(deadLetterWebhooks);
    expect(dlq.length).toBe(1);
  });
});
