import { SEVERITY_VALUES, type Severity } from '@/lib/db/schema/services';
import type { WebhookSourceType } from '@/lib/db/schema/webhook-sources';

const SEVERITY_SET: ReadonlySet<string> = new Set(SEVERITY_VALUES);

const SENTRY_TABLE: Record<string, Severity> = {
  fatal: 'SEV1',
  error: 'SEV2',
  warning: 'SEV3',
  info: 'SEV4',
};

const DATADOG_TABLE: Record<string, Severity> = {
  critical: 'SEV1',
  error: 'SEV1',
  warning: 'SEV2',
};

const GRAFANA_TABLE: Record<string, Severity> = {
  alerting: 'SEV2',
  firing: 'SEV2',
};

/**
 * Map a provider's native severity vocabulary to our SEV1..SEV4 scale.
 * Returns null when the provider didn't supply a recognized severity —
 * the caller falls back to source.default_severity.
 *
 * Per spec §7.4: each provider has a different vocab; explicit fallthrough
 * (return null) beats silent SEV4 default at this layer.
 */
export function mapProviderSeverity(
  provider: WebhookSourceType,
  raw: unknown,
): Severity | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();

  if (provider === 'generic') {
    const upper = raw.toUpperCase();
    return SEVERITY_SET.has(upper) ? (upper as Severity) : null;
  }
  if (provider === 'sentry') return SENTRY_TABLE[lower] ?? null;
  if (provider === 'datadog') return DATADOG_TABLE[lower] ?? null;
  if (provider === 'grafana') return GRAFANA_TABLE[lower] ?? null;

  // Exhaustiveness — should never run because of the WebhookSourceType union.
  return null;
}
