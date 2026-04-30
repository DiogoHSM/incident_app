import Link from 'next/link';
import type { Incident } from '@/lib/db/schema/incidents';

interface Props {
  rows: Incident[];
}

const SEV_BADGE: Record<string, string> = {
  SEV1: 'bg-red-100 text-red-800',
  SEV2: 'bg-orange-100 text-orange-800',
  SEV3: 'bg-yellow-100 text-yellow-800',
  SEV4: 'bg-lime-100 text-lime-800',
};

function age(declaredAt: Date): string {
  const ms = Date.now() - declaredAt.getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function ActiveIncidentsPanel({ rows }: Props) {
  return (
    <section className="rounded border border-neutral-200 bg-white">
      <header className="border-b border-neutral-100 px-4 py-2.5 text-sm font-medium">
        Active incidents
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-neutral-500">No active incidents. Quiet day.</div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEV_BADGE[r.severity] ?? ''}`}>
                {r.severity}
              </span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
                {r.status}
              </span>
              <Link
                href={`/incidents/${r.publicSlug}`}
                className="flex-1 truncate text-sm text-neutral-800 hover:underline"
              >
                {r.title}
              </Link>
              <span className="text-xs text-neutral-500">{age(r.declaredAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
