import { describe, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { datadogAdapter } from '@/lib/ingest/adapters/datadog';
import { encryptSecret } from '@/lib/ingest/secret-material';
import type { WebhookSource } from '@/lib/db/schema/webhook-sources';
import happy from '@/../tests/__fixtures__/webhooks/datadog/happy.json';
import malformed from '@/../tests/__fixtures__/webhooks/datadog/malformed.json';
import missing from '@/../tests/__fixtures__/webhooks/datadog/missing-fields.json';

function makeSource(secret: string): WebhookSource {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    type: 'datadog',
    name: 'datadog-prod',
    secretMaterial: encryptSecret(secret),
    defaultSeverity: 'SEV3',
    defaultServiceId: null,
    autoPromoteThreshold: 3,
    autoPromoteWindowSeconds: 600,
    createdAt: new Date(),
  };
}

describe('datadogAdapter.verify', () => {
  test('accepts valid X-Datadog-Signature', async () => {
    const secret = 'dd-secret';
    const source = makeSource(secret);
    const rawBody = JSON.stringify(happy);
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = new Headers({ 'x-datadog-signature': sig });
    const result = await datadogAdapter.verify({ headers, rawBody, source });
    expect(result).toEqual({ ok: true });
  });

  test('rejects missing header', async () => {
    const source = makeSource('dd-secret');
    const result = await datadogAdapter.verify({
      headers: new Headers(),
      rawBody: '{}',
      source,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects tampered body', async () => {
    const secret = 'dd-secret';
    const source = makeSource(secret);
    const rawBody = JSON.stringify(happy);
    const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = new Headers({ 'x-datadog-signature': sig });
    const result = await datadogAdapter.verify({
      headers,
      rawBody: rawBody.replace('error', 'success'),
      source,
    });
    expect(result.ok).toBe(false);
  });
});

describe('datadogAdapter.normalize', () => {
  test('happy → fingerprint = alert_id:monitor.id, severity from alert_type, service from tags', () => {
    const out = datadogAdapter.normalize(happy);
    expect(out.fingerprint).toBe('1234567890:987654321');
    expect(out.severity).toBe('SEV1'); // alert_type=error
    expect(out.serviceSlugs).toEqual(['api']);
    expect(out.sourceUrl).toBe('https://app.datadoghq.com/event/1234567890');
    expect(out.title).toContain('CPU usage');
  });

  test('missing-fields (no alert_type, no tags, no link) → severity null + serviceSlugs []', () => {
    const out = datadogAdapter.normalize(missing);
    expect(out.fingerprint).toBe('555:777');
    expect(out.severity).toBeNull();
    expect(out.serviceSlugs).toEqual([]);
    expect(out.sourceUrl).toBeNull();
  });

  test('malformed throws', () => {
    expect(() => datadogAdapter.normalize(malformed)).toThrow();
  });
});
