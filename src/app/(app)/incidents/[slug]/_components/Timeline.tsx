import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TimelineEvent } from '@/lib/db/schema/timeline';
import type { TimelineEventBody } from '@/lib/timeline/body';

function relativeTime(ts: Date): string {
  const ms = Date.now() - ts.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function authorName(authors: Map<string, string>, id: string | null): string {
  if (!id) return 'system';
  return authors.get(id) ?? 'Unknown user';
}

export interface TimelineProps {
  events: TimelineEvent[];
  authors: Map<string, string>;
}

export function Timeline({ events, authors }: TimelineProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-neutral-500">No timeline events yet — post the first note.</p>
    );
  }
  return (
    <ol className="space-y-3">
      {events.map((ev) => {
        const body = ev.body as TimelineEventBody;
        return (
          <li
            key={ev.id}
            className="rounded border border-neutral-200 bg-white p-3 text-sm"
          >
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
              <span>
                <strong className="font-medium text-neutral-700">
                  {authorName(authors, ev.authorUserId)}
                </strong>{' '}
                · {body.kind.replaceAll('_', ' ')}
              </span>
              <time dateTime={ev.occurredAt.toISOString()}>{relativeTime(ev.occurredAt)}</time>
            </div>
            {body.kind === 'note' && (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body.markdown}</ReactMarkdown>
              </div>
            )}
            {body.kind === 'status_change' && (
              <p className="text-neutral-700">
                Status: <code>{body.from}</code> → <code>{body.to}</code>
                {body.reason ? <span className="text-neutral-500"> · {body.reason}</span> : null}
              </p>
            )}
            {body.kind === 'severity_change' && (
              <p className="text-neutral-700">
                Severity: <code>{body.from}</code> → <code>{body.to}</code>
              </p>
            )}
            {body.kind === 'role_change' && (
              <p className="text-neutral-700">
                {body.role.toUpperCase()}: {authorName(authors, body.fromUserId)} →{' '}
                {authorName(authors, body.toUserId)}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
