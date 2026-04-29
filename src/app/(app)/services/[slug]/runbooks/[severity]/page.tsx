import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findServiceBySlugForUser } from '@/lib/db/queries/services';
import { getRunbook } from '@/lib/db/queries/runbooks';
import { saveRunbookAction } from './actions';

const allowed = new Set(['SEV1', 'SEV2', 'SEV3', 'SEV4']);

type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

export default async function RunbookEditor({
  params,
}: {
  params: Promise<{ slug: string; severity: string }>;
}) {
  const { slug, severity } = await params;
  if (!allowed.has(severity)) notFound();
  const session = await auth();
  if (!session?.user) return null;
  const service = await findServiceBySlugForUser(db, session.user.id, slug);
  if (!service) notFound();
  // Cast is required: `allowed.has(severity)` runtime check doesn't narrow the type for TS.
  const runbook = await getRunbook(db, session.user.id, service.id, severity as Severity);

  return (
    <form action={saveRunbookAction} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="severity" value={severity} />
      <h1 className="text-xl font-semibold">
        {service.name} — {severity} runbook
      </h1>
      <textarea
        name="markdownBody"
        rows={20}
        defaultValue={runbook?.markdownBody ?? ''}
        className="w-full rounded border border-neutral-200 bg-white p-3 font-mono text-sm"
        placeholder="Markdown content..."
      />
      <div className="flex items-center gap-3 text-sm">
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-white">
          Save
        </button>
        {runbook?.updatedAt && (
          <span className="text-neutral-500">last saved {runbook.updatedAt.toISOString()}</span>
        )}
      </div>
    </form>
  );
}
