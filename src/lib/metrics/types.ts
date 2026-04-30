import type { Severity } from '@/lib/db/schema/services';

export type RangeBucket = 'day' | 'week';

export interface DateRange {
  from: Date;
  to: Date;
  bucket: RangeBucket;
}

export interface BucketRow {
  /** ISO date for `bucket=day` (YYYY-MM-DD) or ISO week start for `bucket=week`. */
  date: string;
  bySeverity: Record<Severity, number>;
  total: number;
}

export interface SeverityMixRow {
  severity: Severity;
  count: number;
}

export interface ServiceHeatmapRow {
  id: string;
  name: string;
}

export interface ServiceHeatmap {
  services: ServiceHeatmapRow[];
  /** severities[s.severityIndex] → matrix row, in SEV1..SEV4 order. */
  severities: readonly Severity[];
  /** matrix[serviceIndex][severityIndex] = count. */
  matrix: number[][];
  max: number;
}

export interface MeanDurationPoint {
  date: string;
  meanMs: number | null;
  count: number;
}

export interface MetricsPayloads {
  range: DateRange;
  mttrSeries: MeanDurationPoint[];
  mttaSeries: MeanDurationPoint[];
  frequency: BucketRow[];
  severityMix: SeverityMixRow[];
  heatmap: ServiceHeatmap;
}
