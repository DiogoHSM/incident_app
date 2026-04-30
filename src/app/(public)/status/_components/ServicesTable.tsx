import type { StatusSnapshotPayload, ServiceStatus } from '@/lib/status/payload';

const DOT: Record<ServiceStatus, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  partial_outage: 'bg-orange-500',
  major_outage: 'bg-red-500',
};

const LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
};

export function ServicesTable({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  if (payload.services.length === 0) {
    return <p className="text-sm text-zinc-500">No services tracked yet.</p>;
  }
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Services</h2>
      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {payload.services.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="flex items-center gap-3">
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[s.status]}`}
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-zinc-500">{LABEL[s.status]}</span>
            </span>
            <span className="text-xs text-zinc-500">
              {(s.uptime30d * 100).toFixed(2)}% · 30d
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
