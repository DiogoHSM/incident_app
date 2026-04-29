# Plan 5 — Postmortem editor + action items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/incidents/[slug]/postmortem` — a templated markdown editor with debounced autosave, side rail of action items (CRUD + assignee + due date + external link), draft → publish flow, and an opt-in "show on public status page" toggle. Publishing emits a `postmortem_link` timeline event so it streams to live war-room viewers via the existing SSE channel.

**Architecture:** Two new tables (`postmortems`, `action_items`) plus a one-row enum extension (`timeline_event_kind` += `postmortem_link`). Postmortem mutations route through the established `src/lib/db/queries/*.ts` boundary; the publish flow is transactional (update + timeline event + `pg_notify`) and reuses the Plan 4 dispatcher unchanged. Autosave goes over a dedicated `POST /api/postmortems/[id]` endpoint (per spec §8.3) — Server Actions handle the lower-frequency state-change ops (create draft, publish, toggle visibility, action item CRUD). The editor is a single-textarea client component with an 800ms debounce and three-state status indicator (`saved 12s ago` / `⚠ retry` / `✗ offline`). Authorization stays at the data layer — `requireTeamMember` (admin bypass) on every entry point.

**Tech Stack:** Next.js 16 App Router · TypeScript strict + `noUncheckedIndexedAccess` · Drizzle ORM 0.45 + Postgres 16 · NextAuth v5 · zod · Vitest 4 + testcontainers · `react-markdown` + `remark-gfm` (already in deps).

**Commit trailer (mandatory on every commit):**
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File map

