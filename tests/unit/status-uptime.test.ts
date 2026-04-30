import { describe, expect, test } from 'vitest';
import { computeUptimeFromDurations, severityWeight } from '@/lib/status/uptime';

describe('severityWeight', () => {
  test('SEV1=1, SEV2=1, SEV3=0.5, SEV4=0', () => {
    expect(severityWeight('SEV1')).toBe(1);
    expect(severityWeight('SEV2')).toBe(1);
    expect(severityWeight('SEV3')).toBe(0.5);
    expect(severityWeight('SEV4')).toBe(0);
  });
});

describe('computeUptimeFromDurations', () => {
  const HOUR = 60 * 60 * 1000;

  test('no incidents → 1.0 uptime', () => {
    expect(computeUptimeFromDurations([], 30 * 24 * HOUR)).toBe(1);
  });

  test('single 1h SEV1 over a 30d window ≈ ~0.9986', () => {
    const totalMs = 30 * 24 * HOUR;
    const downMs = 1 * HOUR;
    const expected = 1 - downMs / totalMs;
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV1', durationMs: 1 * HOUR }],
        totalMs,
      ),
    ).toBeCloseTo(expected, 6);
  });

  test('SEV3 weighted at 0.5', () => {
    const totalMs = 30 * 24 * HOUR;
    const downMs = 0.5 * HOUR;
    const expected = 1 - downMs / totalMs;
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV3', durationMs: 1 * HOUR }],
        totalMs,
      ),
    ).toBeCloseTo(expected, 6);
  });

  test('SEV4 contributes nothing', () => {
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV4', durationMs: 24 * HOUR }],
        30 * 24 * HOUR,
      ),
    ).toBe(1);
  });

  test('caps at 30d × 24h — ridiculous downtime clamped', () => {
    const totalMs = 30 * 24 * HOUR;
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV1', durationMs: 99 * 24 * HOUR }],
        totalMs,
      ),
    ).toBe(0);
  });

  test('multiple incidents accumulate', () => {
    const totalMs = 30 * 24 * HOUR;
    const downMs = 1 * HOUR + 0.5 * 1 * HOUR;
    const expected = 1 - downMs / totalMs;
    expect(
      computeUptimeFromDurations(
        [
          { severity: 'SEV1', durationMs: 1 * HOUR },
          { severity: 'SEV3', durationMs: 1 * HOUR },
        ],
        totalMs,
      ),
    ).toBeCloseTo(expected, 6);
  });
});
