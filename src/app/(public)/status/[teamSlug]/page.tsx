import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { teams } from '@/lib/db/schema/teams';
import {
  listPublicPostmortems,
  readSnapshotForScope,
  recomputeAndPersistSnapshot,
} from '@/lib/db/queries/status-snapshot';
import { StatusBanner } from '../_components/StatusBanner';
import { ServicesTable } from '../_components/ServicesTable';
import { SevenDayBars } from '../_components/SevenDayBars';
import { ActiveIncidentCards } from '../_components/ActiveIncidentCard';
import { PostmortemList } from '../_components/PostmortemList';

export const revalidate = 15;
export const dynamic = 'error';

interface Props {
  params: Promise<{ teamSlug: string }>;
}

export default async function TeamStatusPage({ params }: Props): Promise<React.JSX.Element> {
  const { teamSlug } = await params;
  const [team] = await db.select().from(teams).where(eq(teams.slug, teamSlug)).limit(1);
  if (!team) notFound();

  let snapshot = await readSnapshotForScope(db, { type: 'team', teamId: team.id });
  if (!snapshot) {
    snapshot = await recomputeAndPersistSnapshot(db, { type: 'team', teamId: team.id });
  }
  const postmortems = await listPublicPostmortems(db, { teamId: team.id, limit: 5 });

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{team.name}</h1>
      <StatusBanner payload={snapshot} />
      <ActiveIncidentCards payload={snapshot} />
      <ServicesTable payload={snapshot} />
      <SevenDayBars payload={snapshot} />
      <PostmortemList items={postmortems} />
    </>
  );
}