**Created:**
- `src/lib/db/schema/postmortems.ts` — `postmortems` table + `POSTMORTEM_STATUS_VALUES` + `postmortemStatusEnum`.
- `src/lib/db/schema/action-items.ts` — `actionItems` table + `ACTION_ITEM_STATUS_VALUES` + `actionItemStatusEnum`.
- `src/lib/db/queries/postmortems.ts` — `createDraftForIncident`, `findPostmortemByIdForUser`, `findPostmortemForIncidentSlug`, `updatePostmortemMarkdown`, `publishPostmortem`, `setPostmortemPublicVisibility`.
- `src/lib/db/queries/action-items.ts` — `listActionItemsForPostmortem`, `createActionItem`, `updateActionItem`, `deleteActionItem`.
- `src/lib/postmortems/template.ts` — `buildStarterTemplate(incident, events, authorById)` + `formatTimelineEventForMarkdown(event, authorById)` helpers (pure, unit-tested).
- `src/app/api/postmortems/[id]/route.ts` — `POST` autosave handler (zod-validated body, returns `{ updatedAt }`).
- `src/app/(app)/incidents/[slug]/postmortem/page.tsx` — server-rendered editor shell.
- `src/app/(app)/incidents/[slug]/postmortem/actions.ts` — Server Actions (`createDraftAction`, `publishAction`, `setVisibilityAction`, `createActionItemAction`, `updateActionItemAction`, `deleteActionItemAction`).
- `src/app/(app)/incidents/[slug]/postmortem/_components/PostmortemEditor.tsx` — client textarea + debounced autosave + status indicator.
- `src/app/(app)/incidents/[slug]/postmortem/_components/ActionItemsRail.tsx` — list + add/edit/delete UI.
- `src/app/(app)/incidents/[slug]/_components/PostmortemTrigger.tsx` — war-room button: links to existing draft or invokes `createDraftAction`.
- `drizzle/0005_<auto-name>.sql` — generated migration: new tables + enum-add.
- `tests/integration/postmortems.test.ts` — postmortem queries + publish-emits-timeline-event.
- `tests/integration/action-items.test.ts` — action item queries.
- `tests/integration/postmortems-api.test.ts` — autosave route handler against a real session (skipped if it requires a session helper that doesn't exist; otherwise uses the same pattern as other integration tests).
- `tests/unit/postmortem-template.test.ts` — `buildStarterTemplate` + `formatTimelineEventForMarkdown` golden tests.

**Modified:**
- `src/lib/db/schema/timeline.ts` — add `'postmortem_link'` to `TIMELINE_EVENT_KIND_VALUES`.
- `src/lib/db/schema/index.ts` — export postmortem + action-item modules.
- `src/lib/timeline/body.ts` — extend `TimelineEventBodySchema` with `PostmortemLinkBody` variant.
- `src/lib/realtime/types.ts` — no field additions (the wire schema already keys off `kind`); add a roundtrip note in the test.
- `src/app/(app)/incidents/[slug]/page.tsx` — add `<PostmortemTrigger>` to the right rail.
- `src/app/(app)/incidents/[slug]/_components/Timeline.tsx` — render the new `postmortem_link` kind.
- `tests/setup/withTx.ts` — append `'action_items'` and `'postmortems'` to the truncation list (FK order: action_items first).
- `tests/unit/timeline-body.test.ts` — add a case for the `postmortem_link` variant.
- `CLAUDE.md` — append Plan 5 entry to update history; promote `/incidents/[slug]/postmortem` from "arrives in Plan 5" to live.
- `.claude/GUARDRAILS.md` — add a row for `src/lib/db/schema/postmortems.ts` / `action-items.ts` / postmortem queries / `/api/postmortems/[id]`.

---

## Task 1: Schema — `postmortems` table + `postmortem_status` enum

**Files:**
- Create: `src/lib/db/schema/postmortems.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// src/lib/db/schema/postmortems.ts
import { pgTable, pgEnum, uuid, timestamp, text, boolean } from 'drizzle-orm/pg-core';
import { incidents } from './incidents';

export const POSTMORTEM_STATUS_VALUES = ['draft', 'published'] as const;
export type PostmortemStatus = (typeof POSTMORTEM_STATUS_VALUES)[number];

export const postmortemStatusEnum = pgEnum('postmortem_status', POSTMORTEM_STATUS_VALUES);

export const postmortems = pgTable('postmortems', {
  id: uuid('id').primaryKey().defaultRandom(),
  incidentId: uuid('incident_id')
    .notNull()
    .unique()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  markdownBody: text('markdown_body').notNull(),
  status: postmortemStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publicOnStatusPage: boolean('public_on_status_page').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Postmortem = typeof postmortems.$inferSelect;
export type NewPostmortem = typeof postmortems.$inferInsert;
```

- [ ] **Step 2: Re-export from the schema barrel**

Edit `src/lib/db/schema/index.ts` to append:

```ts
export * from './postmortems';
```

(Keep all existing exports; add the new one at the bottom.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS** — no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/postmortems.ts src/lib/db/schema/index.ts
git commit -m "$(cat <<'EOF'
feat(schema): add postmortems table

One-to-one with incidents (unique on incident_id, cascade on delete).
markdown_body is a single text column — templated sections live as
markdown headings inside, not separate columns. status is an enum
(draft|published); published_at fills in on publish; public_on_status_page
is a separate flag because publishing internally and surfacing on /status
are independent decisions per spec §6.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Schema — `action_items` table + `action_item_status` enum

**Files:**
- Create: `src/lib/db/schema/action-items.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// src/lib/db/schema/action-items.ts
import { pgTable, pgEnum, uuid, timestamp, text, date, index } from 'drizzle-orm/pg-core';
import { postmortems } from './postmortems';
import { users } from './users';

export const ACTION_ITEM_STATUS_VALUES = ['open', 'in_progress', 'done', 'wontfix'] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUS_VALUES)[number];

export const actionItemStatusEnum = pgEnum('action_item_status', ACTION_ITEM_STATUS_VALUES);

export const actionItems = pgTable(
  'action_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postmortemId: uuid('postmortem_id')
      .notNull()
      .references(() => postmortems.id, { onDelete: 'cascade' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: actionItemStatusEnum('status').notNull().default('open'),
    dueDate: date('due_date'),
    externalUrl: text('external_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postmortemIdx: index('action_items_postmortem_idx').on(t.postmortemId, t.createdAt),
  }),
);

export type ActionItem = typeof actionItems.$inferSelect;
export type NewActionItem = typeof actionItems.$inferInsert;
```

> **Note on `dueDate`:** Drizzle's `date` column maps to `string` in TS by default (YYYY-MM-DD). That matches `<input type="date">` exactly — no Date round-tripping. See memory `pgx_date_scan_string.md` for the broader category of date-binary-format gotchas; postgres-js doesn't have the same issue, but we still keep the column as text-shaped on the client.

- [ ] **Step 2: Re-export from the schema barrel**

Edit `src/lib/db/schema/index.ts` to append:

```ts
export * from './action-items';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/action-items.ts src/lib/db/schema/index.ts
git commit -m "$(cat <<'EOF'
feat(schema): add action_items table

N-to-1 with postmortems, cascade-delete when the postmortem is gone.
assignee_user_id is set-null on user delete (we keep historical action
items even after an account is removed). status enum mirrors spec §4.1
(open|in_progress|done|wontfix). due_date uses pg date (string-shaped
in TS, matches <input type=date> directly).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `timeline_event_kind` enum + body schema with `postmortem_link`

**Files:**
- Modify: `src/lib/db/schema/timeline.ts`
- Modify: `src/lib/timeline/body.ts`
- Modify: `tests/unit/timeline-body.test.ts`

- [ ] **Step 1: Add `postmortem_link` to the enum values**

Edit `src/lib/db/schema/timeline.ts` line 5-10. Replace the array:

```ts
export const TIMELINE_EVENT_KIND_VALUES = [
  'note',
  'status_change',
  'severity_change',
  'role_change',
  'postmortem_link',
] as const;
```

- [ ] **Step 2: Add the `PostmortemLinkBody` zod variant**

Edit `src/lib/timeline/body.ts`. After the `RoleChangeBody` declaration and before `TimelineEventBodySchema`:

```ts
const PostmortemLinkBody = z.object({
  kind: z.literal('postmortem_link'),
  postmortemId: z.string().uuid(),
});
```

Then update the discriminated union:

```ts
export const TimelineEventBodySchema = z.discriminatedUnion('kind', [
  NoteBody,
  StatusChangeBody,
  SeverityChangeBody,
  RoleChangeBody,
  PostmortemLinkBody,
]);
```

- [ ] **Step 3: Write the failing unit test**

Edit `tests/unit/timeline-body.test.ts`. Add inside the existing `describe('TimelineEventBodySchema', ...)`:

```ts
test('postmortem_link shape — postmortemId required and uuid', () => {
  expect(
    TimelineEventBodySchema.parse({
      kind: 'postmortem_link',
      postmortemId: '11111111-1111-4111-8111-111111111111',
    }),
  ).toMatchObject({ kind: 'postmortem_link' });
});

test('postmortem_link rejects non-uuid postmortemId', () => {
  expect(() =>
    TimelineEventBodySchema.parse({ kind: 'postmortem_link', postmortemId: 'not-a-uuid' }),
  ).toThrow();
});

test('postmortem_link rejects missing postmortemId', () => {
  expect(() =>
    TimelineEventBodySchema.parse({ kind: 'postmortem_link' }),
  ).toThrow();
});
```

> **Why uuid v4 in the fixture:** memory `zod_v4_uuid_strict_rfc.md` — `'00000000-...-000000000001'` fails strict variant bits in zod v4. Use a real v4 (`...4xxx-8xxx...`) for fixtures.

- [ ] **Step 4: Run the unit tests**

Run: `pnpm test tests/unit/timeline-body.test.ts`
Expected: all tests **PASS**, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema/timeline.ts src/lib/timeline/body.ts tests/unit/timeline-body.test.ts
git commit -m "$(cat <<'EOF'
feat(timeline): add postmortem_link kind + body schema

Extends timeline_event_kind enum and the zod discriminated union with a
new variant carrying postmortemId. Plan 5 emits this event when a draft
is published so SSE viewers see "Postmortem published" land in the
war-room timeline live. The wire schema (TimelineEventOnWire) needs no
change — its discriminator is already `kind`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Generate + apply migration 0005, extend truncation list

**Files:**
- Create: `drizzle/0005_<auto-name>.sql` (generated)
- Modify: `tests/setup/withTx.ts`

- [ ] **Step 1: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/0005_<auto-name>.sql` is written. It should contain (in some order) `CREATE TYPE "public"."postmortem_status" AS ENUM (...)`, `CREATE TYPE "public"."action_item_status" AS ENUM (...)`, `ALTER TYPE "public"."timeline_event_kind" ADD VALUE 'postmortem_link';`, `CREATE TABLE "postmortems" (...)`, `CREATE TABLE "action_items" (...)`, plus the index on action_items.

Open the generated file and **verify**:
- `ALTER TYPE` for `timeline_event_kind` adds `postmortem_link`. (Drizzle's diff produces this; it does NOT reorder — we appended at the end of the array, so the Postgres ordinal also lands at the end.)
- `postmortems.incident_id` has `UNIQUE` and `REFERENCES incidents(id) ON DELETE CASCADE`.
- `action_items.postmortem_id` has `REFERENCES postmortems(id) ON DELETE CASCADE`.
- `action_items.assignee_user_id` has `REFERENCES users(id) ON DELETE SET NULL`.

If any of these are wrong, fix the schema and regenerate. Do **not** hand-edit the SQL.

- [ ] **Step 2: Apply against the dev database**

Run: `pnpm db:migrate`
Expected: migration `0005_<name>` applied successfully.

- [ ] **Step 3: Extend the test truncation list**

Edit `tests/setup/withTx.ts`. Find the `TABLES` array and add the two new tables. **FK order matters for TRUNCATE CASCADE-free runs** — `action_items` (children) must come before `postmortems` (parent), and both before any of their parents:

```ts
const TABLES = [
  'timeline_events',
  'incident_services',
  'action_items',
  'postmortems',
  'incidents',
  // … existing entries …
] as const;
```

> Match the existing exact ordering for the entries above this; only insert the two new lines in the indicated slot. If the file uses `TRUNCATE ... CASCADE`, ordering still doesn't strictly matter, but keeping the FK-respecting order prevents subtle accidents if someone removes CASCADE later.

- [ ] **Step 4: Run the integration suite**

Run: `pnpm test`
Expected: all 128 existing tests still **PASS**. (No new test code yet; this verifies the migration is forward-compatible.)

- [ ] **Step 5: Commit**

```bash
git add drizzle/0005_*.sql drizzle/meta tests/setup/withTx.ts
git commit -m "$(cat <<'EOF'
feat(db): migration 0005 — postmortems + action_items + enum extension

Adds two new tables and one ALTER TYPE on timeline_event_kind. Truncation
list extended in test setup; FK ordering preserved (children before
parents) so we don't depend on CASCADE.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Queries — postmortem CRUD + starter template helper

**Files:**
- Create: `src/lib/postmortems/template.ts`
- Create: `src/lib/db/queries/postmortems.ts`
- Create: `tests/unit/postmortem-template.test.ts`
- Create: `tests/integration/postmortems.test.ts`

### 5a — Starter template helper (pure, unit-tested)

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/postmortem-template.test.ts
import { describe, expect, test } from 'vitest';
import {
  buildStarterTemplate,
  formatTimelineEventForMarkdown,
} from '@/lib/postmortems/template';
import type { TimelineEvent } from '@/lib/db/schema/timeline';
import type { Incident } from '@/lib/db/schema/incidents';

const incident: Incident = {
  id: '11111111-1111-4111-8111-111111111111',
  publicSlug: 'inc-abc12345',
  teamId: '22222222-2222-4222-8222-222222222222',
  declaredBy: '33333333-3333-4333-8333-333333333333',
  severity: 'SEV2',
  status: 'resolved',
  title: 'Login 500s',
  summary: 'Users could not log in',
  declaredAt: new Date('2026-04-29T10:30:00Z'),
  resolvedAt: new Date('2026-04-29T11:15:00Z'),
  icUserId: '44444444-4444-4444-8444-444444444444',
  scribeUserId: null,
  commsUserId: null,
  createdAt: new Date('2026-04-29T10:30:00Z'),
  updatedAt: new Date('2026-04-29T11:15:00Z'),
} as Incident;

const noteEvent: TimelineEvent = {
  id: '55555555-5555-4555-8555-555555555555',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'note',
  body: { kind: 'note', markdown: 'Saw 500s on /v1/login' },
  occurredAt: new Date('2026-04-29T10:32:11Z'),
} as TimelineEvent;

const statusEvent: TimelineEvent = {
  id: '66666666-6666-4666-8666-666666666666',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'status_change',
  body: { kind: 'status_change', from: 'triaging', to: 'investigating' },
  occurredAt: new Date('2026-04-29T10:35:42Z'),
} as TimelineEvent;

const severityEvent: TimelineEvent = {
  id: '77777777-7777-4777-8777-777777777777',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'severity_change',
  body: { kind: 'severity_change', from: 'SEV3', to: 'SEV1' },
  occurredAt: new Date('2026-04-29T10:42:11Z'),
} as TimelineEvent;

const roleEvent: TimelineEvent = {
  id: '88888888-8888-4888-8888-888888888888',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'role_change',
  body: {
    kind: 'role_change',
    role: 'ic',
    fromUserId: null,
    toUserId: '44444444-4444-4444-8444-444444444444',
  },
  occurredAt: new Date('2026-04-29T10:36:00Z'),
} as TimelineEvent;

const authorById = new Map([['44444444-4444-4444-8444-444444444444', 'Alice Anderson']]);

describe('formatTimelineEventForMarkdown', () => {
  test('note → bullet with author and first line', () => {
    expect(formatTimelineEventForMarkdown(noteEvent, authorById)).toBe(
      '- **2026-04-29T10:32:11.000Z** — Note (Alice Anderson): Saw 500s on /v1/login',
    );
  });

  test('status_change → arrow line', () => {
    expect(formatTimelineEventForMarkdown(statusEvent, authorById)).toBe(
      '- **2026-04-29T10:35:42.000Z** — Status: triaging → investigating',
    );
  });

  test('severity_change → arrow line', () => {
    expect(formatTimelineEventForMarkdown(severityEvent, authorById)).toBe(
      '- **2026-04-29T10:42:11.000Z** — Severity: SEV3 → SEV1',
    );
  });

  test('role_change → "IC: — → Alice"', () => {
    expect(formatTimelineEventForMarkdown(roleEvent, authorById)).toBe(
      '- **2026-04-29T10:36:00.000Z** — IC: — → Alice Anderson',
    );
  });

  test('unknown author renders as "(unknown)"', () => {
    const orphan = {
      ...noteEvent,
      authorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    } as TimelineEvent;
    expect(formatTimelineEventForMarkdown(orphan, authorById)).toBe(
      '- **2026-04-29T10:32:11.000Z** — Note (unknown): Saw 500s on /v1/login',
    );
  });

  test('multi-line note keeps only the first line', () => {
    const multi = {
      ...noteEvent,
      body: { kind: 'note', markdown: 'first line\nsecond\nthird' },
    } as TimelineEvent;
    expect(formatTimelineEventForMarkdown(multi, authorById)).toBe(
      '- **2026-04-29T10:32:11.000Z** — Note (Alice Anderson): first line',
    );
  });
});

describe('buildStarterTemplate', () => {
  test('emits the five canonical sections', () => {
    const md = buildStarterTemplate(incident, [noteEvent, statusEvent], authorById);
    expect(md).toContain('## Summary');
    expect(md).toContain('## Timeline');
    expect(md).toContain('## Root cause');
    expect(md).toContain('## What went well');
    expect(md).toContain("## What didn't");
  });

  test('embeds the timeline events as bullet rows', () => {
    const md = buildStarterTemplate(incident, [noteEvent, statusEvent], authorById);
    expect(md).toContain('- **2026-04-29T10:32:11.000Z** — Note (Alice Anderson): Saw 500s on /v1/login');
    expect(md).toContain('- **2026-04-29T10:35:42.000Z** — Status: triaging → investigating');
  });

  test('falls back to a placeholder when there are no events', () => {
    const md = buildStarterTemplate(incident, [], authorById);
    expect(md).toContain('## Timeline\n<!-- no events recorded -->');
  });
});
```

- [ ] **Step 2: Run them — they should fail**

Run: `pnpm test tests/unit/postmortem-template.test.ts`
Expected: **FAIL** — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/postmortems/template.ts
import type { Incident } from '@/lib/db/schema/incidents';
import type { TimelineEvent } from '@/lib/db/schema/timeline';

type AuthorMap = ReadonlyMap<string, string>;

function authorName(event: TimelineEvent, authorById: AuthorMap): string {
  if (!event.authorUserId) return 'system';
  return authorById.get(event.authorUserId) ?? 'unknown';
}

const ROLE_LABEL = { ic: 'IC', scribe: 'Scribe', comms: 'Comms' } as const;

export function formatTimelineEventForMarkdown(
  event: TimelineEvent,
  authorById: AuthorMap,
): string {
  const ts = event.occurredAt.toISOString();
  const prefix = `- **${ts}** — `;

  if (event.kind === 'note') {
    const body = event.body as { markdown: string };
    const firstLine = body.markdown.split('\n', 1)[0] ?? '';
    return `${prefix}Note (${authorName(event, authorById)}): ${firstLine}`;
  }
  if (event.kind === 'status_change') {
    const body = event.body as { from: string; to: string };
    return `${prefix}Status: ${body.from} → ${body.to}`;
  }
  if (event.kind === 'severity_change') {
    const body = event.body as { from: string; to: string };
    return `${prefix}Severity: ${body.from} → ${body.to}`;
  }
  if (event.kind === 'role_change') {
    const body = event.body as {
      role: 'ic' | 'scribe' | 'comms';
      fromUserId: string | null;
      toUserId: string | null;
    };
    const from = body.fromUserId ? (authorById.get(body.fromUserId) ?? 'unknown') : '—';
    const to = body.toUserId ? (authorById.get(body.toUserId) ?? 'unknown') : '—';
    return `${prefix}${ROLE_LABEL[body.role]}: ${from} → ${to}`;
  }
  if (event.kind === 'postmortem_link') {
    return `${prefix}Postmortem published`;
  }
  // Exhaustiveness fallback — should never run because of the union above.
  return `${prefix}(unknown event)`;
}

export function buildStarterTemplate(
  incident: Incident,
  events: readonly TimelineEvent[],
  authorById: AuthorMap,
): string {
  const timelineRows =
    events.length === 0
      ? '<!-- no events recorded -->'
      : events.map((e) => formatTimelineEventForMarkdown(e, authorById)).join('\n');

  return [
    `# Postmortem — ${incident.title}`,
    '',
    '## Summary',
    '<!-- One paragraph: what happened, who saw it, what was the impact. -->',
    '',
    '## Timeline',
    timelineRows,
    '',
    '## Root cause',
    '<!-- The chain of events that produced the failure. -->',
    '',
    '## What went well',
    '',
    "## What didn't",
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run the unit tests — should pass**

Run: `pnpm test tests/unit/postmortem-template.test.ts`
Expected: all tests **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/postmortems/template.ts tests/unit/postmortem-template.test.ts
git commit -m "$(cat <<'EOF'
feat(postmortems): starter-template helper

Pure functions: buildStarterTemplate(incident, events, authorById) emits
the five spec §6.4 sections; formatTimelineEventForMarkdown(event,
authorById) renders one event per bullet, with first-line-only for notes
and arrow forms for status/severity/role. Used by createDraftForIncident
to seed the editor body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 5b — Postmortem queries

- [ ] **Step 1: Write the failing integration tests**

```ts
// tests/integration/postmortems.test.ts
import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import {
  createDraftForIncident,
  findPostmortemByIdForUser,
  findPostmortemForIncidentSlug,
  updatePostmortemMarkdown,
  publishPostmortem,
  setPostmortemPublicVisibility,
} from '@/lib/db/queries/postmortems';
import { ForbiddenError } from '@/lib/authz';
import { eq } from 'drizzle-orm';

describe('postmortem queries', () => {
  const ctx = useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let admin: { id: string };
  let teamId: string;
  let incidentId: string;
  let incidentSlug: string;

  beforeEach(async () => {
    alice = await provisionUserOnSignIn(ctx.db, {
      email: 'alice@example.test',
      name: 'Alice Anderson',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });
    bob = await provisionUserOnSignIn(ctx.db, {
      email: 'bob@example.test',
      name: 'Bob Brown',
      ssoSubject: 'sso-bob',
      adminEmails: [],
    });
    admin = await provisionUserOnSignIn(ctx.db, {
      email: 'admin@example.test',
      name: 'Admin',
      ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });

    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Platform', slug: 'platform' })
      .returning();
    if (!team) throw new Error('team');
    teamId = team.id;
    await ctx.db
      .insert(teamMemberships)
      .values({ teamId, userId: alice.id, role: 'lead' });

    const [incident] = await ctx.db
      .insert(incidents)
      .values({
        publicSlug: 'inc-aaaa1111',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV2',
        title: 'Login 500s',
        summary: 'users could not log in',
      })
      .returning();
    if (!incident) throw new Error('incident');
    incidentId = incident.id;
    incidentSlug = incident.publicSlug;
  });

  test('createDraftForIncident creates a draft with starter template', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    expect(pm.status).toBe('draft');
    expect(pm.publicOnStatusPage).toBe(false);
    expect(pm.publishedAt).toBeNull();
    expect(pm.markdownBody).toContain('## Summary');
    expect(pm.markdownBody).toContain('## Timeline');
  });

  test('createDraftForIncident is idempotent — returns existing draft on second call', async () => {
    const first = await createDraftForIncident(ctx.db, alice.id, incidentId);
    const second = await createDraftForIncident(ctx.db, alice.id, incidentId);
    expect(second.id).toBe(first.id);
  });

  test('createDraftForIncident rejects non-team-member', async () => {
    await expect(createDraftForIncident(ctx.db, bob.id, incidentId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test('admin can create draft on any team incident', async () => {
    const pm = await createDraftForIncident(ctx.db, admin.id, incidentId);
    expect(pm.status).toBe('draft');
  });

  test('findPostmortemForIncidentSlug returns null when none exists', async () => {
    const found = await findPostmortemForIncidentSlug(ctx.db, alice.id, incidentSlug);
    expect(found).toBeNull();
  });

  test('findPostmortemForIncidentSlug returns the draft + incident', async () => {
    await createDraftForIncident(ctx.db, alice.id, incidentId);
    const found = await findPostmortemForIncidentSlug(ctx.db, alice.id, incidentSlug);
    expect(found).not.toBeNull();
    expect(found!.postmortem.status).toBe('draft');
    expect(found!.incident.publicSlug).toBe(incidentSlug);
  });

  test('findPostmortemForIncidentSlug returns null for non-team-member non-admin', async () => {
    await createDraftForIncident(ctx.db, alice.id, incidentId);
    const found = await findPostmortemForIncidentSlug(ctx.db, bob.id, incidentSlug);
    expect(found).toBeNull();
  });

  test('findPostmortemByIdForUser returns null for non-team-member non-admin', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    const found = await findPostmortemByIdForUser(ctx.db, bob.id, pm.id);
    expect(found).toBeNull();
  });

  test('updatePostmortemMarkdown saves new content + bumps updated_at', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    const before = pm.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updatePostmortemMarkdown(
      ctx.db,
      alice.id,
      pm.id,
      '## Summary\nthe new body',
    );
    expect(updated.markdownBody).toBe('## Summary\nthe new body');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
  });

  test('updatePostmortemMarkdown rejects non-team-member', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    await expect(
      updatePostmortemMarkdown(ctx.db, bob.id, pm.id, 'nope'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('publishPostmortem flips status, fills published_at, and emits postmortem_link timeline event', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    const result = await publishPostmortem(ctx.db, alice.id, pm.id);

    expect(result.postmortem.status).toBe('published');
    expect(result.postmortem.publishedAt).toBeInstanceOf(Date);

    const events = await ctx.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId));
    const linkEvent = events.find((e) => e.kind === 'postmortem_link');
    expect(linkEvent).toBeDefined();
    const body = linkEvent!.body as { kind: string; postmortemId: string };
    expect(body.kind).toBe('postmortem_link');
    expect(body.postmortemId).toBe(pm.id);
  });

  test('publishPostmortem is a no-op when already published', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    const first = await publishPostmortem(ctx.db, alice.id, pm.id);
    const second = await publishPostmortem(ctx.db, alice.id, pm.id);
    expect(second.postmortem.publishedAt!.getTime()).toBe(
      first.postmortem.publishedAt!.getTime(),
    );

    const events = await ctx.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId));
    const linkEvents = events.filter((e) => e.kind === 'postmortem_link');
    expect(linkEvents.length).toBe(1);
  });

  test('setPostmortemPublicVisibility flips the flag', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    const updated = await setPostmortemPublicVisibility(ctx.db, alice.id, pm.id, true);
    expect(updated.publicOnStatusPage).toBe(true);

    const flippedBack = await setPostmortemPublicVisibility(ctx.db, alice.id, pm.id, false);
    expect(flippedBack.publicOnStatusPage).toBe(false);
  });

  test('setPostmortemPublicVisibility rejects non-team-member', async () => {
    const pm = await createDraftForIncident(ctx.db, alice.id, incidentId);
    await expect(
      setPostmortemPublicVisibility(ctx.db, bob.id, pm.id, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run the tests — should fail with "module not found"**

Run: `pnpm test tests/integration/postmortems.test.ts`
Expected: **FAIL** — `Cannot find module '@/lib/db/queries/postmortems'`.

- [ ] **Step 3: Write the queries module**

```ts
// src/lib/db/queries/postmortems.ts
import { eq, asc } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import {
  postmortems,
  type Postmortem,
} from '@/lib/db/schema/postmortems';
import { incidents, type Incident } from '@/lib/db/schema/incidents';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember, ForbiddenError } from '@/lib/authz';
import { TimelineEventBodySchema } from '@/lib/timeline/body';
import { notifyIncidentUpdate } from '@/lib/realtime/notify';
import { buildStarterTemplate } from '@/lib/postmortems/template';

async function loadIncidentOrThrow(db: DB, incidentId: string): Promise<Incident> {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
  if (!row) throw new Error('Incident not found');
  return row;
}

async function authorMapForIncident(
  db: DB,
  incidentId: string,
): Promise<Map<string, string>> {
  const events = await db
    .select({ authorUserId: timelineEvents.authorUserId })
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId));
  const ids = new Set<string>();
  for (const e of events) if (e.authorUserId) ids.add(e.authorUserId);
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, [...ids][0]!));
  // ^ above only catches one — replace with inArray below.
  return new Map(rows.map((r) => [r.id, r.name ?? 'unknown']));
}
```

> **Wait — that helper has a bug** (`eq` against one id only). Fix it before continuing. Use `inArray`:

```ts
import { eq, asc, inArray } from 'drizzle-orm';

