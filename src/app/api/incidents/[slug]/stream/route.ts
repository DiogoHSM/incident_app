import { and, eq, gt, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { users } from '@/lib/db/schema/users';
import { getRealtimeDispatcher } from '@/lib/realtime/dispatcher';
import type { TimelineEventOnWire } from '@/lib/realtime/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 25_000;

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

function encode(line: string): Uint8Array {
  return new TextEncoder().encode(line);
}

function formatEvent(evt: TimelineEventOnWire): string {
  const data = JSON.stringify(evt);
  return `id: ${evt.id}\nevent: ${evt.kind}\ndata: ${data}\n\n`;
}

async function backfillSinceLastEventId(
  incidentId: string,
  lastEventId: string,
): Promise<TimelineEventOnWire[]> {
  const [anchor] = await db
    .select({ occurredAt: timelineEvents.occurredAt })
    .from(timelineEvents)
    .where(and(eq(timelineEvents.id, lastEventId), eq(timelineEvents.incidentId, incidentId)))
    .limit(1);
  if (!anchor) return [];
  const rows = await db
    .select({
      id: timelineEvents.id,
      incidentId: timelineEvents.incidentId,
      authorUserId: timelineEvents.authorUserId,
      kind: timelineEvents.kind,
      body: timelineEvents.body,
      occurredAt: timelineEvents.occurredAt,
      authorName: users.name,
    })
    .from(timelineEvents)
    .leftJoin(users, eq(users.id, timelineEvents.authorUserId))
    .where(and(eq(timelineEvents.incidentId, incidentId), gt(timelineEvents.occurredAt, anchor.occurredAt)))
    .orderBy(timelineEvents.occurredAt);
  const targetIds = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'role_change') {
      const body = r.body as { fromUserId: string | null; toUserId: string | null };
      if (body.fromUserId) targetIds.add(body.fromUserId);
      if (body.toUserId) targetIds.add(body.toUserId);
    }
  }
  const targetNames = new Map<string, string | null>();
  if (targetIds.size > 0) {
    const targetRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...targetIds]));
    for (const t of targetRows) targetNames.set(t.id, t.name);
  }
  return rows.map((r) => {
    let fromUserName: string | null = null;
    let toUserName: string | null = null;
    if (r.kind === 'role_change') {
      const body = r.body as { fromUserId: string | null; toUserId: string | null };
      fromUserName = body.fromUserId ? (targetNames.get(body.fromUserId) ?? null) : null;
      toUserName = body.toUserId ? (targetNames.get(body.toUserId) ?? null) : null;
    }
    return { ...r, authorName: r.authorName ?? null, fromUserName, toUserName };
  });
}

export async function GET(request: Request, ctx: RouteCtx): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const { slug } = await ctx.params;
  const found = await findIncidentBySlugForUser(db, session.user.id, slug);
  if (!found) return new Response('Not found', { status: 404 });
  const incidentId = found.incident.id;

  const lastEventId = request.headers.get('last-event-id');

  const dispatcher = getRealtimeDispatcher();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Initial comment so proxies flush headers immediately.
      controller.enqueue(encode(`: connected ${new Date().toISOString()}\n\n`));

      if (lastEventId) {
        try {
          const backfill = await backfillSinceLastEventId(incidentId, lastEventId);
          for (const evt of backfill) {
            controller.enqueue(encode(formatEvent(evt)));
          }
        } catch (err) {
          // Fall through to live mode — the client will re-fetch the canonical
          // timeline (per spec §3.2). Log so production failures are diagnosable.
          console.warn('[sse] backfill failed for incident', incidentId, err);
        }
      }

      unsubscribe = dispatcher.subscribe(incidentId, (evt) => {
        try {
          controller.enqueue(encode(formatEvent(evt)));
        } catch {
          // Stream already closed — drop the event silently.
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encode(`event: heartbeat\ndata: {}\n\n`));
        } catch {
          // Stream closed.
        }
      }, HEARTBEAT_INTERVAL_MS);

      const onAbort = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      if (request.signal.aborted) {
        onAbort();
      } else {
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
