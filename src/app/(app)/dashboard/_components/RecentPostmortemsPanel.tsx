import Link from 'next/link';
import type { Postmortem } from '@/lib/db/schema/postmortems';
import type { Incident } from '@/lib/db/schema/incidents';

interface Props {
  rows: Array<{ postmortem: Postmortem; incident: Incident }>;
}

export function RecentPostmortemsPanel({ rows }: Props) {
  return (
    <section className="rounded border border-neutral-200 bg-white">
      <header className="border-b border-neutral-100 px-4 py-2.5 text-sm font-medium">
        Recent postmortems
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-neutral-500">No postmortems yet.</div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map(({ postmortem, incident }) => (
            <li key={postmortem.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                {postmortem.status}
              </span>
              <Link
                href={`/incidents/${incident.publicSlug}/postmortem`}
                className="flex-1 truncate text-neutral-800 hover:underline"
              >
                {incident.title}
              </Link>
              <span className="text-xs text-neutral-500">
                {postmortem.updatedAt.toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
