import { describe, expect, test } from 'vitest';
import { grafanaAdapter } from '@/lib/ingest/adapters/grafana';
import { hashBearer } from '@/lib/ingest/secret-material';
import type { WebhookSource } from '@/lib/db/schema/webhook-sources';
import happy from '@/../tests/__fixtures__/webhooks/grafana/happy.json';
import malformed from '@/../tests/__fixtures__/webhooks/grafana/malformed.json';
import missing from '@/../tests/__fixtures__/webhooks/grafana/missing-fields.json';

async function makeSource(bearer: string): Promise<WebhookSource> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    type: 'grafana',
    name: 'grafana-prod',
    secretMaterial: await hashBearer(bearer),
    defaultSeverity: 'SEV3',
    defaultServiceId: null,
    autoPromoteThreshold: 3,
    autoPromoteWindowSeconds: 600,
    createdAt: new Date(),
  };
}

describe('grafanaAdapter.verify', () => {
  test('accepts valid Authorization: Bearer <token>', async () => {
    const source = await makeSource('graf-bearer');
    const headers = new Headers({ authorization: 'Bearer graf-bearer' });
    const result = await grafanaAdapter.verify({ headers, rawBody: '{}', source });
    expect(result).toEqual({ ok: true });
  });

  test('rejects missing Authorization header', async () => {
    const source = await makeSource('graf-bearer');
    const result = await grafanaAdapter.verify({
      headers: new Headers(),
      rawBody: '{}',
      source,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects wrong scheme', async () => {
    const source = await makeSource('graf-bearer');
    const headers = new Headers({ authorization: 'Basic graf-bearer' });
    const result = await grafanaAdapter.verify({ headers, rawBody: '{}', source });
    expect(result.ok).toBe(false);
  });

  test('rejects wrong token', async () => {
    const source = await makeSource('graf-bearer');
    const headers = new Headers({ authorization: 'Bearer wrong' });
    const result = await grafanaAdapter.verify({ headers, rawBody: '{}', source });
    expect(result.ok).toBe(false);
  });
});

describe('grafanaAdapter.normalize', () => {
  test('happy → fingerprint = alerts[0].fingerprint, service from labels.service, severity SEV2', () => {
    const out = grafanaAdapter.normalize(happy);
    expect(out.fingerprint).toBe('alert-uid-aaa111');
    expect(out.severity).toBe('SEV2'); // status=firing
    expect(out.serviceSlugs).toEqual(['checkout']);
    expect(out.sourceUrl).toBe(
      'https://grafana.example.com/alerting/list?ruleUID=alert-uid-aaa111',
    );
    expect(out.title).toBe('HighErrorRate');
  });

  test('missing-fields (no service label, no generatorURL, no annotations) → empty slugs + null url', () => {
    const out = grafanaAdapter.normalize(missing);
    expect(out.fingerprint).toBe('alert-uid-bbb222');
    expect(out.serviceSlugs).toEqual([]);
    expect(out.sourceUrl).toBeNull();
    expect(out.title).toBe('DiskFull');
  });

  test('malformed throws', () => {
    expect(() => grafanaAdapter.normalize(malformed)).toThrow();
  });
});
