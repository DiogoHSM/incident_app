import { describe, expect, test } from 'vitest';
import {
  meanDurationMs,
  bucketByDay,
  severityMix,
  serviceHeatmap,
} from '@/lib/metrics/aggregations';
import type { Severity } from '@/lib/db/schema/services';

describe('meanDurationMs', () => {
  test('zero rows → null', () => {
    expect(meanDurationMs([])).toBeNull();
  });

  test('one row with from/to → exact diff in ms', () => {
    const from = new Date('2026-04-29T10:00:00Z');
    const to = new Date('2026-04-29T10:30:00Z');
    expect(meanDurationMs([{ from, to }])).toBe(30 * 60 * 1000);
  });

  test('multiple rows → arithmetic mean', () => {
    const rows = [
      { from: new Date('2026-04-29T10:00:00Z'), to: new Date('2026-04-29T10:10:00Z') },
      { from: new Date('2026-04-29T11:00:00Z'), to: new Date('2026-04-29T11:30:00Z') },
      { from: new Date('2026-04-29T12:00:00Z'), to: new Date('2026-04-29T13:00:00Z') },
    ];
    expect(meanDurationMs(rows)).toBe(((10 + 30 + 60) / 3) * 60 * 1000);
  });

  test('rows with non-positive duration are skipped', () => {
    const rows = [
      { from: new Date('2026-04-29T10:00:00Z'), to: new Date('2026-04-29T10:00:00Z') },
      { from: new Date('2026-04-29T11:30:00Z'), to: new Date('2026-04-29T11:00:00Z') },
      { from: new Date('2026-04-29T12:00:00Z'), to: new Date('2026-04-29T12:30:00Z') },
    ];
    expect(meanDurationMs(rows)).toBe(30 * 60 * 1000);
  });

  test('all rows non-positive → null', () => {
    const rows = [
      { from: new Date('2026-04-29T10:00:00Z'), to: new Date('2026-04-29T10:00:00Z') },
    ];
    expect(meanDurationMs(rows)).toBeNull();
  });
});

describe('bucketByDay', () => {
  const range = {
    from: new Date('2026-04-26T00:00:00Z'),
    to: new Date('2026-04-29T00:00:00Z'),
    bucket: 'day' as const,
  };

  test('zero rows → bucket per day with totals=0', () => {
    const out = bucketByDay([], range);
    expect(out.length).toBe(3);
    expect(out[0]?.date).toBe('2026-04-26');
    expect(out[0]?.total).toBe(0);
    expect(out[0]?.bySeverity).toEqual({ SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 });
  });

  test('rows fall into the correct UTC day', () => {
    const out = bucketByDay(
      [
        { at: new Date('2026-04-26T01:00:00Z'), severity: 'SEV1' as Severity },
        { at: new Date('2026-04-26T23:00:00Z'), severity: 'SEV2' as Severity },
        { at: new Date('2026-04-28T08:00:00Z'), severity: 'SEV1' as Severity },
      ],
      range,
    );
    expect(out[0]?.total).toBe(2);
    expect(out[0]?.bySeverity.SEV1).toBe(1);
    expect(out[0]?.bySeverity.SEV2).toBe(1);
    expect(out[1]?.total).toBe(0);
    expect(out[2]?.total).toBe(1);
    expect(out[2]?.bySeverity.SEV1).toBe(1);
  });

  test('rows without severity bump total but no severity bucket', () => {
    const out = bucketByDay(
      [{ at: new Date('2026-04-26T05:00:00Z') }],
      range,
    );
    expect(out[0]?.total).toBe(1);
    expect(out[0]?.bySeverity).toEqual({ SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 });
  });

  test('week bucket — 14-day window groups into 2 ISO weeks', () => {
    const weekRange = {
      from: new Date('2026-04-13T00:00:00Z'),
      to: new Date('2026-04-27T00:00:00Z'),
      bucket: 'week' as const,
    };
    const out = bucketByDay(
      [
        { at: new Date('2026-04-15T00:00:00Z'), severity: 'SEV2' as Severity },
        { at: new Date('2026-04-22T00:00:00Z'), severity: 'SEV1' as Severity },
      ],
      weekRange,
    );
    expect(out.length).toBe(2);
    expect(out[0]?.total).toBe(1);
    expect(out[1]?.total).toBe(1);
  });
});

describe('severityMix', () => {
  test('zero rows → all zeros, all four severities present', () => {
    const out = severityMix([]);
    expect(out.length).toBe(4);
    expect(out.map((r) => r.count)).toEqual([0, 0, 0, 0]);
    expect(out.map((r) => r.severity)).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
  });

  test('mixed rows tally correctly', () => {
    const out = severityMix([
      { severity: 'SEV1' as Severity },
      { severity: 'SEV1' as Severity },
      { severity: 'SEV3' as Severity },
    ]);
    const bySev = Object.fromEntries(out.map((r) => [r.severity, r.count]));
    expect(bySev.SEV1).toBe(2);
    expect(bySev.SEV2).toBe(0);
    expect(bySev.SEV3).toBe(1);
    expect(bySev.SEV4).toBe(0);
  });
});

describe('serviceHeatmap', () => {
  test('zero rows → empty matrix, max=0', () => {
    const out = serviceHeatmap([]);
    expect(out.services).toEqual([]);
    expect(out.matrix).toEqual([]);
    expect(out.max).toBe(0);
    expect(out.severities).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
  });

  test('matrix shape matches services × severities; max is the largest cell', () => {
    const out = serviceHeatmap([
      { serviceId: 'a', serviceName: 'auth', severity: 'SEV1' as Severity, count: 3 },
      { serviceId: 'a', serviceName: 'auth', severity: 'SEV2' as Severity, count: 1 },
      { serviceId: 'b', serviceName: 'billing', severity: 'SEV3' as Severity, count: 2 },
    ]);
    expect(out.services.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out.services.map((s) => s.name)).toEqual(['auth', 'billing']);
    expect(out.matrix[0]).toEqual([3, 1, 0, 0]);
    expect(out.matrix[1]).toEqual([0, 0, 2, 0]);
    expect(out.max).toBe(3);
  });

  test('services ordered alphabetically by name', () => {
    const out = serviceHeatmap([
      { serviceId: 'z', serviceName: 'zeta', severity: 'SEV1' as Severity, count: 1 },
      { serviceId: 'a', serviceName: 'alpha', severity: 'SEV1' as Severity, count: 1 },
    ]);
    expect(out.services.map((s) => s.name)).toEqual(['alpha', 'zeta']);
  });
});
