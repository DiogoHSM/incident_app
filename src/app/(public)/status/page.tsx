import { db } from '@/lib/db/client';
import {
  listPublicPostmortems,
  readSnapshotForScope,
  recomputeAndPersistSnapshot,
} from '@/lib/db/queries/status-snapshot';
import { StatusBanner } from './_components/StatusBanner';
import { ServicesTable } from './_components/ServicesTable';
import { SevenDayBars } from './_components/SevenDayBars';
import { ActiveIncidentCards } from './_components/ActiveIncidentCard';
import { PostmortemList } from './_components/PostmortemList';

export const revalidate = 15;
export const dynamic = 'error';

export default async function StatusPage(): Promise<React.JSX.Element> {
  let snapshot = await readSnapshotForScope(db, 'public');
  if (!snapshot) {
    snapshot = await recomputeAndPersistSnapshot(db, 'public');
  }
  const postmortems = await listPublicPostmortems(db, { limit: 5 });

  return (
    <>
      <StatusBanner payload={snapshot} />
      <ActiveIncidentCards payload={snapshot} />
      <ServicesTable payload={snapshot} />
      <SevenDayBars payload={snapshot} />
      <PostmortemList items={postmortems} />
    </>
  );
}
