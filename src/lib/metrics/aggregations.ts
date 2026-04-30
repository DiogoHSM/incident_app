import type { Severity } from '@/lib/db/schema/services';
import type {
  BucketRow,
  DateRange,
  ServiceHeatmap,
  SeverityMixRow,
} from './types';

const ALL_SEVERITIES: readonly Severity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function emptyBySeverity(): Record<Severity, number> {
  return { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 };
}

export interface DurationRow {
  from: Date;
  to: Date;
}

const MIN_MS = 60 * 1000;

export function meanDurationMs(rows: readonly DurationRow[]): number | null {
  let totalMin = 0;
  let count = 0;
  for (const r of rows) {
    const d = r.to.getTime() - r.from.getTime();
    if (d > 0) {
      totalMin += d / MIN_MS;
      count += 1;
    }
  }
  if (count === 0) return null;
  return (totalMin / count) * MIN_MS;
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfIsoWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  return new Date(day.getTime() - diff * DAY_MS);
}

export interface BucketableRow {
  at: Date;
  severity?: Severity;
}

export function bucketByDay(
  rows: readonly BucketableRow[],
  range: DateRange,
): BucketRow[] {
  const buckets = new Map<string, BucketRow>();

  if (range.bucket === 'day') {
    const start = startOfUtcDay(range.from);
    const end = startOfUtcDay(range.to);
    for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
      const key = utcDayKey(new Date(t));
      buckets.set(key, { date: key, bySeverity: emptyBySeverity(), total: 0 });
    }
  } else {
    const start = startOfIsoWeek(range.from);
    const end = startOfIsoWeek(range.to);
    for (let t = start.getTime(); t < end.getTime(); t += 7 * DAY_MS) {
      const key = utcDayKey(new Date(t));
      buckets.set(key, { date: key, bySeverity: emptyBySeverity(), total: 0 });
    }
  }

  for (const row of rows) {
    const anchor =
      range.bucket === 'day' ? startOfUtcDay(row.at) : startOfIsoWeek(row.at);
    const key = utcDayKey(anchor);
    const b = buckets.get(key);
    if (!b) continue;
    b.total += 1;
    if (row.severity) b.bySeverity[row.severity] += 1;
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface SeverityRow {
  severity: Severity;
}

export function severityMix(rows: readonly SeverityRow[]): SeverityMixRow[] {
  const counts: Record<Severity, number> = emptyBySeverity();
  for (const r of rows) counts[r.severity] += 1;
  return ALL_SEVERITIES.map((severity) => ({ severity, count: counts[severity] }));
}

export interface HeatmapInputRow {
  serviceId: string;
  serviceName: string;
  severity: Severity;
  count: number;
}

export function serviceHeatmap(rows: readonly HeatmapInputRow[]): ServiceHeatmap {
  if (rows.length === 0) {
    return { services: [], severities: ALL_SEVERITIES, matrix: [], max: 0 };
  }
  const seen = new Map<string, string>();
  for (const r of rows) seen.set(r.serviceId, r.serviceName);
  const services = [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const indexById = new Map(services.map((s, i) => [s.id, i]));
  const sevIndex = new Map<Severity, number>(
    ALL_SEVERITIES.map((s, i) => [s, i] as const),
  );

  const matrix: number[][] = services.map(() => [0, 0, 0, 0]);
  let max = 0;
  for (const r of rows) {
    const i = indexById.get(r.serviceId);
    const j = sevIndex.get(r.severity);
    if (i === undefined || j === undefined) continue;
    const row = matrix[i];
    if (!row) continue;
    row[j] = (row[j] ?? 0) + r.count;
    if (row[j]! > max) max = row[j]!;
  }

  return { services, severities: ALL_SEVERITIES, matrix, max };
}
