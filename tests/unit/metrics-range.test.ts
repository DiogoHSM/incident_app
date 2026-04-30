import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import { parseRange, RangeParseError } from '@/lib/metrics/range';

describe('parseRange', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  test('undefined → 30-day default with day buckets', () => {
    const r = parseRange(undefined);
    expect(r.bucket).toBe('day');
    expect(r.to.toISOString()).toBe('2026-04-29T12:00:00.000Z');
    expect(r.from.toISOString()).toBe('2026-03-30T12:00:00.000Z');
  });

  test('"7d" → 7-day window with day buckets', () => {
    const r = parseRange('7d');
    expect(r.bucket).toBe('day');
    expect(r.from.toISOString()).toBe('2026-04-22T12:00:00.000Z');
  });

  test('"30d" → 30-day window with day buckets', () => {
    const r = parseRange('30d');
    expect(r.bucket).toBe('day');
    expect(r.from.toISOString()).toBe('2026-03-30T12:00:00.000Z');
  });

  test('"90d" → 90-day window with week buckets (>30d)', () => {
    const r = parseRange('90d');
    expect(r.bucket).toBe('week');
    expect(r.from.toISOString()).toBe('2026-01-29T12:00:00.000Z');
  });

  test('custom ISO range "<from>..<to>" parses both endpoints', () => {
    const r = parseRange('2026-01-01T00:00:00.000Z..2026-02-01T00:00:00.000Z');
    expect(r.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(r.bucket).toBe('week');
  });

  test('custom range with ≤30 days → day bucket', () => {
    const r = parseRange('2026-04-01T00:00:00.000Z..2026-04-15T00:00:00.000Z');
    expect(r.bucket).toBe('day');
  });

  test('custom range with from after to throws RangeParseError', () => {
    expect(() =>
      parseRange('2026-04-15T00:00:00.000Z..2026-04-01T00:00:00.000Z'),
    ).toThrow(RangeParseError);
  });

  test('garbage string throws RangeParseError', () => {
    expect(() => parseRange('forever')).toThrow(RangeParseError);
  });

  test('"1d" not on the allow-list → RangeParseError (only 7/30/90 + custom)', () => {
    expect(() => parseRange('1d')).toThrow(RangeParseError);
  });

  test('empty string → 30-day default', () => {
    const r = parseRange('');
    expect(r.bucket).toBe('day');
    expect(r.from.toISOString()).toBe('2026-03-30T12:00:00.000Z');
  });
});