async function authorMapForIncident(
  db: DB,
  incidentId: string,
): Promise<Map<string, string>> {
  const events = await db
    .select({ authorUserId: timelineEvents.authorUserId })
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId));
  const ids = new Set<string>();
  for (const e of events) if (e.authorUserId) ids.add(e.authorUserId);
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name ?? 'unknown']));
}

export async function createDraftForIncident(
  db: DB,
  callerId: string,
  incidentId: string,
): Promise<Postmortem> {
  const incident = await loadIncidentOrThrow(db, incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [existing] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.incidentId, incidentId))
    .limit(1);
  if (existing) return existing;

  const events = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId))
    .orderBy(asc(timelineEvents.occurredAt));
  const authorById = await authorMapForIncident(db, incidentId);
  const markdownBody = buildStarterTemplate(incident, events, authorById);

  const [row] = await db
    .insert(postmortems)
    .values({ incidentId, markdownBody })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

async function loadPostmortemAndIncidentOrNull(
  db: DB,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) return null;
  const incident = await loadIncidentOrThrow(db, pm.incidentId);
  return { postmortem: pm, incident };
}

export async function findPostmortemByIdForUser(
  db: DB,
  userId: string,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const found = await loadPostmortemAndIncidentOrNull(db, postmortemId);
  if (!found) return null;
  const user = await findUserById(db, userId);
  if (!user) return null;
  if (user.role !== 'admin') {
    const [m] = await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, userId))
      .limit(50);
    const teams = new Set(m ? [m.teamId] : []);
    // get full set
    const all = await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, userId));
    for (const r of all) teams.add(r.teamId);
    if (!teams.has(found.incident.teamId)) return null;
  }
  return found;
}
```

> **Tighten that authz pattern** — the duplicate query is sloppy. Replace `findPostmortemByIdForUser` with the canonical version (matches `findIncidentBySlugForUser` in `src/lib/db/queries/incidents.ts:151-187`):

```ts
export async function findPostmortemByIdForUser(
  db: DB,
  userId: string,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) return null;

  const incident = await loadIncidentOrThrow(db, pm.incidentId);

  if (user.role !== 'admin') {
    const isMember =
      (
        await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(
            // and(eq(memberships.userId, ...), eq(memberships.teamId, ...))
            // — replicate the exact pattern from findIncidentBySlugForUser
            // (drizzle-orm `and` import already present at the top once you
            //  add it; uses both filters)
            // For safety in the plan we spell it out with inline imports:
            (await import('drizzle-orm')).and(
              eq(teamMemberships.userId, userId),
              eq(teamMemberships.teamId, incident.teamId),
            ),
          )
          .limit(1)
      ).length > 0;
    if (!isMember) return null;
  }

  return { postmortem: pm, incident };
}
```

> **Cleaner: hoist `and` to the top-level import** (final form):

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';

// … and use:
.where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, incident.teamId)))
```

