import type { StatusSnapshotPayload } from '@/lib/status/payload';

const SEV_COLOR: Record<string, string> = {
  SEV1: 'bg-red-600',
  SEV2: 'bg-orange-500',
  SEV3: 'bg-amber-500',
  SEV4: 'bg-yellow-300',
};

export function SevenDayBars({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  if (payload.severityByDay.length === 0) return <></>;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Last 7 days</h2>
      <ol className="flex gap-2" aria-label="7-day severity heatmap">
        {payload.severityByDay.map((d) => {
          const klass = d.worstSeverity ? SEV_COLOR[d.worstSeverity] : 'bg-emerald-200';
          return (
            <li
              key={d.date}
              className="flex flex-col items-center gap-1"
              aria-label={`${d.date}: ${d.worstSeverity ?? 'no incidents'}`}
            >
              <span className={`block h-12 w-6 rounded ${klass ?? 'bg-zinc-200'}`} />
              <span className="text-[10px] text-zinc-500">{d.date.slice(5)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
