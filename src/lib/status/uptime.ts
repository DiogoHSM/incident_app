import { and, eq, gte, lte, isNull, or } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import type { Severity } from '@/lib/db/schema/services';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  SEV1: 1,
  SEV2: 1,
  SEV3: 0.5,
  SEV4: 0,
};

export function severityWeight(s: Severity): number {
  return SEVERITY_WEIGHT[s];
}

export interface UptimeIncidentDuration {
  severity: Severity;
  durationMs: number;
}

/**
 * Pure helper. Computes uptime from pre-computed weighted durations.
 *
 * Formula: 1 - (sum(durationMs × weight) / totalMs)
 * Weights: SEV1=1, SEV2=1, SEV3=0.5, SEV4=0.
 * Clamped to [0, 1].
 */
export function computeUptimeFromDurations(
  ds: readonly UptimeIncidentDuration[],
  totalMs: number,
): number {
  if (totalMs <= 0) return 1;
  let weightedDownMs = 0;
  for (const d of ds) {
    weightedDownMs += d.durationMs * severityWeight(d.severity);
  }
  if (weightedDownMs <= 0) return 1;
  if (weightedDownMs >= totalMs) return 0;
  return 1 - weightedDownMs / totalMs;
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * HOUR_MS;

/**
 * 30-day uptime for a service. Sums weighted downtime
 * (SEV1=1, SEV2=1, SEV3=0.5, SEV4=0) for any incident that touched
 * the service in the window — open incidents are weighted up to `now`.
 *
 * Coarse approximation; v1 has no probe pipeline.
 */
export async function compute30dUptime(
  db: DB,
  serviceId: string,
  now: Date,
): Promise<number> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  const rows = await db
    .select({
      severity: incidents.severity,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .innerJoin(incidentServices, eq(incidentServices.incidentId, incidents.id))
    .where(
      and(
        eq(incidentServices.serviceId, serviceId),
        lte(incidents.declaredAt, now),
        or(isNull(incidents.resolvedAt), gte(incidents.resolvedAt, windowStart)),
      ),
    );

  const durations: UptimeIncidentDuration[] = rows.map((r) => {
    const startMs = Math.max(r.declaredAt.getTime(), windowStart.getTime());
    const endMs = (r.resolvedAt ?? now).getTime();
    return {
      severity: r.severity,
      durationMs: Math.max(0, Math.min(endMs, now.getTime()) - startMs),
    };
  });

  return computeUptimeFromDurations(durations, WINDOW_MS);
}
