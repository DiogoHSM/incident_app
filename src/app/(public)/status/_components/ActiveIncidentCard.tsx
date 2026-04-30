import Link from 'next/link';
import type { StatusSnapshotPayload } from '@/lib/status/payload';

export function ActiveIncidentCards({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  if (payload.activeIncidents.length === 0) {
    return <></>;
  }
  return (
    <section className="mb-8 space-y-3">
      <h2 className="text-base font-semibold">Active incidents</h2>
      {payload.activeIncidents.map((i) => (
        <article
          key={i.slug}
          className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              <Link href={`/status/incidents/${i.slug}`} className="underline-offset-2 hover:underline">
                {i.title}
              </Link>
            </h3>
            <span className="text-xs text-zinc-500">
              {i.severity} · {i.status} · started {i.declaredAt.toISOString().slice(0, 16).replace('T', ' ')}Z
            </span>
          </header>
          {i.latestPublicUpdate ? (
            <p className="text-sm">
              <span className="text-zinc-500">
                {i.latestPublicUpdate.postedAt.toISOString().slice(11, 19)}Z —{' '}
                {i.latestPublicUpdate.author ?? 'team'}:
              </span>{' '}
              {i.latestPublicUpdate.body}
            </p>
          ) : (
            <p className="text-sm text-zinc-500">No public updates yet.</p>
          )}
        </article>
      ))}
    </section>
  );
}
