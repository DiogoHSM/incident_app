# Plan 3 — Timeline events + status / severity / role mutations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/incidents/[slug]` a working war-room: render a timeline, post notes, change status/severity, and assign IC/Scribe/Comms — all server-rendered, no real-time yet (SSE arrives in Plan 4).

**Architecture:** A new `timeline_events` table plus four transactional mutation queries (`appendNote`, `changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole`). Every mutation that changes incident state writes a `TimelineEvent` row in the same DB transaction so the audit trail is atomic. A status state machine enforces legal transitions and the "must have an IC to leave triaging" rule. Authorization is at the data-access layer (`requireTeamMember` / admin-sees-all) — UI gating is courtesy. Server Actions wire the page form controls; `revalidatePath` triggers a fresh server render after each mutation.

**Tech Stack:** Next.js 16 App Router · TypeScript strict + `noUncheckedIndexedAccess` · Drizzle ORM 0.45 + Postgres 16 · NextAuth v5 · zod · Vitest 4 + testcontainers · `react-markdown` (new dep, for note rendering).

**Commit trailer (mandatory on every commit):**
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File map

**Created:**
- `src/lib/db/schema/timeline.ts` — `timelineEvents` table + `timelineEventKind` enum.
- `src/lib/timeline/body.ts` — zod schemas + TS discriminated union for `TimelineEventBody`.
- `src/lib/db/queries/timeline.ts` — `appendNote`, `listTimelineEventsForIncident`.
- `drizzle/0003_<auto-name>.sql` — generated migration for the new table.
- `src/app/(app)/incidents/[slug]/_components/Timeline.tsx` — server-rendered event list.
- `src/app/(app)/incidents/[slug]/_components/NoteForm.tsx` — note composer (client component, plain form).
- `src/app/(app)/incidents/[slug]/_components/StatusControl.tsx` — change-status dropdown.
- `src/app/(app)/incidents/[slug]/_components/SeverityControl.tsx` — change-severity dropdown.
- `src/app/(app)/incidents/[slug]/_components/RolePickers.tsx` — IC/Scribe/Comms assigners.
- `src/app/(app)/incidents/[slug]/actions.ts` — Server Actions.
- `tests/integration/timeline.test.ts` — tests for `appendNote` + `listTimelineEventsForIncident`.
- `tests/integration/incidents-mutations.test.ts` — state-machine + role + severity tests.
- `tests/unit/timeline-body.test.ts` — zod schema unit tests.

**Modified:**
- `src/lib/db/schema/index.ts` — export new schema module.
- `src/lib/db/queries/incidents.ts` — extend with `changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole`, `listTeamMembers`.
- `src/lib/db/queries/teams.ts` — add `listTeamMembersWithUsers`.
- `src/app/(app)/incidents/[slug]/page.tsx` — replace placeholder timeline section, mount the new components.
- `tests/setup/withTx.ts` — append `'timeline_events'` to the `TABLES` truncation list.
- `package.json` — add `react-markdown` and `remark-gfm`.
- `CLAUDE.md` — append Plan 3 entry to update history; promote `/incidents/[slug]` from "no real-time, no role mutations, no timeline events" to its real Plan-3 state.
- `.claude/GUARDRAILS.md` — add a row for the new timeline module.

---

## Task 1: Schema — `timeline_events` table

**Files:**
- Create: `src/lib/db/schema/timeline.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// src/lib/db/schema/timeline.ts
import { pgTable, pgEnum, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { incidents } from './incidents';
import { users } from './users';

export const TIMELINE_EVENT_KIND_VALUES = [
  'note',
  'status_change',
  'severity_change',
  'role_change',
] as const;
export type TimelineEventKind = (typeof TIMELINE_EVENT_KIND_VALUES)[number];

export const timelineEventKindEnum = pgEnum('timeline_event_kind', TIMELINE_EVENT_KIND_VALUES);

export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: timelineEventKindEnum('kind').notNull(),
    body: jsonb('body').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    incidentOccurredIdx: index('timeline_events_incident_occurred_idx').on(
      t.incidentId,
      t.occurredAt.desc(),
    ),
  }),
);

export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type NewTimelineEvent = typeof timelineEvents.$inferInsert;
```

- [ ] **Step 2: Register the module**

Edit `src/lib/db/schema/index.ts` to append the export at the bottom:

```ts
export * from './users';
export * from './teams';
export * from './team-memberships';
export * from './services';
export * from './runbooks';
export * from './incidents';
export * from './timeline';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS** — no errors. (No tests exercise this yet; the file just needs to compile.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/timeline.ts src/lib/db/schema/index.ts
git commit -m "$(cat <<'EOF'
feat(schema): add timeline_events table for incident audit log

Defines the four kinds shipped in Plan 3 (note, status_change,
severity_change, role_change). webhook / postmortem_link / attachment /
status_update_published are intentionally out of the enum until their
owning plans need them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Body schemas — zod discriminated union

**Files:**
- Create: `src/lib/timeline/body.ts`
- Test: `tests/unit/timeline-body.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/timeline-body.test.ts
import { describe, expect, test } from 'vitest';
import { TimelineEventBodySchema, parseTimelineEventBody } from '@/lib/timeline/body';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';

