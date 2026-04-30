import type { DateRange, RangeBucket } from './types';

export class RangeParseError extends Error {
  constructor(input: string) {
    super(`Invalid range "${input}"`);
    this.name = 'RangeParseError';
  }
}

const PRESETS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function pickBucket(from: Date, to: Date): RangeBucket {
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  return days > 30 ? 'week' : 'day';
}

export function parseRange(input: string | undefined): DateRange {
  const now = new Date();

  if (!input) {
    const from = new Date(now.getTime() - 30 * DAY_MS);
    return { from, to: now, bucket: 'day' };
  }

  const presetDays = PRESETS[input];
  if (presetDays !== undefined) {
    const from = new Date(now.getTime() - presetDays * DAY_MS);
    return { from, to: now, bucket: pickBucket(from, now) };
  }

  if (input.includes('..')) {
    const [fromStr, toStr] = input.split('..', 2);
    if (!fromStr || !toStr) throw new RangeParseError(input);
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new RangeParseError(input);
    }
    if (from.getTime() >= to.getTime()) throw new RangeParseError(input);
    return { from, to, bucket: pickBucket(from, to) };
  }

  throw new RangeParseError(input);
}