Final, clean module follows below — replace any of the above scaffolding with this one when you write the file:

```ts
// src/lib/db/queries/postmortems.ts (FINAL)
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { postmortems, type Postmortem } from '@/lib/db/schema/postmortems';
import { incidents, type Incident } from '@/lib/db/schema/incidents';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember } from '@/lib/authz';
import { TimelineEventBodySchema } from '@/lib/timeline/body';
import { notifyIncidentUpdate } from '@/lib/realtime/notify';
import { buildStarterTemplate } from '@/lib/postmortems/template';

async function loadIncidentOrThrow(db: DB, incidentId: string): Promise<Incident> {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
  if (!row) throw new Error('Incident not found');
  return row;
}

async function authorMapForIncident(
  db: DB,
  incidentId: string,
): Promise<Map<string, string>> {
  const events = await db
    .select({ authorUserId: timelineEvents.authorUserId })
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId));
  const ids = new Set<string>();
  for (const e of events) if (e.authorUserId) ids.add(e.authorUserId);
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name ?? 'unknown']));
}

export async function createDraftForIncident(
  db: DB,
  callerId: string,
  incidentId: string,
): Promise<Postmortem> {
  const incident = await loadIncidentOrThrow(db, incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [existing] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.incidentId, incidentId))
    .limit(1);
  if (existing) return existing;

  const events = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.incidentId, incidentId))
    .orderBy(asc(timelineEvents.occurredAt));
  const authorById = await authorMapForIncident(db, incidentId);
  const markdownBody = buildStarterTemplate(incident, events, authorById);

  const [row] = await db
    .insert(postmortems)
    .values({ incidentId, markdownBody })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export async function findPostmortemByIdForUser(
  db: DB,
  userId: string,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) return null;

  const incident = await loadIncidentOrThrow(db, pm.incidentId);

  if (user.role !== 'admin') {
    const isMember =
      (
        await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(
            and(
              eq(teamMemberships.userId, userId),
              eq(teamMemberships.teamId, incident.teamId),
            ),
          )
          .limit(1)
      ).length > 0;
    if (!isMember) return null;
  }

  return { postmortem: pm, incident };
}

export async function findPostmortemForIncidentSlug(
  db: DB,
  userId: string,
  slug: string,
): Promise<{ postmortem: Postmortem; incident: Incident } | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.publicSlug, slug))
    .limit(1);
  if (!incident) return null;

  if (user.role !== 'admin') {
    const isMember =
      (
        await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(
            and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, incident.teamId)),
          )
          .limit(1)
      ).length > 0;
    if (!isMember) return null;
  }

  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.incidentId, incident.id))
    .limit(1);
  if (!pm) return null;

  return { postmortem: pm, incident };
}

export async function updatePostmortemMarkdown(
  db: DB,
  callerId: string,
  postmortemId: string,
  markdownBody: string,
): Promise<Postmortem> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) throw new Error('Postmortem not found');
  const incident = await loadIncidentOrThrow(db, pm.incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [updated] = await db
    .update(postmortems)
    .set({ markdownBody, updatedAt: new Date() })
    .where(eq(postmortems.id, postmortemId))
    .returning();
  if (!updated) throw new Error('Update returned no rows');
  return updated;
}

export async function publishPostmortem(
  db: DB,
  callerId: string,
  postmortemId: string,
): Promise<{ postmortem: Postmortem; incidentId: string }> {
  return db.transaction(async (tx) => {
    const [pm] = await tx
      .select()
      .from(postmortems)
      .where(eq(postmortems.id, postmortemId))
      .limit(1);
    if (!pm) throw new Error('Postmortem not found');
    const incident = await loadIncidentOrThrow(tx as unknown as DB, pm.incidentId);
    await requireTeamMember(tx as unknown as DB, callerId, incident.teamId);

    if (pm.status === 'published') {
      return { postmortem: pm, incidentId: incident.id };
    }

    const now = new Date();
    const [updated] = await tx
      .update(postmortems)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(eq(postmortems.id, postmortemId))
      .returning();
    if (!updated) throw new Error('Update returned no rows');

    const body = TimelineEventBodySchema.parse({
      kind: 'postmortem_link',
      postmortemId: updated.id,
    });
    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId: incident.id,
        authorUserId: callerId,
        kind: 'postmortem_link',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'postmortem_link',
      occurredAt: event.occurredAt.toISOString(),
    });

    return { postmortem: updated, incidentId: incident.id };
  });
}

export async function setPostmortemPublicVisibility(
  db: DB,
  callerId: string,
  postmortemId: string,
  publicOnStatusPage: boolean,
): Promise<Postmortem> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) throw new Error('Postmortem not found');
  const incident = await loadIncidentOrThrow(db, pm.incidentId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [updated] = await db
    .update(postmortems)
    .set({ publicOnStatusPage, updatedAt: new Date() })
    .where(eq(postmortems.id, postmortemId))
    .returning();
  if (!updated) throw new Error('Update returned no rows');
  return updated;
}
```

> **Why `publishPostmortem` returns `incidentId`:** the Server Action that calls it needs the incident id (or slug) to `revalidatePath` the war-room. We can also return the full incident if more callers need it later — for now `incidentId` suffices.

- [ ] **Step 4: Run the integration tests — should pass**

Run: `pnpm test tests/integration/postmortems.test.ts`
Expected: all 12 tests **PASS**.