describe('TimelineEventBodySchema', () => {
  test('accepts a valid note body', () => {
    expect(
      TimelineEventBodySchema.parse({ kind: 'note', markdown: 'Saw 500s on /v1/login' }),
    ).toEqual({ kind: 'note', markdown: 'Saw 500s on /v1/login' });
  });

  test('rejects an empty note', () => {
    expect(() => TimelineEventBodySchema.parse({ kind: 'note', markdown: '' })).toThrow();
  });

  test('rejects an oversized note', () => {
    expect(() =>
      TimelineEventBodySchema.parse({ kind: 'note', markdown: 'x'.repeat(50_001) }),
    ).toThrow();
  });

  test('accepts each valid status_change transition shape', () => {
    for (const from of INCIDENT_STATUS_VALUES) {
      for (const to of INCIDENT_STATUS_VALUES) {
        if (from === to) continue;
        expect(
          TimelineEventBodySchema.parse({ kind: 'status_change', from, to }),
        ).toMatchObject({ kind: 'status_change', from, to });
      }
    }
  });

  test('status_change reason is optional and trimmed', () => {
    const parsed = TimelineEventBodySchema.parse({
      kind: 'status_change',
      from: 'investigating',
      to: 'identified',
      reason: '  rolled back deploy  ',
    });
    expect(parsed).toMatchObject({ reason: 'rolled back deploy' });
  });

  test('severity_change shape', () => {
    expect(
      TimelineEventBodySchema.parse({ kind: 'severity_change', from: 'SEV3', to: 'SEV1' }),
    ).toMatchObject({ kind: 'severity_change', from: 'SEV3', to: 'SEV1' });
  });

  test('role_change shape, allows null on either side', () => {
    expect(
      TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'ic',
        fromUserId: null,
        toUserId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toMatchObject({ kind: 'role_change', role: 'ic' });
  });

  test('role_change rejects unknown role', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'bogus',
        fromUserId: null,
        toUserId: null,
      }),
    ).toThrow();
  });

  test('parseTimelineEventBody narrows by kind', () => {
    const body = parseTimelineEventBody({ kind: 'note', markdown: 'hi' });
    if (body.kind === 'note') {
      // type-narrowed; this expression compiles only if narrowing works
      expect(body.markdown).toBe('hi');
    } else {
      throw new Error('expected note kind');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/timeline-body.test.ts`
Expected: **FAIL** — `Cannot find module '@/lib/timeline/body'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/body.ts
import { z } from 'zod';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';

export const ROLE_VALUES = ['ic', 'scribe', 'comms'] as const;
export type IncidentRole = (typeof ROLE_VALUES)[number];

const NoteBody = z.object({
  kind: z.literal('note'),
  markdown: z.string().min(1).max(50_000),
});

const StatusChangeBody = z.object({
  kind: z.literal('status_change'),
  from: z.enum(INCIDENT_STATUS_VALUES),
  to: z.enum(INCIDENT_STATUS_VALUES),
  reason: z
    .string()
    .max(500)
    .transform((s) => s.trim())
    .optional(),
});

const SeverityChangeBody = z.object({
  kind: z.literal('severity_change'),
  from: z.enum(SEVERITY_VALUES),
  to: z.enum(SEVERITY_VALUES),
});

const RoleChangeBody = z.object({
  kind: z.literal('role_change'),
  role: z.enum(ROLE_VALUES),
  fromUserId: z.string().uuid().nullable(),
  toUserId: z.string().uuid().nullable(),
});

export const TimelineEventBodySchema = z.discriminatedUnion('kind', [
  NoteBody,
  StatusChangeBody,
  SeverityChangeBody,
  RoleChangeBody,
]);

export type TimelineEventBody = z.infer<typeof TimelineEventBodySchema>;

export function parseTimelineEventBody(input: unknown): TimelineEventBody {
  return TimelineEventBodySchema.parse(input);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/timeline-body.test.ts`
Expected: **PASS** — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/body.ts tests/unit/timeline-body.test.ts
git commit -m "$(cat <<'EOF'
feat(timeline): zod-validated body schemas for timeline events

Discriminated union over kind: note | status_change | severity_change |
role_change. Validated at every write boundary so jsonb shape can never
drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migration + test infra wiring

**Files:**
- Create (auto-generated): `drizzle/0003_<auto-name>.sql` and corresponding `drizzle/meta/0003_snapshot.json`, updated `drizzle/meta/_journal.json`.
- Modify: `tests/setup/withTx.ts`

- [ ] **Step 1: Generate the migration**

Run: `pnpm db:generate`
Expected: prints something like `0003_<adjective>_<noun>.sql created` and updates `drizzle/meta/`.

- [ ] **Step 2: Inspect the generated SQL**

Run: `cat drizzle/0003_*.sql`
Expected output should include:
```sql
CREATE TYPE "public"."timeline_event_kind" AS ENUM('note', 'status_change', 'severity_change', 'role_change');
CREATE TABLE "timeline_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL,
  "author_user_id" uuid,
  "kind" "timeline_event_kind" NOT NULL,
  "body" jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_incident_id_incidents_id_fk" ... ON DELETE cascade ...
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_author_user_id_users_id_fk" ... ON DELETE set null ...
CREATE INDEX "timeline_events_incident_occurred_idx" ON "timeline_events" USING btree ("incident_id","occurred_at" DESC NULLS LAST);
```

If the generated file looks wrong (missing FK, wrong enum values, missing index), do NOT edit by hand — fix the schema file in Task 1 and re-run `pnpm db:generate`.

- [ ] **Step 3: Apply the migration locally**

Run: `pnpm db:migrate`
Expected: prints `Migrations applied!` (or equivalent).

- [ ] **Step 4: Add the new table to the test truncation list**

Edit `tests/setup/withTx.ts`. Replace the `TABLES` constant block with:

```ts
const TABLES = [
  'timeline_events',
  'incident_services',
  'incidents',
  'runbooks',
  'services',
  'team_memberships',
  'teams',
  'users',
] as const;
```

(Order matters: `timeline_events` references `incidents` and `users`, but TRUNCATE ... CASCADE handles dependencies regardless. Listing it first is just convention — children before parents.)

- [ ] **Step 5: Run the existing test suite to confirm no regressions**

Run: `pnpm test`
Expected: **PASS** — 55 tests still green (the 8 new unit tests from Task 2 bring total to 63).

- [ ] **Step 6: Commit**

```bash
git add drizzle/ tests/setup/withTx.ts
git commit -m "$(cat <<'EOF'
chore(db): migration 0003 — timeline_events table

Generated by drizzle-kit. Adds timeline_events with FK cascade from
incidents (audit trail dies with the incident) and SET NULL on
author_user_id (preserves history when a user is deleted). Truncation
list updated for tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `appendNote` query + tests

**Files:**
- Create: `src/lib/db/queries/timeline.ts`
- Create: `tests/integration/timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/timeline.test.ts
import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { ForbiddenError } from '@/lib/authz';
import { declareIncident } from '@/lib/db/queries/incidents';
import {
  appendNote,
  listTimelineEventsForIncident,
} from '@/lib/db/queries/timeline';

interface World {
  adminId: string;
  memberAId: string;
  memberBId: string;
  outsiderId: string;
  teamAId: string;
  teamBId: string;
  incidentAId: string;
}

async function seed(): Promise<World> {
  const db = getTestDb();
  const [admin] = await db
    .insert(users)
    .values({ email: 'admin@x.co', name: 'Admin', ssoSubject: 's|admin', role: 'admin' })
    .returning();
  const [memberA] = await db
    .insert(users)
    .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a' })
    .returning();
  const [memberB] = await db
    .insert(users)
    .values({ email: 'b@x.co', name: 'B', ssoSubject: 's|b' })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
    .returning();
  const [teamA] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  const [teamB] = await db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
  await db.insert(teamMemberships).values([
    { userId: memberA!.id, teamId: teamA!.id, role: 'member' },
    { userId: memberB!.id, teamId: teamB!.id, role: 'member' },
  ]);
  const inc = await declareIncident(db, memberA!.id, {
    teamId: teamA!.id,
    title: 'incident A',
    summary: '',
    severity: 'SEV2',
    affectedServiceIds: [],
  });
  return {
    adminId: admin!.id,
    memberAId: memberA!.id,
    memberBId: memberB!.id,
    outsiderId: outsider!.id,
    teamAId: teamA!.id,
    teamBId: teamB!.id,
    incidentAId: inc.id,
  };
}

describe('appendNote', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('team member can append a note', async () => {
    const db = getTestDb();
    const ev = await appendNote(db, world.memberAId, world.incidentAId, 'rolling back deploy');
    expect(ev.kind).toBe('note');
    expect(ev.authorUserId).toBe(world.memberAId);
    expect(ev.incidentId).toBe(world.incidentAId);
    expect(ev.body).toEqual({ kind: 'note', markdown: 'rolling back deploy' });

    const rows = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.incidentAId));
    expect(rows).toHaveLength(1);
  });

  test('admin can append even without team membership', async () => {
    const db = getTestDb();
    const ev = await appendNote(db, world.adminId, world.incidentAId, 'admin checking in');
    expect(ev.authorUserId).toBe(world.adminId);
  });

  test('outsider cannot append', async () => {
    const db = getTestDb();
    await expect(
      appendNote(db, world.outsiderId, world.incidentAId, 'sneaky'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('member of another team cannot append', async () => {
    const db = getTestDb();
    await expect(
      appendNote(db, world.memberBId, world.incidentAId, 'wrong team'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('empty note rejected before authz', async () => {
    const db = getTestDb();
    await expect(appendNote(db, world.memberAId, world.incidentAId, '')).rejects.toThrow();
  });

  test('unknown incident throws', async () => {
    const db = getTestDb();
    await expect(
      appendNote(db, world.memberAId, '00000000-0000-0000-0000-000000000000', 'x'),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/integration/timeline.test.ts`
Expected: **FAIL** — `Cannot find module '@/lib/db/queries/timeline'`.

- [ ] **Step 3: Write the query module**

```ts
// src/lib/db/queries/timeline.ts
import { and, desc, eq, lt } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import {
  timelineEvents,
  type TimelineEvent,
} from '@/lib/db/schema/timeline';
import { incidents } from '@/lib/db/schema/incidents';
import { ForbiddenError, requireTeamMember } from '@/lib/authz';
import { TimelineEventBodySchema } from '@/lib/timeline/body';

async function loadIncidentForActor(
  db: DB,
  actorUserId: string,
  incidentId: string,
): Promise<{ id: string; teamId: string }> {
  const [row] = await db
    .select({ id: incidents.id, teamId: incidents.teamId })
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  if (!row) throw new Error('Incident not found');
  await requireTeamMember(db, actorUserId, row.teamId);
  return row;
}

export async function appendNote(
  db: DB,
  actorUserId: string,
  incidentId: string,
  markdown: string,
): Promise<TimelineEvent> {
  const body = TimelineEventBodySchema.parse({ kind: 'note', markdown });
  const inc = await loadIncidentForActor(db, actorUserId, incidentId);

  const [row] = await db
    .insert(timelineEvents)
    .values({
      incidentId: inc.id,
      authorUserId: actorUserId,
      kind: 'note',
      body,
    })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export interface ListTimelineOptions {
  limit?: number;
  before?: Date;
}

export async function listTimelineEventsForIncident(
  db: DB,
  actorUserId: string,
  incidentId: string,
  opts: ListTimelineOptions = {},
): Promise<TimelineEvent[]> {
  await loadIncidentForActor(db, actorUserId, incidentId);

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conditions = [eq(timelineEvents.incidentId, incidentId)];
  if (opts.before) conditions.push(lt(timelineEvents.occurredAt, opts.before));

  return db
    .select()
    .from(timelineEvents)
    .where(and(...conditions))
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(limit);
}

export { ForbiddenError };
```

- [ ] **Step 4: Run the tests to verify `appendNote` passes**

Run: `pnpm test tests/integration/timeline.test.ts -t appendNote`
Expected: **PASS** — 6 tests under `appendNote`.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries/timeline.ts tests/integration/timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(timeline): appendNote query with authz at the data layer

Validates body via zod, then verifies the actor is a team member of
the incident's owning team (or admin). Outsiders rejected before any
write. 6 integration tests cover member/admin/outsider/empty/unknown
incident.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `listTimelineEventsForIncident` query + tests

**Files:**
- Modify: `tests/integration/timeline.test.ts` (already imports the function from Task 4; the implementation is already in place — this task is the test coverage).

- [ ] **Step 1: Append the test block**

Append to `tests/integration/timeline.test.ts` after the `appendNote` describe:

```ts
describe('listTimelineEventsForIncident', () => {
  useTestDb();
  let world: World;
  let firstAt: Date;
  let secondAt: Date;
  let thirdAt: Date;

  beforeEach(async () => {
    world = await seed();
    const db = getTestDb();
    firstAt = new Date(Date.now() - 1000 * 60 * 30);
    secondAt = new Date(Date.now() - 1000 * 60 * 15);
    thirdAt = new Date();
    await db.insert(timelineEvents).values([
      {
        incidentId: world.incidentAId,
        authorUserId: world.memberAId,
        kind: 'note',
        body: { kind: 'note', markdown: 'first' },
        occurredAt: firstAt,
      },
      {
        incidentId: world.incidentAId,
        authorUserId: world.memberAId,
        kind: 'note',
        body: { kind: 'note', markdown: 'second' },
        occurredAt: secondAt,
      },
      {
        incidentId: world.incidentAId,
        authorUserId: world.memberAId,
        kind: 'note',
        body: { kind: 'note', markdown: 'third' },
        occurredAt: thirdAt,
      },
    ]);
  });

  test('returns events newest-first', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.memberAId,
      world.incidentAId,
    );
    expect(events.map((e) => (e.body as { markdown: string }).markdown)).toEqual([
      'third',
      'second',
      'first',
    ]);
  });

  test('admin sees all without team membership', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.adminId,
      world.incidentAId,
    );
    expect(events).toHaveLength(3);
  });

  test('outsider denied', async () => {
    await expect(
      listTimelineEventsForIncident(getTestDb(), world.outsiderId, world.incidentAId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('member of another team denied', async () => {
    await expect(
      listTimelineEventsForIncident(getTestDb(), world.memberBId, world.incidentAId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('limit caps the result count', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.memberAId,
      world.incidentAId,
      { limit: 2 },
    );
    expect(events).toHaveLength(2);
    expect((events[0]!.body as { markdown: string }).markdown).toBe('third');
    expect((events[1]!.body as { markdown: string }).markdown).toBe('second');
  });

  test('before cursor returns older events only', async () => {
    const events = await listTimelineEventsForIncident(
      getTestDb(),
      world.memberAId,
      world.incidentAId,
      { before: secondAt },
    );
    expect(events.map((e) => (e.body as { markdown: string }).markdown)).toEqual(['first']);
  });
});
```

- [ ] **Step 2: Run the new block**

Run: `pnpm test tests/integration/timeline.test.ts -t listTimelineEventsForIncident`
Expected: **PASS** — 6 tests.

- [ ] **Step 3: Run the full file to confirm no regression**

Run: `pnpm test tests/integration/timeline.test.ts`
Expected: **PASS** — 12 tests total.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/timeline.test.ts
git commit -m "$(cat <<'EOF'
test(timeline): cover listTimelineEventsForIncident

newest-first order, admin-sees-all parity, outsider denial, limit
clamp, before-cursor pagination. 12 timeline tests total.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `changeIncidentStatus` — state machine + IC enforcement

**Files:**
- Modify: `src/lib/db/queries/incidents.ts`
- Create: `tests/integration/incidents-mutations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/incidents-mutations.test.ts
import { beforeEach, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import {
  incidents,
  INCIDENT_STATUS_VALUES,
  type IncidentStatus,
} from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { ForbiddenError } from '@/lib/authz';
import {
  declareIncident,
  changeIncidentStatus,
  IncidentStateMachineError,
} from '@/lib/db/queries/incidents';

interface World {
  adminId: string;
  memberAId: string;
  memberA2Id: string;
  outsiderId: string;
  teamAId: string;
  triagingId: string;
  investigatingId: string;
}

async function seed(): Promise<World> {
  const db = getTestDb();
  const [admin] = await db
    .insert(users)
    .values({ email: 'admin@x.co', name: 'Admin', ssoSubject: 's|admin', role: 'admin' })
    .returning();
  const [memberA] = await db
    .insert(users)
    .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a' })
    .returning();
  const [memberA2] = await db
    .insert(users)
    .values({ email: 'a2@x.co', name: 'A2', ssoSubject: 's|a2' })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
    .returning();
  const [teamA] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  await db.insert(teamMemberships).values([
    { userId: memberA!.id, teamId: teamA!.id, role: 'member' },
    { userId: memberA2!.id, teamId: teamA!.id, role: 'member' },
  ]);

  const investigating = await declareIncident(db, memberA!.id, {
    teamId: teamA!.id,
    title: 'live one',
    summary: '',
    severity: 'SEV2',
    affectedServiceIds: [],
  });

  // Insert a triaging-state incident directly (bypassing declareIncident which defaults to investigating).
  const [triaging] = await db
    .insert(incidents)
    .values({
      publicSlug: 'inc-triag001',
      teamId: teamA!.id,
      declaredBy: memberA!.id,
      severity: 'SEV3',
      status: 'triaging',
      title: 'unconfirmed alert',
      summary: '',
    })
    .returning();

  return {
    adminId: admin!.id,
    memberAId: memberA!.id,
    memberA2Id: memberA2!.id,
    outsiderId: outsider!.id,
    teamAId: teamA!.id,
    triagingId: triaging!.id,
    investigatingId: investigating.id,
  };
}

describe('changeIncidentStatus — allowed transitions', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  const allowed: Array<[IncidentStatus, IncidentStatus]> = [
    ['investigating', 'identified'],
    ['investigating', 'monitoring'],
    ['investigating', 'resolved'],
    ['identified', 'monitoring'],
    ['identified', 'investigating'],
    ['identified', 'resolved'],
    ['monitoring', 'resolved'],
    ['monitoring', 'investigating'],
    ['resolved', 'investigating'],
  ];

  test.each(allowed)('%s → %s succeeds and writes status_change event', async (from, to) => {
    const db = getTestDb();
    await db
      .update(incidents)
      .set({ status: from, resolvedAt: from === 'resolved' ? new Date() : null })
      .where(eq(incidents.id, world.investigatingId));

    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      to,
      {},
    );
    expect(result).not.toBeNull();
    expect(result!.incident.status).toBe(to);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.investigatingId));
    expect(events.some((e) => e.kind === 'status_change')).toBe(true);
  });

  test('same-status call is a no-op (returns null, writes no event)', async () => {
    const db = getTestDb();
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      'investigating',
      {},
    );
    expect(result).toBeNull();
    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.investigatingId));
    expect(events).toHaveLength(0);
  });

  test('→ resolved sets resolvedAt; resolved → investigating clears it', async () => {
    const db = getTestDb();
    const r1 = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      'resolved',
      {},
    );
    expect(r1!.incident.resolvedAt).toBeInstanceOf(Date);

    const r2 = await changeIncidentStatus(
      db,
      world.memberAId,
      world.investigatingId,
      'investigating',
      {},
    );
    expect(r2!.incident.resolvedAt).toBeNull();
  });
});

describe('changeIncidentStatus — forbidden transitions', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  const forbidden: Array<[IncidentStatus, IncidentStatus]> = [
    ['triaging', 'identified'],
    ['triaging', 'monitoring'],
    ['investigating', 'triaging'],
    ['identified', 'triaging'],
    ['monitoring', 'triaging'],
    ['monitoring', 'identified'],
    ['resolved', 'triaging'],
    ['resolved', 'identified'],
    ['resolved', 'monitoring'],
    ['resolved', 'resolved'],
  ].filter(([f, t]) => f !== t) as Array<[IncidentStatus, IncidentStatus]>;

  test.each(forbidden)('%s → %s rejected with IncidentStateMachineError', async (from, to) => {
    const db = getTestDb();
    await db.update(incidents).set({ status: from }).where(eq(incidents.id, world.triagingId));
    await expect(
      changeIncidentStatus(db, world.memberAId, world.triagingId, to, {}),
    ).rejects.toBeInstanceOf(IncidentStateMachineError);
  });
});

describe('changeIncidentStatus — triaging requires IC', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('leaving triaging without IC throws', async () => {
    const db = getTestDb();
    await expect(
      changeIncidentStatus(db, world.memberAId, world.triagingId, 'investigating', {}),
    ).rejects.toBeInstanceOf(IncidentStateMachineError);
  });

  test('leaving triaging with assignIcUserId works and writes role_change + status_change', async () => {
    const db = getTestDb();
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.triagingId,
      'investigating',
      { assignIcUserId: world.memberA2Id },
    );
    expect(result).not.toBeNull();
    expect(result!.incident.status).toBe('investigating');
    expect(result!.incident.icUserId).toBe(world.memberA2Id);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.triagingId));
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(['role_change', 'status_change']);
  });

  test('leaving triaging when IC already set works without assignIcUserId', async () => {
    const db = getTestDb();
    await db
      .update(incidents)
      .set({ icUserId: world.memberAId })
      .where(eq(incidents.id, world.triagingId));
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.triagingId,
      'investigating',
      {},
    );
    expect(result!.incident.status).toBe('investigating');
  });

  test('triaging → resolved (false-positive close) does NOT require IC', async () => {
    const db = getTestDb();
    const result = await changeIncidentStatus(
      db,
      world.memberAId,
      world.triagingId,
      'resolved',
      {},
    );
    expect(result!.incident.status).toBe('resolved');
    expect(result!.incident.resolvedAt).toBeInstanceOf(Date);
  });

  test('assignIcUserId for a non-team-member is rejected', async () => {
    const db = getTestDb();
    await expect(
      changeIncidentStatus(db, world.memberAId, world.triagingId, 'investigating', {
        assignIcUserId: world.outsiderId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('changeIncidentStatus — authz', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('outsider cannot change status', async () => {
    await expect(
      changeIncidentStatus(getTestDb(), world.outsiderId, world.investigatingId, 'identified', {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('admin can change status without team membership', async () => {
    const result = await changeIncidentStatus(
      getTestDb(),
      world.adminId,
      world.investigatingId,
      'identified',
      {},
    );
    expect(result!.incident.status).toBe('identified');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/integration/incidents-mutations.test.ts -t 'changeIncidentStatus'`
Expected: **FAIL** — `changeIncidentStatus` and `IncidentStateMachineError` not exported.

- [ ] **Step 3: Extend the incidents query module**

Append to `src/lib/db/queries/incidents.ts` (keep all existing exports). Add these imports at the top alongside the existing ones:

```ts
import { timelineEvents } from '@/lib/db/schema/timeline';
import { TimelineEventBodySchema, type IncidentRole } from '@/lib/timeline/body';
```

Then append:

```ts
export class IncidentStateMachineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentStateMachineError';
  }
}

const ALLOWED_TRANSITIONS: Record<IncidentStatus, ReadonlySet<IncidentStatus>> = {
  triaging: new Set<IncidentStatus>(['investigating', 'resolved']),
  investigating: new Set<IncidentStatus>(['identified', 'monitoring', 'resolved']),
  identified: new Set<IncidentStatus>(['monitoring', 'investigating', 'resolved']),
  monitoring: new Set<IncidentStatus>(['investigating', 'resolved']),
  resolved: new Set<IncidentStatus>(['investigating']),
};

export interface ChangeIncidentStatusOptions {
  reason?: string;
  assignIcUserId?: string;
}

export async function changeIncidentStatus(
  db: DB,
  actorUserId: string,
  incidentId: string,
  toStatus: IncidentStatus,
  options: ChangeIncidentStatusOptions = {},
): Promise<{ incident: Incident; statusEvent: typeof timelineEvents.$inferSelect } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as DB, actorUserId, current.teamId);

    if (current.status === toStatus) return null;

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.has(toStatus)) {
      throw new IncidentStateMachineError(
        `Cannot transition incident from ${current.status} to ${toStatus}`,
      );
    }

    let assigningIcId: string | null = null;
    if (current.status === 'triaging' && toStatus !== 'resolved') {
      if (!current.icUserId && !options.assignIcUserId) {
        throw new IncidentStateMachineError(
          'An Incident Commander must be assigned when leaving triaging',
        );
      }
      if (options.assignIcUserId && options.assignIcUserId !== current.icUserId) {
        await requireTeamMember(tx as DB, options.assignIcUserId, current.teamId);
        assigningIcId = options.assignIcUserId;
      }
    }

    const nextResolvedAt =
      toStatus === 'resolved' ? new Date() : current.status === 'resolved' ? null : current.resolvedAt;

    const updateValues: Partial<typeof incidents.$inferInsert> = {
      status: toStatus,
      resolvedAt: nextResolvedAt,
      updatedAt: new Date(),
    };
    if (assigningIcId) updateValues.icUserId = assigningIcId;

    const [updated] = await tx
      .update(incidents)
      .set(updateValues)
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    if (assigningIcId) {
      const roleBody = TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'ic' satisfies IncidentRole,
        fromUserId: current.icUserId,
        toUserId: assigningIcId,
      });
      await tx.insert(timelineEvents).values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'role_change',
        body: roleBody,
      });
    }

    const statusBody = TimelineEventBodySchema.parse({
      kind: 'status_change',
      from: current.status,
      to: toStatus,
      reason: options.reason,
    });
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

    return { incident: updated, statusEvent };
  });
}
```

- [ ] **Step 4: Run the new tests**

Run: `pnpm test tests/integration/incidents-mutations.test.ts -t changeIncidentStatus`
Expected: **PASS** — all `changeIncidentStatus` describe blocks green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `pnpm test`
Expected: **PASS** — all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries/incidents.ts tests/integration/incidents-mutations.test.ts
git commit -m "$(cat <<'EOF'
feat(incidents): changeIncidentStatus with state machine + IC rule

Five-state lifecycle (triaging → investigating → identified ↔ monitoring
→ resolved, plus regression and re-open paths). Leaving triaging requires
an IC; if none is set, callers must pass assignIcUserId, which writes
both role_change and status_change events in the same transaction.
resolvedAt managed automatically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `changeIncidentSeverity` query + tests

**Files:**
- Modify: `src/lib/db/queries/incidents.ts`
- Modify: `tests/integration/incidents-mutations.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/integration/incidents-mutations.test.ts`:

```ts
import { changeIncidentSeverity } from '@/lib/db/queries/incidents';

describe('changeIncidentSeverity', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  test('member can change SEV2 → SEV1 and writes severity_change event', async () => {
    const db = getTestDb();
    const result = await changeIncidentSeverity(
      db,
      world.memberAId,
      world.investigatingId,
      'SEV1',
    );
    expect(result!.incident.severity).toBe('SEV1');
    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, world.investigatingId));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('severity_change');
    expect(events[0]!.body).toMatchObject({ from: 'SEV2', to: 'SEV1' });
  });

  test('same-tier call is a no-op', async () => {
    const result = await changeIncidentSeverity(
      getTestDb(),
      world.memberAId,
      world.investigatingId,
      'SEV2',
    );
    expect(result).toBeNull();
  });

  test('outsider rejected', async () => {
    await expect(
      changeIncidentSeverity(getTestDb(), world.outsiderId, world.investigatingId, 'SEV1'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('admin can change without membership', async () => {
    const result = await changeIncidentSeverity(
      getTestDb(),
      world.adminId,
      world.investigatingId,
      'SEV4',
    );
    expect(result!.incident.severity).toBe('SEV4');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/integration/incidents-mutations.test.ts -t changeIncidentSeverity`
Expected: **FAIL** — `changeIncidentSeverity` not exported.

- [ ] **Step 3: Append the implementation**

Append to `src/lib/db/queries/incidents.ts`:

```ts
export async function changeIncidentSeverity(
  db: DB,
  actorUserId: string,
  incidentId: string,
  toSeverity: Severity,
): Promise<{ incident: Incident; event: typeof timelineEvents.$inferSelect } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as DB, actorUserId, current.teamId);

    if (current.severity === toSeverity) return null;

    const [updated] = await tx
      .update(incidents)
      .set({ severity: toSeverity, updatedAt: new Date() })
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'severity_change',
      from: current.severity,
      to: toSeverity,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'severity_change',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    return { incident: updated, event };
  });
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test tests/integration/incidents-mutations.test.ts -t changeIncidentSeverity`
Expected: **PASS** — 4 severity tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries/incidents.ts tests/integration/incidents-mutations.test.ts
git commit -m "$(cat <<'EOF'
feat(incidents): changeIncidentSeverity with audit-trail event

Any tier → any tier transition (auto-promote-from-webhook bumps land in
Plan 8 with the webhook subsystem). Same-tier is a no-op. Writes a
severity_change event in the same transaction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `assignIncidentRole` query + tests

**Files:**
- Modify: `src/lib/db/queries/incidents.ts`
- Modify: `tests/integration/incidents-mutations.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/integration/incidents-mutations.test.ts`:

```ts
import { assignIncidentRole } from '@/lib/db/queries/incidents';

describe('assignIncidentRole', () => {
  useTestDb();
  let world: World;
  beforeEach(async () => {
    world = await seed();
  });

  for (const role of ['ic', 'scribe', 'comms'] as const) {
    test(`assigning ${role} writes role_change event and updates the column`, async () => {
      const db = getTestDb();
      const result = await assignIncidentRole(
        db,
        world.memberAId,
        world.investigatingId,
        role,
        world.memberA2Id,
      );
      expect(result).not.toBeNull();
      const column = ({ ic: 'icUserId', scribe: 'scribeUserId', comms: 'commsUserId' } as const)[
        role
      ];
      expect(result!.incident[column]).toBe(world.memberA2Id);

      const events = await db
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.incidentId, world.investigatingId),
            eq(timelineEvents.kind, 'role_change'),
          ),
        );
      expect(events).toHaveLength(1);
      expect(events[0]!.body).toMatchObject({
        kind: 'role_change',
        role,
        toUserId: world.memberA2Id,
      });
    });
  }

  test('unassigning (toUserId = null) is allowed and writes an event', async () => {
    const db = getTestDb();
    await assignIncidentRole(db, world.memberAId, world.investigatingId, 'ic', world.memberA2Id);
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'ic',
      null,
    );
    expect(result!.incident.icUserId).toBeNull();
    const events = await db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.incidentId, world.investigatingId),
          eq(timelineEvents.kind, 'role_change'),
        ),
      );
    expect(events).toHaveLength(2);
  });

  test('assigning the same user is a no-op', async () => {
    const db = getTestDb();
    await assignIncidentRole(db, world.memberAId, world.investigatingId, 'ic', world.memberA2Id);
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'ic',
      world.memberA2Id,
    );
    expect(result).toBeNull();
  });

  test('assigning a non-team-member is rejected', async () => {
    await expect(
      assignIncidentRole(
        getTestDb(),
        world.memberAId,
        world.investigatingId,
        'scribe',
        world.outsiderId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('assigning an admin (who is not on the team) is allowed because admins pass requireTeamMember', async () => {
    const db = getTestDb();
    const result = await assignIncidentRole(
      db,
      world.memberAId,
      world.investigatingId,
      'comms',
      world.adminId,
    );
    expect(result!.incident.commsUserId).toBe(world.adminId);
  });

  test('outsider actor rejected', async () => {
    await expect(
      assignIncidentRole(
        getTestDb(),
        world.outsiderId,
        world.investigatingId,
        'ic',
        world.memberAId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/integration/incidents-mutations.test.ts -t assignIncidentRole`
Expected: **FAIL** — `assignIncidentRole` not exported.

- [ ] **Step 3: Append the implementation**

Append to `src/lib/db/queries/incidents.ts`:

```ts
const ROLE_COLUMN: Record<IncidentRole, 'icUserId' | 'scribeUserId' | 'commsUserId'> = {
  ic: 'icUserId',
  scribe: 'scribeUserId',
  comms: 'commsUserId',
};

export async function assignIncidentRole(
  db: DB,
  actorUserId: string,
  incidentId: string,
  role: IncidentRole,
  toUserId: string | null,
): Promise<{ incident: Incident; event: typeof timelineEvents.$inferSelect } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    await requireTeamMember(tx as DB, actorUserId, current.teamId);

    const column = ROLE_COLUMN[role];
    const fromUserId = current[column];

    if (fromUserId === toUserId) return null;

    if (toUserId !== null) {
      await requireTeamMember(tx as DB, toUserId, current.teamId);
    }

    const [updated] = await tx
      .update(incidents)
      .set({ [column]: toUserId, updatedAt: new Date() })
      .where(eq(incidents.id, incidentId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'role_change',
      role,
      fromUserId,
      toUserId,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'role_change',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    return { incident: updated, event };
  });
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test tests/integration/incidents-mutations.test.ts`
Expected: **PASS** — all mutations tests green.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: **PASS** — all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries/incidents.ts tests/integration/incidents-mutations.test.ts
git commit -m "$(cat <<'EOF'
feat(incidents): assignIncidentRole for IC / Scribe / Comms

Same-target assignment is a no-op. Non-team-member targets rejected
(admins pass because they pass requireTeamMember). Unassign (toUserId =
null) always allowed. Each call writes a role_change event in the same
transaction as the column update.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Team-members helper for the role pickers

**Files:**
- Modify: `src/lib/db/queries/teams.ts`

- [ ] **Step 1: Inspect the current file**

Run: `cat src/lib/db/queries/teams.ts`
Expected: file exists with `isTeamMember` and possibly other helpers. Note the export shape.

- [ ] **Step 2: Append `listTeamMembersWithUsers`**

Add to `src/lib/db/queries/teams.ts`:

```ts
import { eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users, type User } from '@/lib/db/schema/users';

export async function listTeamMembersWithUsers(
  db: DB,
  teamId: string,
): Promise<Array<Pick<User, 'id' | 'name' | 'email'>>> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(teamMemberships)
    .innerJoin(users, eq(teamMemberships.userId, users.id))
    .where(eq(teamMemberships.teamId, teamId))
    .orderBy(users.name);
  return rows;
}
```

(If `eq`, `teamMemberships`, `users`, or `User` are already imported in the file, do not double-import — reuse the existing imports.)

- [ ] **Step 3: Quick smoke test**

Append to `tests/integration/teams.test.ts` (whichever describe block makes sense, or a new `describe('listTeamMembersWithUsers')`):

```ts
import { listTeamMembersWithUsers } from '@/lib/db/queries/teams';

describe('listTeamMembersWithUsers', () => {
  useTestDb();

  test('returns alphabetized members of the given team only', async () => {
    const db = getTestDb();
    const [t1] = await db.insert(teams).values({ name: 'T1', slug: 't1' }).returning();
    const [t2] = await db.insert(teams).values({ name: 'T2', slug: 't2' }).returning();
    const [u1] = await db
      .insert(users)
      .values({ email: 'b@x.co', name: 'Bob', ssoSubject: 's|b' })
      .returning();
    const [u2] = await db
      .insert(users)
      .values({ email: 'a@x.co', name: 'Alice', ssoSubject: 's|a' })
      .returning();
    const [u3] = await db
      .insert(users)
      .values({ email: 'c@x.co', name: 'Carla', ssoSubject: 's|c' })
      .returning();
    await db.insert(teamMemberships).values([
      { userId: u1!.id, teamId: t1!.id, role: 'member' },
      { userId: u2!.id, teamId: t1!.id, role: 'member' },
      { userId: u3!.id, teamId: t2!.id, role: 'member' },
    ]);

    const list = await listTeamMembersWithUsers(db, t1!.id);
    expect(list.map((m) => m.name)).toEqual(['Alice', 'Bob']);
  });
});
```

(Re-use existing imports at the top of `tests/integration/teams.test.ts`. If `users`, `teams`, `teamMemberships` are not yet imported there, add them.)

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/integration/teams.test.ts -t listTeamMembersWithUsers`
Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries/teams.ts tests/integration/teams.test.ts
git commit -m "$(cat <<'EOF'
feat(teams): listTeamMembersWithUsers for role-picker UI

Returns id/name/email of each team member, alphabetized — the role
pickers on the incident page need a small list, no joins beyond
membership × users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Server Actions

**Files:**
- Create: `src/app/(app)/incidents/[slug]/actions.ts`

- [ ] **Step 1: Write the actions file**

```ts
// src/app/(app)/incidents/[slug]/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import {
  changeIncidentSeverity,
  changeIncidentStatus,
  assignIncidentRole,
} from '@/lib/db/queries/incidents';
import { appendNote } from '@/lib/db/queries/timeline';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';
import { ROLE_VALUES } from '@/lib/timeline/body';

async function resolveIncidentIdOrThrow(slug: string, userId: string): Promise<string> {
  const found = await findIncidentBySlugForUser(db, userId, slug);
  if (!found) throw new Error('Incident not found');
  return found.incident.id;
}

const noteSchema = z.object({
  slug: z.string().min(1),
  markdown: z.string().min(1).max(50_000),
});

export async function addNoteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = noteSchema.parse({
    slug: formData.get('slug'),
    markdown: formData.get('markdown'),
  });
  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await appendNote(db, session.user.id, incidentId, parsed.markdown);
  revalidatePath(`/incidents/${parsed.slug}`);
}

const statusSchema = z.object({
  slug: z.string().min(1),
  toStatus: z.enum(INCIDENT_STATUS_VALUES),
  reason: z.string().max(500).optional(),
  assignIcUserId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export async function changeStatusAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = statusSchema.parse({
    slug: formData.get('slug'),
    toStatus: formData.get('toStatus'),
    reason: formData.get('reason') ?? undefined,
    assignIcUserId: formData.get('assignIcUserId') ?? undefined,
  });

  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await changeIncidentStatus(db, session.user.id, incidentId, parsed.toStatus, {
    reason: parsed.reason,
    assignIcUserId: parsed.assignIcUserId,
  });
  revalidatePath(`/incidents/${parsed.slug}`);
}

const severitySchema = z.object({
  slug: z.string().min(1),
  toSeverity: z.enum(SEVERITY_VALUES),
});

export async function changeSeverityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = severitySchema.parse({
    slug: formData.get('slug'),
    toSeverity: formData.get('toSeverity'),
  });
  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await changeIncidentSeverity(db, session.user.id, incidentId, parsed.toSeverity);
  revalidatePath(`/incidents/${parsed.slug}`);
}

const roleSchema = z.object({
  slug: z.string().min(1),
  role: z.enum(ROLE_VALUES),
  toUserId: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal('').transform(() => null)),
});

export async function assignRoleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = roleSchema.parse({
    slug: formData.get('slug'),
    role: formData.get('role'),
    toUserId: formData.get('toUserId'),
  });
  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await assignIncidentRole(db, session.user.id, incidentId, parsed.role, parsed.toUserId);
  revalidatePath(`/incidents/${parsed.slug}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/incidents/[slug]/actions.ts'
git commit -m "$(cat <<'EOF'
feat(incidents): server actions for note / status / severity / role

Each action: auth(), zod parse, find incident, call query, revalidate
the page. Thrown errors fall through to error.tsx (parity with Plan 2;
useFormState migration is a v1.1 follow-up).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: NoteForm + react-markdown dep

**Files:**
- Modify: `package.json`
- Create: `src/app/(app)/incidents/[slug]/_components/NoteForm.tsx`

- [ ] **Step 1: Add the markdown deps**

Run: `pnpm add react-markdown remark-gfm`
Expected: `react-markdown` and `remark-gfm` added to `package.json` `dependencies`.

- [ ] **Step 2: Create the NoteForm component**

```tsx
// src/app/(app)/incidents/[slug]/_components/NoteForm.tsx
'use client';

import { useRef } from 'react';
import { addNoteAction } from '../actions';

export function NoteForm({ slug }: { slug: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData): Promise<void> {
    await addNoteAction(formData);
    formRef.current?.reset();
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <textarea
        name="markdown"
        required
        maxLength={50_000}
        rows={3}
        placeholder="Post a note (markdown supported)…"
        className="w-full rounded border border-neutral-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Post note
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml 'src/app/(app)/incidents/[slug]/_components/NoteForm.tsx'
git commit -m "$(cat <<'EOF'
feat(incidents): NoteForm client component for posting timeline notes

Plain HTML form bound to addNoteAction; resets the textarea after
successful submission. react-markdown / remark-gfm added for the
upcoming Timeline renderer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: StatusControl + SeverityControl

**Files:**
- Create: `src/app/(app)/incidents/[slug]/_components/StatusControl.tsx`
- Create: `src/app/(app)/incidents/[slug]/_components/SeverityControl.tsx`

- [ ] **Step 1: Create StatusControl**

```tsx
// src/app/(app)/incidents/[slug]/_components/StatusControl.tsx
'use client';

import { useState } from 'react';
import {
  INCIDENT_STATUS_VALUES,
  type IncidentStatus,
} from '@/lib/db/schema/incidents';
import { changeStatusAction } from '../actions';

const ALLOWED: Record<IncidentStatus, IncidentStatus[]> = {
  triaging: ['investigating', 'resolved'],
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['monitoring', 'investigating', 'resolved'],
  monitoring: ['investigating', 'resolved'],
  resolved: ['investigating'],
};

export interface StatusControlProps {
  slug: string;
  current: IncidentStatus;
  hasIc: boolean;
  teamMembers: Array<{ id: string; name: string }>;
}

export function StatusControl({ slug, current, hasIc, teamMembers }: StatusControlProps) {
  const [next, setNext] = useState<IncidentStatus>(current);
  const options = ALLOWED[current];
  const leavingTriaging = current === 'triaging' && next !== 'triaging' && next !== 'resolved';
  const needsIcPick = leavingTriaging && !hasIc;

  if (options.length === 0) return null;

  return (
    <form action={changeStatusAction} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <label className="block text-xs font-medium text-neutral-600">Update status</label>
      <select
        name="toStatus"
        value={next}
        onChange={(e) => setNext(e.target.value as IncidentStatus)}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      >
        <option value={current} disabled>
          (currently {current})
        </option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {needsIcPick ? (
        <select
          name="assignIcUserId"
          required
          defaultValue=""
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Assign Incident Commander…
          </option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="assignIcUserId" value="" />
      )}
      <input
        type="text"
        name="reason"
        placeholder="Reason (optional)"
        maxLength={500}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={next === current}
        className="w-full rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        Apply
      </button>
    </form>
  );
}

export const STATUS_OPTIONS_FOR_TEST = INCIDENT_STATUS_VALUES;
```

- [ ] **Step 2: Create SeverityControl**

```tsx
// src/app/(app)/incidents/[slug]/_components/SeverityControl.tsx
'use client';

import { SEVERITY_VALUES, type Severity } from '@/lib/db/schema/services';
import { changeSeverityAction } from '../actions';

export interface SeverityControlProps {
  slug: string;
  current: Severity;
}

export function SeverityControl({ slug, current }: SeverityControlProps) {
  return (
    <form action={changeSeverityAction} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <label className="block text-xs font-medium text-neutral-600">Change severity</label>
      <select
        name="toSeverity"
        defaultValue={current}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      >
        {SEVERITY_VALUES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
      >
        Apply
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(app)/incidents/[slug]/_components/StatusControl.tsx' 'src/app/(app)/incidents/[slug]/_components/SeverityControl.tsx'
git commit -m "$(cat <<'EOF'
feat(incidents): StatusControl + SeverityControl

StatusControl restricts options to legal next states and surfaces an IC
picker exactly when leaving triaging without one assigned. SeverityControl
is a flat dropdown — auto-promote rules belong to webhook ingestion
(Plan 8).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: RolePickers component

**Files:**
- Create: `src/app/(app)/incidents/[slug]/_components/RolePickers.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/(app)/incidents/[slug]/_components/RolePickers.tsx
'use client';

import { ROLE_VALUES, type IncidentRole } from '@/lib/timeline/body';
import { assignRoleAction } from '../actions';

const LABELS: Record<IncidentRole, string> = {
  ic: 'Incident Commander',
  scribe: 'Scribe',
  comms: 'Comms',
};

export interface RolePickersProps {
  slug: string;
  assignments: Record<IncidentRole, string | null>;
  teamMembers: Array<{ id: string; name: string }>;
}

export function RolePickers({ slug, assignments, teamMembers }: RolePickersProps) {
  return (
    <div className="space-y-3">
      {ROLE_VALUES.map((role) => (
        <form key={role} action={assignRoleAction} className="space-y-1">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="role" value={role} />
          <label className="block text-xs font-medium text-neutral-600">{LABELS[role]}</label>
          <div className="flex gap-1">
            <select
              name="toUserId"
              defaultValue={assignments[role] ?? ''}
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="">— unassigned —</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium hover:bg-neutral-50"
            >
              Set
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/incidents/[slug]/_components/RolePickers.tsx'
git commit -m "$(cat <<'EOF'
feat(incidents): RolePickers for IC / Scribe / Comms

Three independent forms — each posts to assignRoleAction with role and
toUserId. Empty value (— unassigned —) maps to null in the action,
which the query treats as a valid unassign. Non-team-member targets
are still rejected server-side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Timeline component (server-rendered)

**Files:**
- Create: `src/app/(app)/incidents/[slug]/_components/Timeline.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/(app)/incidents/[slug]/_components/Timeline.tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/incidents/[slug]/_components/Timeline.tsx'
git commit -m "$(cat <<'EOF'
feat(incidents): Timeline server component renders all four event kinds

Notes use react-markdown + remark-gfm. Status / severity / role events
render as compact one-liners with author + relative time. Author name
resolution is passed in as a Map so the page query can batch the user
lookup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Wire everything into `/incidents/[slug]/page.tsx`

**Files:**
- Modify: `src/app/(app)/incidents/[slug]/page.tsx`

- [ ] **Step 1: Replace the page**

Open `src/app/(app)/incidents/[slug]/page.tsx` and replace the entire file with:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import { getRunbook } from '@/lib/db/queries/runbooks';
import { listTeamMembersWithUsers } from '@/lib/db/queries/teams';
import { listTimelineEventsForIncident } from '@/lib/db/queries/timeline';
import { users } from '@/lib/db/schema/users';
import { SeverityPill } from '../_components/SeverityPill';
import { StatusPill } from '../_components/StatusPill';
import { Timeline } from './_components/Timeline';
import { NoteForm } from './_components/NoteForm';
import { StatusControl } from './_components/StatusControl';
import { SeverityControl } from './_components/SeverityControl';
import { RolePickers } from './_components/RolePickers';

function durationLabel(start: Date, end: Date | null): string {
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { slug } = await params;
  const found = await findIncidentBySlugForUser(db, session.user.id, slug);
  if (!found) notFound();
  const { incident, affectedServices } = found;
  const userId = session.user.id;

  const [runbooks, events, teamMembers] = await Promise.all([
    Promise.all(
      affectedServices.map(async (svc) => {
        try {
          const rb = await getRunbook(db, userId, svc.id, incident.severity);
          return { service: svc, runbook: rb };
        } catch {
          return { service: svc, runbook: null };
        }
      }),
    ),
    listTimelineEventsForIncident(db, userId, incident.id),
    listTeamMembersWithUsers(db, incident.teamId),
  ]);

  // Resolve author names for events. Includes role_change.fromUserId/toUserId targets.
  const involvedUserIds = new Set<string>();
  for (const ev of events) {
    if (ev.authorUserId) involvedUserIds.add(ev.authorUserId);
    if (ev.kind === 'role_change') {
      const body = ev.body as { fromUserId: string | null; toUserId: string | null };
      if (body.fromUserId) involvedUserIds.add(body.fromUserId);
      if (body.toUserId) involvedUserIds.add(body.toUserId);
    }
  }
  for (const m of teamMembers) involvedUserIds.add(m.id);
  for (const id of [incident.icUserId, incident.scribeUserId, incident.commsUserId]) {
    if (id) involvedUserIds.add(id);
  }

  const authorRows =
    involvedUserIds.size > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...involvedUserIds]))
      : [];
  const authorMap = new Map(authorRows.map((r) => [r.id, r.name]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SeverityPill value={incident.severity} />
            <StatusPill value={incident.status} />
            <span className="text-xs text-neutral-500">{incident.publicSlug}</span>
          </div>
          <h1 className="text-2xl font-semibold">{incident.title}</h1>
          <p className="text-sm text-neutral-600">
            Declared {incident.declaredAt.toISOString()} ·{' '}
            {durationLabel(incident.declaredAt, incident.resolvedAt)} so far
          </p>
        </div>

        {incident.summary && (
          <section className="rounded border border-neutral-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-medium text-neutral-700">Summary</h2>
            <p className="whitespace-pre-wrap text-sm">{incident.summary}</p>
          </section>
        )}

        <section className="space-y-3 rounded border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-medium text-neutral-700">Timeline</h2>
          <NoteForm slug={incident.publicSlug} />
          <Timeline events={events} authors={authorMap} />
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Quick actions</h2>
          <div className="space-y-3">
            <StatusControl
              slug={incident.publicSlug}
              current={incident.status}
              hasIc={incident.icUserId !== null}
              teamMembers={teamMembers.map((m) => ({ id: m.id, name: m.name }))}
            />
            <SeverityControl slug={incident.publicSlug} current={incident.severity} />
          </div>
        </section>

        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Roles</h2>
          <RolePickers
            slug={incident.publicSlug}
            assignments={{
              ic: incident.icUserId,
              scribe: incident.scribeUserId,
              comms: incident.commsUserId,
            }}
            teamMembers={teamMembers.map((m) => ({ id: m.id, name: m.name }))}
          />
        </section>

        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Affected services</h2>
          {affectedServices.length === 0 ? (
            <p className="text-sm text-neutral-500">None attached.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {affectedServices.map((s) => (
                <li key={s.id}>
                  <Link href={`/services/${s.slug}`} className="text-blue-700 hover:underline">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">
            Runbooks · {incident.severity}
          </h2>
          {runbooks.length === 0 ? (
            <p className="text-sm text-neutral-500">No services attached.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {runbooks.map(({ service, runbook }) => (
                <li key={service.id}>
                  <Link
                    href={`/services/${service.slug}/runbooks/${incident.severity}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {service.name} → {incident.severity}
                  </Link>
                  {runbook ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                      {runbook.markdownBody.slice(0, 140) || '(empty)'}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-neutral-400">No runbook yet.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Build to confirm there are no Next 16 issues**

Run: `pnpm build`
Expected: **PASS** — Next.js builds the route, no SSR errors.

- [ ] **Step 4: Manual smoke test**

Start the dev server (`pnpm dev`) and visit `/incidents/[some-slug]`. Confirm:
- Timeline section renders (empty state on a fresh incident).
- Posting a note via the form works and appears in the timeline.
- Changing status via the dropdown works and adds a `status_change` event.
- Changing severity works.
- Assigning IC / Scribe / Comms works.
- Leaving `triaging` without an IC surfaces the IC picker; submitting without a pick fails (zod rejects empty `assignIcUserId` in the schema).

If any of these fail, fix in this task before committing.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/incidents/[slug]/page.tsx'
git commit -m "$(cat <<'EOF'
feat(incidents): wire timeline + mutation controls into the war-room

Replaces the Plan 2 placeholder. Author name resolution batches via
inArray on a single users query. Quick-actions rail carries
StatusControl + SeverityControl; Roles section surfaces the three role
pickers. All sections share the team-member list so admins editing a
foreign team's incident still see who is assignable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Acceptance pass + docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/GUARDRAILS.md`
- Modify: `.claude/memory/MEMORY.md` (only if a new memory entry is warranted)
- Modify: `README.md` (if the manual checklist references Plan 3)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: **PASS** — total ~83 tests (55 from Plans 1+2, +8 unit body, +12 timeline integration, +~20 mutations integration, +1 listTeamMembersWithUsers). Exact count may vary by ±2; all green is the gate, not the number.

- [ ] **Step 2: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: **PASS** on both. If lint complains about `react-hooks/rules-of-hooks` on any new test (per the global memory note about `useTestDb` triggering false positives), wrap the call inside the `describe` block — it must not be at module level.

- [ ] **Step 3: Update CLAUDE.md**

Edit the **Update history** section at the bottom of `CLAUDE.md` and append a Plan 3 entry. Also update the "Notes" section to remove "Plan 3 in progress" / "no real-time, no role mutations, no timeline events" stale text and replace the relevant lines with the post-Plan-3 reality. Specifically:

- In the opening blockquote, change "Plan 2 (Incidents core) shipped 2026-04-28" to "Plan 2 (Incidents core) shipped 2026-04-28. Plan 3 (Timeline + mutations) shipped <today>."
- In **Notes**, replace the bullet "no real-time, no role mutations, no timeline events" line with "real-time SSE deferred to Plan 4; timeline / status / severity / role mutations live."
- In **Local conventions**, add: "**Timeline writes**: every mutation that changes incident state (`changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole`, `appendNote`) writes a `TimelineEvent` row in the same DB transaction. zod validates the jsonb body shape on every insert."
- In **Update history**, append:
  ```
  - <today>: **Plan 3 (Timeline + mutations) implemented**. New `timeline_events` table, four mutation queries (`appendNote`, `changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole`), state machine with IC-required-when-leaving-triaging, four Server Actions, five new components on `/incidents/[slug]`. Test count: ~83.
  ```

- [ ] **Step 4: Update GUARDRAILS.md**

Add a new row to the table in `.claude/GUARDRAILS.md`:

| Timeline schema (`src/lib/db/schema/timeline.ts`), queries (`src/lib/db/queries/timeline.ts`), body schemas (`src/lib/timeline/body.ts`) | spec §4.1 + §6.1 + this plan | jsonb body MUST go through `TimelineEventBodySchema.parse(...)` before insert. New event kinds (`webhook`, `postmortem_link`, `attachment`, `status_update_published`) added in their owning plan; do not pre-add. Each mutation query writes its event in the same transaction as the row update. |

Bump the **Last revision** date.

- [ ] **Step 5: Update README**

If `README.md` has a "manual acceptance checklist", add Plan 3 items: "post a note", "change status", "leave triaging requires IC picker", "change severity", "assign IC/Scribe/Comms". If no such section exists, skip this step.

- [ ] **Step 6: Final commit**

```bash
git add CLAUDE.md .claude/GUARDRAILS.md README.md
git commit -m "$(cat <<'EOF'
docs: Plan 3 acceptance — timeline + mutations live

Updates CLAUDE.md history, GUARDRAILS table, and (if present) the
README manual checklist to reflect the post-Plan-3 state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Announce in Linear**

Post a comment on the Linear "Incident App" project (id `9a1934ab-bcff-4604-a845-d17ca8b51feb`) summarizing Plan 3 delivery — what shipped, what's deferred to Plan 4 (SSE/real-time), test count delta. Use the existing Linear MCP `mcp__linear__save_comment` tool. (If the executor lacks Linear MCP access in their session, skip this step and flag it in the final report.)

---

## Self-review notes

(Run by the plan author, not the executor. Listed here for transparency.)

- **Spec coverage:** §4.1 timeline_events schema → Task 1 + 3. §4.3 status state machine → Task 6. §6.1 war-room layout → Tasks 11–15. §3.5 authz at data layer → reused via `requireTeamMember` in Tasks 4–8. §13 "roles as columns on Incident, role-change history in TimelineEvent" → Task 8 covers both. SSE / public status / postmortems / webhook ingestion / metrics are all explicit deferred items, owned by later plans.
- **Placeholder scan:** none — every step contains either runnable commands or the full code.
- **Type consistency:** `TimelineEventBody` is the single source for body shapes (Task 2), reused by every query and component. `IncidentStatus` / `Severity` / `IncidentRole` come from the existing schema modules. The state-machine lookup (`ALLOWED_TRANSITIONS` in queries, `ALLOWED` in StatusControl) is duplicated intentionally — server-side is authoritative; client-side is courtesy gating that doesn't import from the queries module to keep the client bundle clean.
- **Scope:** Plan 3 is one cohesive subsystem; no decomposition needed. Roughly the same size as Plans 1 (13 tasks) and 2 (12 tasks).
- **Ambiguity:** "Same-status no-op" is explicit for status, severity, and role. "resolvedAt managed automatically" is explicit. "IC required when leaving triaging" is qualified to "except when going directly to resolved" (the false-positive close path) — both Task 6 tests cover this.
