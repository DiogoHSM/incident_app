import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listIncidentsForUser } from '@/lib/db/queries/incidents';
import { INCIDENT_STATUS_VALUES, type IncidentStatus } from '@/lib/db/schema/incidents';
import { SEVERITY_VALUES, type Severity } from '@/lib/db/schema/services';
import { FilterChips } from './_components/FilterChips';
import { IncidentRow } from './_components/IncidentRow';

interface SearchParams {
  status?: string;
  severity?: string;
  days?: string;
}

function parseStatus(v: unknown): IncidentStatus | undefined {
  return typeof v === 'string' && (INCIDENT_STATUS_VALUES as readonly string[]).includes(v)
    ? (v as IncidentStatus)
    : undefined;
}

function parseSeverity(v: unknown): Severity | undefined {
  return typeof v === 'string' && (SEVERITY_VALUES as readonly string[]).includes(v)
    ? (v as Severity)
    : undefined;
}

function parseDays(v: unknown): number {
  if (typeof v !== 'string') return 30;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : 30;
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const sp = await searchParams;

  const filters = {
    status: parseStatus(sp.status),
    severity: parseSeverity(sp.severity),
    daysBack: parseDays(sp.days),
  };
  const list = await listIncidentsForUser(db, session.user.id, filters);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Incidents</h1>
        <Link
          href="/incidents/new"
          className="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-800"
        >
          Declare incident
        </Link>
      </div>

      <FilterChips
        current={{
          status: sp.status,
          severity: sp.severity,
          days: sp.days ?? '30',
        }}
      />

      {list.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No incidents in this window.
          {sp.status || sp.severity ? ' Try clearing filters.' : ''}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
          {list.map((inc) => (
            <li key={inc.id}>
              <IncidentRow incident={inc} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
