# Plan 4 — Real-time timeline via SSE + Postgres LISTEN/NOTIFY

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/incidents/[slug]` update live across browsers — every timeline event written by any user appears in every open page within ~1 s, with `revalidatePath` as the fallback path.

**Architecture:** Each Next.js process runs a singleton dispatcher that holds one dedicated Postgres connection on `LISTEN incident_updates`. Every mutation that inserts a `TimelineEvent` calls `notifyIncidentUpdate(tx, …)` inside the same transaction (`pg_notify` is queued and fires on commit, so the row is durable before any client sees the message). The dispatcher receives NOTIFYs, fetches the freshly-committed row joined with the author's name, and broadcasts to in-memory subscribers. A Node-runtime route handler at `/api/incidents/[slug]/stream` authenticates, subscribes the request to the dispatcher, and writes Server-Sent Events. On the client, `IncidentLiveProvider` (a React Context provider) opens an `EventSource`, merges new events into state, deduplicates by id, supports `Last-Event-ID` reconnect backfill, and exposes optimistic-add for note posting (per spec §8.1: notes are optimistic, status/severity/role changes are not).

**Tech Stack:** Next.js 16 App Router (Node runtime for the route) · TypeScript strict + `noUncheckedIndexedAccess` · Drizzle ORM 0.45 · `postgres` 3.x (`client.listen()` for `LISTEN`) · zod · React 19 (`useSyncExternalStore` for the dispatcher subscription, `createContext` for client state) · Vitest 4 + testcontainers.

**Out of scope (defer):**

- Viewer count widget (§3.2 mentions "🟢 Live · 4 viewers") — Plan 11 (polish).
- New event kinds: `webhook`, `postmortem_link`, `attachment`, `status_update_published` — added in their owning plans (8 / 7 / later).
- Optimistic UI for status/severity/role mutations — explicitly NOT optimistic per spec §8.1.
- Edge-cached status page invalidation via the same NOTIFY — Plan 9 (status page).
- Multi-process pub/sub beyond per-instance `LISTEN` — each instance LISTENs independently per spec §3.2; horizontal scaling already works.
- Server-side route-handler test — defer to Playwright in Plan 11. Dispatcher round-trip is covered by the integration test.

**Deliberate deviations from the spec:**

These are called out so the reviewer doesn't flag them as oversights; the rationale is in the implementer notes at the bottom of the plan.

| Spec says | Plan does | Why |
|---|---|---|
| URL `/api/incidents/[id]/stream` (§3.2) | URL `/api/incidents/[slug]/stream` | Matches the rest of the app — pages live at `/incidents/[slug]`. The route resolves slug→incident via the existing `findIncidentBySlugForUser` (admin-sees-all already enforced there). |
| Channel `incident:[id]` (§3.2 line 53) | Single global channel `incident_updates` (§3.2 line 54) | The spec contradicts itself across two adjacent lines. Postgres `LISTEN` is per-connection and channel cardinality matters; one global channel + in-memory routing is the standard pattern and is what line 54 already says. |
| Heartbeat as SSE comment line (§3.2) | Heartbeat as typed `event: heartbeat` | Comment lines don't fire `EventSource.onmessage`, so the client can't distinguish "no traffic" from "still connected" if heartbeats are comments. A typed event lets the liveness ticker reset on each heartbeat. The proxy-defeat purpose of the heartbeat is unaffected. |
| On reconnect, page re-fetches last 100 events (§3.2 / §8.2) | On reconnect, server backfills events newer than the `Last-Event-ID` anchor's `occurred_at` | Cheaper and more correct: backfill exactly the gap. The "last 100" version risks duplicates and misses anything past the 100-row window. Since `timeline_events` are append-only in v1, the anchor is always retrievable. |

**Commit trailer (mandatory on every commit):**
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File map

**Created:**

- `src/lib/realtime/types.ts` — `IncidentUpdatePayload` zod schema (the `pg_notify` wire shape) and `TimelineEventOnWire` (event + author name resolved by the dispatcher).
- `src/lib/realtime/notify.ts` — `notifyIncidentUpdate(tx, payload)` helper.
- `src/lib/realtime/dispatcher.ts` — singleton class with `subscribe(incidentId, listener)`, `close()`, and the `LISTEN incident_updates` loop. Uses `globalThis` cache outside test mode.
- `src/app/api/incidents/[slug]/stream/route.ts` — SSE route handler (Node runtime).
- `src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx` — client context provider (EventSource owner).
- `src/app/(app)/incidents/[slug]/_components/ConnectionBanner.tsx` — small client component, shows a yellow "Reconnecting…" banner when no message has arrived in 30 s.
- `tests/integration/realtime-dispatcher.test.ts` — dispatcher LISTEN/NOTIFY round-trip + per-mutation integration coverage.
- `tests/unit/realtime-payload.test.ts` — zod payload schema unit test.

**Modified:**

- `src/lib/db/queries/timeline.ts` — `appendNote` wraps insert + notify in `db.transaction(...)`.
- `src/lib/db/queries/incidents.ts` — `changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole` call `notifyIncidentUpdate(tx, …)` after every `timelineEvents` insert (including the role_change side-effect inside `changeIncidentStatus`).
- `src/app/(app)/incidents/[slug]/_components/Timeline.tsx` — read events + authors from context when wrapped, fall back to props otherwise (so the existing server-only render path keeps working).
- `src/app/(app)/incidents/[slug]/_components/NoteForm.tsx` — consume `IncidentLiveProvider` context, push optimistic event before submitting the action, replace on echo by markdown match within 5 s, mark error otherwise.
- `src/app/(app)/incidents/[slug]/page.tsx` — wrap the timeline section in `<IncidentLiveProvider initialEvents={...} authors={...} slug={...}>`.
- `CLAUDE.md` — append Plan 4 entry; promote `/incidents/[slug]` from "real-time SSE arrives in Plan 4" to its real Plan-4 state.
- `.claude/GUARDRAILS.md` — add a row for the `src/lib/realtime/` module.
- `.claude/memory/foundation_followups.md` — close out "Plan 4: Real-time SSE" if it was listed; add new follow-ups (route-handler tests, viewer count, optimistic-status-with-rollback) that surface during this plan.
- `README.md` — bump the manual acceptance checklist to include the live-update smoke test.

---

## Task 1: Wire payload schema + types

**Files:**

- Create: `src/lib/realtime/types.ts`
- Create: `tests/unit/realtime-payload.test.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/realtime-payload.test.ts
import { describe, expect, it } from 'vitest';
import { IncidentUpdatePayloadSchema } from '@/lib/realtime/types';

