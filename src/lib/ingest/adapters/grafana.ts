import { z } from 'zod';
import type { Adapter, NormalizedAlert } from '../types';
import { compareBearer, expectSecretShape } from '../secret-material';
import { mapProviderSeverity } from '../severity';

const GrafanaAlert = z.object({
  fingerprint: z.string().min(1),
  status: z.string().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).optional(),
  generatorURL: z.string().url().optional(),
});

const GrafanaPayload = z.object({
  status: z.string().optional(),
  alerts: z.array(GrafanaAlert).min(1),
});

const SCHEME = 'Bearer ';

export const grafanaAdapter: Adapter = {
  type: 'grafana',

  async verify({ headers, source }) {
    const auth = headers.get('authorization');
    if (!auth) return { ok: false, reason: 'missing Authorization' };
    if (!auth.startsWith(SCHEME)) return { ok: false, reason: 'wrong scheme' };
    const candidate = auth.slice(SCHEME.length);

    const bcryptShape = expectSecretShape(source.secretMaterial as never, 'bcrypt');
    const ok = await compareBearer(candidate, bcryptShape);
    if (!ok) return { ok: false, reason: 'bearer mismatch' };
    return { ok: true };
  },

  normalize(payload: unknown): NormalizedAlert {
    const parsed = GrafanaPayload.parse(payload);
    const first = parsed.alerts[0];
    if (!first) throw new Error('grafana payload has empty alerts array');
    const service = first.labels.service ?? null;
    const title =
      first.labels.alertname ?? first.annotations?.summary ?? 'Grafana alert';
    return {
      title,
      fingerprint: first.fingerprint,
      severity: mapProviderSeverity('grafana', first.status ?? parsed.status),
      serviceSlugs: service ? [service] : [],
      sourceUrl: first.generatorURL ?? null,
      raw: payload,
    };
  },
};
