'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TimelineEventOnWire } from '@/lib/realtime/types';
import type { TimelineEvent } from '@/lib/db/schema/timeline';

type Optimistic = {
  id: string; // 'tmp-<uuid>'
  pending: true;
  error?: string;
  markdown: string;
  createdAt: Date;
  authorUserId: string;
  authorName: string | null;
};

export type DisplayedEvent =
  | (TimelineEvent & {
      source: 'server';
      authorName: string | null;
      fromUserName: string | null;
      toUserName: string | null;
    })
  | (Optimistic & { source: 'optimistic' });

type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface ContextValue {
  events: DisplayedEvent[];
  authors: Map<string, string | null>;
  connection: ConnectionState;
  addOptimisticNote(input: { markdown: string; authorUserId: string }): string;
  markOptimisticError(id: string, message: string): void;
  reconcileOptimistic(realEvent: TimelineEventOnWire): void;
}

const Ctx = createContext<ContextValue | null>(null);

const RECONNECT_THRESHOLD_MS = 30_000;

export function useIncidentLive(): ContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIncidentLive used outside <IncidentLiveProvider>');
  return v;
}

export interface IncidentLiveProviderProps {
  slug: string;
  initialEvents: TimelineEvent[];
  initialAuthors: Array<{ id: string; name: string | null }>;
  children: React.ReactNode;
}

export function IncidentLiveProvider({
  slug,
  initialEvents,
  initialAuthors,
  children,
}: IncidentLiveProviderProps): React.JSX.Element {
  const [events, setEvents] = useState<DisplayedEvent[]>(() =>
    initialEvents.map((e) => ({
      ...e,
      source: 'server' as const,
      authorName: initialAuthors.find((a) => a.id === e.authorUserId)?.name ?? null,
      fromUserName: null,
      toUserName: null,
    })),
  );
  const [authors, setAuthors] = useState<Map<string, string | null>>(
    () => new Map(initialAuthors.map((a) => [a.id, a.name])),
  );
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const lastMessageAtRef = useRef<number>(0);

  const upsertEvent = useCallback((evt: TimelineEventOnWire) => {
    setEvents((prev) => {
      // Dedup by id (real id replaces optimistic only via reconcileOptimistic).
      if (prev.some((e) => e.source === 'server' && e.id === evt.id)) return prev;
      const newEntry: DisplayedEvent = {
        ...evt,
        source: 'server',
      };
      // Prepend newest-first; UI renders chronologically using occurredAt.
      return [newEntry, ...prev];
    });
    const authorId = evt.authorUserId;
    if (authorId) {
      setAuthors((prev) => {
        if (prev.has(authorId)) return prev;
        const next = new Map(prev);
        next.set(authorId, evt.authorName);
        return next;
      });
    }
  }, []);

  const reconcileOptimistic = useCallback((realEvent: TimelineEventOnWire) => {
    setEvents((prev) => {
      // If a server entry with this id already exists, no-op.
      if (prev.some((e) => e.source === 'server' && e.id === realEvent.id)) return prev;

      // Try to find an optimistic note with the same markdown.
      let replaced = false;
      const next = prev.map((e) => {
        if (replaced) return e;
        if (
          e.source === 'optimistic' &&
          realEvent.kind === 'note' &&
          (realEvent.body as { markdown?: string }).markdown === e.markdown
        ) {
          replaced = true;
          return { ...realEvent, source: 'server' as const } satisfies DisplayedEvent;
        }
        return e;
      });
      if (replaced) return next;
      // Otherwise, just prepend.
      return [{ ...realEvent, source: 'server' as const }, ...prev];
    });
  }, []);

  const addOptimisticNote = useCallback(
    ({ markdown, authorUserId }: { markdown: string; authorUserId: string }): string => {
      const id = `tmp-${crypto.randomUUID()}`;
      const entry: DisplayedEvent = {
        id,
        pending: true,
        markdown,
        createdAt: new Date(),
        authorUserId,
        authorName: authors.get(authorUserId) ?? null,
        source: 'optimistic',
      };
      setEvents((prev) => [entry, ...prev]);
      return id;
    },
    [authors],
  );

  const markOptimisticError = useCallback((id: string, message: string) => {
    setEvents((prev) =>
      prev.map((e) =>
        e.source === 'optimistic' && e.id === id ? { ...e, error: message } : e,
      ),
    );
  }, []);

  // EventSource subscription.
  useEffect(() => {
    lastMessageAtRef.current = Date.now();
    const es = new EventSource(`/api/incidents/${slug}/stream`);

    const onAnyMessage = () => {
      lastMessageAtRef.current = Date.now();
      setConnection('live');
    };

    es.addEventListener('open', onAnyMessage);
    es.addEventListener('heartbeat', onAnyMessage);

    const handleEvent = (kind: string) => (msg: MessageEvent) => {
      onAnyMessage();
      try {
        const parsed = JSON.parse(msg.data) as TimelineEventOnWire;
        if (kind === 'note') reconcileOptimistic(parsed);
        else upsertEvent(parsed);
      } catch {
        // Drop malformed payload silently.
      }
    };

    es.addEventListener('note', handleEvent('note'));
    es.addEventListener('status_change', handleEvent('status_change'));
    es.addEventListener('severity_change', handleEvent('severity_change'));
    es.addEventListener('role_change', handleEvent('role_change'));
    es.addEventListener('postmortem_link', handleEvent('postmortem_link'));
    es.addEventListener('webhook', handleEvent('webhook'));

    es.addEventListener('error', () => {
      setConnection('reconnecting');
    });

    // Liveness ticker — promote to "reconnecting" if no message for 30 s
    // even when readyState says OPEN (e.g. proxy black-holed the conn).
    const tick = setInterval(() => {
      if (Date.now() - lastMessageAtRef.current > RECONNECT_THRESHOLD_MS) {
        setConnection('reconnecting');
      }
    }, 1_000);

    return () => {
      clearInterval(tick);
      es.close();
    };
  }, [slug, reconcileOptimistic, upsertEvent]);

  const value = useMemo<ContextValue>(
    () => ({
      events,
      authors,
      connection,
      addOptimisticNote,
      markOptimisticError,
      reconcileOptimistic,
    }),
    [events, authors, connection, addOptimisticNote, markOptimisticError, reconcileOptimistic],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
