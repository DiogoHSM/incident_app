import { describe, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { genericAdapter } from '@/lib/ingest/adapters/generic';
import { encryptSecret } from '@/lib/ingest/secret-material';
import type { WebhookSource } from '@/lib/db/schema/webhook-sources';
import happy from '@/../tests/__fixtures__/webhooks/generic/happy.json';
import malformed from '@/../tests/__fixtures__/webhooks/generic/malformed.json';
import missing from '@/../tests/__fixtures__/webhooks/generic/missing-fields.json';

function makeSource(secret: string): WebhookSource {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    type: 'generic',
    name: 'generic-prod',
    secretMaterial: encryptSecret(secret),
    defaultSeverity: 'SEV3',
    defaultServiceId: null,
    autoPromoteThreshold: 3,
    autoPromoteWindowSeconds: 600,
    createdAt: new Date(),
  };
}

describe('genericAdapter.verify', () => {
  test('accepts a valid HMAC SHA-256 signature in X-Signature: sha256=<hex>', async () => {
    const secret = 's3cret';
    const source = makeSource(secret);
    const rawBody = JSON.stringify(happy);
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = new Headers({ 'x-signature': `sha256=${sig}` });
    const result = await genericAdapter.verify({ headers, rawBody, source });
    expect(result).toEqual({ ok: true });
  });

  test('rejects when X-Signature header is missing', async () => {
    const source = makeSource('s3cret');
    const result = await genericAdapter.verify({
      headers: new Headers(),
      rawBody: '{}',
      source,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects when signature has the wrong prefix', async () => {
    const source = makeSource('s3cret');
    const headers = new Headers({ 'x-signature': 'md5=ffff' });
    const result = await genericAdapter.verify({ headers, rawBody: '{}', source });
    expect(result.ok).toBe(false);
  });

  test('rejects a tampered body', async () => {
    const secret = 's3cret';
    const source = makeSource(secret);
    const rawBody = JSON.stringify(happy);
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = new Headers({ 'x-signature': `sha256=${sig}` });
    const result = await genericAdapter.verify({
      headers,
      rawBody: rawBody + ' ',
      source,
    });
    expect(result.ok).toBe(false);
  });
});

describe('genericAdapter.normalize', () => {
  test('happy → NormalizedAlert with mapped severity + services', () => {
    const out = genericAdapter.normalize(happy);
    expect(out.title).toBe('Database connection pool exhausted');
    expect(out.fingerprint).toBe('db-pool-exhausted-prod');
    expect(out.severity).toBe('SEV2');
    expect(out.serviceSlugs).toEqual(['api', 'checkout']);
    expect(out.sourceUrl).toBe('https://internal.example.com/alerts/123');
    expect(out.raw).toEqual(happy);
  });

  test('missing-fields (no severity, no services) → severity null + serviceSlugs []', () => {
    const out = genericAdapter.normalize(missing);
    expect(out.severity).toBeNull();
    expect(out.serviceSlugs).toEqual([]);
    expect(out.sourceUrl).toBeNull();
  });

  test('malformed throws', () => {
    expect(() => genericAdapter.normalize(malformed)).toThrow();
  });
});
