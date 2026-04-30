import Link from 'next/link';
import { type Incident } from '@/lib/db/schema/incidents';
import { SeverityPill } from './SeverityPill';
import { StatusPill } from './StatusPill';

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function IncidentRow({ incident }: { incident: Incident }) {
  return (
    <Link
      href={`/incidents/${incident.publicSlug}`}
      className="grid grid-cols-[80px_1fr_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-neutral-50"
    >
      <SeverityPill value={incident.severity} />
      <span className="flex items-center gap-1">
        <StatusPill value={incident.status} />
        {incident.status === 'triaging' && incident.declaredBy === null && (
          <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
            ⚠ unconfirmed
          </span>
        )}
      </span>
      <span className="truncate font-medium">{incident.title}</span>
      <span className="text-xs text-neutral-500">{timeAgo(incident.declaredAt)}</span>
    </Link>
  );
}
