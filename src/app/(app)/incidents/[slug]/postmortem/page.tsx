import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findPostmortemForIncidentSlug } from '@/lib/db/queries/postmortems';
import { listActionItemsForPostmortem } from '@/lib/db/queries/action-items';
import { listTeamMembersWithUsers } from '@/lib/db/queries/teams';
import { PostmortemEditor } from './_components/PostmortemEditor';
import { ActionItemsRail } from './_components/ActionItemsRail';
import { setVisibilityAction, publishAction } from './actions';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function PostmortemPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { slug } = await params;
  const found = await findPostmortemForIncidentSlug(db, session.user.id, slug);
  if (!found) notFound();

  const { postmortem, incident } = found;
  const [actionItems, teamMembers] = await Promise.all([
    listActionItemsForPostmortem(db, session.user.id, postmortem.id),
    listTeamMembersWithUsers(db, incident.teamId),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        <header className="mb-4 flex items-center gap-3">
          <span className="rounded bg-neutral-200 px-2 py-1 text-xs font-medium">
            {postmortem.status}
          </span>
          <h1 className="text-2xl font-semibold">Postmortem — {incident.title}</h1>
        </header>

        <PostmortemEditor
          postmortemId={postmortem.id}
          initialMarkdown={postmortem.markdownBody}
          initialUpdatedAtIso={postmortem.updatedAt.toISOString()}
        />

        <div className="mt-6 flex items-center gap-3">
          {postmortem.status === 'draft' ? (
            <form action={publishAction.bind(null, postmortem.id, slug)}>
              <button
                type="submit"
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Publish
              </button>
            </form>
          ) : (
            <span className="text-sm text-neutral-500">
              Published {postmortem.publishedAt?.toISOString()}
            </span>
          )}

          <form
            action={setVisibilityAction.bind(
              null,
              postmortem.id,
              slug,
              !postmortem.publicOnStatusPage,
            )}
          >
            <button
              type="submit"
              className="rounded border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              {postmortem.publicOnStatusPage ? 'Hide from /status' : 'Show on /status'}
            </button>
          </form>
        </div>
      </section>

      <aside>
        <ActionItemsRail
          postmortemId={postmortem.id}
          slug={slug}
          items={actionItems}
          teamMembers={teamMembers.map((m) => ({ id: m.id, name: m.name }))}
        />
      </aside>
    </div>
  );
}
