import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Adapter, NormalizedAlert } from '../types';
import { decryptSecret, expectSecretShape } from '../secret-material';
import { mapProviderSeverity } from '../severity';

const GenericPayload = z.object({
  title: z.string().min(1).max(500),
  fingerprint: z.string().min(1).max(500),
  severity: z.string().optional(),
  services: z.array(z.string()).optional(),
  source_url: z.string().url().optional(),
  summary: z.string().optional(),
});

const SIG_PREFIX = 'sha256=';

export const genericAdapter: Adapter = {
  type: 'generic',

  async verify({ headers, rawBody, source }) {
    const header = headers.get('x-signature');
    if (!header) return { ok: false, reason: 'missing X-Signature' };
    if (!header.startsWith(SIG_PREFIX)) return { ok: false, reason: 'wrong scheme' };
    const provided = header.slice(SIG_PREFIX.length);

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
    const parsed = GenericPayload.parse(payload);
    return {
      title: parsed.title,
      fingerprint: parsed.fingerprint,
      severity: mapProviderSeverity('generic', parsed.severity),
      serviceSlugs: parsed.services ?? [],
      sourceUrl: parsed.source_url ?? null,
      raw: payload,
    };
  },
};
