import { notFound } from 'next/navigation';
import Link from 'next/link';
import { inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import { getRunbook } from '@/lib/db/queries/runbooks';
import { listTeamMembersWithUsers } from '@/lib/db/queries/teams';
import { listTimelineEventsForIncident } from '@/lib/db/queries/timeline';
import { users } from '@/lib/db/schema/users';
import { SeverityPill } from '../_components/SeverityPill';
import { StatusPill } from '../_components/StatusPill';
import { IncidentLiveProvider } from './_components/IncidentLiveProvider';
import { ConnectionBanner } from './_components/ConnectionBanner';
import { Timeline } from './_components/Timeline';
import { NoteForm } from './_components/NoteForm';
import { StatusControl } from './_components/StatusControl';
import { SeverityControl } from './_components/SeverityControl';
import { RolePickers } from './_components/RolePickers';

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

  const [runbooks, teamMembers, events] = await Promise.all([
    Promise.all(
      affectedServices.map(async (svc) => {
        try {
          const rb = await getRunbook(db, userId, svc.id, incident.severity);
          return { service: svc, runbook: rb };
        } catch {
          return { service: svc, runbook: null };
        }
      }),
    ),
    listTeamMembersWithUsers(db, incident.teamId),
    listTimelineEventsForIncident(db, userId, incident.id),
  ]);

  // Resolve author names. Covers each event's actor + role_change body targets
  // (fromUserId / toUserId), so role_change rows render names instead of UUIDs.
  const involvedUserIds = new Set<string>();
  for (const ev of events) {
    if (ev.authorUserId) involvedUserIds.add(ev.authorUserId);
    if (ev.kind === 'role_change') {
      const body = ev.body as { fromUserId: string | null; toUserId: string | null };
      if (body.fromUserId) involvedUserIds.add(body.fromUserId);
      if (body.toUserId) involvedUserIds.add(body.toUserId);
    }
  }
  const authorRows =
    involvedUserIds.size > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...involvedUserIds]))
      : [];
  const authorMap = new Map<string, string>(authorRows.map((r) => [r.id, r.name]));

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

        <IncidentLiveProvider
          slug={incident.publicSlug}
          initialEvents={events}
          initialAuthors={[...authorMap.entries()].map(([id, name]): { id: string; name: string | null } => ({ id, name }))}
        >
          <section className="space-y-3 rounded border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-medium text-neutral-700">Timeline</h2>
            <ConnectionBanner />
            <NoteForm slug={incident.publicSlug} currentUserId={userId} />
            <Timeline />
          </section>
        </IncidentLiveProvider>
      </div>

      <aside className="space-y-4">
        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Quick actions</h2>
          <div className="space-y-3">
            <StatusControl
              slug={incident.publicSlug}
              current={incident.status}
              hasIc={incident.icUserId !== null}
              teamMembers={teamMembers.map((m) => ({ id: m.id, name: m.name }))}
            />
            <SeverityControl slug={incident.publicSlug} current={incident.severity} />
          </div>
        </section>

        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Roles</h2>
          <RolePickers
            slug={incident.publicSlug}
            assignments={{
              ic: incident.icUserId,
              scribe: incident.scribeUserId,
              comms: incident.commsUserId,
            }}
            teamMembers={teamMembers.map((m) => ({ id: m.id, name: m.name }))}
          />
        </section>

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