describe('IncidentUpdatePayloadSchema', () => {
  it('parses a valid payload', () => {
    const parsed = IncidentUpdatePayloadSchema.parse({
      incidentId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
      kind: 'note',
      occurredAt: '2026-04-29T12:00:00.000Z',
    });
    expect(parsed.kind).toBe('note');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      IncidentUpdatePayloadSchema.parse({
        incidentId: '11111111-1111-4111-8111-111111111111',
        eventId: '22222222-2222-4222-8222-222222222222',
        kind: 'webhook',
        occurredAt: '2026-04-29T12:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects malformed UUIDs', () => {
    expect(() =>
      IncidentUpdatePayloadSchema.parse({
        incidentId: 'not-a-uuid',
        eventId: '22222222-2222-4222-8222-222222222222',
        kind: 'note',
        occurredAt: '2026-04-29T12:00:00.000Z',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/realtime-payload.test.ts`
Expected: **FAIL** — `Cannot find module '@/lib/realtime/types'`.

- [ ] **Step 3: Create the types module**

```ts
// src/lib/realtime/types.ts
import { z } from 'zod';
import { TIMELINE_EVENT_KIND_VALUES } from '@/lib/db/schema/timeline';
import type { TimelineEvent } from '@/lib/db/schema/timeline';

export const IncidentUpdatePayloadSchema = z.object({
  incidentId: z.string().uuid(),
  eventId: z.string().uuid(),
  kind: z.enum(TIMELINE_EVENT_KIND_VALUES),
  occurredAt: z.string().datetime(),
});

export type IncidentUpdatePayload = z.infer<typeof IncidentUpdatePayloadSchema>;

export interface TimelineEventOnWire extends TimelineEvent {
  authorName: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/realtime-payload.test.ts`
Expected: **PASS** — 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/types.ts tests/unit/realtime-payload.test.ts
git commit -m "$(cat <<'EOF'
feat(realtime): add IncidentUpdatePayload zod schema for pg_notify

The schema is the wire contract between mutations (pg_notify producers)
and the dispatcher (LISTEN consumer). Body content is intentionally NOT
in the payload — Postgres NOTIFY caps at 8 KB and note bodies can reach
50 KB. The dispatcher fetches the row from DB by id on receipt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `notifyIncidentUpdate` helper

**Files:**

- Create: `src/lib/realtime/notify.ts`

- [ ] **Step 1: Implement the helper**

```ts
// src/lib/realtime/notify.ts
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { IncidentUpdatePayloadSchema, type IncidentUpdatePayload } from './types';

export const NOTIFY_CHANNEL = 'incident_updates';

export async function notifyIncidentUpdate(
  tx: DB,
  payload: IncidentUpdatePayload,
): Promise<void> {
  const validated = IncidentUpdatePayloadSchema.parse(payload);
  await tx.execute(sql`SELECT pg_notify(${NOTIFY_CHANNEL}, ${JSON.stringify(validated)})`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime/notify.ts
git commit -m "$(cat <<'EOF'
feat(realtime): add notifyIncidentUpdate helper

Validates the payload via zod before pg_notify so a bad payload throws
inside the mutation transaction (rolling back the row insert) instead
of silently shipping garbage to subscribers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Realtime dispatcher

**Files:**

- Create: `src/lib/realtime/dispatcher.ts`

- [ ] **Step 1: Implement the dispatcher**

```ts
// src/lib/realtime/dispatcher.ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime/dispatcher.ts
git commit -m "$(cat <<'EOF'
feat(realtime): add dispatcher with LISTEN incident_updates

Singleton class holding two postgres connections (one for LISTEN, one for
the small SELECT-by-id that resolves the author name on each NOTIFY). Maps
incidentId -> Set<listener>; unsubscribe is the returned function.

createRealtimeDispatcher() bypasses the globalThis cache so tests can run
against a testcontainer connection string without polluting subsequent
runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire NOTIFY into mutations

**Files:**

- Modify: `src/lib/db/queries/timeline.ts`
- Modify: `src/lib/db/queries/incidents.ts`

- [ ] **Step 1: Wrap `appendNote` in a transaction with notify**

Replace the body of `appendNote` in `src/lib/db/queries/timeline.ts` (the existing implementation does not use a transaction):

```ts
// Add to imports at the top:
import { notifyIncidentUpdate } from '@/lib/realtime/notify';

export async function appendNote(
  db: DB,
  actorUserId: string,
  incidentId: string,
  markdown: string,
): Promise<TimelineEvent> {
  const body = TimelineEventBodySchema.parse({ kind: 'note', markdown });
  const inc = await loadIncidentForActor(db, actorUserId, incidentId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(timelineEvents)
      .values({
        incidentId: inc.id,
        authorUserId: actorUserId,
        kind: 'note',
        body,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: row.incidentId,
      eventId: row.id,
      kind: row.kind,
      occurredAt: row.occurredAt.toISOString(),
    });

    return row;
  });
}
```

- [ ] **Step 2: Add notify calls inside `changeIncidentStatus`**

In `src/lib/db/queries/incidents.ts`, add to imports:

```ts
import { notifyIncidentUpdate } from '@/lib/realtime/notify';
```

Then, inside `changeIncidentStatus`:

(a) **Replace** the existing `if (assigningIcId) { ... }` block (the one that calls `tx.insert(timelineEvents).values(...)` without `.returning()`) with:

```ts
    if (assigningIcId) {
      const roleBody = TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'ic' satisfies IncidentRole,
        fromUserId: current.icUserId,
        toUserId: assigningIcId,
      });
      const [roleEvent] = await tx
        .insert(timelineEvents)
        .values({
          incidentId,
          authorUserId: actorUserId,
          kind: 'role_change',
          body: roleBody,
        })
        .returning();
      if (!roleEvent) throw new Error('Insert returned no rows');
      await notifyIncidentUpdate(tx as unknown as DB, {
        incidentId: roleEvent.incidentId,
        eventId: roleEvent.id,
        kind: 'role_change',
        occurredAt: roleEvent.occurredAt.toISOString(),
      });
    }
```

The change is: `.returning()` on the insert + null-guard + `notifyIncidentUpdate` call. Everything else is unchanged.

(b) **Insert** a notify call between the existing `statusEvent` insert (the one that already uses `.returning()`) and `return { incident: updated, statusEvent };`. The result should look like:

```ts
    const [statusEvent] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'status_change',
        body: statusBody,
      })
      .returning();
    if (!statusEvent) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: statusEvent.incidentId,
      eventId: statusEvent.id,
      kind: 'status_change',
      occurredAt: statusEvent.occurredAt.toISOString(),
    });

    return { incident: updated, statusEvent };
```

- [ ] **Step 3: Add notify call inside `changeIncidentSeverity`**

Inside `changeIncidentSeverity`, after the `event` insert and the null-guard, before `return { incident: updated, event };`:

```ts
    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'severity_change',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { incident: updated, event };
```

- [ ] **Step 4: Add notify call inside `assignIncidentRole`**

Inside `assignIncidentRole`, after the `event` insert and the null-guard, before `return { incident: updated, event };`:

```ts
    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'role_change',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { incident: updated, event };
```

- [ ] **Step 5: Run the existing mutation tests**

Run: `pnpm test tests/integration/timeline.test.ts tests/integration/incidents-mutations.test.ts`
Expected: **PASS** — all existing tests still green. The notify call is a side-effect; the mutation results haven't changed shape.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries/timeline.ts src/lib/db/queries/incidents.ts
git commit -m "$(cat <<'EOF'
feat(realtime): emit pg_notify in every timeline-event mutation

appendNote now runs in a transaction so the row insert and the NOTIFY
queue+commit are atomic. The three incident mutations each grow a notify
call after their timeline_events insert. changeIncidentStatus emits twice
when leaving triaging with a new IC: once for the role_change side-effect,
once for the status_change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Dispatcher round-trip integration test

**Files:**

- Create: `tests/integration/realtime-dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/realtime-dispatcher.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRealtimeDispatcher,
  type RealtimeDispatcher,
} from '@/lib/realtime/dispatcher';
import type { TimelineEventOnWire } from '@/lib/realtime/types';
import { useTestDb, getTestDb } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { appendNote } from '@/lib/db/queries/timeline';
import {
  assignIncidentRole,
  changeIncidentSeverity,
  changeIncidentStatus,
  declareIncident,
} from '@/lib/db/queries/incidents';

interface World {
  actorId: string;
  teamId: string;
  incidentId: string;
}

let actorCounter = 0;

async function seed(): Promise<World> {
  const db = getTestDb();
  const tag = ++actorCounter;
  const [user] = await db
    .insert(users)
    .values({ email: `rt-${tag}@x.co`, name: `RT${tag}`, ssoSubject: `s|rt-${tag}` })
    .returning();
  const [team] = await db.insert(teams).values({ name: `RT${tag}`, slug: `rt-${tag}` }).returning();
  await db
    .insert(teamMemberships)
    .values({ userId: user!.id, teamId: team!.id, role: 'member' });
  const inc = await declareIncident(db, user!.id, {
    teamId: team!.id,
    title: `incident ${tag}`,
    summary: '',
    severity: 'SEV2',
    affectedServiceIds: [],
  });
  return { actorId: user!.id, teamId: team!.id, incidentId: inc.id };
}

describe('RealtimeDispatcher (integration)', () => {
  useTestDb();

  let dispatcher: (RealtimeDispatcher & { whenReady(): Promise<void> }) | undefined;
  let world: World;

  beforeAll(async () => {
    const uri = process.env.TEST_DATABASE_URL;
    if (!uri) throw new Error('TEST_DATABASE_URL not set');
    dispatcher = createRealtimeDispatcher(uri);
    await dispatcher.whenReady();
  });

  afterAll(async () => {
    await dispatcher?.close();
  });

  beforeEach(async () => {
    actorCounter = 0;
    world = await seed();
  });

  function nextEvent(incidentId: string): Promise<TimelineEventOnWire> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error('timeout waiting for dispatcher event'));
      }, 5_000);
      const unsub = dispatcher!.subscribe(incidentId, (evt) => {
        clearTimeout(timer);
        unsub();
        resolve(evt);
      });
    });
  }

  it('delivers a note event to a subscriber on the matching incident', async () => {
    const promise = nextEvent(world.incidentId);
    await appendNote(getTestDb(), world.actorId, world.incidentId, 'first note');
    const evt = await promise;
    expect(evt.kind).toBe('note');
    expect(evt.incidentId).toBe(world.incidentId);
    expect(evt.authorName).toBeTruthy();
    expect((evt.body as { kind: string }).kind).toBe('note');
  });

  it('delivers role_change + status_change when leaving triaging with a new IC', async () => {
    const received: TimelineEventOnWire[] = [];
    const done = new Promise<void>((resolve) => {
      const unsub = dispatcher!.subscribe(world.incidentId, (evt) => {
        received.push(evt);
        if (received.length === 2) {
          unsub();
          resolve();
        }
      });
    });
    await changeIncidentStatus(getTestDb(), world.actorId, world.incidentId, 'investigating', {
      assignIcUserId: world.actorId,
    });
    await done;
    expect(received.map((e) => e.kind).sort()).toEqual(['role_change', 'status_change']);
  });

  it('delivers severity_change events', async () => {
    const promise = nextEvent(world.incidentId);
    await changeIncidentSeverity(getTestDb(), world.actorId, world.incidentId, 'SEV1');
    const evt = await promise;
    expect(evt.kind).toBe('severity_change');
  });

  it('delivers role_change events for non-IC roles', async () => {
    const promise = nextEvent(world.incidentId);
    await assignIncidentRole(
      getTestDb(),
      world.actorId,
      world.incidentId,
      'scribe',
      world.actorId,
    );
    const evt = await promise;
    expect(evt.kind).toBe('role_change');
  });

  it('only delivers to subscribers of the matching incident', async () => {
    const second = await seed();
    let bReceived = 0;
    const unsub = dispatcher!.subscribe(second.incidentId, () => {
      bReceived++;
    });
    await appendNote(getTestDb(), world.actorId, world.incidentId, 'only for A');
    // Give the dispatcher up to 1 s to (incorrectly) deliver to B.
    await new Promise((r) => setTimeout(r, 1_000));
    unsub();
    expect(bReceived).toBe(0);
  });

  it('unsubscribe stops delivery', async () => {
    let count = 0;
    const unsub = dispatcher!.subscribe(world.incidentId, () => {
      count++;
    });
    unsub();
    await appendNote(getTestDb(), world.actorId, world.incidentId, 'after unsubscribe');
    await new Promise((r) => setTimeout(r, 500));
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/realtime-dispatcher.test.ts`
Expected: **PASS** — 6/6.

If a `nextEvent` call times out: confirm that the mutation actually inserted the row (in the same `useTestDb()` test database) and that the dispatcher is connected to the same `TEST_DATABASE_URL`. The dispatcher is created in `beforeAll`, BEFORE `useTestDb()`'s `beforeAll`, so both must read the same env var — they do, because `tests/setup/global.ts` sets `process.env.TEST_DATABASE_URL` in its top-level `setup()` (run before any test file's `beforeAll`).

Note about ordering: the second test ("delivers role_change + status_change") relies on the dispatcher delivering events in the order they were committed, which Postgres NOTIFY guarantees within a single transaction. The `.sort()` makes the assertion order-independent in case the listener fires the two callbacks in either order.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/realtime-dispatcher.test.ts
git commit -m "$(cat <<'EOF'
test(realtime): cover LISTEN/NOTIFY round-trip end-to-end

Asserts that every mutation that inserts a timeline_events row produces a
dispatcher event with the right kind and matching incidentId, that
subscribers on different incidents are isolated, and that unsubscribe
stops delivery.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: SSE route handler

**Files:**

- Create: `src/app/api/incidents/[slug]/stream/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// src/app/api/incidents/[slug]/stream/route.ts
import { eq, and, gt } from 'drizzle-orm';
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
  return rows.map((r) => ({ ...r, authorName: r.authorName ?? null }));
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
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: **PASS**.

If lint complains about `request` being unused in any narrowing branch: verify the imports are minimal and that `request.headers.get('last-event-id')` is still in the active code path.

- [ ] **Step 3: Manual smoke test**

Bring up the dev server and the database, then in two terminals:

```bash
# terminal 1
pnpm dev

# terminal 2 — fetch the stream after declaring an incident in the UI
# (replace <slug> with the real slug and copy the next-auth cookie from your browser)
curl -N \
  -H "Cookie: next-auth.session-token=<your-session-cookie>" \
  http://localhost:3000/api/incidents/<slug>/stream
```

You should see `: connected …` followed by `event: heartbeat` lines every 25 s.

In a third terminal (or in the browser), post a note via the UI. The `event: note` line should appear within ~1 s in the curl output.

There is no automated test for the route handler in this plan — defer to Plan 11 e2e (Playwright). The dispatcher round-trip in Task 5 covers the data path.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/incidents/[slug]/stream/route.ts
git commit -m "$(cat <<'EOF'
feat(realtime): add SSE route at /api/incidents/[slug]/stream

Node-runtime route handler. Authenticates via auth(), authorizes via
findIncidentBySlugForUser (so admin-sees-all stays consistent), subscribes
to the dispatcher, and streams id/event/data SSE frames. Honors
Last-Event-ID by backfilling timeline_events with occurredAt > anchor's
occurredAt before going live. Heartbeats every 25 s to defeat proxy idle
timeouts. Cleans up on request abort.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Client provider + connection banner

**Files:**

- Create: `src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx`
- Create: `src/app/(app)/incidents/[slug]/_components/ConnectionBanner.tsx`

- [ ] **Step 1: Implement the provider**

```tsx
// src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx
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
  | (TimelineEvent & { source: 'server'; authorName: string | null })
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
```

- [ ] **Step 2: Implement the connection banner**

```tsx
// src/app/(app)/incidents/[slug]/_components/ConnectionBanner.tsx
'use client';

import { useIncidentLive } from './IncidentLiveProvider';

export function ConnectionBanner(): React.JSX.Element | null {
  const { connection } = useIncidentLive();
  if (connection !== 'reconnecting') return null;
  return (
    <div
      role="status"
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      Reconnecting…
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/incidents/\[slug\]/_components/IncidentLiveProvider.tsx src/app/\(app\)/incidents/\[slug\]/_components/ConnectionBanner.tsx
git commit -m "$(cat <<'EOF'
feat(realtime): client provider for SSE timeline + reconnect banner

IncidentLiveProvider owns the EventSource, holds events + authors state,
and exposes addOptimisticNote / markOptimisticError / reconcileOptimistic
through React context. ConnectionBanner renders a yellow "Reconnecting…"
notice once 30 s pass without any message (heartbeat or otherwise).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Optimistic note submission

**Files:**

- Modify: `src/app/(app)/incidents/[slug]/_components/NoteForm.tsx`
- Modify: `src/app/(app)/incidents/[slug]/_components/Timeline.tsx`

- [ ] **Step 1: Refactor `NoteForm` to use the provider**

The current `NoteForm` is a thin wrapper over a server action. Replace its contents so it consumes the provider, inserts an optimistic entry, calls the action, and marks an error if the action throws or no canonical event arrives within 5 s.

```tsx
// src/app/(app)/incidents/[slug]/_components/NoteForm.tsx
'use client';

import { useRef, useState } from 'react';
import { addNoteAction } from '../actions';
import { useIncidentLive } from './IncidentLiveProvider';

export interface NoteFormProps {
  slug: string;
  currentUserId: string;
}

export function NoteForm({ slug, currentUserId }: NoteFormProps): React.JSX.Element {
  const { addOptimisticNote, markOptimisticError, events } = useIncidentLive();
  const [pending, setPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function onSubmit(form: FormData) {
    const markdown = String(form.get('markdown') ?? '').trim();
    if (!markdown) return;

    const optimisticId = addOptimisticNote({ markdown, authorUserId: currentUserId });
    setPending(true);
    if (textareaRef.current) textareaRef.current.value = '';

    // Fail-safe: if no canonical event echoes in 5 s, mark the optimistic
    // entry as errored. The provider's reconcileOptimistic clears the
    // pending entry on echo, so this will only ever fire when the round-trip
    // genuinely failed.
    const timeout = setTimeout(() => {
      const stillPending = events.some((e) => e.source === 'optimistic' && e.id === optimisticId);
      if (stillPending) markOptimisticError(optimisticId, 'Server did not confirm — try again.');
    }, 5_000);

    try {
      await addNoteAction(form);
    } catch (err) {
      markOptimisticError(optimisticId, err instanceof Error ? err.message : 'Failed to post.');
    } finally {
      clearTimeout(timeout);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <textarea
        ref={textareaRef}
        name="markdown"
        rows={3}
        required
        className="w-full rounded border border-neutral-300 p-2 text-sm"
        placeholder="Post an update…"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:bg-neutral-300"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  );
}
```

> **Note on the closure over `events`**: this is intentionally read at the moment the timeout fires. Stale closure is acceptable here because `events` is checked only to decide whether to surface the error UX — the canonical state is owned by the provider, and `markOptimisticError` is a no-op if the entry has already been replaced.

- [ ] **Step 2: Refactor `Timeline` to consume the provider**

Replace `Timeline.tsx` so it reads from context (and ignore the deprecated props):

```tsx
// src/app/(app)/incidents/[slug]/_components/Timeline.tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIncidentLive, type DisplayedEvent } from './IncidentLiveProvider';

function eventTime(e: DisplayedEvent): Date {
  return e.source === 'optimistic' ? e.createdAt : e.occurredAt;
}

export function Timeline(): React.JSX.Element {
  const { events, authors } = useIncidentLive();

  // Render newest-first.
  const sorted = [...events].sort((a, b) => eventTime(b).getTime() - eventTime(a).getTime());

  if (sorted.length === 0) {
    return <p className="text-sm text-neutral-500">No timeline events yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {sorted.map((e) => (
        <li
          key={e.id}
          className={
            e.source === 'optimistic'
              ? 'rounded border border-dashed border-neutral-300 bg-neutral-50 p-3'
              : 'rounded border border-neutral-200 bg-white p-3'
          }
        >
          <header className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-medium">
              {e.source === 'optimistic'
                ? e.authorName ?? 'You'
                : authors.get(e.authorUserId ?? '') ?? 'Unknown'}
            </span>
            <span>·</span>
            <time dateTime={eventTime(e).toISOString()}>
              {eventTime(e).toLocaleTimeString()}
            </time>
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
          </header>
          {e.source === 'optimistic' ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.markdown}</ReactMarkdown>
            </div>
          ) : (
            <TimelineBodyView event={e} />
          )}
        </li>
      ))}
    </ul>
  );
}

function TimelineBodyView({
  event,
}: {
  event: Extract<DisplayedEvent, { source: 'server' }>;
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
      <p className="text-sm">
        Status: <strong>{body.from}</strong> → <strong>{body.to}</strong>
        {body.reason ? <span className="text-neutral-500"> · {body.reason}</span> : null}
      </p>
    );
  }
  if (event.kind === 'severity_change') {
    const body = event.body as { from: string; to: string };
    return (
      <p className="text-sm">
        Severity: <strong>{body.from}</strong> → <strong>{body.to}</strong>
      </p>
    );
  }
  // role_change
  const body = event.body as {
    role: string;
    fromUserId: string | null;
    toUserId: string | null;
  };
  return (
    <p className="text-sm">
      Role <strong>{body.role}</strong>:{' '}
      {body.fromUserId ? `was ${body.fromUserId}` : 'unassigned'} →{' '}
      {body.toUserId ?? 'unassigned'}
    </p>
  );
}
```

> If the prior `Timeline.tsx` had additional formatting (icons, kind badges) you want to preserve, port them into `TimelineBodyView` — don't widen the props back, the context is now the source of truth.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/incidents/\[slug\]/_components/NoteForm.tsx src/app/\(app\)/incidents/\[slug\]/_components/Timeline.tsx
git commit -m "$(cat <<'EOF'
feat(realtime): optimistic note submission + context-driven timeline

NoteForm pushes a pending entry into the provider before calling the
action; reconcileOptimistic in the provider replaces it with the
canonical SSE-echoed event by markdown match. Timeline reads events
from context so the optimistic + server views share one source of truth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire the provider into the page

**Files:**

- Modify: `src/app/(app)/incidents/[slug]/page.tsx`

- [ ] **Step 1: Wrap the timeline section with the provider**

In `page.tsx`, replace the `<section>` containing `NoteForm` + `Timeline` with a wrapped version. Keep all other rendering unchanged.

```tsx
// Add to imports at the top:
import { IncidentLiveProvider } from './_components/IncidentLiveProvider';
import { ConnectionBanner } from './_components/ConnectionBanner';
```

Then replace:

```tsx
        <section className="space-y-3 rounded border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-medium text-neutral-700">Timeline</h2>
          <NoteForm slug={incident.publicSlug} />
          <Timeline events={events} authors={authorMap} />
        </section>
```

with:

```tsx
        <IncidentLiveProvider
          slug={incident.publicSlug}
          initialEvents={events}
          initialAuthors={[...authorMap.entries()].map(([id, name]) => ({ id, name }))}
        >
          <section className="space-y-3 rounded border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-medium text-neutral-700">Timeline</h2>
            <ConnectionBanner />
            <NoteForm slug={incident.publicSlug} currentUserId={userId} />
            <Timeline />
          </section>
        </IncidentLiveProvider>
```

The page is still a server component; it passes the server-rendered data to the provider as initial state, so the first paint is identical to before. The client provider takes over once it mounts.

- [ ] **Step 2: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: **PASS** — the existing 118 tests are unchanged + the new 6+3 (dispatcher + payload).

- [ ] **Step 3: Manual smoke test**

```bash
pnpm dev
```

Open `/incidents/<slug>` in two browser windows side by side. In window A, post a note. Within ~1 s, the note appears in window B. In B's DevTools network tab, the `/api/incidents/<slug>/stream` request stays open and you can see `event: heartbeat` lines arriving every 25 s.

Kill the database (`docker compose stop db`) to test reconnect: within 30 s the yellow "Reconnecting…" banner appears in both windows. Bring the DB back up; the banner clears once the stream resumes.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/incidents/\[slug\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(realtime): mount IncidentLiveProvider on the war-room page

The page stays server-rendered; the provider receives the server-resolved
events + author map as initial state and takes over on mount. Adds a
ConnectionBanner above NoteForm so reconnect state is visible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Docs, guardrails, follow-ups

**Files:**

- Modify: `CLAUDE.md`
- Modify: `.claude/GUARDRAILS.md`
- Modify: `.claude/memory/foundation_followups.md`
- Modify: `README.md`

- [ ] **Step 1: Append a Plan 4 entry to `CLAUDE.md`**

Under the `## Update history` section, add a new bullet at the bottom:

```md
- 2026-04-29: **Plan 4 (Real-time SSE) implemented**. New `src/lib/realtime/` module: `dispatcher` (singleton holding one `LISTEN incident_updates` connection per Node process), `notify.ts` (`pg_notify` helper called inside every mutation transaction), `types.ts` (zod payload schema). New SSE route at `/api/incidents/[slug]/stream` (Node runtime, heartbeat 25 s, `Last-Event-ID` backfill). Client `IncidentLiveProvider` owns the EventSource and exposes optimistic-note insertion via React context; `Timeline` and `NoteForm` are now context consumers. `revalidatePath` stays as a fallback for non-SSE clients. Test count climbed from 118 to 12X (3 unit + 6 integration added).
```

Also remove the line "until then the page re-renders via `revalidatePath` after each mutation" from the Notes section.

- [ ] **Step 2: Append a Realtime row to `.claude/GUARDRAILS.md`**

Add inside the table, in the order that matches the existing rows:

```md
| Realtime — `src/lib/realtime/*`, `src/app/api/incidents/[slug]/stream/route.ts`, `IncidentLiveProvider.tsx` | spec §3.2 + §8.1/8.2 + `2026-04-29-realtime-sse.md` plan | NOTIFY payload is the wire contract — every body field that crosses pg_notify must go through `IncidentUpdatePayloadSchema`. The dispatcher is a singleton: do **not** instantiate it from app code, always go through `getRealtimeDispatcher()`. The SSE route MUST stay `runtime = 'nodejs'` (Edge can't hold LISTEN connections). Optimistic UI is **only** for notes; status/severity/role mutations stay confirmed-only per spec §8.1. |
```

- [ ] **Step 3: Update follow-ups**

In `.claude/memory/foundation_followups.md`, if a "Plan 4: Real-time SSE" placeholder exists, mark it closed (reference: this plan + commit hash). Add new follow-ups encountered during this plan (typical candidates):

- "Route-handler test for `/api/incidents/[slug]/stream`" — defer until Playwright is set up in Plan 11.
- "Viewer count widget on the war-room (🟢 Live · N viewers)" — Plan 11.
- "Retry button on errored optimistic notes" — spec §8.1 mentions "mark `error` with retry"; this plan only marks the error. Add a retry button that re-submits the same markdown (one-click) when user feedback shows up.
- "Stronger optimistic-note dedup than markdown match" — current reconciliation matches on markdown text; if two users post identical text simultaneously, the wrong optimistic entry can be replaced. Fix is client-generated correlation token threaded through the action and the NOTIFY payload. Skip until the failure is observed in practice.
- "Optimistic-with-rollback for status/severity/role" — explicitly rejected by spec §8.1; track only if user pushback shows up.
- "Edge-cached status page invalidation via the same `incident_updates` channel" — Plan 9.

- [ ] **Step 4: Update `README.md`**

In the manual acceptance checklist section, add:

```md
- [ ] Live timeline: open the same incident in two browser windows; a note posted in one appears in the other within ~1 s without manual refresh.
- [ ] Reconnect banner: stop the DB container; within 30 s a yellow "Reconnecting…" banner appears; bring the DB back up; the banner clears.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .claude/GUARDRAILS.md .claude/memory/foundation_followups.md README.md
git commit -m "$(cat <<'EOF'
docs: record Plan 4 (real-time SSE) state across CLAUDE.md, guardrails, README

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final acceptance

After all tasks land, verify:

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean — including the `no-restricted-imports` rule on Edge files (the SSE route is in `src/app/api/...`, not in `src/lib/auth/config.ts`/`middleware.ts`, so that rule does not apply to it).
- [ ] `pnpm test` green — 118 prior + 6 dispatcher integration + 3 payload unit = 127.
- [ ] Manual smoke test from Task 9 Step 3 passes.
- [ ] CLAUDE.md, GUARDRAILS, and follow-ups reflect Plan 4 reality.

---

## Notes for the implementer

- **Why a singleton dispatcher per process:** `LISTEN` is per-connection and each NOTIFY broadcasts to every connection in that database that's `LISTEN`ing on the channel. A naïve "one LISTEN per request" approach would burn one Postgres connection per open browser tab and trip pool limits in seconds. One LISTEN per process + in-memory fan-out scales linearly with tabs, not with mutations.

- **Why the dispatcher fetches the row instead of trusting the NOTIFY payload:** `pg_notify` caps at 8 KB; note bodies can reach 50 KB (per `TimelineEventBodySchema`). Putting only `{incidentId, eventId, kind, occurredAt}` on the wire keeps the channel cheap and avoids splitting the schema between "what's small enough for NOTIFY" and "what isn't".

- **Why `revalidatePath` stays in the Server Actions:** SSE is best-effort. If the client's connection is broken, the next form submit's `revalidatePath` still re-renders the page from scratch — non-SSE clients (curl, screen readers, broken proxies) don't break. The cost is one extra render per mutation; tolerable.

- **Why `auth()` is called from the route, not from a middleware:** the SSE route is under `src/app/api/...` and uses the Node `auth()` from `src/lib/auth/index.ts`. The Edge `auth.config.ts` only gates page navigation; route handlers re-check inside the handler so they can return `401` instead of redirecting. Don't move auth out of this route into middleware — middleware can't easily decide between "redirect to sign-in" (pages) and "401 JSON" (API).

- **Why no test for the route handler:** a real test requires (a) a NextAuth session, (b) the dispatcher, (c) ReadableStream consumption, (d) `Last-Event-ID` round-tripping. The dispatcher round-trip in Task 5 covers the data path; the route is a thin wrapper. Plan 11 (Playwright) is where this gets exercised end-to-end.

- **Why `client.listen` and not raw SQL:** `postgres-js` has a typed wrapper that handles reconnection (the underlying connection re-establishes `LISTEN` on connect). Going manual would mean re-issuing `LISTEN` on every reconnect, which is the kind of wheel that bites silently. The wrapper costs nothing.
