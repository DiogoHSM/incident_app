import { z } from 'zod';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  listResolvedIncidentsInRange,
  listAcknowledgedIncidentsInRange,
  listDeclaredIncidentsInRange,
  listIncidentsByServiceInRange,
} from '@/lib/db/queries/metrics';
import { parseRange, RangeParseError } from '@/lib/metrics/range';
import {
  bucketByDay,
  meanDurationMs,
  serviceHeatmap,
  severityMix,
} from '@/lib/metrics/aggregations';
import { ForbiddenError } from '@/lib/authz';
import { RangeSelector } from './_components/RangeSelector';
import { MTTRChart } from './_components/MTTRChart';
import { MTTAChart } from './_components/MTTAChart';
import { FrequencyChart } from './_components/FrequencyChart';
import { SeverityMix } from './_components/SeverityMix';
import { ServiceHeatmap } from './_components/ServiceHeatmap';
import type { MeanDurationPoint } from '@/lib/metrics/types';

const SearchParamsSchema = z.object({
  range: z.string().optional(),
  team: z.string().uuid().optional(),
  service: z.string().uuid().optional(),
});

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function meanDurationByBucket(
  rows: ReadonlyArray<{ from: Date; to: Date; bucketAt: Date }>,
  range: ReturnType<typeof parseRange>,
): MeanDurationPoint[] {
  const buckets = bucketByDay(
    rows.map((r) => ({ at: r.bucketAt })),
    range,
  );
  const out: MeanDurationPoint[] = buckets.map((b) => ({ date: b.date, meanMs: null, count: 0 }));
  const indexByDate = new Map(out.map((p, i) => [p.date, i]));

  const sumByDate = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const key = (() => {
      const tmp = bucketByDay([{ at: r.bucketAt }], range);
      return tmp[0]?.date ?? null;
    })();
    if (!key) continue;
    const d = r.to.getTime() - r.from.getTime();
    if (d <= 0) continue;
    const acc = sumByDate.get(key) ?? { sum: 0, n: 0 };
    acc.sum += d;
    acc.n += 1;
    sumByDate.set(key, acc);
  }
  for (const [date, { sum, n }] of sumByDate) {
    const i = indexByDate.get(date);
    if (i === undefined) continue;
    out[i] = { date, meanMs: sum / n, count: n };
  }
  return out;
}

export default async function MetricsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/signin');
  const userId = session.user.id;

  const sp = await searchParams;
  const parsedSp = SearchParamsSchema.safeParse({
    range: typeof sp.range === 'string' ? sp.range : undefined,
    team: typeof sp.team === 'string' ? sp.team : undefined,
    service: typeof sp.service === 'string' ? sp.service : undefined,
  });
  if (!parsedSp.success) {
    return (
      <div className="text-sm text-red-600">
        Invalid query parameters: {parsedSp.error.message}
      </div>
    );
  }

  let range;
  try {
    range = parseRange(parsedSp.data.range);
  } catch (e) {
    if (e instanceof RangeParseError) {
      return (
        <div className="text-sm text-red-600">
          Invalid range. Try <code>?range=7d</code>, <code>30d</code>, or <code>90d</code>.
        </div>
      );
    }
    throw e;
  }

  const filters = {
    from: range.from,
    to: range.to,
    teamId: parsedSp.data.team,
  };

  let resolved, acked, declared, perService;
  try {
    [resolved, acked, declared, perService] = await Promise.all([
      listResolvedIncidentsInRange(db, userId, filters),
      listAcknowledgedIncidentsInRange(db, userId, filters),
      listDeclaredIncidentsInRange(db, userId, filters),
      listIncidentsByServiceInRange(db, userId, filters),
    ]);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <div className="text-sm text-red-600">
          You are not a member of the requested team.
        </div>
      );
    }
    throw e;
  }

  const mttrSeries = meanDurationByBucket(
    resolved
      .filter((r) => !r.dismissed)
      .map((r) => ({ from: r.declaredAt, to: r.resolvedAt, bucketAt: r.resolvedAt })),
    range,
  );

  const mttaSeries = meanDurationByBucket(
    acked
      .filter((r) => r.acknowledgedAt !== null)
      .map((r) => ({
        from: r.declaredAt,
        to: r.acknowledgedAt!,
        bucketAt: r.declaredAt,
      })),
    range,
  );

  const frequency = bucketByDay(
    declared.map((r) => ({ at: r.declaredAt, severity: r.severity })),
    range,
  );

  const sevMix = severityMix(declared.map((r) => ({ severity: r.severity })));
  const heatmap = serviceHeatmap(perService);

  const overallMTTR = meanDurationMs(
    resolved.filter((r) => !r.dismissed).map((r) => ({ from: r.declaredAt, to: r.resolvedAt })),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Metrics</h1>
          <p className="text-xs text-neutral-500">
            {range.from.toISOString().slice(0, 10)} → {range.to.toISOString().slice(0, 10)} ·
            {range.bucket === 'day' ? ' daily' : ' weekly'} buckets
          </p>
        </div>
        <RangeSelector />
      </div>

      <section className="rounded border border-neutral-200 bg-white p-4">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">MTTR over time</h2>
          <span className="text-xs text-neutral-500">
            Overall: {overallMTTR === null ? '—' : `${Math.round(overallMTTR / 60000)}m`}
          </span>
        </header>
        <MTTRChart data={mttrSeries} />
      </section>

      <section className="rounded border border-neutral-200 bg-white p-4">
        <header className="mb-3"><h2 className="text-sm font-medium">MTTA over time (webhook-declared)</h2></header>
        <MTTAChart data={mttaSeries} />
      </section>

      <section className="rounded border border-neutral-200 bg-white p-4">
        <header className="mb-3"><h2 className="text-sm font-medium">Incident frequency</h2></header>
        <FrequencyChart data={frequency} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded border border-neutral-200 bg-white p-4">
          <header className="mb-3"><h2 className="text-sm font-medium">Severity mix</h2></header>
          <SeverityMix data={sevMix} />
        </section>
        <section className="rounded border border-neutral-200 bg-white p-4">
          <header className="mb-3"><h2 className="text-sm font-medium">Per-service heatmap</h2></header>
          <ServiceHeatmap data={heatmap} />
        </section>
      </div>
    </div>
  );
}
