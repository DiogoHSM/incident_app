import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { findPublicIncidentBySlug } from '@/lib/db/queries/status-page';

export const revalidate = 15;
export const dynamic = 'error';

interface Props {
  params: Promise<{ slug: string }>;
}

function formatDuration(start: Date, end: Date | null): string {
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

export default async function PublicIncidentPage({ params }: Props): Promise<React.JSX.Element> {
  const { slug } = await params;
  const incident = await findPublicIncidentBySlug(db, slug);
  if (!incident) notFound();

  const updates = [...incident.publicUpdates].reverse();

  return (
    <article>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{incident.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {incident.severity} · {incident.status} · started{' '}
          {incident.declaredAt.toISOString().slice(0, 16).replace('T', ' ')}Z · duration{' '}
          {formatDuration(incident.declaredAt, incident.resolvedAt)}
        </p>
      </header>
      <section>
        <h2 className="mb-3 text-base font-semibold">Public updates</h2>
        {updates.length === 0 ? (
          <p className="text-sm text-zinc-500">No public updates yet.</p>
        ) : (
          <ol className="space-y-3">
            {updates.map((u) => (
              <li
                key={u.id}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="mb-1 text-xs text-zinc-500">
                  {u.postedAt.toISOString().slice(0, 16).replace('T', ' ')}Z
                  {u.author ? ` — ${u.author}` : ''}
                </div>
                <p className="text-sm">{u.message}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