If they don't, the most common failures are:
1. `requireTeamMember` not awaiting — re-read the file.
2. Missing `inArray` import — added in the final form above.
3. `useTestDb()` called outside `describe` — memory `eslint_react_hooks_rule_false_positive.md`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries/postmortems.ts tests/integration/postmortems.test.ts
git commit -m "$(cat <<'EOF'
feat(queries): postmortem CRUD + atomic publish

createDraftForIncident is idempotent (returns existing if one already
exists). updatePostmortemMarkdown is the autosave path. publishPostmortem
runs in a transaction: status→published, published_at→now, inserts a
postmortem_link timeline event, and pg_notifies the realtime channel —
all atomic so SSE viewers can't see "published" without seeing the event,
or vice-versa. setPostmortemPublicVisibility is a separate concern from
publish (per spec §6.4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Queries — action item CRUD

**Files:**
- Create: `src/lib/db/queries/action-items.ts`
- Create: `tests/integration/action-items.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/action-items.test.ts
import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { createDraftForIncident } from '@/lib/db/queries/postmortems';
import {
  listActionItemsForPostmortem,
  createActionItem,
  updateActionItem,
  deleteActionItem,
} from '@/lib/db/queries/action-items';
import { ForbiddenError } from '@/lib/authz';

describe('action item queries', () => {
  const ctx = useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let teamId: string;
  let postmortemId: string;

  beforeEach(async () => {
    alice = await provisionUserOnSignIn(ctx.db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });
    bob = await provisionUserOnSignIn(ctx.db, {
      email: 'bob@example.test',
      name: 'Bob',
      ssoSubject: 'sso-bob',
      adminEmails: [],
    });

    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Platform', slug: 'platform' })
      .returning();
    teamId = team!.id;
    await ctx.db
      .insert(teamMemberships)
      .values({ teamId, userId: alice.id, role: 'lead' });

    const [incident] = await ctx.db
      .insert(incidents)
      .values({
        publicSlug: 'inc-bbbb2222',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV3',
        title: 'Cache thrash',
        summary: 'redis evictions',
      })
      .returning();
    const pm = await createDraftForIncident(ctx.db, alice.id, incident!.id);
    postmortemId = pm.id;
  });

  test('createActionItem creates a row with defaults (status=open, no assignee)', async () => {
    const item = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 'Add backpressure to cache writes',
    });
    expect(item.title).toBe('Add backpressure to cache writes');
    expect(item.status).toBe('open');
    expect(item.assigneeUserId).toBeNull();
    expect(item.dueDate).toBeNull();
    expect(item.externalUrl).toBeNull();
  });

  test('createActionItem accepts assignee + due_date + url', async () => {
    const item = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 'Write integration test',
      assigneeUserId: alice.id,
      dueDate: '2026-05-15',
      externalUrl: 'https://linear.app/team/issue/PER-100',
    });
    expect(item.assigneeUserId).toBe(alice.id);
    expect(item.dueDate).toBe('2026-05-15');
    expect(item.externalUrl).toBe('https://linear.app/team/issue/PER-100');
  });

  test('createActionItem rejects non-team-member', async () => {
    await expect(
      createActionItem(ctx.db, bob.id, postmortemId, { title: 'nope' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('listActionItemsForPostmortem returns items in createdAt order', async () => {
    await createActionItem(ctx.db, alice.id, postmortemId, { title: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    await createActionItem(ctx.db, alice.id, postmortemId, { title: 'second' });
    const items = await listActionItemsForPostmortem(ctx.db, alice.id, postmortemId);
    expect(items.map((i) => i.title)).toEqual(['first', 'second']);
  });

  test('listActionItemsForPostmortem returns empty for non-team-member non-admin', async () => {
    await createActionItem(ctx.db, alice.id, postmortemId, { title: 'first' });
    const items = await listActionItemsForPostmortem(ctx.db, bob.id, postmortemId);
    expect(items).toEqual([]);
  });

  test('updateActionItem changes title + status + assignee', async () => {
    const created = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 'old',
    });
    const updated = await updateActionItem(ctx.db, alice.id, created.id, {
      title: 'new',
      status: 'in_progress',
      assigneeUserId: alice.id,
    });
    expect(updated.title).toBe('new');
    expect(updated.status).toBe('in_progress');
    expect(updated.assigneeUserId).toBe(alice.id);
  });

  test('updateActionItem can clear assignee + due_date + url with explicit nulls', async () => {
    const created = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 't',
      assigneeUserId: alice.id,
      dueDate: '2026-05-15',
      externalUrl: 'https://example.test/x',
    });
    const updated = await updateActionItem(ctx.db, alice.id, created.id, {
      assigneeUserId: null,
      dueDate: null,
      externalUrl: null,
    });
    expect(updated.assigneeUserId).toBeNull();
    expect(updated.dueDate).toBeNull();
    expect(updated.externalUrl).toBeNull();
  });

  test('updateActionItem rejects non-team-member', async () => {
    const created = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 't',
    });
    await expect(
      updateActionItem(ctx.db, bob.id, created.id, { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('deleteActionItem removes the row', async () => {
    const created = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 't',
    });
    await deleteActionItem(ctx.db, alice.id, created.id);
    const items = await listActionItemsForPostmortem(ctx.db, alice.id, postmortemId);
    expect(items).toEqual([]);
  });

  test('deleteActionItem rejects non-team-member', async () => {
    const created = await createActionItem(ctx.db, alice.id, postmortemId, {
      title: 't',
    });
    await expect(deleteActionItem(ctx.db, bob.id, created.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
```

- [ ] **Step 2: Run — should fail with module not found**

Run: `pnpm test tests/integration/action-items.test.ts`
Expected: **FAIL** — `Cannot find module '@/lib/db/queries/action-items'`.

- [ ] **Step 3: Write the queries module**

```ts
// src/lib/db/queries/action-items.ts
import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import {
  actionItems,
  type ActionItem,
  type ActionItemStatus,
} from '@/lib/db/schema/action-items';
import { postmortems } from '@/lib/db/schema/postmortems';
import { incidents, type Incident } from '@/lib/db/schema/incidents';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember } from '@/lib/authz';

async function loadIncidentForPostmortem(db: DB, postmortemId: string): Promise<Incident> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) throw new Error('Postmortem not found');
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, pm.incidentId))
    .limit(1);
  if (!incident) throw new Error('Incident not found');
  return incident;
}

async function loadIncidentForActionItem(db: DB, actionItemId: string): Promise<Incident> {
  const [item] = await db
    .select()
    .from(actionItems)
    .where(eq(actionItems.id, actionItemId))
    .limit(1);
  if (!item) throw new Error('Action item not found');
  return loadIncidentForPostmortem(db, item.postmortemId);
}

export async function listActionItemsForPostmortem(
  db: DB,
  userId: string,
  postmortemId: string,
): Promise<ActionItem[]> {
  const user = await findUserById(db, userId);
  if (!user) return [];
  let incident: Incident;
  try {
    incident = await loadIncidentForPostmortem(db, postmortemId);
  } catch {
    return [];
  }
  if (user.role !== 'admin') {
    const [m] = await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(
        and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, incident.teamId)),
      )
      .limit(1);
    if (!m) return [];
  }
  return db
    .select()
    .from(actionItems)
    .where(eq(actionItems.postmortemId, postmortemId))
    .orderBy(asc(actionItems.createdAt));
}

export interface CreateActionItemInput {
  title: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  externalUrl?: string | null;
}

export async function createActionItem(
  db: DB,
  callerId: string,
  postmortemId: string,
  input: CreateActionItemInput,
): Promise<ActionItem> {
  const incident = await loadIncidentForPostmortem(db, postmortemId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [row] = await db
    .insert(actionItems)
    .values({
      postmortemId,
      title: input.title,
      assigneeUserId: input.assigneeUserId ?? null,
      dueDate: input.dueDate ?? null,
      externalUrl: input.externalUrl ?? null,
    })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export interface UpdateActionItemInput {
  title?: string;
  status?: ActionItemStatus;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  externalUrl?: string | null;
}

export async function updateActionItem(
  db: DB,
  callerId: string,
  actionItemId: string,
  input: UpdateActionItemInput,
): Promise<ActionItem> {
  const incident = await loadIncidentForActionItem(db, actionItemId);
  await requireTeamMember(db, callerId, incident.teamId);

  const patch: Partial<typeof actionItems.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.status !== undefined) patch.status = input.status;
  if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.externalUrl !== undefined) patch.externalUrl = input.externalUrl;

  const [row] = await db
    .update(actionItems)
    .set(patch)
    .where(eq(actionItems.id, actionItemId))
    .returning();
  if (!row) throw new Error('Update returned no rows');
  return row;
}

export async function deleteActionItem(
  db: DB,
  callerId: string,
  actionItemId: string,
): Promise<void> {
  const incident = await loadIncidentForActionItem(db, actionItemId);
  await requireTeamMember(db, callerId, incident.teamId);

  await db.delete(actionItems).where(eq(actionItems.id, actionItemId));
}
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm test tests/integration/action-items.test.ts`
Expected: all 10 tests **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries/action-items.ts tests/integration/action-items.test.ts
git commit -m "$(cat <<'EOF'
feat(queries): action item CRUD scoped to postmortem

list/create/update/delete with team-membership authz (admin bypass).
Update accepts explicit-null on assignee / due_date / external_url so
the UI can clear them. Date column is string-shaped (YYYY-MM-DD), no
JS Date round-trip — matches <input type=date> directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: API route — `POST /api/postmortems/[id]` autosave

**Files:**
- Create: `src/app/api/postmortems/[id]/route.ts`

> **Why a route, not a Server Action:** spec §8.3 explicitly puts autosave on `POST /api/postmortems/[id]` so the client can fire the request without a `<form>` round-trip and parse `{ updatedAt }` from JSON. Server Actions are POST-able too but force a re-render cycle; we want the lightest possible debounce path here.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/postmortems/[id]/route.ts
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  findPostmortemByIdForUser,
  updatePostmortemMarkdown,
} from '@/lib/db/queries/postmortems';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  markdownBody: z.string().max(200_000),
});

