import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findUserById } from '@/lib/db/queries/users';
import { listTeamsWithMemberships } from '@/lib/db/queries/teams-admin';
import { listServicesForUser } from '@/lib/db/queries/services';
import { listWebhookSourcesForTeam } from '@/lib/db/queries/webhook-sources';
import { CreateSourceForm } from './_components/CreateSourceForm';
import { SourceRow } from './_components/SourceRow';
import { SecretRevealModal } from './_components/SecretRevealModal';

export const dynamic = 'force-dynamic';

interface RevealCookie {
  id: string;
  secret: string;
}

export default async function WebhooksSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const user = await findUserById(db, session.user.id);
  if (!user || user.role !== 'admin') redirect('/dashboard');

  const teamsWithMembers = await listTeamsWithMemberships(db, session.user.id);
  const allServices = await listServicesForUser(db, session.user.id);

  const servicesByTeam: Record<string, Array<{ id: string; name: string }>> = {};
  for (const svc of allServices) {
    const bucket = servicesByTeam[svc.teamId] ?? [];
    bucket.push({ id: svc.id, name: svc.name });
    servicesByTeam[svc.teamId] = bucket;
  }

  const sourcesByTeam = await Promise.all(
    teamsWithMembers.map(async (t) => ({
      team: t,
      sources: await listWebhookSourcesForTeam(db, session.user.id, t.id),
    })),
  );

  let reveal: RevealCookie | null = null;
  const cookieStore = await cookies();
  const rev = cookieStore.get('webhook_secret_reveal');
  if (rev?.value) {
    try {
      reveal = JSON.parse(rev.value) as RevealCookie;
    } catch {
      reveal = null;
    }
    cookieStore.delete('webhook_secret_reveal');
  }

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? 'localhost:3000';
  const base = `${proto}://${host}`;

  const teams = teamsWithMembers.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Webhook sources</h1>

      <CreateSourceForm teams={teams} servicesByTeam={servicesByTeam} />

      {sourcesByTeam.map(({ team, sources }) => (
        <section key={team.id} className="space-y-2">
          <h2 className="text-lg font-medium">{team.name}</h2>
          {sources.length === 0 ? (
            <p className="text-sm text-gray-500">No webhook sources for this team.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border rounded">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Default severity</th>
                    <th className="px-3 py-2 font-medium">Auto-promote</th>
                    <th className="px-3 py-2 font-medium">URL</th>
                    <th className="px-3 py-2 font-medium">Secret</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <SourceRow
                      key={s.id}
                      source={s}
                      webhookUrl={`${base}/api/webhooks/${s.id}`}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {reveal !== null && (
        <SecretRevealModal
          sourceId={reveal.id}
          plaintextSecret={reveal.secret}
          webhookUrl={`${base}/api/webhooks/${reveal.id}`}
        />
      )}
    </div>
  );
}
