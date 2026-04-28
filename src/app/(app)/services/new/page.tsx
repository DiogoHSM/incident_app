import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listMyTeams } from '@/lib/db/queries/teams';
import { createServiceAction } from '../actions';

export default async function NewServicePage() {
  const session = await auth();
  if (!session?.user) return null;

  const myTeams = await listMyTeams(db, session.user.id);

  if (myTeams.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        You aren&apos;t in any team yet. Ask an admin to add you.
      </p>
    );
  }

  return (
    <form action={createServiceAction} className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold">New service</h1>
      <label className="block text-sm">
        Team
        <select name="teamId" required className="mt-1 w-full rounded border px-2 py-1.5">
          {myTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Name
        <input name="name" required className="mt-1 w-full rounded border px-2 py-1.5" />
      </label>
      <label className="block text-sm">
        Slug
        <input
          name="slug"
          required
          pattern="^[a-z0-9][a-z0-9-]*$"
          className="mt-1 w-full rounded border px-2 py-1.5"
        />
      </label>
      <label className="block text-sm">
        Description
        <textarea name="description" rows={3} className="mt-1 w-full rounded border px-2 py-1.5" />
      </label>
      <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
        Create
      </button>
    </form>
  );
}