const IdSchema = z.string().uuid();

export async function POST(request: Request, ctx: RouteCtx): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return new Response('Bad id', { status: 400 });

  // Authorization: load via the user-scoped finder. Returns null both for
  // non-existent and unauthorized — the 404 leaks no information either way.
  const found = await findPostmortemByIdForUser(db, session.user.id, id);
  if (!found) return new Response('Not found', { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 422 });
  }

  const updated = await updatePostmortemMarkdown(
    db,
    session.user.id,
    id,
    parsed.data.markdownBody,
  );

  return Response.json({ updatedAt: updated.updatedAt.toISOString() });
}
```

- [ ] **Step 2: Smoke-test by hand**

Start the dev server:

Run: `pnpm dev`

Sign in via Google (or use an existing session). Open the browser devtools network tab and run:

```js
await fetch('/api/postmortems/<some-real-postmortem-id>', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ markdownBody: '## Summary\nhello' }),
}).then(r => r.json());
```

Expected: `{ updatedAt: "2026-04-29T..." }`. If you get 404, the postmortem id doesn't belong to the signed-in user's team. If 401, the session cookie isn't being sent (rare in same-origin fetch).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/postmortems/[id]/route.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /api/postmortems/[id] for autosave

Node runtime, NextAuth-gated, zod-validated body, returns { updatedAt }.
Authorization uses findPostmortemByIdForUser (returns null for
non-existent OR unauthorized — same 404 either way, no enumeration leak).
Per spec §8.3, this is the dedicated autosave endpoint; lower-frequency
state changes (publish, visibility, action items) go through Server
Actions instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Server Actions for the postmortem page

**Files:**
- Create: `src/app/(app)/incidents/[slug]/postmortem/actions.ts`

> **Authorization model:** every action calls `auth()`, then funnels through the user-scoped finder (`findIncident…ForUser` / `findPostmortem…ForUser`) before the mutation. The mutations themselves re-call `requireTeamMember` — defense in depth. UI gating is courtesy.

- [ ] **Step 1: Write the actions file**

```ts
// src/app/(app)/incidents/[slug]/postmortem/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import {
  createDraftForIncident,
  findPostmortemByIdForUser,
  publishPostmortem,
  setPostmortemPublicVisibility,
} from '@/lib/db/queries/postmortems';
import {
  createActionItem,
  deleteActionItem,
  updateActionItem,
} from '@/lib/db/queries/action-items';
import { ACTION_ITEM_STATUS_VALUES } from '@/lib/db/schema/action-items';

async function requireSessionUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session.user.id;
}

export async function createDraftAction(slug: string): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findIncidentBySlugForUser(db, userId, slug);
  if (!found) throw new Error('Incident not found');
  await createDraftForIncident(db, userId, found.incident.id);
  revalidatePath(`/incidents/${slug}`);
  revalidatePath(`/incidents/${slug}/postmortem`);
  redirect(`/incidents/${slug}/postmortem`);
}

export async function publishAction(postmortemId: string, slug: string): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findPostmortemByIdForUser(db, userId, postmortemId);
  if (!found) throw new Error('Postmortem not found');
  await publishPostmortem(db, userId, postmortemId);
  revalidatePath(`/incidents/${slug}`);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

export async function setVisibilityAction(
  postmortemId: string,
  slug: string,
  publicOnStatusPage: boolean,
): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findPostmortemByIdForUser(db, userId, postmortemId);
  if (!found) throw new Error('Postmortem not found');
  await setPostmortemPublicVisibility(db, userId, postmortemId, publicOnStatusPage);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

const CreateActionItemSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  externalUrl: z.string().url().max(500).nullable().optional(),
});

export async function createActionItemAction(
  postmortemId: string,
  slug: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findPostmortemByIdForUser(db, userId, postmortemId);
  if (!found) throw new Error('Postmortem not found');

  const raw = {
    title: formData.get('title'),
    assigneeUserId: formData.get('assigneeUserId') || null,
    dueDate: formData.get('dueDate') || null,
    externalUrl: formData.get('externalUrl') || null,
  };
  const parsed = CreateActionItemSchema.parse(raw);
  await createActionItem(db, userId, postmortemId, parsed);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

const UpdateActionItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(ACTION_ITEM_STATUS_VALUES).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  externalUrl: z.string().url().max(500).nullable().optional(),
});

