import { describe, expect, test } from 'vitest';
import { mapProviderSeverity } from '@/lib/ingest/severity';

describe('mapProviderSeverity — generic', () => {
  test('passes through SEV1..SEV4 verbatim', () => {
    for (const s of ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const) {
      expect(mapProviderSeverity('generic', s)).toBe(s);
    }
  });
  test('returns null for unknown values', () => {
    expect(mapProviderSeverity('generic', 'critical')).toBeNull();
    expect(mapProviderSeverity('generic', undefined)).toBeNull();
    expect(mapProviderSeverity('generic', null)).toBeNull();
  });
});

describe('mapProviderSeverity — sentry', () => {
  test('fatal → SEV1, error → SEV2, warning → SEV3, info → SEV4', () => {
    expect(mapProviderSeverity('sentry', 'fatal')).toBe('SEV1');
    expect(mapProviderSeverity('sentry', 'error')).toBe('SEV2');
    expect(mapProviderSeverity('sentry', 'warning')).toBe('SEV3');
    expect(mapProviderSeverity('sentry', 'info')).toBe('SEV4');
  });
  test('debug → null (caller falls back to default)', () => {
    expect(mapProviderSeverity('sentry', 'debug')).toBeNull();
  });
  test('case-insensitive', () => {
    expect(mapProviderSeverity('sentry', 'Error')).toBe('SEV2');
  });
});

describe('mapProviderSeverity — datadog', () => {
  test('alert_type=error/critical → SEV1, warning → SEV2, info/success → null', () => {
    expect(mapProviderSeverity('datadog', 'critical')).toBe('SEV1');
    expect(mapProviderSeverity('datadog', 'error')).toBe('SEV1');
    expect(mapProviderSeverity('datadog', 'warning')).toBe('SEV2');
    expect(mapProviderSeverity('datadog', 'info')).toBeNull();
    expect(mapProviderSeverity('datadog', 'success')).toBeNull();
  });
});

describe('mapProviderSeverity — grafana', () => {
  test('state=alerting → SEV2 (Grafana has no native severity), ok/no_data → null', () => {
    expect(mapProviderSeverity('grafana', 'alerting')).toBe('SEV2');
    expect(mapProviderSeverity('grafana', 'firing')).toBe('SEV2');
    expect(mapProviderSeverity('grafana', 'ok')).toBeNull();
    expect(mapProviderSeverity('grafana', 'no_data')).toBeNull();
  });
});
