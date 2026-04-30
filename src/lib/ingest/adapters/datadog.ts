import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Adapter, NormalizedAlert } from '../types';
import { decryptSecret, expectSecretShape } from '../secret-material';
import { mapProviderSeverity } from '../severity';

const DatadogPayload = z.object({
  alert_id: z.string().min(1),
  alert_title: z.string().min(1),
  alert_type: z.string().optional(),
  monitor: z.object({ id: z.string().min(1) }),
  tags: z.string().optional(),
  link: z.string().url().optional(),
});

/**
 * Datadog's `tags` field is a comma-separated string like
 * "service:api,env:prod,host:api-prod-3". We pull values where the
 * key is "service" and use those as service slugs. Multiple service:
 * tags map to multiple slugs; missing → empty array (caller falls
 * back to source.default_service_id).
 */
function extractServiceSlugs(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.startsWith('service:'))
    .map((t) => t.slice('service:'.length))
    .filter((s) => s.length > 0);
}

export const datadogAdapter: Adapter = {
  type: 'datadog',

  async verify({ headers, rawBody, source }) {
    const provided = headers.get('x-datadog-signature');
    if (!provided) return { ok: false, reason: 'missing X-Datadog-Signature' };

    const aes = expectSecretShape(source.secretMaterial, 'aes');
    const secret = decryptSecret(aes);
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'signature length mismatch' };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: 'signature mismatch' };
    return { ok: true };
  },

  normalize(payload: unknown): NormalizedAlert {
    const parsed = DatadogPayload.parse(payload);
    return {
      title: parsed.alert_title,
      fingerprint: `${parsed.alert_id}:${parsed.monitor.id}`,
      severity: mapProviderSeverity('datadog', parsed.alert_type),
      serviceSlugs: extractServiceSlugs(parsed.tags),
      sourceUrl: parsed.link ?? null,
      raw: payload,
    };
  },
};
