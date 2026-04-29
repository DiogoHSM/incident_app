import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listMyTeams } from '@/lib/db/queries/teams';
import { listServicesForUser } from '@/lib/db/queries/services';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';
import { declareIncidentAction } from '../actions';

export default async function NewIncidentPage() {
  const session = await auth();
  if (!session?.user) return null;

  const [myTeams, myServices] = await Promise.all([
    listMyTeams(db, session.user.id),
    listServicesForUser(db, session.user.id),
  ]);

  if (myTeams.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        You aren&apos;t in any team yet. Ask an admin to add you before declaring an incident.
      </p>
    );
  }

  return (
    <form action={declareIncidentAction} className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Declare incident</h1>

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
        Title
        <input
          name="title"
          required
          maxLength={200}
          placeholder="One-line description of what's happening"
          className="mt-1 w-full rounded border px-2 py-1.5"
        />
      </label>

      <label className="block text-sm">
        Severity
        <select
          name="severity"
          required
          defaultValue="SEV3"
          className="mt-1 w-full rounded border px-2 py-1.5"
        >
          {SEVERITY_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Summary
        <textarea
          name="summary"
          rows={4}
          maxLength={2000}
          placeholder="What you know so far. Optional."
          className="mt-1 w-full rounded border px-2 py-1.5"
        />
      </label>

      <fieldset className="text-sm">
        <legend className="font-medium">Affected services</legend>
        {myServices.length === 0 ? (
          <p className="mt-1 text-neutral-500">
            No services available. You can declare without one and attach later.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {myServices.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="affectedServiceIds" value={s.id} />
                  <span>
                    {s.name} <span className="text-xs text-neutral-500">({s.slug})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <button type="submit" className="rounded bg-red-700 px-3 py-1.5 text-sm text-white">
        Declare incident
      </button>
    </form>
  );
}