export async function updateActionItemAction(
  actionItemId: string,
  slug: string,
  patch: z.infer<typeof UpdateActionItemSchema>,
): Promise<void> {
  const userId = await requireSessionUserId();
  // We can't load the postmortem from action item id without an extra query,
  // so let updateActionItem enforce — it does its own requireTeamMember.
  const validated = UpdateActionItemSchema.parse(patch);
  await updateActionItem(db, userId, actionItemId, validated);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

export async function deleteActionItemAction(
  actionItemId: string,
  slug: string,
): Promise<void> {
  const userId = await requireSessionUserId();
  await deleteActionItem(db, userId, actionItemId);
  revalidatePath(`/incidents/${slug}/postmortem`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/incidents/[slug]/postmortem/actions.ts
git commit -m "$(cat <<'EOF'
feat(actions): postmortem + action item Server Actions

createDraftAction / publishAction / setVisibilityAction wrap the
postmortem queries with auth + revalidatePath. Action item actions
parse FormData (create) or a zod-validated patch (update). Authorization
is enforced both at the action boundary (findIncidentBySlugForUser /
findPostmortemByIdForUser) and inside each query (requireTeamMember) —
defense in depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Postmortem editor page (server) + war-room PostmortemTrigger

**Files:**
- Create: `src/app/(app)/incidents/[slug]/postmortem/page.tsx`
- Create: `src/app/(app)/incidents/[slug]/_components/PostmortemTrigger.tsx`
- Modify: `src/app/(app)/incidents/[slug]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/incidents/[slug]/postmortem/page.tsx
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findPostmortemForIncidentSlug } from '@/lib/db/queries/postmortems';
import { listActionItemsForPostmortem } from '@/lib/db/queries/action-items';
import { listTeamMembersWithUsers } from '@/lib/db/queries/teams';
import { PostmortemEditor } from './_components/PostmortemEditor';
import { ActionItemsRail } from './_components/ActionItemsRail';
import { setVisibilityAction, publishAction } from './actions';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function PostmortemPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { slug } = await params;
  const found = await findPostmortemForIncidentSlug(db, session.user.id, slug);
  if (!found) notFound();

  const { postmortem, incident } = found;
  const [actionItems, teamMembers] = await Promise.all([
    listActionItemsForPostmortem(db, session.user.id, postmortem.id),
    listTeamMembersWithUsers(db, incident.teamId),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        <header className="mb-4 flex items-center gap-3">
          <span className="rounded bg-zinc-200 px-2 py-1 text-xs font-medium dark:bg-zinc-800">
            {postmortem.status}
          </span>
          <h1 className="text-2xl font-semibold">Postmortem — {incident.title}</h1>
        </header>

        <PostmortemEditor
          postmortemId={postmortem.id}
          initialMarkdown={postmortem.markdownBody}
          initialUpdatedAtIso={postmortem.updatedAt.toISOString()}
        />

        <div className="mt-6 flex items-center gap-3">
          {postmortem.status === 'draft' ? (
            <form action={publishAction.bind(null, postmortem.id, slug)}>
              <button
                type="submit"
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Publish
              </button>
            </form>
          ) : (
            <span className="text-sm text-zinc-500">
              Published {postmortem.publishedAt?.toISOString()}
            </span>
          )}

          <form
            action={setVisibilityAction.bind(
              null,
              postmortem.id,
              slug,
              !postmortem.publicOnStatusPage,
            )}
          >
            <button
              type="submit"
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {postmortem.publicOnStatusPage ? 'Hide from /status' : 'Show on /status'}
            </button>
          </form>
        </div>
      </section>

      <aside>
        <ActionItemsRail
          postmortemId={postmortem.id}
          slug={slug}
          items={actionItems}
          teamMembers={teamMembers.map((m) => ({ id: m.userId, name: m.user.name }))}
        />
      </aside>
    </div>
  );
}
```

> **`listTeamMembersWithUsers` already exists** — it was added in Plan 3 (`src/lib/db/queries/teams.ts`). Verify the shape — if the field name differs, adjust the `.map((m) => ({ id: m.userId, name: m.user.name }))` line accordingly. Open the file to confirm before running.

- [ ] **Step 2: Write the trigger**

```tsx
// src/app/(app)/incidents/[slug]/_components/PostmortemTrigger.tsx
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { findPostmortemForIncidentSlug } from '@/lib/db/queries/postmortems';
import { auth } from '@/lib/auth';
import { createDraftAction } from '../postmortem/actions';

interface Props {
  slug: string;
}

export async function PostmortemTrigger({ slug }: Props) {
  const session = await auth();
  if (!session?.user) return null;
  const found = await findPostmortemForIncidentSlug(db, session.user.id, slug);

  if (found) {
    return (
      <Link
        href={`/incidents/${slug}/postmortem`}
        className="block rounded border px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        Postmortem ({found.postmortem.status})
      </Link>
    );
  }
  return (
    <form action={createDraftAction.bind(null, slug)}>
      <button
        type="submit"
        className="block w-full rounded border px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        + Start postmortem
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Mount the trigger on the war-room**

Open `src/app/(app)/incidents/[slug]/page.tsx`. In the right rail (the column that already holds `RolePickers` / `StatusControl` / `SeverityControl` from Plan 3), add a section. The exact placement depends on the current JSX — search for the right-rail container (likely an `<aside>` or `grid-cols` section) and add at the bottom:

```tsx
import { PostmortemTrigger } from './_components/PostmortemTrigger';

// … inside the right rail, after the role pickers block:
<section>
  <h2 className="mb-2 text-sm font-medium text-zinc-500">Postmortem</h2>
  <PostmortemTrigger slug={slug} />
</section>
```

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`. Sign in. Open `/incidents/<some-slug>`. The right rail should show "+ Start postmortem". Click it → page redirects to `/incidents/<slug>/postmortem`, draft created, editor visible with starter template populated and a Publish button below.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**. The editor + rail components don't exist yet — they're stubbed in the page. To compile, write minimal stubs **inline** in this commit (real implementations come in Tasks 10-11):

```tsx
// src/app/(app)/incidents/[slug]/postmortem/_components/PostmortemEditor.tsx (stub)
'use client';
interface Props {
  postmortemId: string;
  initialMarkdown: string;
  initialUpdatedAtIso: string;
}
export function PostmortemEditor({ initialMarkdown }: Props) {
  return <textarea defaultValue={initialMarkdown} className="h-96 w-full" />;
}
```

```tsx
// src/app/(app)/incidents/[slug]/postmortem/_components/ActionItemsRail.tsx (stub)
'use client';
interface Props {
  postmortemId: string;
  slug: string;
  items: { id: string; title: string }[];
  teamMembers: { id: string; name: string | null }[];
}
export function ActionItemsRail({ items }: Props) {
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>{i.title}</li>
      ))}
    </ul>
  );
}
```

This lets the project compile and the smoke-test work end-to-end before Tasks 10/11 polish.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/incidents/[slug]/postmortem/page.tsx \
        src/app/(app)/incidents/[slug]/postmortem/_components/PostmortemEditor.tsx \
        src/app/(app)/incidents/[slug]/postmortem/_components/ActionItemsRail.tsx \
        src/app/(app)/incidents/[slug]/_components/PostmortemTrigger.tsx \
        src/app/(app)/incidents/[slug]/page.tsx
git commit -m "$(cat <<'EOF'
feat(ui): postmortem editor page + war-room trigger

Server-rendered page composes the editor + action items rail with auth
+ findPostmortemForIncidentSlug. Publish + visibility controls are
plain forms binding Server Actions. War-room right rail gets a new
section linking to the existing postmortem or creating a draft on
click. Editor + rail components are stubbed here; full versions land
in Tasks 10-11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: PostmortemEditor — debounced autosave + status indicator

**Files:**
- Modify: `src/app/(app)/incidents/[slug]/postmortem/_components/PostmortemEditor.tsx`

- [ ] **Step 1: Replace the stub with the real component**

```tsx
// src/app/(app)/incidents/[slug]/postmortem/_components/PostmortemEditor.tsx
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
    statusColor = 'text-zinc-500';
  } else if (status.kind === 'error') {
    statusLabel = `⚠ ${status.message}`;
    statusColor = 'text-amber-600';
  } else if (status.kind === 'saved') {
    statusLabel = `saved ${timeAgo(status.atIso, now)}`;
    statusColor = 'text-emerald-600';
  } else {
    statusLabel = `saved ${timeAgo(status.lastSavedAtIso, now)}`;
    statusColor = 'text-zinc-500';
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[60vh] w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
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
            className="rounded border px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            retry now
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

> **No timer-leaks:** `useEffect` returns clean up the interval; `timerRef` is cleared in the `beforeunload` handler. The `inflightRef` is aborted before each new flush so we never apply a stale 200 over a fresh 200.
> **`useEffect` ordering:** memory `react_hooks_purity_set_state_in_effect.md` — we never call `setState` synchronously inside `useEffect` body; the tick effect uses `setInterval` callback (in event scope), which is fine.

- [ ] **Step 2: Manual smoke (the only meaningful test for this component in v1)**

Run: `pnpm dev`. Open `/incidents/<slug>/postmortem`. Type into the textarea. Wait ~1 second. Status flips: `saving…` → `saved just now`. Tick: `saved 5s ago`, then `12s ago`, etc. Disconnect network (devtools → throttling → Offline) and type → status flips to `⚠ Failed to fetch` → click `retry now` → still errors. Bring network back → next change saves cleanly.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/incidents/[slug]/postmortem/_components/PostmortemEditor.tsx
git commit -m "$(cat <<'EOF'
feat(ui): PostmortemEditor with 800ms debounced autosave

Single textarea, fetch POST to /api/postmortems/[id], three-state
indicator (saved Xs ago / saving… / ⚠ retry). beforeunload uses
keepalive to flush pending changes. AbortController cancels stale
in-flight requests so a fast typer never sees a saved-but-stale
state. No optimistic UI for the body itself — autosave is the
contract; the user sees the round-trip succeed before "saved" lights up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: ActionItemsRail — add / edit / delete

**Files:**
- Modify: `src/app/(app)/incidents/[slug]/postmortem/_components/ActionItemsRail.tsx`

- [ ] **Step 1: Replace the stub with the real component**

```tsx
// src/app/(app)/incidents/[slug]/postmortem/_components/ActionItemsRail.tsx
'use client';

import { useState, useTransition } from 'react';
import {
  createActionItemAction,
  deleteActionItemAction,
  updateActionItemAction,
} from '../actions';
import type { ActionItem, ActionItemStatus } from '@/lib/db/schema/action-items';
import { ACTION_ITEM_STATUS_VALUES } from '@/lib/db/schema/action-items';

interface TeamMember {
  id: string;
  name: string | null;
}

interface Props {
  postmortemId: string;
  slug: string;
  items: ActionItem[];
  teamMembers: TeamMember[];
}

export function ActionItemsRail({ postmortemId, slug, items, teamMembers }: Props) {
  const [pending, startTransition] = useTransition();
  const [draftTitle, setDraftTitle] = useState('');

  const onAdd = (formData: FormData) => {
    startTransition(async () => {
      await createActionItemAction(postmortemId, slug, formData);
      setDraftTitle('');
    });
  };

  return (
    <section className="rounded border p-3">
      <h2 className="mb-2 text-sm font-medium text-zinc-500">Action items</h2>

      <form
        action={onAdd}
        className="mb-3 flex flex-col gap-2"
      >
        <input
          name="title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="New action item"
          className="rounded border px-2 py-1 text-sm"
          required
          maxLength={200}
        />
        <div className="flex gap-2">
          <select
            name="assigneeUserId"
            defaultValue=""
            className="flex-1 rounded border px-2 py-1 text-sm"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? '(no name)'}
              </option>
            ))}
          </select>
          <input
            name="dueDate"
            type="date"
            className="rounded border px-2 py-1 text-sm"
          />
        </div>
        <input
          name="externalUrl"
          type="url"
          placeholder="https://linear.app/…"
          className="rounded border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending || draftTitle.length === 0}
          className="self-start rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? 'Adding…' : '+ Add'}
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ActionItemRow
            key={item.id}
            item={item}
            slug={slug}
            teamMembers={teamMembers}
          />
        ))}
        {items.length === 0 ? (
          <li className="text-xs text-zinc-500">No action items yet.</li>
        ) : null}
      </ul>
    </section>
  );
}

