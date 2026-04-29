import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listTeamsWithMemberships } from '@/lib/db/queries/teams-admin';
import { findUserById } from '@/lib/db/queries/users';
import { addMemberAction, createTeamAction, removeMemberAction } from './actions';

export default async function TeamsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/signin');
  if (session.user.role !== 'admin') redirect('/dashboard');

  const teamsWithMembers = await listTeamsWithMemberships(db, session.user.id);
  const allUserIds = teamsWithMembers.flatMap((t) => t.members.map((m) => m.userId));
  const userMap = new Map<string, string>();
  await Promise.all(
    allUserIds.map(async (id) => {
      const u = await findUserById(db, id);
      if (u) userMap.set(id, u.email);
    }),
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Teams</h1>
        <form action={createTeamAction} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="Team name"
            required
            className="rounded border px-2 py-1.5 text-sm"
          />
          <input
            name="slug"
            placeholder="slug"
            required
            pattern="^[a-z0-9][a-z0-9-]*$"
            className="rounded border px-2 py-1.5 text-sm"
          />
          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            Add team
          </button>
        </form>
      </section>

      <section className="space-y-4">
        {teamsWithMembers.map((t) => (
          <div key={t.id} className="rounded border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-neutral-500">{t.slug}</div>
              </div>
              <div className="text-xs text-neutral-500">{t.members.length} member(s)</div>
            </div>

            <ul className="mt-3 divide-y divide-neutral-100">
              {t.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-2 text-sm">
                  <span>{userMap.get(m.userId) ?? m.userId}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">
                      {m.role}
                    </span>
                    <form action={removeMemberAction}>
                      <input type="hidden" name="teamId" value={t.id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        remove
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>

            <form action={addMemberAction} className="mt-3 flex gap-2">
              <input type="hidden" name="teamId" value={t.id} />
              <input
                name="email"
                placeholder="user@example.com"
                required
                className="flex-1 rounded border px-2 py-1.5 text-sm"
              />
              <select name="role" className="rounded border px-2 py-1.5 text-sm">
                <option value="member">member</option>
                <option value="lead">lead</option>
              </select>
              <button type="submit" className="rounded border px-3 py-1.5 text-sm">
                Add member
              </button>
            </form>
          </div>
        ))}
      </section>
    </div>
  );
}
