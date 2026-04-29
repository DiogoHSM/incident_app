import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/lib/db/schema';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { users } from '@/lib/db/schema/users';
import { env } from '@/lib/env';
import { IncidentUpdatePayloadSchema } from './types';
import { NOTIFY_CHANNEL } from './notify';
import type { TimelineEventOnWire } from './types';

export type DispatcherListener = (event: TimelineEventOnWire) => void;

export interface RealtimeDispatcher {
  subscribe(incidentId: string, listener: DispatcherListener): () => void;
  close(): Promise<void>;
}

class DispatcherImpl implements RealtimeDispatcher {
  private subscribersByIncident = new Map<string, Set<DispatcherListener>>();
  private listenClient: ReturnType<typeof postgres>;
  private fetchClient: ReturnType<typeof postgres>;
  private fetchDb: ReturnType<typeof drizzle<typeof schema>>;
  private unlisten: (() => Promise<void>) | null = null;
  private ready: Promise<void>;

  constructor(connectionString: string) {
    this.listenClient = postgres(connectionString, { max: 1, idle_timeout: 0 });
    this.fetchClient = postgres(connectionString, { max: 4 });
    this.fetchDb = drizzle(this.fetchClient, { schema });
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    const sub = await this.listenClient.listen(NOTIFY_CHANNEL, (raw) => {
      void this.onNotify(raw);
    });
    this.unlisten = () => sub.unlisten();
  }

  private async onNotify(raw: string): Promise<void> {
    try {
      let parsed;
      try {
        parsed = IncidentUpdatePayloadSchema.parse(JSON.parse(raw));
      } catch (err) {
        // Drop malformed payloads — a corrupt NOTIFY must never take down the listener.
        console.error('[realtime] malformed NOTIFY payload, dropping', err);
        return;
      }
      const subs = this.subscribersByIncident.get(parsed.incidentId);
      if (!subs || subs.size === 0) return;

      const [row] = await this.fetchDb
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
        .where(eq(timelineEvents.id, parsed.eventId))
        .limit(1);
      if (!row) {
        console.warn('[realtime] timeline event not found for id', parsed.eventId);
        return;
      }

      const onWire: TimelineEventOnWire = {
        id: row.id,
        incidentId: row.incidentId,
        authorUserId: row.authorUserId,
        kind: row.kind,
        body: row.body,
        occurredAt: row.occurredAt,
        authorName: row.authorName ?? null,
      };

      for (const listener of subs) {
        try {
          listener(onWire);
        } catch (err) {
          // One bad listener must not break the others.
          console.error('[realtime] listener threw, continuing', err);
        }
      }
    } catch (err) {
      // Outer guard: a thrown SELECT (DB blip) must not become an unhandled rejection.
      console.error('[realtime] unhandled error in onNotify', err);
    }
  }

  subscribe(incidentId: string, listener: DispatcherListener): () => void {
    let subs = this.subscribersByIncident.get(incidentId);
    if (!subs) {
      subs = new Set();
      this.subscribersByIncident.set(incidentId, subs);
    }
    subs.add(listener);
    return () => {
      const set = this.subscribersByIncident.get(incidentId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.subscribersByIncident.delete(incidentId);
    };
  }

  async close(): Promise<void> {
    if (this.unlisten) await this.unlisten();
    await this.listenClient.end({ timeout: 1 });
    await this.fetchClient.end({ timeout: 1 });
    this.subscribersByIncident.clear();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }
}

const globalForDispatcher = globalThis as unknown as {
  realtimeDispatcher?: DispatcherImpl;
};

export function getRealtimeDispatcher(): RealtimeDispatcher & { whenReady(): Promise<void> } {
  let d = globalForDispatcher.realtimeDispatcher;
  if (!d) {
    d = new DispatcherImpl(env.DATABASE_URL);
    globalForDispatcher.realtimeDispatcher = d;
  }
  return d;
}

// For tests: build a fresh dispatcher pointed at a specific connection string,
// bypassing the globalThis cache. Caller is responsible for close().
export function createRealtimeDispatcher(connectionString: string): RealtimeDispatcher & {
  whenReady(): Promise<void>;
} {
  return new DispatcherImpl(connectionString);
}
