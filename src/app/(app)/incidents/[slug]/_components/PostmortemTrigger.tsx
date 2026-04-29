import Link from 'next/link';
import { db } from '@/lib/db/client';
import { findPostmortemForIncidentSlug } from '@/lib/db/queries/postmortems';
import { auth } from '@/lib/auth';
import { createDraftAction } from '../postmortem/actions';

interface Props {
  slug: string;
}

export async function PostmortemTrigger({ slug }: Props) {
  const session = await auth();
  if (!session?.user) return null;
  const found = await findPostmortemForIncidentSlug(db, session.user.id, slug);

  if (found) {
    return (
      <Link
        href={`/incidents/${slug}/postmortem`}
        className="block rounded border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-100"
      >
        Postmortem ({found.postmortem.status})
      </Link>
    );
  }
  return (
    <form action={createDraftAction.bind(null, slug)}>
      <button
        type="submit"
        className="block w-full rounded border border-neutral-200 bg-white px-3 py-2 text-left text-sm hover:bg-neutral-100"
      >
        + Start postmortem
      </button>
    </form>
  );
}
