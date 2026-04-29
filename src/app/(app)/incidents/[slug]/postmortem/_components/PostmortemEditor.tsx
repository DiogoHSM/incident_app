'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  postmortemId: string;
  initialMarkdown: string;
  initialUpdatedAtIso: string;
}

type SaveStatus =
  | { kind: 'idle'; lastSavedAtIso: string }
  | { kind: 'pending' }
  | { kind: 'saved'; atIso: string }
  | { kind: 'error'; message: string };

const DEBOUNCE_MS = 800;

function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function PostmortemEditor({
  postmortemId,
  initialMarkdown,
  initialUpdatedAtIso,
}: Props) {
  const [body, setBody] = useState(initialMarkdown);
  const [status, setStatus] = useState<SaveStatus>({
    kind: 'idle',
    lastSavedAtIso: initialUpdatedAtIso,
  });
  const [now, setNow] = useState(() => new Date());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  // Tick once a second so "saved 12s ago" updates without re-saving.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const flush = useCallback(
    async (markdownBody: string) => {
      if (inflightRef.current) inflightRef.current.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      setStatus({ kind: 'pending' });
      try {
        const res = await fetch(`/api/postmortems/${postmortemId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdownBody }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          setStatus({ kind: 'error', message: `${res.status} ${text || res.statusText}` });
          return;
        }
        const data = (await res.json()) as { updatedAt: string };
        setStatus({ kind: 'saved', atIso: data.updatedAt });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setStatus({ kind: 'error', message: (err as Error).message ?? 'network error' });
      }
    },
    [postmortemId],
  );

  const onChange = useCallback(
    (next: string) => {
      setBody(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush(next);
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  const retry = useCallback(() => {
    void flush(body);
  }, [flush, body]);

  // Flush on tab close / navigation.
  useEffect(() => {
    const handler = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Best-effort send; we deliberately do not await — the page is going away.
        void fetch(`/api/postmortems/${postmortemId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdownBody: body }),
          keepalive: true,
        });
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [body, postmortemId]);

  let statusLabel: string;
  let statusColor: string;
  if (status.kind === 'pending') {
    statusLabel = 'saving…';
    statusColor = 'text-neutral-500';
  } else if (status.kind === 'error') {
    statusLabel = `⚠ ${status.message}`;
    statusColor = 'text-amber-600';
  } else if (status.kind === 'saved') {
    statusLabel = `saved ${timeAgo(status.atIso, now)}`;
    statusColor = 'text-emerald-600';
  } else {
    statusLabel = `saved ${timeAgo(status.lastSavedAtIso, now)}`;
    statusColor = 'text-neutral-500';
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[60vh] w-full rounded border border-neutral-200 bg-white p-3 font-mono text-sm"
        spellCheck="true"
      />
      <div className="flex items-center justify-between text-xs">
        <span className={statusColor} aria-live="polite">
          {statusLabel}
        </span>
        {status.kind === 'error' ? (
          <button
            type="button"
            onClick={retry}
            className="rounded border px-2 py-0.5 hover:bg-neutral-100"
          >
            retry now
          </button>
        ) : null}
      </div>
    </div>
  );
}
