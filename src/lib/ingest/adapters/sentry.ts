import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Adapter, NormalizedAlert } from '../types';
import { decryptSecret, expectSecretShape } from '../secret-material';
import { mapProviderSeverity } from '../severity';

/**
 * Sentry's "issue alert" webhook shape (subset). We accept a minimal
 * required core so the adapter doesn't break when Sentry adds new
 * envelope fields. Service slug is derived from `data.issue.project.slug`
 * — operators must align Sentry project slugs with our service slugs
 * for matching to work; if they don't, the incident is created with
 * source.default_service_id (handled by the ingest core, not here).
 */
const SentryPayload = z.object({
  data: z.object({
    issue: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      level: z.string().optional(),
      permalink: z.string().url().optional(),
      project: z.object({ slug: z.string().min(1) }),
    }),
  }),
});

export const sentryAdapter: Adapter = {
  type: 'sentry',

  async verify({ headers, rawBody, source }) {
    const provided = headers.get('sentry-hook-signature');
    if (!provided) return { ok: false, reason: 'missing Sentry-Hook-Signature' };

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
    const parsed = SentryPayload.parse(payload);
    const issue = parsed.data.issue;
    return {
      title: issue.title,
      fingerprint: issue.id,
      severity: mapProviderSeverity('sentry', issue.level),
      serviceSlugs: [issue.project.slug],
      sourceUrl: issue.permalink ?? null,
      raw: payload,
    };
  },
};
