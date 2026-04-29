'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIncidentLive, type DisplayedEvent } from './IncidentLiveProvider';

function eventTime(e: DisplayedEvent): Date {
  return e.source === 'optimistic' ? e.createdAt : e.occurredAt;
}

function relativeTime(ts: Date): string {
  const ms = Date.now() - ts.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function lookupAuthor(authors: Map<string, string | null>, id: string | null): string {
  if (!id) return 'system';
  return authors.get(id) ?? 'Unknown user';
}

export function Timeline(): React.JSX.Element {
  const { events, authors } = useIncidentLive();

  // Render newest-first.
  const sorted = [...events].sort((a, b) => eventTime(b).getTime() - eventTime(a).getTime());

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-neutral-500">No timeline events yet — post the first note.</p>
    );
  }

  return (
    <ol className="space-y-3">
      {sorted.map((e) => {
        const time = eventTime(e);
        const kindLabel =
          e.source === 'optimistic' ? 'note' : e.kind.replaceAll('_', ' ');
        const displayName =
          e.source === 'optimistic'
            ? e.authorName ?? 'You'
            : lookupAuthor(authors, e.authorUserId);
        return (
          <li
            key={e.id}
            className={
              e.source === 'optimistic'
                ? 'rounded border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm'
                : 'rounded border border-neutral-200 bg-white p-3 text-sm'
            }
          >
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
              <span>
                <strong className="font-medium text-neutral-700">{displayName}</strong> ·{' '}
                {kindLabel}
              </span>
              <span className="flex items-center gap-2">
                {e.source === 'optimistic' && (
                  <span
                    className={
                      'error' in e && e.error
                        ? 'rounded bg-red-100 px-1 text-red-700'
                        : 'rounded bg-neutral-200 px-1 text-neutral-700'
                    }
                  >
                    {'error' in e && e.error ? `error: ${e.error}` : 'sending…'}
                  </span>
                )}
                <time dateTime={time.toISOString()}>{relativeTime(time)}</time>
              </span>
            </div>
            {e.source === 'optimistic' ? (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.markdown}</ReactMarkdown>
              </div>
            ) : (
              <TimelineBodyView event={e} authors={authors} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function TimelineBodyView({
  event,
  authors,
}: {
  event: Extract<DisplayedEvent, { source: 'server' }>;
  authors: Map<string, string | null>;
}): React.JSX.Element {
  if (event.kind === 'note') {
    const body = event.body as { markdown: string };
    return (
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body.markdown}</ReactMarkdown>
      </div>
    );
  }
  if (event.kind === 'status_change') {
    const body = event.body as { from: string; to: string; reason?: string };
    return (
      <p className="text-neutral-700">
        Status: <code>{body.from}</code> → <code>{body.to}</code>
        {body.reason ? <span className="text-neutral-500"> · {body.reason}</span> : null}
      </p>
    );
  }
  if (event.kind === 'severity_change') {
    const body = event.body as { from: string; to: string };
    return (
      <p className="text-neutral-700">
        Severity: <code>{body.from}</code> → <code>{body.to}</code>
      </p>
    );
  }
  // role_change
  const body = event.body as {
    role: string;
    fromUserId: string | null;
    toUserId: string | null;
  };
  const fromName =
    event.fromUserName ?? (body.fromUserId ? lookupAuthor(authors, body.fromUserId) : 'system');
  const toName =
    event.toUserName ?? (body.toUserId ? lookupAuthor(authors, body.toUserId) : 'system');
  return (
    <p className="text-neutral-700">
      {body.role.toUpperCase()}: {fromName} → {toName}
    </p>
  );
}
