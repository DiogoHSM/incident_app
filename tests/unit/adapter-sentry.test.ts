import { describe, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { sentryAdapter } from '@/lib/ingest/adapters/sentry';
import { encryptSecret } from '@/lib/ingest/secret-material';
import type { WebhookSource } from '@/lib/db/schema/webhook-sources';
import happy from '@/../tests/__fixtures__/webhooks/sentry/happy.json';
import malformed from '@/../tests/__fixtures__/webhooks/sentry/malformed.json';
import missing from '@/../tests/__fixtures__/webhooks/sentry/missing-fields.json';

function makeSource(secret: string): WebhookSource {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    type: 'sentry',
    name: 'sentry-prod',
    secretMaterial: encryptSecret(secret),
    defaultSeverity: 'SEV3',
    defaultServiceId: null,
    autoPromoteThreshold: 3,
    autoPromoteWindowSeconds: 600,
    createdAt: new Date(),
  };
}

describe('sentryAdapter.verify', () => {
  test('accepts valid Sentry-Hook-Signature (HMAC SHA-256 hex over raw body)', async () => {
    const secret = 'sentry-secret';
    const source = makeSource(secret);
    const rawBody = JSON.stringify(happy);
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = new Headers({ 'sentry-hook-signature': sig });
    const result = await sentryAdapter.verify({ headers, rawBody, source });
    expect(result).toEqual({ ok: true });
  });

  test('rejects when header is missing', async () => {
    const source = makeSource('sentry-secret');
    const result = await sentryAdapter.verify({
      headers: new Headers(),
      rawBody: '{}',
      source,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects on tamper', async () => {
    const secret = 'sentry-secret';
    const source = makeSource(secret);
    const rawBody = JSON.stringify(happy);
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = new Headers({ 'sentry-hook-signature': sig });
    const result = await sentryAdapter.verify({
      headers,
      rawBody: rawBody.replace('error', 'fatal'),
      source,
    });
    expect(result.ok).toBe(false);
  });
});

describe('sentryAdapter.normalize', () => {
  test('happy → NormalizedAlert with fingerprint=issue.id, severity from level, project.slug as service', () => {
    const out = sentryAdapter.normalize(happy);
    expect(out.fingerprint).toBe('abc123def456');
    expect(out.severity).toBe('SEV2'); // level=error
    expect(out.serviceSlugs).toEqual(['api-server']);
    expect(out.sourceUrl).toBe('https://sentry.io/organizations/acme/issues/abc123def456/');
    expect(out.title).toContain('TypeError');
  });

  test('missing-fields (no level) → severity null', () => {
    const out = sentryAdapter.normalize(missing);
    expect(out.fingerprint).toBe('xyz789');
    expect(out.severity).toBeNull();
    expect(out.serviceSlugs).toEqual(['worker']);
  });

  test('malformed (data=null) throws', () => {
    expect(() => sentryAdapter.normalize(malformed)).toThrow();
  });
});
