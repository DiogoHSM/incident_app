import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import { getRunbook } from '@/lib/db/queries/runbooks';
import { SeverityPill } from '../_components/SeverityPill';
import { StatusPill } from '../_components/StatusPill';

function durationLabel(start: Date, end: Date | null): string {
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { slug } = await params;
  const found = await findIncidentBySlugForUser(db, session.user.id, slug);
  if (!found) notFound();
  const { incident, affectedServices } = found;

  const userId = session.user.id;
  const runbooks = await Promise.all(
    affectedServices.map(async (svc) => {
      try {
        const rb = await getRunbook(db, userId, svc.id, incident.severity);
        return { service: svc, runbook: rb };
      } catch {
        return { service: svc, runbook: null };
      }
    }),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SeverityPill value={incident.severity} />
            <StatusPill value={incident.status} />
            <span className="text-xs text-neutral-500">{incident.publicSlug}</span>
          </div>
          <h1 className="text-2xl font-semibold">{incident.title}</h1>
          <p className="text-sm text-neutral-600">
            Declared {incident.declaredAt.toISOString()} ·{' '}
            {durationLabel(incident.declaredAt, incident.resolvedAt)} so far
          </p>
        </div>

        {incident.summary && (
          <section className="rounded border border-neutral-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-medium text-neutral-700">Summary</h2>
            <p className="whitespace-pre-wrap text-sm">{incident.summary}</p>
          </section>
        )}

        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Timeline</h2>
          <p className="text-sm text-neutral-500">
            Live timeline lands in Plan 3 — no events yet for this incident.
          </p>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Affected services</h2>
          {affectedServices.length === 0 ? (
            <p className="text-sm text-neutral-500">None attached.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {affectedServices.map((s) => (
                <li key={s.id}>
                  <Link href={`/services/${s.slug}`} className="text-blue-700 hover:underline">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">
            Runbooks · {incident.severity}
          </h2>
          {runbooks.length === 0 ? (
            <p className="text-sm text-neutral-500">No services attached.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {runbooks.map(({ service, runbook }) => (
                <li key={service.id}>
                  <Link
                    href={`/services/${service.slug}/runbooks/${incident.severity}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {service.name} → {incident.severity}
                  </Link>
                  {runbook ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                      {runbook.markdownBody.slice(0, 140) || '(empty)'}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-neutral-400">No runbook yet.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
