import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { db } from '@/lib/db/client';
import { findPublicPostmortemById } from '@/lib/db/queries/status-snapshot';

export const revalidate = 15;
export const dynamic = 'error';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PublicPostmortemPage({ params }: Props): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();
  const pm = await findPublicPostmortemById(db, id);
  if (!pm) notFound();

  return (
    <article>
      <header className="mb-6">
        <p className="text-xs text-zinc-500">
          Postmortem · published {pm.publishedAt.toISOString().slice(0, 10)}
        </p>
        <h1 className="mt-1 text-xl font-semibold">{pm.incidentTitle}</h1>
      </header>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{pm.markdownBody}</ReactMarkdown>
      </div>
    </article>
  );
}
