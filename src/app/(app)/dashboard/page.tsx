import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  countActiveIncidentsForUser,
  countOpenRcasForUser,
  countOpenActionItemsForUser,
  mttr7dForUser,
  listActiveIncidentsForUser,
  listMyOpenActionItems,
  listRecentPostmortemsForUser,
} from '@/lib/db/queries/dashboard';
import { StatCard } from './_components/StatCard';
import { ActiveIncidentsPanel } from './_components/ActiveIncidentsPanel';
import { MyActionItemsPanel } from './_components/MyActionItemsPanel';
import { RecentPostmortemsPanel } from './_components/RecentPostmortemsPanel';

function formatMttr(ms: number | null): string {
  if (ms === null) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect('/signin');
  const userId = session.user.id;

  const [active, openRcas, openActions, mttr, activeList, actionItemsList, recentPms] =
    await Promise.all([
      countActiveIncidentsForUser(db, userId),
      countOpenRcasForUser(db, userId),
      countOpenActionItemsForUser(db, userId),
      mttr7dForUser(db, userId),
      listActiveIncidentsForUser(db, userId, 10),
      listMyOpenActionItems(db, userId, 10),
      listRecentPostmortemsForUser(db, userId, 5),
    ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-xs text-neutral-500">
            Welcome, {session.user.name ?? session.user.email}
          </p>
        </div>
        <Link
          href="/incidents/new"
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Declare incident
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active" value={active.toString()} />
        <StatCard label="Open RCAs" value={openRcas.toString()} />
        <StatCard label="My actions" value={openActions.toString()} />
        <StatCard label="MTTR (7d)" value={formatMttr(mttr)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ActiveIncidentsPanel rows={activeList} />
        <MyActionItemsPanel rows={actionItemsList} />
      </div>

      <RecentPostmortemsPanel rows={recentPms} />
    </div>
  );
}