function ActionItemRow({
  item,
  slug,
  teamMembers,
}: {
  item: ActionItem;
  slug: string;
  teamMembers: TeamMember[];
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const update = (patch: Parameters<typeof updateActionItemAction>[2]) => {
    startTransition(async () => {
      await updateActionItemAction(item.id, slug, patch);
    });
  };

  const onDelete = () => {
    if (!confirm('Delete this action item?')) return;
    startTransition(async () => {
      await deleteActionItemAction(item.id, slug);
    });
  };

  if (!editing) {
    return (
      <li className="rounded border p-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="font-medium">{item.title}</div>
            <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-zinc-500">
              <span>
                Status:{' '}
                <select
                  value={item.status}
                  disabled={pending}
                  onChange={(e) => update({ status: e.target.value as ActionItemStatus })}
                  className="rounded border px-1 py-0.5"
                >
                  {ACTION_ITEM_STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </span>
              {item.assigneeUserId ? (
                <span>
                  Assignee:{' '}
                  {teamMembers.find((m) => m.id === item.assigneeUserId)?.name ?? '(removed)'}
                </span>
              ) : null}
              {item.dueDate ? <span>Due: {item.dueDate}</span> : null}
              {item.externalUrl ? (
                <a
                  href={item.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  link
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border px-2 py-0.5 text-xs"
            >
              edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded border px-2 py-0.5 text-xs text-red-600"
            >
              delete
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded border p-2 text-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          update({
            title: String(fd.get('title') ?? ''),
            assigneeUserId: (fd.get('assigneeUserId') as string) || null,
            dueDate: (fd.get('dueDate') as string) || null,
            externalUrl: (fd.get('externalUrl') as string) || null,
          });
          setEditing(false);
        }}
        className="flex flex-col gap-2"
      >
        <input
          name="title"
          defaultValue={item.title}
          className="rounded border px-2 py-1"
          required
          maxLength={200}
        />
        <div className="flex gap-2">
          <select
            name="assigneeUserId"
            defaultValue={item.assigneeUserId ?? ''}
            className="flex-1 rounded border px-2 py-1"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? '(no name)'}
              </option>
            ))}
          </select>
          <input
            name="dueDate"
            type="date"
            defaultValue={item.dueDate ?? ''}
            className="rounded border px-2 py-1"
          />
        </div>
        <input
          name="externalUrl"
          type="url"
          defaultValue={item.externalUrl ?? ''}
          placeholder="https://…"
          className="rounded border px-2 py-1"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded border px-3 py-1"
          >
            cancel
          </button>
        </div>
      </form>
    </li>
  );
}
```

> **No optimistic UI:** the rail re-renders after each Server Action via `revalidatePath`. That's fine for this surface — action items are edited rarely, and "saved" is implicit when the row repaints. Notes had to be optimistic because they're typed during a live incident; action items aren't.

- [ ] **Step 2: Manual smoke**

Run: `pnpm dev`. On `/incidents/<slug>/postmortem`, type a title in the rail's input and submit → row appears in the list. Click `edit` → form replaces row. Change title and assignee → click `save` → row updates. Click `delete` → confirm → row vanishes. Refresh the page → state persists.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/incidents/[slug]/postmortem/_components/ActionItemsRail.tsx
git commit -m "$(cat <<'EOF'
feat(ui): ActionItemsRail — add / inline-edit / delete

Add form posts to createActionItemAction. Each row is read-only by
default; "edit" flips to inline form bound to updateActionItemAction.
Status select on the read view is one-click (disabled while pending),
since "open → in_progress" is the most common edit. Native confirm()
gates delete. No optimistic UI — revalidatePath gives us correct state
without the complexity (action items aren't edited under live-incident
pressure the way notes are).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Render postmortem_link in the war-room timeline + render-list update

**Files:**
- Modify: `src/app/(app)/incidents/[slug]/_components/Timeline.tsx`

The war-room timeline streams the new `postmortem_link` event but currently has no render branch for it.

- [ ] **Step 1: Find the kind switch**

Open `src/app/(app)/incidents/[slug]/_components/Timeline.tsx`. Find the function that maps `event.kind` to JSX (likely a `switch` or chain of `if (event.kind === ...) return ...`).

- [ ] **Step 2: Add the new branch**

Add (in the same style as the existing branches):

```tsx
if (event.kind === 'postmortem_link') {
  return (
    <li key={event.id} className="flex items-baseline gap-2 text-sm">
      <time className="font-mono text-xs text-zinc-500">
        {event.occurredAt.toISOString().slice(11, 19)}
      </time>
      <span>
        <span aria-hidden>📝 </span>
        Postmortem published
      </span>
    </li>
  );
}
```

> Match the surrounding style — if other branches use a different time format or icon convention, follow that. The above is a minimum; do not invent additional UI here.

- [ ] **Step 3: Verify the IncidentLiveProvider doesn't trip**

Open `src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx` (or wherever the SSE consumer lives). Check whether it has a kind-specific branch. If it just spreads the wire payload into the timeline list, no change needed. If it filters by kind, add `'postmortem_link'` to the allowed set.

- [ ] **Step 4: Manual smoke (full publish round-trip)**

Run: `pnpm dev`. Open `/incidents/<slug>` in tab A. Open `/incidents/<slug>/postmortem` in tab B. In tab B, click `Publish`. In tab A, the timeline should show "Postmortem published" within ~1 second (no manual refresh).

If it doesn't appear: check the browser console of tab A for the SSE event. The dispatcher resolves `authorName` for any `authorUserId` (so the publish caller's name should be available even though the render doesn't show it yet). If the event arrives but isn't rendered, the kind branch above isn't matching — log `event.kind` to confirm.

- [ ] **Step 5: Run the full integration suite**

Run: `pnpm test`
Expected: all tests still **PASS** (the new postmortem + action-items tests bring the count up; should be ~145+ if the math checks out).

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/incidents/[slug]/_components/Timeline.tsx
git commit -m "$(cat <<'EOF'
feat(ui): render postmortem_link timeline events in war-room

Closes the Plan 5 SSE round-trip — publishing a postmortem now flips
the badge AND lands a "Postmortem published" row in any open war-room
tab. No optimistic UI for this one (publish is a state change, not a
note).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/GUARDRAILS.md`

- [ ] **Step 1: Append Plan 5 entry to CLAUDE.md update history**

Open `CLAUDE.md`. In the `## Update history` section at the bottom, add (after the Plan 4 line):

```markdown
- 2026-04-29: **Plan 5 (Postmortems + action items) implemented**. New `postmortems` and `action_items` tables (migration 0005). New `postmortem_link` timeline event kind (one-line ALTER TYPE) with body schema variant. Six postmortem queries (`createDraftForIncident`, `findPostmortemByIdForUser`, `findPostmortemForIncidentSlug`, `updatePostmortemMarkdown`, `publishPostmortem` (transactional + emits `postmortem_link` event + pg_notify), `setPostmortemPublicVisibility`). Four action item queries with team-member authz. New API route `POST /api/postmortems/[id]` for autosave (zod-validated, 200 KB cap). Six Server Actions for the editor page. Editor at `/incidents/[slug]/postmortem`: starter template (Summary / Timeline / Root cause / What went well / What didn't), 800ms debounced autosave with three-state indicator, action items rail with inline edit, draft→published flow, separate "show on /status" toggle. War-room right rail gets a PostmortemTrigger; timeline renders the new event kind. Test count climbed from 128 to N (12 new postmortem integration + 10 new action-item integration + 6 new unit tests for the template + 3 new body-schema tests).
```

- [ ] **Step 2: Update the GUARDRAILS table**

Open `.claude/GUARDRAILS.md`. Add a row after the realtime row (the one starting with `Realtime — src/lib/realtime/*`):

```markdown
| Postmortems — `src/lib/db/schema/postmortems.ts`, `src/lib/db/schema/action-items.ts`, `src/lib/db/queries/postmortems.ts`, `src/lib/db/queries/action-items.ts`, `src/lib/postmortems/template.ts`, `src/app/api/postmortems/[id]/route.ts`, `src/app/(app)/incidents/[slug]/postmortem/**` | spec §4.1 + §6.4 + §8.3 + `2026-04-29-postmortems.md` plan | One postmortem per incident (unique on incident_id). `publishPostmortem` is the only place that emits the `postmortem_link` timeline event — runs in a `db.transaction(...)` with `notifyIncidentUpdate`. Autosave goes over `POST /api/postmortems/[id]`, NOT a Server Action — keep it that way (per spec §8.3). Publish vs `public_on_status_page` are independent flags. Action item `dueDate` is string-shaped (YYYY-MM-DD), no JS Date round-trip. |
```

Update the "Last revision" line at the top:

```markdown
**Last revision**: 2026-04-29 (after Plan 5 merge)
```

- [ ] **Step 3: Final test run**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .claude/GUARDRAILS.md
git commit -m "$(cat <<'EOF'
docs: log Plan 5 — postmortems + action items

Update history entry + new GUARDRAILS row covering the postmortems +
action-items modules, the autosave route, and the postmortem_link
timeline kind. Last-revision bumped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (run after the plan is fully executed)

1. **Spec coverage check:**
   - [ ] §4.1 Postmortem entity — table + columns match (id, incident_id unique, markdown_body, status enum, published_at, public_on_status_page, updated_at). `created_at` added (not in spec but standard).
   - [ ] §4.1 ActionItem entity — table + columns match (id, postmortem_id, assignee_user_id, title, status enum, due_date, external_url, created_at). `updated_at` added (standard).
   - [ ] §5.1 Route `/incidents/[slug]/postmortem` — page.tsx exists, server-rendered.
   - [ ] §6.4 Postmortem editor sections — Summary, Timeline (auto-imported, editable), Root cause, What went well, What didn't — emitted by `buildStarterTemplate`.
   - [ ] §6.4 Right rail action items + Publish + visibility toggle — present in page.tsx.
   - [ ] §6.4 Inline status `saved Xs ago` / `⚠ retry` — implemented in PostmortemEditor.
   - [ ] §8.3 Debounce 800ms + POST /api/postmortems/[id] + keepalive on unload — all present.
   - [ ] §8.5 zod at boundaries — body schema, action input schemas, route body schema all zod-validated.
   - [ ] Timeline kind `postmortem_link` — added (§4.1).

2. **Authorization:**
   - [ ] Every query that takes `userId` calls `requireTeamMember` OR branches on `user.role === 'admin'`. Verified in postmortems.ts and action-items.ts.
   - [ ] API route does `findPostmortemByIdForUser` before mutation.
   - [ ] Server Actions all start with `requireSessionUserId()` and re-call user-scoped finders.

3. **Transactional integrity:**
   - [ ] `publishPostmortem` uses `db.transaction(async (tx) => …)`, inserts the timeline event in the same tx as the update, calls `notifyIncidentUpdate(tx, …)` so `pg_notify` queues until commit. ✓

4. **Strict-mode + Drizzle:**
   - [ ] Every `.returning()` is followed by `if (!row) throw new Error(...);`. ✓ (spot-check all 6 places)
   - [ ] `inArray` used for batch user-name fetch (no N+1).

5. **Test coverage:**
   - [ ] Unit: `tests/unit/postmortem-template.test.ts` (5+ tests), `tests/unit/timeline-body.test.ts` (+3 cases for `postmortem_link`).
   - [ ] Integration: `tests/integration/postmortems.test.ts` (12 tests), `tests/integration/action-items.test.ts` (10 tests).
   - [ ] Truncation list updated in `tests/setup/withTx.ts`.

6. **No placeholders or "TBD":** scan the plan — every code block is real, every step is concrete. ✓

---

## Deferred to v1.1 (not part of this plan)

- **Resolved-required-before-publish guard.** Spec doesn't require it; not enforced. Add later if a real user publishes a postmortem on a still-open incident and regrets it.
- **Action item `external_url` validation against domain allow-list.** Today any URL is accepted. Could later restrict to linear.app / atlassian.net etc.
- **Multiple postmortems per incident.** Spec is 1:1 (unique on incident_id). If retros need iteration history, model later.
- **Postmortem visibility on /status page.** Plan 5 stores the flag; Plan 7 (status page) consumes it.
- **OTel traces around publish + autosave.** Spec §8.6 mentions traces per Server Action; we don't add them here. Plan 11 (polish/observability) wires it up.
- **Autosave conflict resolution.** Last-write-wins. Two tabs editing the same postmortem will clobber each other silently.
- **`useFormState` migration for action item forms.** Same pattern as the rest of the app today (`throw new Error` falls through to `error.tsx`); migrating to `{ ok, errors }` is a separate cross-cutting refactor (see `foundation_followups.md`).
