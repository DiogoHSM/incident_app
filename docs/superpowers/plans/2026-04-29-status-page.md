# Plan 7 — Public status page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the unauthenticated `/status` family — `/status` (org), `/status/[teamSlug]` (team), `/status/incidents/[slug]` (single incident), `/status/postmortems/[id]` (public postmortem read view), `/status/maintenance` (static fallback) — backed by a denormalized `status_snapshots` table that mutations refresh atomically. Add a war-room "Post update to /status" action that emits a new `status_update_published` timeline event.

**Architecture:** A new `status_snapshots` table is keyed by scope (`'public'` or `'team:<uuid>'`), payload validated by `StatusSnapshotPayloadSchema`. Every incident state change (`declareIncident`, `changeIncidentStatus`, `dismissTriagingIncident`, `postPublicStatusUpdate`) calls `recomputeAllSnapshotsForTeam(tx, teamId)` inside the same `db.transaction(...)` so the snapshot is fresh on commit. Public pages use Next 16 ISR (`export const revalidate = 15;`) reading directly from the snapshot — DB hit only on cache miss. A new `pg_notify('status_snapshot_updated', ...)` channel is fired alongside `incident_updates` so a future Plan 9+ deployment can wire `revalidatePath('/status')` from a long-lived listener; v1 relies on the 15 s ISR cap. War-room gets a `PublicUpdateForm` (gated to IC/Scribe/Comms/admin) that funnels through a Server Action calling the new `postPublicStatusUpdate` mutation, which atomically writes the timeline event + recomputes snapshots + double-notifies (incident channel + snapshot channel).

**Tech Stack:** Next.js 16 App Router (ISR `revalidate=15`) · TypeScript strict + `noUncheckedIndexedAccess` · Drizzle ORM 0.45 + Postgres 16 · NextAuth v5 (public routes bypass middleware) · zod · Vitest 4 + testcontainers.

**Plan 6 dependency assumption:** Plan 7 amends `dismissTriagingIncident` (Plan 6 — triage promote/dismiss) by adding a `recomputeAllSnapshotsForTeam(tx, ...)` call inside its transaction. **This plan assumes Plan 6 has been merged before Task 7 runs.** If Plan 6 has not yet shipped when Task 7 begins, skip the `dismissTriagingIncident` amendment in Step 4 and add a note to `.claude/memory/foundation_followups.md` flagging "Plan 7 → Plan 6 hook deferred"; revisit after Plan 6 lands. The other amendments (`changeIncidentStatus`, `declareIncident`) target Plan 2/3 code that already exists.

**Out of scope (defer):**
- Real-time `revalidatePath('/status')` from a listener — Plan 9+. v1 is ISR-only at 15 s.
- Per-day worst-severity heatmap precomputation as a materialized view — too granular for v1; computed inside `recomputeAndPersistSnapshot`.
- `attachment` and `webhook` timeline kinds — owned by future plans.
- Optimistic UI for the `PublicUpdateForm` — public updates are not optimistic per spec §8.1 (status/severity/role mutations and now public updates require server confirmation).
- Public route Playwright e2e tests — Plan 11.

**Commit trailer (mandatory on every commit):**
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File map

**Created:**

- `src/lib/db/schema/status-snapshots.ts` — `statusSnapshots` table.
- `src/lib/status/payload.ts` — `StatusSnapshotPayloadSchema` (zod) + `StatusSnapshotPayload` type.
- `src/lib/status/snapshot.ts` — pure builders: `serviceStatusFromActive`, `worstSeverityFromIncidents`, `buildPublicSnapshot`, `buildTeamSnapshot`.
- `src/lib/status/uptime.ts` — `compute30dUptime(serviceId, db, now)` helper + the supporting reader.
- `src/lib/db/queries/status-snapshot.ts` — `readSnapshotForScope`, `recomputeAndPersistSnapshot`, `recomputeAllSnapshotsForTeam`, `listPublicPostmortems`, `findPublicPostmortemById`.
- `src/lib/db/queries/status-page.ts` — `findPublicIncidentBySlug` (no auth, returns minimal shape with `status_update_published` events only).
- `src/lib/realtime/notify-snapshot.ts` — `notifySnapshotUpdated(tx, scope)`.
- `src/app/(public)/layout.tsx` — public layout (brand line + footer, no app chrome).
- `src/app/(public)/status/page.tsx` — org-wide page (ISR 15 s).
- `src/app/(public)/status/[teamSlug]/page.tsx` — team-scoped page (ISR 15 s).
- `src/app/(public)/status/incidents/[slug]/page.tsx` — single public incident page.
- `src/app/(public)/status/postmortems/[id]/page.tsx` — public postmortem read-only view.
- `src/app/(public)/status/maintenance/page.tsx` — static fallback.
- `src/app/(public)/status/_components/StatusBanner.tsx` — green/yellow/red banner.
- `src/app/(public)/status/_components/ServicesTable.tsx` — service rows with uptime%.
- `src/app/(public)/status/_components/SevenDayBars.tsx` — 7-bar heatmap.
- `src/app/(public)/status/_components/ActiveIncidentCard.tsx` — public-update-only timeline cards.
- `src/app/(public)/status/_components/PostmortemList.tsx` — published-and-public list.
- `src/app/(app)/incidents/[slug]/_components/PublicUpdateForm.tsx` — IC/Scribe/Comms/admin-gated update form.
- `drizzle/0007_<auto-name>.sql` — generated migration: `status_snapshots` table + `ALTER TYPE timeline_event_kind ADD VALUE 'status_update_published'`.
- `tests/unit/status-snapshot-builders.test.ts` — builder golden tests.
- `tests/unit/status-uptime.test.ts` — `compute30dUptime` golden tests.
- `tests/integration/status-snapshot.test.ts` — read/recompute/persist + recomputeAllForTeam.
- `tests/integration/status-public-update.test.ts` — `postPublicStatusUpdate` authz + atomicity.
- `tests/integration/status-snapshot-hooks.test.ts` — verifies `changeIncidentStatus` + `declareIncident` + (when present) `dismissTriagingIncident` recompute snapshots inside their transactions.

**Modified:**

- `src/lib/db/schema/timeline.ts` — append `'status_update_published'` to `TIMELINE_EVENT_KIND_VALUES`.
- `src/lib/db/schema/index.ts` — export `status-snapshots`.
- `src/lib/timeline/body.ts` — add `StatusUpdatePublishedBody` variant in the discriminated union.
- `src/lib/db/queries/incidents.ts` — extend `declareIncident` and `changeIncidentStatus` to call `recomputeAllSnapshotsForTeam(tx, teamId)` + add `postPublicStatusUpdate(...)` mutation.
- `src/lib/db/queries/incidents.ts` — also amend `dismissTriagingIncident` (Plan 6 prereq, see assumption above) to call `recomputeAllSnapshotsForTeam(tx, teamId)`.
- `src/middleware.ts` — exempt `/status/**` from the auth gate.
- `src/app/(app)/incidents/[slug]/page.tsx` — server-render `PublicUpdateForm` in the right rail when the actor is IC/Scribe/Comms/admin.
- `src/app/(app)/incidents/[slug]/actions.ts` — add `postPublicUpdateAction(slug, formData)`.
- `src/app/(app)/incidents/[slug]/_components/Timeline.tsx` — render `status_update_published` kind.
- `src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx` — extend per-kind addEventListener map.
- `tests/setup/withTx.ts` — append `'status_snapshots'` to the truncate list (no FK; ordering doesn't matter, but we keep it grouped).
- `tests/unit/timeline-body.test.ts` — add a case for the new variant.
- `CLAUDE.md` — Plan 7 update history entry; promote `/status` from "deferred" to live.
- `.claude/GUARDRAILS.md` — add a row for `src/lib/status/**`, `src/lib/db/queries/status-snapshot.ts`, `/status/*` routes, `notify-snapshot.ts`.
- `.claude/memory/foundation_followups.md` — close out Plan 4 follow-up #5 ("Edge-cached status page invalidation via the same channel") and Plan 5 follow-up #12 ("Postmortem visibility on /status page"); flag any new items the review surfaces.

---

## Task 1: Schema — `status_snapshots` table + extend `timeline_event_kind` with `status_update_published`

**Files:**
- Create: `src/lib/db/schema/status-snapshots.ts`
- Modify: `src/lib/db/schema/timeline.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// src/lib/db/schema/status-snapshots.ts
import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const statusSnapshots = pgTable('status_snapshots', {
  // Scope is the PK. Format:
  //   'public'           — org-wide snapshot
  //   'team:<uuid>'      — per-team snapshot
  scope: text('scope').primaryKey(),
  payload: jsonb('payload').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StatusSnapshotRow = typeof statusSnapshots.$inferSelect;
export type NewStatusSnapshotRow = typeof statusSnapshots.$inferInsert;
```

- [ ] **Step 2: Append `'status_update_published'` to the timeline kind enum**

Edit `src/lib/db/schema/timeline.ts`:

```ts
export const TIMELINE_EVENT_KIND_VALUES = [
  'note',
  'status_change',
  'severity_change',
  'role_change',
  'postmortem_link',
  'status_update_published',
] as const;
```

- [ ] **Step 3: Re-export from the schema barrel**

Edit `src/lib/db/schema/index.ts` — append:

```ts
export * from './status-snapshots';
```

(Keep all existing exports.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema/status-snapshots.ts \
        src/lib/db/schema/timeline.ts \
        src/lib/db/schema/index.ts
git commit -m "$(cat <<'EOF'
feat(schema): add status_snapshots + status_update_published timeline kind

status_snapshots is keyed by scope text PK ('public' or 'team:<uuid>')
with a jsonb payload that holds services + active_incidents +
severityByDay. Single row per scope; mutations upsert. The new
status_update_published timeline kind is the public-update event the
IC/Scribe/Comms posts to /status from the war-room — separate from
internal notes by design (spec §6.5: "never internal notes" on /status).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Body schema — `StatusUpdatePublishedBody` variant

**Files:**
- Modify: `src/lib/timeline/body.ts`
- Modify: `tests/unit/timeline-body.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Edit `tests/unit/timeline-body.test.ts`. Append inside the existing `describe('TimelineEventBodySchema', ...)`:

```ts
test('status_update_published — message + scope present', () => {
  expect(
    TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message: 'We are investigating elevated 500s on /v1/login.',
      postedToScope: 'public',
    }),
  ).toMatchObject({ kind: 'status_update_published', postedToScope: 'public' });
});

test('status_update_published — team scope', () => {
  expect(
    TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message: 'Restoring partial traffic.',
      postedToScope: 'team',
    }).postedToScope,
  ).toBe('team');
});

test('status_update_published rejects empty message', () => {
  expect(() =>
    TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message: '',
      postedToScope: 'public',
    }),
  ).toThrow();
});

test('status_update_published rejects message over 5000 chars', () => {
  expect(() =>
    TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message: 'x'.repeat(5001),
      postedToScope: 'public',
    }),
  ).toThrow();
});

test('status_update_published rejects unknown scope', () => {
  expect(() =>
    TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message: 'hi',
      postedToScope: 'planet',
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run them — should fail**

Run: `pnpm test tests/unit/timeline-body.test.ts`
Expected: **FAIL** — schema does not yet know `'status_update_published'`.

- [ ] **Step 3: Add the variant**

Edit `src/lib/timeline/body.ts`. After the `PostmortemLinkBody` declaration, before `TimelineEventBodySchema`:

```ts
const StatusUpdatePublishedBody = z.object({
  kind: z.literal('status_update_published'),
  message: z.string().min(1).max(5_000),
  postedToScope: z.enum(['public', 'team']),
});
```

Update the discriminated union:

```ts
export const TimelineEventBodySchema = z.discriminatedUnion('kind', [
  NoteBody,
  StatusChangeBody,
  SeverityChangeBody,
  RoleChangeBody,
  PostmortemLinkBody,
  StatusUpdatePublishedBody,
]);
```

- [ ] **Step 4: Run — should pass**

Run: `pnpm test tests/unit/timeline-body.test.ts`
Expected: all tests **PASS** (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/body.ts tests/unit/timeline-body.test.ts
git commit -m "$(cat <<'EOF'
feat(timeline): StatusUpdatePublishedBody variant

Adds the body shape for the status_update_published kind: a string
message (1..5000) and a postedToScope ('public' | 'team'). Plan 7's
postPublicStatusUpdate mutation parses through this schema before
inserting the timeline_events row, mirroring every other kind's
TimelineEventBodySchema.parse(...) pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Snapshot payload schema + pure builder helpers

**Files:**
- Create: `src/lib/status/payload.ts`
- Create: `src/lib/status/snapshot.ts`
- Create: `tests/unit/status-snapshot-builders.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/status-snapshot-builders.test.ts
import { describe, expect, test } from 'vitest';
import {
  buildPublicSnapshot,
  buildTeamSnapshot,
  serviceStatusFromActive,
  worstSeverityFromIncidents,
} from '@/lib/status/snapshot';
import { StatusSnapshotPayloadSchema } from '@/lib/status/payload';

const teamA = '11111111-1111-4111-8111-111111111111';
const teamB = '22222222-2222-4222-8222-222222222222';
const svc1 = '33333333-3333-4333-8333-333333333333';
const svc2 = '44444444-4444-4444-8444-444444444444';
const svc3 = '55555555-5555-4555-8555-555555555555';
const inc1 = '66666666-6666-4666-8666-666666666666';

describe('serviceStatusFromActive', () => {
  test('no incidents → operational', () => {
    expect(serviceStatusFromActive(svc1, [])).toBe('operational');
  });

  test('SEV1 active and service attached → major_outage', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV1', affectedServiceIds: [svc1] },
      ]),
    ).toBe('major_outage');
  });

  test('SEV2 → partial_outage', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV2', affectedServiceIds: [svc1] },
      ]),
    ).toBe('partial_outage');
  });

  test('SEV3 → degraded', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV3', affectedServiceIds: [svc1] },
      ]),
    ).toBe('degraded');
  });

  test('SEV4 → operational (no public-facing impact)', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV4', affectedServiceIds: [svc1] },
      ]),
    ).toBe('operational');
  });

  test('attached to a different service → operational', () => {
    expect(
      serviceStatusFromActive(svc2, [
        { id: inc1, severity: 'SEV1', affectedServiceIds: [svc1] },
      ]),
    ).toBe('operational');
  });

  test('worst-of when multiple incidents on same service', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: 'a', severity: 'SEV3', affectedServiceIds: [svc1] },
        { id: 'b', severity: 'SEV1', affectedServiceIds: [svc1] },
      ]),
    ).toBe('major_outage');
  });
});

describe('worstSeverityFromIncidents', () => {
  test('empty → null', () => {
    expect(worstSeverityFromIncidents([])).toBeNull();
  });

  test('SEV3 + SEV1 → SEV1', () => {
    expect(
      worstSeverityFromIncidents([
        { severity: 'SEV3' },
        { severity: 'SEV1' },
        { severity: 'SEV4' },
      ]),
    ).toBe('SEV1');
  });

  test('SEV4 only → SEV4', () => {
    expect(worstSeverityFromIncidents([{ severity: 'SEV4' }])).toBe('SEV4');
  });
});

describe('buildPublicSnapshot', () => {
  test('empty inputs → all-operational shape', () => {
    const payload = buildPublicSnapshot({
      services: [],
      activeIncidents: [],
      severityByDay: [],
    });
    expect(payload.services).toEqual([]);
    expect(payload.activeIncidents).toEqual([]);
    expect(payload.severityByDay).toEqual([]);
    // Round-trip the schema.
    expect(StatusSnapshotPayloadSchema.parse(payload)).toEqual(payload);
  });

  test('single SEV1 incident affects only attached services', () => {
    const payload = buildPublicSnapshot({
      services: [
        { id: svc1, slug: 'auth', name: 'Auth', teamId: teamA, uptime30d: 0.999 },
        { id: svc2, slug: 'billing', name: 'Billing', teamId: teamA, uptime30d: 1.0 },
      ],
      activeIncidents: [
        {
          slug: 'inc-aaaa1111',
          title: 'Login 500s',
          severity: 'SEV1',
          status: 'investigating',
          declaredAt: new Date('2026-04-29T10:00:00Z'),
          affectedServiceIds: [svc1],
          latestPublicUpdate: {
            body: 'Investigating elevated 500s.',
            postedAt: new Date('2026-04-29T10:05:00Z'),
            author: 'Alice',
          },
        },
      ],
      severityByDay: [],
    });
    expect(payload.services.find((s) => s.id === svc1)?.status).toBe('major_outage');
    expect(payload.services.find((s) => s.id === svc2)?.status).toBe('operational');
    expect(payload.activeIncidents).toHaveLength(1);
    expect(payload.activeIncidents[0]?.latestPublicUpdate?.body).toBe(
      'Investigating elevated 500s.',
    );
    StatusSnapshotPayloadSchema.parse(payload);
  });

  test('null services list still validates', () => {
    const payload = buildPublicSnapshot({
      services: [],
      activeIncidents: [
        {
          slug: 'inc-bbbb2222',
          title: 'Stale cache',
          severity: 'SEV3',
          status: 'identified',
          declaredAt: new Date('2026-04-29T11:00:00Z'),
          affectedServiceIds: [],
        },
      ],
      severityByDay: [],
    });
    expect(payload.services).toEqual([]);
    StatusSnapshotPayloadSchema.parse(payload);
  });

  test('serializes severityByDay as YYYY-MM-DD strings', () => {
    const payload = buildPublicSnapshot({
      services: [],
      activeIncidents: [],
      severityByDay: [
        { date: '2026-04-23', worstSeverity: null },
        { date: '2026-04-24', worstSeverity: 'SEV2' },
      ],
    });
    expect(payload.severityByDay.map((d) => d.date)).toEqual(['2026-04-23', '2026-04-24']);
    StatusSnapshotPayloadSchema.parse(payload);
  });
});

describe('buildTeamSnapshot', () => {
  test('filters services to the given team', () => {
    const payload = buildTeamSnapshot(teamA, {
      services: [
        { id: svc1, slug: 'auth', name: 'Auth', teamId: teamA, uptime30d: 1 },
        { id: svc2, slug: 'billing', name: 'Billing', teamId: teamA, uptime30d: 1 },
        { id: svc3, slug: 'payments', name: 'Payments', teamId: teamB, uptime30d: 1 },
      ],
      activeIncidents: [],
      severityByDay: [],
    });
    expect(payload.services.map((s) => s.id).sort()).toEqual([svc1, svc2].sort());
    StatusSnapshotPayloadSchema.parse(payload);
  });

  test('filters active incidents to those with services on the team', () => {
    const payload = buildTeamSnapshot(teamA, {
      services: [
        { id: svc1, slug: 'auth', name: 'Auth', teamId: teamA, uptime30d: 1 },
        { id: svc3, slug: 'payments', name: 'Payments', teamId: teamB, uptime30d: 1 },
      ],
      activeIncidents: [
        {
          slug: 'inc-aaaa1111',
          title: 'A',
          severity: 'SEV1',
          status: 'investigating',
          declaredAt: new Date(),
          affectedServiceIds: [svc1],
        },
        {
          slug: 'inc-bbbb2222',
          title: 'B',
          severity: 'SEV1',
          status: 'investigating',
          declaredAt: new Date(),
          affectedServiceIds: [svc3],
        },
      ],
      severityByDay: [],
    });
    expect(payload.activeIncidents.map((i) => i.slug)).toEqual(['inc-aaaa1111']);
  });
});
```

- [ ] **Step 2: Run them — they should fail**

Run: `pnpm test tests/unit/status-snapshot-builders.test.ts`
Expected: **FAIL** — modules not found.

- [ ] **Step 3: Implement the payload schema**

```ts
// src/lib/status/payload.ts
import { z } from 'zod';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';

export const SERVICE_STATUS_VALUES = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
] as const;
export type ServiceStatus = (typeof SERVICE_STATUS_VALUES)[number];

const SnapshotServiceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  teamId: z.string().uuid(),
  status: z.enum(SERVICE_STATUS_VALUES),
  uptime30d: z.number().min(0).max(1),
});

const SnapshotPublicUpdateSchema = z.object({
  body: z.string().min(1).max(5_000),
  postedAt: z.coerce.date(),
  author: z.string().nullable().optional(),
});

const SnapshotActiveIncidentSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(SEVERITY_VALUES),
  status: z.enum(INCIDENT_STATUS_VALUES),
  declaredAt: z.coerce.date(),
  latestPublicUpdate: SnapshotPublicUpdateSchema.optional(),
});

const SnapshotDayCellSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  worstSeverity: z.enum(SEVERITY_VALUES).nullable(),
});

export const StatusSnapshotPayloadSchema = z.object({
  services: z.array(SnapshotServiceSchema),
  activeIncidents: z.array(SnapshotActiveIncidentSchema),
  severityByDay: z.array(SnapshotDayCellSchema),
});

export type StatusSnapshotPayload = z.infer<typeof StatusSnapshotPayloadSchema>;
export type SnapshotService = z.infer<typeof SnapshotServiceSchema>;
export type SnapshotActiveIncident = z.infer<typeof SnapshotActiveIncidentSchema>;
export type SnapshotDayCell = z.infer<typeof SnapshotDayCellSchema>;
```

- [ ] **Step 4: Implement the snapshot builders**

```ts
// src/lib/status/snapshot.ts
import type { Severity } from '@/lib/db/schema/services';
import type { IncidentStatus } from '@/lib/db/schema/incidents';
import type {
  ServiceStatus,
  SnapshotActiveIncident,
  SnapshotDayCell,
  SnapshotService,
  StatusSnapshotPayload,
} from './payload';

// SEV1+impact → major_outage. SEV2 → partial. SEV3 → degraded. SEV4 → operational.
// Worst-of when multiple incidents touch the same service.
const SEVERITY_TO_SERVICE_STATUS: Record<Severity, ServiceStatus> = {
  SEV1: 'major_outage',
  SEV2: 'partial_outage',
  SEV3: 'degraded',
  SEV4: 'operational',
};

const SERVICE_STATUS_RANK: Record<ServiceStatus, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

const SEVERITY_RANK: Record<Severity, number> = {
  SEV4: 0,
  SEV3: 1,
  SEV2: 2,
  SEV1: 3,
};

export interface ActiveIncidentForBuilder {
  id: string;
  severity: Severity;
  affectedServiceIds: readonly string[];
}

export function serviceStatusFromActive(
  serviceId: string,
  active: readonly ActiveIncidentForBuilder[],
): ServiceStatus {
  let worst: ServiceStatus = 'operational';
  for (const incident of active) {
    if (!incident.affectedServiceIds.includes(serviceId)) continue;
    const candidate = SEVERITY_TO_SERVICE_STATUS[incident.severity];
    if (SERVICE_STATUS_RANK[candidate] > SERVICE_STATUS_RANK[worst]) {
      worst = candidate;
    }
  }
  return worst;
}

export function worstSeverityFromIncidents(
  incidents: readonly { severity: Severity }[],
): Severity | null {
  let best: Severity | null = null;
  for (const i of incidents) {
    if (best === null || SEVERITY_RANK[i.severity] > SEVERITY_RANK[best]) {
      best = i.severity;
    }
  }
  return best;
}

export interface BuildSnapshotInput {
  services: ReadonlyArray<{
    id: string;
    slug: string;
    name: string;
    teamId: string;
    uptime30d: number;
  }>;
  activeIncidents: ReadonlyArray<{
    slug: string;
    title: string;
    severity: Severity;
    status: IncidentStatus;
    declaredAt: Date;
    affectedServiceIds: readonly string[];
    latestPublicUpdate?: {
      body: string;
      postedAt: Date;
      author?: string | null;
    };
  }>;
  severityByDay: ReadonlyArray<SnapshotDayCell>;
}

export function buildPublicSnapshot(input: BuildSnapshotInput): StatusSnapshotPayload {
  const services: SnapshotService[] = input.services.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    teamId: s.teamId,
    status: serviceStatusFromActive(
      s.id,
      input.activeIncidents.map((i) => ({
        id: i.slug,
        severity: i.severity,
        affectedServiceIds: i.affectedServiceIds,
      })),
    ),
    uptime30d: s.uptime30d,
  }));

  const activeIncidents: SnapshotActiveIncident[] = input.activeIncidents.map((i) => ({
    slug: i.slug,
    title: i.title,
    severity: i.severity,
    status: i.status,
    declaredAt: i.declaredAt,
    ...(i.latestPublicUpdate
      ? {
          latestPublicUpdate: {
            body: i.latestPublicUpdate.body,
            postedAt: i.latestPublicUpdate.postedAt,
            author: i.latestPublicUpdate.author ?? null,
          },
        }
      : {}),
  }));

  return {
    services,
    activeIncidents,
    severityByDay: [...input.severityByDay],
  };
}

export function buildTeamSnapshot(
  teamId: string,
  input: BuildSnapshotInput,
): StatusSnapshotPayload {
  const teamServices = input.services.filter((s) => s.teamId === teamId);
  const teamServiceIds = new Set(teamServices.map((s) => s.id));
  const teamIncidents = input.activeIncidents.filter((i) =>
    i.affectedServiceIds.some((sid) => teamServiceIds.has(sid)),
  );
  return buildPublicSnapshot({
    services: teamServices,
    activeIncidents: teamIncidents,
    severityByDay: input.severityByDay,
  });
}
```

- [ ] **Step 5: Run tests — should pass**

Run: `pnpm test tests/unit/status-snapshot-builders.test.ts`
Expected: all tests **PASS**.

- [ ] **Step 6: Commit**

```bash
git add src/lib/status/payload.ts \
        src/lib/status/snapshot.ts \
        tests/unit/status-snapshot-builders.test.ts
git commit -m "$(cat <<'EOF'
feat(status): pure snapshot builders + payload schema

StatusSnapshotPayloadSchema is the contract between
recomputeAndPersistSnapshot (writer) and the public /status routes
(reader). buildPublicSnapshot derives per-service status via
serviceStatusFromActive (SEV1→major, SEV2→partial, SEV3→degraded,
SEV4→operational, worst-of when multiple incidents overlap).
buildTeamSnapshot reuses the public builder after filtering by team_id.
Pure functions, golden-tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `compute30dUptime` helper + tests

**Files:**
- Create: `src/lib/status/uptime.ts`
- Create: `tests/unit/status-uptime.test.ts`

The formula (documented inline):

> Sum of (incident duration × severity weight) for incidents touching the service in the last 30 days, where weights are SEV1=1.0, SEV2=1.0, SEV3=0.5, SEV4=0. Cap at 30d × 24h. Uptime = 1 - (downtime / total). Open incidents are weighted up to `now`. This is a coarse approximation; a future plan can refine with per-component health if a real probe pipeline is added.

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/status-uptime.test.ts
import { describe, expect, test } from 'vitest';
import { computeUptimeFromDurations, severityWeight } from '@/lib/status/uptime';

describe('severityWeight', () => {
  test('SEV1=1, SEV2=1, SEV3=0.5, SEV4=0', () => {
    expect(severityWeight('SEV1')).toBe(1);
    expect(severityWeight('SEV2')).toBe(1);
    expect(severityWeight('SEV3')).toBe(0.5);
    expect(severityWeight('SEV4')).toBe(0);
  });
});

describe('computeUptimeFromDurations', () => {
  const HOUR = 60 * 60 * 1000;

  test('no incidents → 1.0 uptime', () => {
    expect(computeUptimeFromDurations([], 30 * 24 * HOUR)).toBe(1);
  });

  test('single 1h SEV1 over a 30d window ≈ ~0.9986', () => {
    const totalMs = 30 * 24 * HOUR;
    const downMs = 1 * HOUR;
    const expected = 1 - downMs / totalMs;
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV1', durationMs: 1 * HOUR }],
        totalMs,
      ),
    ).toBeCloseTo(expected, 6);
  });

  test('SEV3 weighted at 0.5', () => {
    const totalMs = 30 * 24 * HOUR;
    const downMs = 0.5 * HOUR; // 1h * 0.5
    const expected = 1 - downMs / totalMs;
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV3', durationMs: 1 * HOUR }],
        totalMs,
      ),
    ).toBeCloseTo(expected, 6);
  });

  test('SEV4 contributes nothing', () => {
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV4', durationMs: 24 * HOUR }],
        30 * 24 * HOUR,
      ),
    ).toBe(1);
  });

  test('caps at 30d × 24h — ridiculous downtime clamped', () => {
    const totalMs = 30 * 24 * HOUR;
    expect(
      computeUptimeFromDurations(
        [{ severity: 'SEV1', durationMs: 99 * 24 * HOUR }],
        totalMs,
      ),
    ).toBe(0);
  });

  test('multiple incidents accumulate', () => {
    const totalMs = 30 * 24 * HOUR;
    const downMs = 1 * HOUR + 0.5 * 1 * HOUR; // SEV1 1h + SEV3 1h@0.5
    const expected = 1 - downMs / totalMs;
    expect(
      computeUptimeFromDurations(
        [
          { severity: 'SEV1', durationMs: 1 * HOUR },
          { severity: 'SEV3', durationMs: 1 * HOUR },
        ],
        totalMs,
      ),
    ).toBeCloseTo(expected, 6);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm test tests/unit/status-uptime.test.ts`
Expected: **FAIL** — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/status/uptime.ts
import { and, eq, gte, lte, isNull, or, inArray } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import type { Severity } from '@/lib/db/schema/services';
import { incidents } from '@/lib/db/schema/incidents';
import { incidentServices } from '@/lib/db/schema/incidents';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  SEV1: 1,
  SEV2: 1,
  SEV3: 0.5,
  SEV4: 0,
};

export function severityWeight(s: Severity): number {
  return SEVERITY_WEIGHT[s];
}

export interface UptimeIncidentDuration {
  severity: Severity;
  durationMs: number;
}

export function computeUptimeFromDurations(
  ds: readonly UptimeIncidentDuration[],
  totalMs: number,
): number {
  if (totalMs <= 0) return 1;
  let weightedDownMs = 0;
  for (const d of ds) {
    weightedDownMs += d.durationMs * severityWeight(d.severity);
  }
  if (weightedDownMs <= 0) return 1;
  if (weightedDownMs >= totalMs) return 0;
  return 1 - weightedDownMs / totalMs;
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * HOUR_MS;

/**
 * 30-day uptime for a service. Sums weighted downtime
 * (SEV1=1, SEV2=1, SEV3=0.5, SEV4=0) for any incident that touched
 * the service in the window — open incidents are weighted up to `now`.
 *
 * Coarse approximation; v1 has no probe pipeline. A future plan can
 * tighten it with per-component health checks.
 */
export async function compute30dUptime(
  db: DB,
  serviceId: string,
  now: Date,
): Promise<number> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // All incidents that touched this service AND overlapped the window:
  //   declared_at <= now AND (resolved_at IS NULL OR resolved_at >= windowStart)
  const rows = await db
    .select({
      severity: incidents.severity,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .innerJoin(incidentServices, eq(incidentServices.incidentId, incidents.id))
    .where(
      and(
        eq(incidentServices.serviceId, serviceId),
        lte(incidents.declaredAt, now),
        or(isNull(incidents.resolvedAt), gte(incidents.resolvedAt, windowStart)),
      ),
    );

  const durations: UptimeIncidentDuration[] = rows.map((r) => {
    const startMs = Math.max(r.declaredAt.getTime(), windowStart.getTime());
    const endMs = (r.resolvedAt ?? now).getTime();
    return {
      severity: r.severity,
      durationMs: Math.max(0, Math.min(endMs, now.getTime()) - startMs),
    };
  });

  return computeUptimeFromDurations(durations, WINDOW_MS);
}
```

> **Note on imports:** `incidentServices` lives in `src/lib/db/schema/incidents.ts` (verified). Keep them grouped from the same file.

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/unit/status-uptime.test.ts`
Expected: all tests **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/status/uptime.ts tests/unit/status-uptime.test.ts
git commit -m "$(cat <<'EOF'
feat(status): compute30dUptime + pure weight helper

Formula: weighted downtime / 30d. SEV1=1, SEV2=1, SEV3=0.5, SEV4=0.
Open incidents weight up to `now`; closed ones to resolved_at.
Coarse — v1 has no probe pipeline. computeUptimeFromDurations is
a pure helper unit-tested with golden cases; the DB-backed
compute30dUptime stitches the rows together.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: status-snapshot queries (`read`, `recompute`, `recomputeAllForTeam`, public postmortems)

**Files:**
- Create: `src/lib/db/queries/status-snapshot.ts`
- Create: `src/lib/db/queries/status-page.ts`
- Create: `tests/integration/status-snapshot.test.ts`

> **Note:** all reads in `status-snapshot.ts` and `status-page.ts` are public (unauthenticated). They are the **only exception** to the project's "authz at the data layer" rule (per spec §5.2 / §3.5). The exception is justified because the data they expose is the explicitly-public subset (snapshot payloads, public-update events, postmortems with `public_on_status_page=true AND status='published'`). Internal notes are never read here.

- [ ] **Step 1: Write the failing integration tests**

```ts
// tests/integration/status-snapshot.test.ts
import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import {
  readSnapshotForScope,
  recomputeAndPersistSnapshot,
  recomputeAllSnapshotsForTeam,
} from '@/lib/db/queries/status-snapshot';
import { eq } from 'drizzle-orm';

describe('status-snapshot queries', () => {
  const ctx = useTestDb();
  let alice: { id: string };
  let teamId: string;
  let svcId: string;

  beforeEach(async () => {
    alice = await provisionUserOnSignIn(ctx.db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
      adminEmails: [],
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

    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId, name: 'Auth', slug: 'auth' })
      .returning();
    if (!svc) throw new Error('svc');
    svcId = svc.id;
  });

  test('readSnapshotForScope returns null when none persisted', async () => {
    const got = await readSnapshotForScope(ctx.db, 'public');
    expect(got).toBeNull();
  });

  test('recomputeAndPersistSnapshot for public — empty world', async () => {
    const payload = await recomputeAndPersistSnapshot(ctx.db, 'public');
    expect(payload.services).toHaveLength(1);
    expect(payload.services[0]?.status).toBe('operational');
    expect(payload.activeIncidents).toEqual([]);

    const back = await readSnapshotForScope(ctx.db, 'public');
    expect(back).not.toBeNull();
    expect(back!.services[0]?.id).toBe(svcId);
  });

  test('recomputeAndPersistSnapshot reflects an active SEV1 incident', async () => {
    const [inc] = await ctx.db
      .insert(incidents)
      .values({
        publicSlug: 'inc-aaaa1111',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV1',
        status: 'investigating',
        title: 'Login 500s',
        summary: '',
      })
      .returning();
    if (!inc) throw new Error('inc');
    await ctx.db.insert(incidentServices).values({ incidentId: inc.id, serviceId: svcId });

    const payload = await recomputeAndPersistSnapshot(ctx.db, 'public');
    expect(payload.services[0]?.status).toBe('major_outage');
    expect(payload.activeIncidents).toHaveLength(1);
    expect(payload.activeIncidents[0]?.slug).toBe('inc-aaaa1111');
  });

  test('resolved incidents are not in activeIncidents', async () => {
    const [inc] = await ctx.db
      .insert(incidents)
      .values({
        publicSlug: 'inc-bbbb2222',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV1',
        status: 'resolved',
        title: 'Resolved',
        summary: '',
        resolvedAt: new Date(),
      })
      .returning();
    if (!inc) throw new Error('inc');
    await ctx.db.insert(incidentServices).values({ incidentId: inc.id, serviceId: svcId });

    const payload = await recomputeAndPersistSnapshot(ctx.db, 'public');
    expect(payload.activeIncidents).toEqual([]);
    expect(payload.services[0]?.status).toBe('operational');
  });

  test('recomputeAndPersistSnapshot for team:<uuid> only includes team services', async () => {
    // Add a second team + service to verify scoping.
    const [otherTeam] = await ctx.db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    if (!otherTeam) throw new Error('other team');
    const [otherSvc] = await ctx.db
      .insert(services)
      .values({ teamId: otherTeam.id, name: 'Pay', slug: 'pay' })
      .returning();

    const payload = await recomputeAndPersistSnapshot(ctx.db, {
      type: 'team',
      teamId,
    });
    expect(payload.services.map((s) => s.id)).toEqual([svcId]);
    expect(payload.services.map((s) => s.id)).not.toContain(otherSvc!.id);
  });

  test('recomputeAllSnapshotsForTeam writes both public and team:<uuid> rows', async () => {
    await recomputeAllSnapshotsForTeam(ctx.db, teamId);

    const all = await ctx.db.select().from(statusSnapshots);
    const scopes = all.map((r) => r.scope).sort();
    expect(scopes).toContain('public');
    expect(scopes).toContain(`team:${teamId}`);
  });

  test('recomputeAndPersistSnapshot upserts (does not duplicate)', async () => {
    await recomputeAndPersistSnapshot(ctx.db, 'public');
    await recomputeAndPersistSnapshot(ctx.db, 'public');
    const rows = await ctx.db
      .select()
      .from(statusSnapshots)
      .where(eq(statusSnapshots.scope, 'public'));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — should fail (module not found)**

Run: `pnpm test tests/integration/status-snapshot.test.ts`
Expected: **FAIL** — `Cannot find module '@/lib/db/queries/status-snapshot'`.

- [ ] **Step 3: Implement the queries**

```ts
// src/lib/db/queries/status-snapshot.ts
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { services } from '@/lib/db/schema/services';
import { teams } from '@/lib/db/schema/teams';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { users } from '@/lib/db/schema/users';
import { postmortems } from '@/lib/db/schema/postmortems';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import {
  buildPublicSnapshot,
  buildTeamSnapshot,
  worstSeverityFromIncidents,
} from '@/lib/status/snapshot';
import {
  StatusSnapshotPayloadSchema,
  type SnapshotDayCell,
  type StatusSnapshotPayload,
} from '@/lib/status/payload';
import { compute30dUptime } from '@/lib/status/uptime';

export type SnapshotScope = 'public' | { type: 'team'; teamId: string };

function scopeKey(scope: SnapshotScope): string {
  if (scope === 'public') return 'public';
  return `team:${scope.teamId}`;
}

export async function readSnapshotForScope(
  db: DB,
  scope: SnapshotScope,
): Promise<StatusSnapshotPayload | null> {
  const key = scopeKey(scope);
  const [row] = await db
    .select()
    .from(statusSnapshots)
    .where(eq(statusSnapshots.scope, key))
    .limit(1);
  if (!row) return null;
  // Validate on read so a manually-edited row doesn't crash the page.
  const parsed = StatusSnapshotPayloadSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  return parsed.data;
}

interface BuilderInputs {
  services: Array<{ id: string; slug: string; name: string; teamId: string; uptime30d: number }>;
  activeIncidents: Array<{
    slug: string;
    title: string;
    severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
    status: 'triaging' | 'investigating' | 'identified' | 'monitoring' | 'resolved';
    declaredAt: Date;
    affectedServiceIds: string[];
    latestPublicUpdate?: { body: string; postedAt: Date; author?: string | null };
  }>;
  severityByDay: SnapshotDayCell[];
}

async function loadBuilderInputs(db: DB, now: Date): Promise<BuilderInputs> {
  // 1) services + 30d uptime per service
  const allServices = await db.select().from(services);
  const servicesWithUptime: BuilderInputs['services'] = [];
  for (const s of allServices) {
    const uptime30d = await compute30dUptime(db, s.id, now);
    servicesWithUptime.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      teamId: s.teamId,
      uptime30d,
    });
  }

  // 2) active incidents (status != 'resolved')
  const activeRows = await db
    .select()
    .from(incidents)
    .where(ne(incidents.status, 'resolved'))
    .orderBy(desc(incidents.declaredAt));

  // services-per-incident
  const incIds = activeRows.map((r) => r.id);
  const links = incIds.length
    ? await db
        .select()
        .from(incidentServices)
        .where(inArray(incidentServices.incidentId, incIds))
    : [];
  const linksByIncident = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByIncident.get(l.incidentId) ?? [];
    arr.push(l.serviceId);
    linksByIncident.set(l.incidentId, arr);
  }

  // latest public update per incident — read newest status_update_published event
  const latestUpdates = new Map<
    string,
    { body: string; postedAt: Date; authorUserId: string | null }
  >();
  if (incIds.length > 0) {
    const updates = await db
      .select({
        incidentId: timelineEvents.incidentId,
        body: timelineEvents.body,
        occurredAt: timelineEvents.occurredAt,
        authorUserId: timelineEvents.authorUserId,
      })
      .from(timelineEvents)
      .where(
        and(
          inArray(timelineEvents.incidentId, incIds),
          eq(timelineEvents.kind, 'status_update_published'),
        ),
      )
      .orderBy(desc(timelineEvents.occurredAt));
    for (const u of updates) {
      if (latestUpdates.has(u.incidentId)) continue;
      const body = u.body as { message: string };
      latestUpdates.set(u.incidentId, {
        body: body.message,
        postedAt: u.occurredAt,
        authorUserId: u.authorUserId,
      });
    }
  }

  const authorIds = [...new Set([...latestUpdates.values()].map((u) => u.authorUserId).filter((x): x is string => !!x))];
  const authorMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const authorRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, authorIds));
    for (const r of authorRows) authorMap.set(r.id, r.name ?? null);
  }

  const activeIncidents: BuilderInputs['activeIncidents'] = activeRows.map((r) => {
    const upd = latestUpdates.get(r.id);
    return {
      slug: r.publicSlug,
      title: r.title,
      severity: r.severity,
      status: r.status,
      declaredAt: r.declaredAt,
      affectedServiceIds: linksByIncident.get(r.id) ?? [],
      ...(upd
        ? {
            latestPublicUpdate: {
              body: upd.body,
              postedAt: upd.postedAt,
              author: upd.authorUserId ? authorMap.get(upd.authorUserId) ?? null : null,
            },
          }
        : {}),
    };
  });

  // 3) severityByDay — last 7 days, worst severity per day across declared-or-active that day
  const severityByDay = await loadSeverityByDay(db, now);

  return { services: servicesWithUptime, activeIncidents, severityByDay };
}

async function loadSeverityByDay(db: DB, now: Date): Promise<SnapshotDayCell[]> {
  const days: SnapshotDayCell[] = [];
  const startMs = now.getTime() - 6 * 24 * 60 * 60 * 1000;
  const dayStart = new Date(new Date(startMs).setUTCHours(0, 0, 0, 0));

  // Pull incidents touching the 7-day window once.
  const windowStart = dayStart;
  const windowEnd = new Date(now.getTime());
  const rows = await db
    .select({
      severity: incidents.severity,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .where(
      and(
        // started before windowEnd AND (still open OR resolved after windowStart)
        sql`${incidents.declaredAt} <= ${windowEnd}`,
        sql`(${incidents.resolvedAt} IS NULL OR ${incidents.resolvedAt} >= ${windowStart})`,
      ),
    );

  for (let i = 0; i < 7; i++) {
    const day = new Date(dayStart.getTime() + i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const overlapping = rows.filter(
      (r) =>
        r.declaredAt < dayEnd && (r.resolvedAt === null || r.resolvedAt >= day),
    );
    const worst = worstSeverityFromIncidents(overlapping);
    days.push({
      date: day.toISOString().slice(0, 10),
      worstSeverity: worst,
    });
  }
  return days;
}

export async function recomputeAndPersistSnapshot(
  db: DB,
  scope: SnapshotScope,
  now: Date = new Date(),
): Promise<StatusSnapshotPayload> {
  const inputs = await loadBuilderInputs(db, now);
  const payload =
    scope === 'public'
      ? buildPublicSnapshot(inputs)
      : buildTeamSnapshot(scope.teamId, inputs);
  const validated = StatusSnapshotPayloadSchema.parse(payload);

  const key = scopeKey(scope);
  await db
    .insert(statusSnapshots)
    .values({ scope: key, payload: validated, updatedAt: now })
    .onConflictDoUpdate({
      target: statusSnapshots.scope,
      set: { payload: validated, updatedAt: now },
    });

  return validated;
}

export async function recomputeAllSnapshotsForTeam(
  db: DB,
  teamId: string,
  now: Date = new Date(),
): Promise<void> {
  // Public AND the affected team. (Cross-team incidents touching multiple
  // teams' services would warrant a per-team set; v1 keeps it minimal —
  // only the primary team's snapshot is recomputed alongside public.)
  await recomputeAndPersistSnapshot(db, 'public', now);
  await recomputeAndPersistSnapshot(db, { type: 'team', teamId }, now);
}

export interface PublicPostmortemListItem {
  id: string;
  incidentSlug: string;
  incidentTitle: string;
  publishedAt: Date;
}

export async function listPublicPostmortems(
  db: DB,
  opts: { teamId?: string; limit?: number } = {},
): Promise<PublicPostmortemListItem[]> {
  const limit = opts.limit ?? 5;
  const conditions = [
    eq(postmortems.status, 'published'),
    eq(postmortems.publicOnStatusPage, true),
  ];

  if (opts.teamId) {
    // Filter by team via incident.teamId join
    const rows = await db
      .select({
        id: postmortems.id,
        publishedAt: postmortems.publishedAt,
        incidentSlug: incidents.publicSlug,
        incidentTitle: incidents.title,
      })
      .from(postmortems)
      .innerJoin(incidents, eq(postmortems.incidentId, incidents.id))
      .where(and(...conditions, eq(incidents.teamId, opts.teamId)))
      .orderBy(desc(postmortems.publishedAt))
      .limit(limit);
    return rows
      .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
      .map((r) => ({
        id: r.id,
        incidentSlug: r.incidentSlug,
        incidentTitle: r.incidentTitle,
        publishedAt: r.publishedAt,
      }));
  }

  const rows = await db
    .select({
      id: postmortems.id,
      publishedAt: postmortems.publishedAt,
      incidentSlug: incidents.publicSlug,
      incidentTitle: incidents.title,
    })
    .from(postmortems)
    .innerJoin(incidents, eq(postmortems.incidentId, incidents.id))
    .where(and(...conditions))
    .orderBy(desc(postmortems.publishedAt))
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
    .map((r) => ({
      id: r.id,
      incidentSlug: r.incidentSlug,
      incidentTitle: r.incidentTitle,
      publishedAt: r.publishedAt,
    }));
}

export interface PublicPostmortem {
  id: string;
  markdownBody: string;
  publishedAt: Date;
  incidentTitle: string;
  incidentSlug: string;
}

export async function findPublicPostmortemById(
  db: DB,
  postmortemId: string,
): Promise<PublicPostmortem | null> {
  const [row] = await db
    .select({
      id: postmortems.id,
      markdownBody: postmortems.markdownBody,
      status: postmortems.status,
      publicOnStatusPage: postmortems.publicOnStatusPage,
      publishedAt: postmortems.publishedAt,
      incidentTitle: incidents.title,
      incidentSlug: incidents.publicSlug,
    })
    .from(postmortems)
    .innerJoin(incidents, eq(postmortems.incidentId, incidents.id))
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!row) return null;
  if (row.status !== 'published') return null;
  if (!row.publicOnStatusPage) return null;
  if (!row.publishedAt) return null;
  return {
    id: row.id,
    markdownBody: row.markdownBody,
    publishedAt: row.publishedAt,
    incidentTitle: row.incidentTitle,
    incidentSlug: row.incidentSlug,
  };
}
```

- [ ] **Step 4: Implement the public single-incident reader**

```ts
// src/lib/db/queries/status-page.ts
import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { users } from '@/lib/db/schema/users';

export interface PublicIncidentDetail {
  slug: string;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  status: 'triaging' | 'investigating' | 'identified' | 'monitoring' | 'resolved';
  declaredAt: Date;
  resolvedAt: Date | null;
  publicUpdates: Array<{
    id: string;
    message: string;
    postedAt: Date;
    author: string | null;
  }>;
}

/**
 * Public read of a single incident: returns the headline metadata and
 * the chronological list of `status_update_published` events ONLY.
 * Internal notes are never returned. No auth.
 */
export async function findPublicIncidentBySlug(
  db: DB,
  slug: string,
): Promise<PublicIncidentDetail | null> {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.publicSlug, slug))
    .limit(1);
  if (!incident) return null;

  const updateRows = await db
    .select({
      id: timelineEvents.id,
      body: timelineEvents.body,
      occurredAt: timelineEvents.occurredAt,
      authorName: users.name,
    })
    .from(timelineEvents)
    .leftJoin(users, eq(users.id, timelineEvents.authorUserId))
    .where(
      and(
        eq(timelineEvents.incidentId, incident.id),
        eq(timelineEvents.kind, 'status_update_published'),
      ),
    )
    .orderBy(asc(timelineEvents.occurredAt));

  return {
    slug: incident.publicSlug,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    declaredAt: incident.declaredAt,
    resolvedAt: incident.resolvedAt,
    publicUpdates: updateRows.map((r) => ({
      id: r.id,
      message: (r.body as { message: string }).message,
      postedAt: r.occurredAt,
      author: r.authorName ?? null,
    })),
  };
}
```

- [ ] **Step 5: Run tests — should pass**

Run: `pnpm test tests/integration/status-snapshot.test.ts`
Expected: all 7 tests **PASS**.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries/status-snapshot.ts \
        src/lib/db/queries/status-page.ts \
        tests/integration/status-snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(queries): status-snapshot read/recompute/persist + public readers

readSnapshotForScope returns the validated payload or null.
recomputeAndPersistSnapshot reads services + active incidents +
latest public updates + 7-day severity bands, runs
buildPublicSnapshot/buildTeamSnapshot, and upserts the row.
recomputeAllSnapshotsForTeam refreshes both 'public' and
'team:<uuid>' so a single mutation closes the loop. Public readers
(listPublicPostmortems, findPublicPostmortemById,
findPublicIncidentBySlug) skip the team-membership gate by design —
they only return the explicitly-public subset (status='published'
AND public_on_status_page=true; status_update_published events only).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Generate migration 0007 + extend test setup

**Files:**
- Create: `drizzle/0007_<auto-name>.sql`
- Modify: `tests/setup/withTx.ts`

- [ ] **Step 1: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/0007_<auto-name>.sql` is written. It should contain:
- `ALTER TYPE "public"."timeline_event_kind" ADD VALUE 'status_update_published';`
- `CREATE TABLE "status_snapshots" ("scope" text PRIMARY KEY NOT NULL, "payload" jsonb NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);`

Open the generated file and verify both. If either is missing, fix the schema and regenerate. Do **not** hand-edit the SQL.

- [ ] **Step 2: Apply against the dev database**

Run: `pnpm db:migrate`
Expected: migration `0007_<name>` applied successfully.

- [ ] **Step 3: Extend the test truncate list**

Edit `tests/setup/withTx.ts`. Append `'status_snapshots'` to the `TABLES` array. Order doesn't matter for this table (no FKs), but keep it grouped with the other top-level tables:

```ts
const TABLES = [
  'timeline_events',
  'incident_services',
  'action_items',
  'postmortems',
  'incidents',
  'runbooks',
  'services',
  'team_memberships',
  'teams',
  'status_snapshots',
  'users',
] as const;
```

- [ ] **Step 4: Run the full integration suite**

Run: `pnpm test`
Expected: all existing tests still **PASS**, plus the 7 new status-snapshot tests from Task 5 (which were already merged in their own commit).

- [ ] **Step 5: Commit**

```bash
git add drizzle/0007_*.sql drizzle/meta tests/setup/withTx.ts
git commit -m "$(cat <<'EOF'
feat(db): migration 0007 — status_snapshots + status_update_published

ALTER TYPE adds the new timeline kind; CREATE TABLE for status_snapshots
(scope text PK, jsonb payload, updated_at). Truncate list extended in
test setup. Forward-only; no destructive change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Hook `recomputeAllSnapshotsForTeam` into existing mutations + add `notifySnapshotUpdated`

**Files:**
- Create: `src/lib/realtime/notify-snapshot.ts`
- Modify: `src/lib/db/queries/incidents.ts` (extend `declareIncident`, `changeIncidentStatus`, and — assumed — `dismissTriagingIncident`)
- Create: `tests/integration/status-snapshot-hooks.test.ts`

> **Plan 6 dependency reminder:** Step 4 below patches `dismissTriagingIncident`, which Plan 6 introduces. If Plan 6 has not yet shipped, skip Step 4 and add a follow-up note (see plan header). Steps 1–3 + 5–6 are unaffected.

- [ ] **Step 1: Write the snapshot notify helper**

```ts
// src/lib/realtime/notify-snapshot.ts
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';

export const SNAPSHOT_NOTIFY_CHANNEL = 'status_snapshot_updated';

/**
 * Fires a pg_notify on the status_snapshot_updated channel inside the
 * caller's transaction. v1 has no live consumer of this channel —
 * /status pages rely on Next ISR (revalidate=15) for cache invalidation.
 * The notify exists as a forward-looking hook so a Plan 9+ deployment
 * can wire revalidatePath('/status') from a long-lived listener
 * without touching every mutation site again.
 */
export async function notifySnapshotUpdated(
  tx: DB,
  scope: 'public' | { type: 'team'; teamId: string },
): Promise<void> {
  const scopeKey = scope === 'public' ? 'public' : `team:${scope.teamId}`;
  const payload = JSON.stringify({ scope: scopeKey, at: new Date().toISOString() });
  await tx.execute(sql`SELECT pg_notify(${SNAPSHOT_NOTIFY_CHANNEL}, ${payload})`);
}
```

- [ ] **Step 2: Write the failing integration tests for the hook into existing mutations**

```ts
// tests/integration/status-snapshot-hooks.test.ts
import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import { declareIncident, changeIncidentStatus } from '@/lib/db/queries/incidents';
import { eq } from 'drizzle-orm';

describe('snapshot recompute hooks', () => {
  const ctx = useTestDb();
  let alice: { id: string };
  let teamId: string;
  let svcId: string;

  beforeEach(async () => {
    alice = await provisionUserOnSignIn(ctx.db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
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
    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId, name: 'Auth', slug: 'auth' })
      .returning();
    svcId = svc!.id;
  });

  test('declareIncident persists snapshots for public + team:<uuid>', async () => {
    await declareIncident(ctx.db, alice.id, {
      teamId,
      title: 'Login 500s',
      summary: '',
      severity: 'SEV1',
      affectedServiceIds: [svcId],
    });

    const rows = await ctx.db.select().from(statusSnapshots);
    const scopes = rows.map((r) => r.scope).sort();
    expect(scopes).toContain('public');
    expect(scopes).toContain(`team:${teamId}`);

    const publicRow = rows.find((r) => r.scope === 'public')!;
    const payload = publicRow.payload as { activeIncidents: Array<{ slug: string }> };
    expect(payload.activeIncidents).toHaveLength(1);
  });

  test('changeIncidentStatus to resolved removes the incident from active', async () => {
    const inc = await declareIncident(ctx.db, alice.id, {
      teamId,
      title: 't',
      summary: '',
      severity: 'SEV2',
      affectedServiceIds: [svcId],
    });
    await changeIncidentStatus(ctx.db, alice.id, inc.id, 'resolved');

    const [pub] = await ctx.db
      .select()
      .from(statusSnapshots)
      .where(eq(statusSnapshots.scope, 'public'));
    const payload = pub!.payload as {
      activeIncidents: unknown[];
      services: Array<{ status: string }>;
    };
    expect(payload.activeIncidents).toEqual([]);
    expect(payload.services[0]?.status).toBe('operational');
  });
});
```

- [ ] **Step 3: Run — should fail (snapshots not yet hooked)**

Run: `pnpm test tests/integration/status-snapshot-hooks.test.ts`
Expected: **FAIL** — no snapshot rows are written.

- [ ] **Step 4: Hook the calls into the existing mutations**

In `src/lib/db/queries/incidents.ts`:

a) **Imports** — append at the top:

```ts
import { recomputeAllSnapshotsForTeam } from '@/lib/db/queries/status-snapshot';
import { notifySnapshotUpdated } from '@/lib/realtime/notify-snapshot';
```

b) **`declareIncident`** — inside the existing `db.transaction(...)`, after the `incidentServices` insert and before the `return incident;`, add:

```ts
await recomputeAllSnapshotsForTeam(tx as unknown as DB, input.teamId);
await notifySnapshotUpdated(tx as unknown as DB, 'public');
await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: input.teamId });
```

c) **`changeIncidentStatus`** — at the bottom of the transaction, just before `return { incident: updated, statusEvent };`, add:

```ts
await recomputeAllSnapshotsForTeam(tx as unknown as DB, current.teamId);
await notifySnapshotUpdated(tx as unknown as DB, 'public');
await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: current.teamId });
```

d) **`dismissTriagingIncident`** (Plan 6 prereq — skip if not present yet) — add the same trio of calls at the bottom of its transaction. State the assumption inline as a comment:

```ts
// Plan 7: keep /status snapshots fresh whenever an incident exits 'triaging'
// (resolved-as-false-positive). public + team scopes both refresh.
await recomputeAllSnapshotsForTeam(tx as unknown as DB, current.teamId);
await notifySnapshotUpdated(tx as unknown as DB, 'public');
await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: current.teamId });
```

- [ ] **Step 5: Run hooks tests — should pass**

Run: `pnpm test tests/integration/status-snapshot-hooks.test.ts`
Expected: 2 tests **PASS**.

Run the rest of the suite to confirm no regressions: `pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/realtime/notify-snapshot.ts \
        src/lib/db/queries/incidents.ts \
        tests/integration/status-snapshot-hooks.test.ts
git commit -m "$(cat <<'EOF'
feat(incidents): recompute /status snapshots inside mutations

declareIncident, changeIncidentStatus (and dismissTriagingIncident
when Plan 6 is merged) now call recomputeAllSnapshotsForTeam(tx, ...)
inside their existing db.transaction(...) so the public + team
status_snapshots rows are refreshed atomically with the state change.
notifySnapshotUpdated fires pg_notify on the status_snapshot_updated
channel; v1 has no listener (ISR revalidate=15 covers staleness),
but the hook is in place for Plan 9+ to wire revalidatePath('/status').

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `postPublicStatusUpdate` mutation + tests

**Files:**
- Modify: `src/lib/db/queries/incidents.ts`
- Create: `tests/integration/status-public-update.test.ts`

> **Authorization:** the actor must hold one of the active roles for this incident — IC, Scribe, Comms — OR be an admin. Plain team members cannot post public updates (per spec §6.1: "Post update to /status" is a quick action exposed to the response leadership).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/status-public-update.test.ts
import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import {
  declareIncident,
  postPublicStatusUpdate,
} from '@/lib/db/queries/incidents';
import { ForbiddenError } from '@/lib/authz';
import { eq } from 'drizzle-orm';

describe('postPublicStatusUpdate', () => {
  const ctx = useTestDb();
  let ic: { id: string };
  let scribe: { id: string };
  let comms: { id: string };
  let admin: { id: string };
  let bystander: { id: string };
  let outsider: { id: string };
  let teamId: string;
  let incidentId: string;

  beforeEach(async () => {
    ic = await provisionUserOnSignIn(ctx.db, {
      email: 'ic@example.test',
      name: 'IC',
      ssoSubject: 'sso-ic',
      adminEmails: [],
    });
    scribe = await provisionUserOnSignIn(ctx.db, {
      email: 'scribe@example.test',
      name: 'Scribe',
      ssoSubject: 'sso-scribe',
      adminEmails: [],
    });
    comms = await provisionUserOnSignIn(ctx.db, {
      email: 'comms@example.test',
      name: 'Comms',
      ssoSubject: 'sso-comms',
      adminEmails: [],
    });
    bystander = await provisionUserOnSignIn(ctx.db, {
      email: 'bystander@example.test',
      name: 'Bystander',
      ssoSubject: 'sso-by',
      adminEmails: [],
    });
    admin = await provisionUserOnSignIn(ctx.db, {
      email: 'admin@example.test',
      name: 'Admin',
      ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });
    outsider = await provisionUserOnSignIn(ctx.db, {
      email: 'outsider@example.test',
      name: 'Outsider',
      ssoSubject: 'sso-out',
      adminEmails: [],
    });

    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Platform', slug: 'platform' })
      .returning();
    teamId = team!.id;
    for (const u of [ic, scribe, comms, bystander]) {
      await ctx.db
        .insert(teamMemberships)
        .values({ teamId, userId: u.id, role: 'member' });
    }

    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId, name: 'Auth', slug: 'auth' })
      .returning();

    const inc = await declareIncident(ctx.db, ic.id, {
      teamId,
      title: 'Login 500s',
      summary: '',
      severity: 'SEV2',
      affectedServiceIds: [svc!.id],
    });
    incidentId = inc.id;

    // Promote ic to IC role; scribe to scribe; comms to comms.
    await ctx.db
      .update(incidents)
      .set({ icUserId: ic.id, scribeUserId: scribe.id, commsUserId: comms.id })
      .where(eq(incidents.id, incidentId));
  });

  test('IC can post a public update', async () => {
    const event = await postPublicStatusUpdate(
      ctx.db,
      ic.id,
      incidentId,
      'Investigating elevated 500s.',
    );
    expect(event.kind).toBe('status_update_published');
    const body = event.body as { kind: string; message: string; postedToScope: string };
    expect(body.message).toBe('Investigating elevated 500s.');
    expect(body.postedToScope).toBe('public');
  });

  test('scribe can post', async () => {
    const event = await postPublicStatusUpdate(ctx.db, scribe.id, incidentId, 'hi');
    expect(event.kind).toBe('status_update_published');
  });

  test('comms can post', async () => {
    const event = await postPublicStatusUpdate(ctx.db, comms.id, incidentId, 'hi');
    expect(event.kind).toBe('status_update_published');
  });

  test('admin can post even without being on the team', async () => {
    const event = await postPublicStatusUpdate(ctx.db, admin.id, incidentId, 'hi');
    expect(event.kind).toBe('status_update_published');
  });

  test('plain team member without a role is rejected', async () => {
    await expect(
      postPublicStatusUpdate(ctx.db, bystander.id, incidentId, 'hi'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('outsider (not on team) is rejected', async () => {
    await expect(
      postPublicStatusUpdate(ctx.db, outsider.id, incidentId, 'hi'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('public update appears in the snapshot as latestPublicUpdate', async () => {
    await postPublicStatusUpdate(ctx.db, ic.id, incidentId, 'Investigating.');
    const [pub] = await ctx.db
      .select()
      .from(statusSnapshots)
      .where(eq(statusSnapshots.scope, 'public'));
    const payload = pub!.payload as {
      activeIncidents: Array<{ latestPublicUpdate?: { body: string } }>;
    };
    expect(payload.activeIncidents[0]?.latestPublicUpdate?.body).toBe(
      'Investigating.',
    );
  });

  test('event row + snapshot are atomic — same transaction', async () => {
    await postPublicStatusUpdate(ctx.db, ic.id, incidentId, 'first');
    const events = await ctx.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId));
    const updates = events.filter((e) => e.kind === 'status_update_published');
    expect(updates).toHaveLength(1);

    const [pub] = await ctx.db
      .select()
      .from(statusSnapshots)
      .where(eq(statusSnapshots.scope, 'public'));
    expect(pub).toBeDefined();
  });

  test('rejects empty message', async () => {
    await expect(
      postPublicStatusUpdate(ctx.db, ic.id, incidentId, ''),
    ).rejects.toThrow();
  });

  test('rejects message longer than 5000 chars', async () => {
    await expect(
      postPublicStatusUpdate(ctx.db, ic.id, incidentId, 'x'.repeat(5001)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — should fail (`postPublicStatusUpdate` doesn't exist)**

Run: `pnpm test tests/integration/status-public-update.test.ts`
Expected: **FAIL** — `postPublicStatusUpdate is not a function`.

- [ ] **Step 3: Implement the mutation in `src/lib/db/queries/incidents.ts`**

Append (at the bottom of the file, alongside the other transactional mutations):

```ts
import { findUserById as findUserByIdForRoleCheck } from '@/lib/db/queries/users';
// ^ already imported as findUserById near the top — reuse the existing import.
//   This line is illustrative only; do not duplicate the import.

export async function postPublicStatusUpdate(
  db: DB,
  actorUserId: string,
  incidentId: string,
  message: string,
): Promise<typeof timelineEvents.$inferSelect> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (!current) throw new Error('Incident not found');

    // Authorization: actor must be IC, Scribe, Comms, OR admin.
    const user = await findUserById(tx as unknown as DB, actorUserId);
    if (!user) throw new ForbiddenError('Unknown user');
    const isAdmin = user.role === 'admin';
    const hasRole =
      current.icUserId === actorUserId ||
      current.scribeUserId === actorUserId ||
      current.commsUserId === actorUserId;
    if (!isAdmin && !hasRole) {
      throw new ForbiddenError('Only IC/Scribe/Comms or admin can post public updates');
    }

    const body = TimelineEventBodySchema.parse({
      kind: 'status_update_published',
      message,
      postedToScope: 'public',
    });

    const [event] = await tx
      .insert(timelineEvents)
      .values({
        incidentId,
        authorUserId: actorUserId,
        kind: 'status_update_published',
        body,
      })
      .returning();
    if (!event) throw new Error('Insert returned no rows');

    // Snapshot refresh + dual notify (war-room + status page channel).
    await recomputeAllSnapshotsForTeam(tx as unknown as DB, current.teamId);
    await notifyIncidentUpdate(tx as unknown as DB, {
      incidentId: event.incidentId,
      eventId: event.id,
      kind: 'status_update_published',
      occurredAt: event.occurredAt.toISOString(),
    });
    await notifySnapshotUpdated(tx as unknown as DB, 'public');
    await notifySnapshotUpdated(tx as unknown as DB, { type: 'team', teamId: current.teamId });

    return event;
  });
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/integration/status-public-update.test.ts`
Expected: 9 tests **PASS**.

- [ ] **Step 5: Verify the realtime payload schema accepts the new kind**

Add a one-liner to the existing `tests/unit/realtime-payload.test.ts`:

```ts
it('accepts status_update_published kind', () => {
  const parsed = IncidentUpdatePayloadSchema.parse({
    incidentId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    kind: 'status_update_published',
    occurredAt: '2026-04-29T12:00:00.000Z',
  });
  expect(parsed.kind).toBe('status_update_published');
});
```

Run: `pnpm test tests/unit/realtime-payload.test.ts`
Expected: all PASS — the wire schema reads from `TIMELINE_EVENT_KIND_VALUES` which now contains the new kind.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries/incidents.ts \
        tests/integration/status-public-update.test.ts \
        tests/unit/realtime-payload.test.ts
git commit -m "$(cat <<'EOF'
feat(incidents): postPublicStatusUpdate mutation

Authorization: actor must be IC, Scribe, Comms (any of the three
incident roles) OR admin — plain team members cannot post public
updates. Transactional: inserts the status_update_published timeline
event, recomputes public + team snapshots, fires both
notifyIncidentUpdate (war-room SSE) AND notifySnapshotUpdated
(forward-looking /status revalidation channel). Validates message
length (1..5000) via TimelineEventBodySchema before insert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Public layout + middleware exemption

**Files:**
- Create: `src/app/(public)/layout.tsx`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Update the middleware matcher**

Edit `src/middleware.ts`. Update the matcher to exempt `/status/**` from auth:

```ts
// Edge-safe: imports must stay Edge-runtime compatible. Do not import from @/lib/auth (Node).
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

const { auth } = NextAuth(authConfig);

export { auth as middleware };

export const config = {
  matcher: [
    // Skip auth on Next internals, favicon, AND any /status/* (public status page).
    '/((?!_next/static|_next/image|favicon.ico|status).*)',
  ],
};
```

> **Why this works:** `/status` and `/status/foo/bar` both start with `status` and are excluded by the negative lookahead group. Confirm by hitting `/status` after the change — no redirect to `/sign-in`.

- [ ] **Step 2: Write the public layout**

```tsx
// src/app/(public)/layout.tsx
import type { ReactNode } from 'react';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="mx-auto max-w-4xl">
          <a href="/status" className="text-base font-semibold tracking-tight">
            Status
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      <footer className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto max-w-4xl">
          Last refreshed at the time shown on each section. Auto-refreshes every 15 seconds.
        </div>
      </footer>
    </div>
  );
}
```

> **`(public)` is a route group** — Next.js doesn't add it to the URL. So `/app/(public)/status/page.tsx` serves `/status`, not `/(public)/status`.

- [ ] **Step 3: Manual smoke**

Run: `pnpm dev`. Open `/status` (without signing in). Expected: layout renders (no auth redirect). The page itself isn't built yet (Task 10) — Next will throw a "Page not found" or render the default — that's expected.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/app/(public)/layout.tsx src/middleware.ts
git commit -m "$(cat <<'EOF'
feat(public): /status route group + middleware exemption

Adds a (public) route group with a minimal layout (brand + footer);
URL stays /status because route groups don't appear in the path.
Middleware matcher excludes anything under /status from the auth
gate — public pages must be reachable from a fresh browser.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `/status` (org-wide) page with ISR + UI components

**Files:**
- Create: `src/app/(public)/status/page.tsx`
- Create: `src/app/(public)/status/_components/StatusBanner.tsx`
- Create: `src/app/(public)/status/_components/ServicesTable.tsx`
- Create: `src/app/(public)/status/_components/SevenDayBars.tsx`
- Create: `src/app/(public)/status/_components/ActiveIncidentCard.tsx`
- Create: `src/app/(public)/status/_components/PostmortemList.tsx`

- [ ] **Step 1: Build the components**

```tsx
// src/app/(public)/status/_components/StatusBanner.tsx
import type { StatusSnapshotPayload } from '@/lib/status/payload';

export function StatusBanner({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  let level: 'green' | 'yellow' | 'red' = 'green';
  for (const s of payload.services) {
    if (s.status === 'major_outage') {
      level = 'red';
      break;
    }
    if (s.status === 'partial_outage' || s.status === 'degraded') {
      level = 'yellow';
    }
  }

  const label =
    level === 'red'
      ? 'Major outage'
      : level === 'yellow'
        ? 'Some systems degraded'
        : 'All systems operational';

  const klass =
    level === 'red'
      ? 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100'
      : level === 'yellow'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'
        : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';

  return (
    <section
      className={`mb-6 rounded-md px-4 py-3 text-sm font-medium ${klass}`}
      role="status"
    >
      {label}
    </section>
  );
}
```

```tsx
// src/app/(public)/status/_components/ServicesTable.tsx
import type { StatusSnapshotPayload, ServiceStatus } from '@/lib/status/payload';

const DOT: Record<ServiceStatus, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  partial_outage: 'bg-orange-500',
  major_outage: 'bg-red-500',
};

const LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
};

export function ServicesTable({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  if (payload.services.length === 0) {
    return <p className="text-sm text-zinc-500">No services tracked yet.</p>;
  }
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Services</h2>
      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {payload.services.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="flex items-center gap-3">
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[s.status]}`}
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-zinc-500">{LABEL[s.status]}</span>
            </span>
            <span className="text-xs text-zinc-500">
              {(s.uptime30d * 100).toFixed(2)}% · 30d
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/app/(public)/status/_components/SevenDayBars.tsx
import type { StatusSnapshotPayload } from '@/lib/status/payload';

const SEV_COLOR: Record<string, string> = {
  SEV1: 'bg-red-600',
  SEV2: 'bg-orange-500',
  SEV3: 'bg-amber-500',
  SEV4: 'bg-yellow-300',
};

export function SevenDayBars({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  if (payload.severityByDay.length === 0) return <></>;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Last 7 days</h2>
      <ol className="flex gap-2" aria-label="7-day severity heatmap">
        {payload.severityByDay.map((d) => {
          const klass = d.worstSeverity ? SEV_COLOR[d.worstSeverity] : 'bg-emerald-200';
          return (
            <li
              key={d.date}
              className="flex flex-col items-center gap-1"
              aria-label={`${d.date}: ${d.worstSeverity ?? 'no incidents'}`}
            >
              <span className={`block h-12 w-6 rounded ${klass ?? 'bg-zinc-200'}`} />
              <span className="text-[10px] text-zinc-500">{d.date.slice(5)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

```tsx
// src/app/(public)/status/_components/ActiveIncidentCard.tsx
import Link from 'next/link';
import type { StatusSnapshotPayload } from '@/lib/status/payload';

export function ActiveIncidentCards({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  if (payload.activeIncidents.length === 0) {
    return <></>;
  }
  return (
    <section className="mb-8 space-y-3">
      <h2 className="text-base font-semibold">Active incidents</h2>
      {payload.activeIncidents.map((i) => (
        <article
          key={i.slug}
          className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              <Link href={`/status/incidents/${i.slug}`} className="underline-offset-2 hover:underline">
                {i.title}
              </Link>
            </h3>
            <span className="text-xs text-zinc-500">
              {i.severity} · {i.status} · started {i.declaredAt.toISOString().slice(0, 16).replace('T', ' ')}Z
            </span>
          </header>
          {i.latestPublicUpdate ? (
            <p className="text-sm">
              <span className="text-zinc-500">
                {i.latestPublicUpdate.postedAt.toISOString().slice(11, 19)}Z —{' '}
                {i.latestPublicUpdate.author ?? 'team'}:
              </span>{' '}
              {i.latestPublicUpdate.body}
            </p>
          ) : (
            <p className="text-sm text-zinc-500">No public updates yet.</p>
          )}
        </article>
      ))}
    </section>
  );
}
```

```tsx
// src/app/(public)/status/_components/PostmortemList.tsx
import Link from 'next/link';
import type { PublicPostmortemListItem } from '@/lib/db/queries/status-snapshot';

export function PostmortemList({
  items,
}: {
  items: PublicPostmortemListItem[];
}): React.JSX.Element {
  if (items.length === 0) return <></>;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Recent postmortems</h2>
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id} className="text-sm">
            <Link
              href={`/status/postmortems/${p.id}`}
              className="underline-offset-2 hover:underline"
            >
              {p.incidentTitle}
            </Link>
            <span className="ml-2 text-xs text-zinc-500">
              {p.publishedAt.toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Build the page**

```tsx
// src/app/(public)/status/page.tsx
import { db } from '@/lib/db/client';
import {
  listPublicPostmortems,
  readSnapshotForScope,
  recomputeAndPersistSnapshot,
} from '@/lib/db/queries/status-snapshot';
import { StatusBanner } from './_components/StatusBanner';
import { ServicesTable } from './_components/ServicesTable';
import { SevenDayBars } from './_components/SevenDayBars';
import { ActiveIncidentCards } from './_components/ActiveIncidentCard';
import { PostmortemList } from './_components/PostmortemList';

export const revalidate = 15;
export const dynamic = 'error';
// ^ force static-with-ISR. If a runtime mismatch (e.g. cookies()) sneaks in,
//   the build will fail loudly instead of silently dropping to dynamic.

export default async function StatusPage(): Promise<React.JSX.Element> {
  let snapshot = await readSnapshotForScope(db, 'public');
  if (!snapshot) {
    // Cold start — recompute on the fly. Subsequent renders use the cached row.
    snapshot = await recomputeAndPersistSnapshot(db, 'public');
  }
  const postmortems = await listPublicPostmortems(db, { limit: 5 });

  return (
    <>
      <StatusBanner payload={snapshot} />
      <ActiveIncidentCards payload={snapshot} />
      <ServicesTable payload={snapshot} />
      <SevenDayBars payload={snapshot} />
      <PostmortemList items={postmortems} />
    </>
  );
}
```

- [ ] **Step 3: Manual smoke**

Run: `pnpm dev`. Visit `/status` (signed out is fine).
- With no incidents: green banner + "No services tracked yet" or empty services list + empty active incidents.
- After declaring + publishing a public update via the war-room (Task 14), the page refreshes within 15 s and shows the update under "Active incidents".

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/app/(public)/status/page.tsx \
        src/app/(public)/status/_components/StatusBanner.tsx \
        src/app/(public)/status/_components/ServicesTable.tsx \
        src/app/(public)/status/_components/SevenDayBars.tsx \
        src/app/(public)/status/_components/ActiveIncidentCard.tsx \
        src/app/(public)/status/_components/PostmortemList.tsx
git commit -m "$(cat <<'EOF'
feat(public): /status org page with ISR (revalidate=15)

Server component reads readSnapshotForScope(db, 'public'); falls back
to recomputeAndPersistSnapshot on cold start. Renders banner +
active incident cards (public updates only — never internal notes) +
services rows with status dot + 30-day uptime% + 7-day heatmap +
recent published-and-public postmortems. dynamic='error' guards
against a future drop to dynamic rendering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `/status/[teamSlug]` page with ISR

**Files:**
- Create: `src/app/(public)/status/[teamSlug]/page.tsx`

- [ ] **Step 1: Build the page**

```tsx
// src/app/(public)/status/[teamSlug]/page.tsx
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { teams } from '@/lib/db/schema/teams';
import {
  listPublicPostmortems,
  readSnapshotForScope,
  recomputeAndPersistSnapshot,
} from '@/lib/db/queries/status-snapshot';
import { StatusBanner } from '../_components/StatusBanner';
import { ServicesTable } from '../_components/ServicesTable';
import { SevenDayBars } from '../_components/SevenDayBars';
import { ActiveIncidentCards } from '../_components/ActiveIncidentCard';
import { PostmortemList } from '../_components/PostmortemList';

export const revalidate = 15;
export const dynamic = 'error';

interface Props {
  params: Promise<{ teamSlug: string }>;
}

export default async function TeamStatusPage({ params }: Props): Promise<React.JSX.Element> {
  const { teamSlug } = await params;
  const [team] = await db.select().from(teams).where(eq(teams.slug, teamSlug)).limit(1);
  if (!team) notFound();

  let snapshot = await readSnapshotForScope(db, { type: 'team', teamId: team.id });
  if (!snapshot) {
    snapshot = await recomputeAndPersistSnapshot(db, { type: 'team', teamId: team.id });
  }
  const postmortems = await listPublicPostmortems(db, { teamId: team.id, limit: 5 });

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{team.name}</h1>
      <StatusBanner payload={snapshot} />
      <ActiveIncidentCards payload={snapshot} />
      <ServicesTable payload={snapshot} />
      <SevenDayBars payload={snapshot} />
      <PostmortemList items={postmortems} />
    </>
  );
}
```

- [ ] **Step 2: Manual smoke**

Run: `pnpm dev`. Visit `/status/<some-team-slug>` (e.g. `/status/platform`). Page renders the team-scoped snapshot. `/status/does-not-exist` 404s.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add src/app/(public)/status/[teamSlug]/page.tsx
git commit -m "$(cat <<'EOF'
feat(public): /status/[teamSlug] team-scoped page

Same shape as /status, scoped to a single team. Reads team by slug,
404s on miss, then reads the team:<uuid> snapshot. Cold-start path
recomputes on the fly. Postmortem list is filtered by team.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `/status/incidents/[slug]` public single-incident page

**Files:**
- Create: `src/app/(public)/status/incidents/[slug]/page.tsx`

- [ ] **Step 1: Build the page**

```tsx
// src/app/(public)/status/incidents/[slug]/page.tsx
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { findPublicIncidentBySlug } from '@/lib/db/queries/status-page';

export const revalidate = 15;
export const dynamic = 'error';

interface Props {
  params: Promise<{ slug: string }>;
}

function formatDuration(start: Date, end: Date | null): string {
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

export default async function PublicIncidentPage({ params }: Props): Promise<React.JSX.Element> {
  const { slug } = await params;
  const incident = await findPublicIncidentBySlug(db, slug);
  if (!incident) notFound();

  const updates = [...incident.publicUpdates].reverse(); // newest first

  return (
    <article>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{incident.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {incident.severity} · {incident.status} · started{' '}
          {incident.declaredAt.toISOString().slice(0, 16).replace('T', ' ')}Z · duration{' '}
          {formatDuration(incident.declaredAt, incident.resolvedAt)}
        </p>
      </header>
      <section>
        <h2 className="mb-3 text-base font-semibold">Public updates</h2>
        {updates.length === 0 ? (
          <p className="text-sm text-zinc-500">No public updates yet.</p>
        ) : (
          <ol className="space-y-3">
            {updates.map((u) => (
              <li
                key={u.id}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="mb-1 text-xs text-zinc-500">
                  {u.postedAt.toISOString().slice(0, 16).replace('T', ' ')}Z
                  {u.author ? ` — ${u.author}` : ''}
                </div>
                <p className="text-sm">{u.message}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
```

> **Why direct DB read here, not via the snapshot:** single-incident traffic is much lower than `/status`. Caching this page individually saves nothing meaningful, and the simpler reader is easier to reason about. ISR-15 still buffers reads.

- [ ] **Step 2: Manual smoke**

Visit `/status/incidents/<some-slug>`. Page shows the title + meta + reverse-chronological public updates.

- [ ] **Step 3: Commit**

```bash
git add src/app/(public)/status/incidents/[slug]/page.tsx
git commit -m "$(cat <<'EOF'
feat(public): /status/incidents/[slug] public single-incident view

Reverse-chronological status_update_published events ONLY — never
internal notes. ISR=15. Direct read via findPublicIncidentBySlug
(no snapshot — single-incident traffic doesn't justify another
denormalized row).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `/status/postmortems/[id]` public read-only postmortem

**Files:**
- Create: `src/app/(public)/status/postmortems/[id]/page.tsx`

- [ ] **Step 1: Build the page**

```tsx
// src/app/(public)/status/postmortems/[id]/page.tsx
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
  // Defensive uuid check — bad ids 404 instead of throwing.
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
```

> **Auth model:** `findPublicPostmortemById` itself checks `status='published' AND public_on_status_page=true`. A draft, an unpublished, or a private-but-published postmortem all return `null` → 404. No information leak.

- [ ] **Step 2: Manual smoke**

Publish a postmortem via `/incidents/<slug>/postmortem` and toggle "Show on /status". Visit `/status/postmortems/<id>`. Renders. Toggle off → page 404s. Toggle on, mark draft → page 404s.

- [ ] **Step 3: Commit**

```bash
git add src/app/(public)/status/postmortems/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(public): /status/postmortems/[id] public read-only postmortem

Consumes the public_on_status_page flag (Plan 5). Returns 404 unless
status='published' AND public_on_status_page=true. Renders with
react-markdown + remark-gfm. ISR=15. Defensive uuid regex on the
param so junk ids 404 cleanly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `/status/maintenance` static fallback

**Files:**
- Create: `src/app/(public)/status/maintenance/page.tsx`

- [ ] **Step 1: Build the page**

```tsx
// src/app/(public)/status/maintenance/page.tsx
export const dynamic = 'force-static';
export const revalidate = false;

export default function StatusMaintenancePage(): React.JSX.Element {
  return (
    <article className="text-center">
      <h1 className="mb-3 text-2xl font-semibold">We're working on it</h1>
      <p className="mx-auto max-w-md text-sm text-zinc-500">
        We're temporarily unable to display live status. Updates are still
        being recorded internally; please check back shortly.
      </p>
    </article>
  );
}
```

> **Last-line-of-defense per spec §8.4.** No DB calls; pre-rendered at build time. If the runtime can't even reach Postgres, this page can be served from cache/edge unconditionally. The actual fallback wiring (e.g. Vercel rewrite when /status fails) belongs to a deployment-time step, not this plan.

- [ ] **Step 2: Manual smoke**

Visit `/status/maintenance`. Renders without DB.

- [ ] **Step 3: Commit**

```bash
git add src/app/(public)/status/maintenance/page.tsx
git commit -m "$(cat <<'EOF'
feat(public): /status/maintenance static fallback

Pure-static (force-static + revalidate=false). Last-line-of-defense
per spec §8.4 if the DB is unreachable. Routing-tier fallback
(rewrite or 50x → /status/maintenance) is deployment work, not in
this plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: War-room — `PublicUpdateForm` + Server Action + Timeline render + SSE handler

**Files:**
- Create: `src/app/(app)/incidents/[slug]/_components/PublicUpdateForm.tsx`
- Modify: `src/app/(app)/incidents/[slug]/actions.ts`
- Modify: `src/app/(app)/incidents/[slug]/page.tsx`
- Modify: `src/app/(app)/incidents/[slug]/_components/Timeline.tsx`
- Modify: `src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx`

- [ ] **Step 1: Add the Server Action**

Edit `src/app/(app)/incidents/[slug]/actions.ts`. Append:

```ts
'use server';
// (existing 'use server' directive at top of file — do not duplicate)

import { z } from 'zod';
// (existing imports — keep)
import { postPublicStatusUpdate } from '@/lib/db/queries/incidents';

const PublicUpdateSchema = z.object({
  message: z.string().min(1).max(5_000),
});

export async function postPublicUpdateAction(
  slug: string,
  formData: FormData,
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const found = await findIncidentBySlugForUser(db, session.user.id, slug);
  if (!found) throw new Error('Incident not found');

  const parsed = PublicUpdateSchema.parse({
    message: formData.get('message'),
  });

  await postPublicStatusUpdate(
    db,
    session.user.id,
    found.incident.id,
    parsed.message,
  );
  revalidatePath(`/incidents/${slug}`);
  revalidatePath(`/status`);
  revalidatePath(`/status/incidents/${slug}`);
}
```

> The exact import lines (`auth`, `db`, `findIncidentBySlugForUser`, `revalidatePath`) likely already exist in this file from earlier plans — reuse them. Open the file to confirm before adding.

- [ ] **Step 2: Build the form component**

```tsx
// src/app/(app)/incidents/[slug]/_components/PublicUpdateForm.tsx
'use client';

import { useState, useTransition } from 'react';
import { postPublicUpdateAction } from '../actions';

interface Props {
  slug: string;
}

export function PublicUpdateForm({ slug }: Props): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await postPublicUpdateAction(slug, formData);
        setMessage('');
      } catch (e) {
        setError((e as Error).message ?? 'Failed to post');
      }
    });
  };

  return (
    <form action={onSubmit} className="space-y-2">
      <label className="block text-xs font-medium text-neutral-600">
        Post update to /status
      </label>
      <textarea
        name="message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={5000}
        required
        rows={3}
        placeholder="Public-facing message (no internal jargon — appears on /status)"
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || message.trim().length === 0}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pending ? 'Posting…' : 'Post to /status'}
        </button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Mount the form on the war-room (gated to IC/Scribe/Comms/admin)**

Edit `src/app/(app)/incidents/[slug]/page.tsx`. In the right rail, after the existing controls, add a section that's only rendered when the actor holds a role or is admin. The exact JSX depends on the file's current structure; the gating logic is:

```tsx
import { PublicUpdateForm } from './_components/PublicUpdateForm';

// ... inside the page body, after fetching `incident`, `session`, and the user record:
const userIsAdmin = currentUser?.role === 'admin';
const userHoldsRole =
  incident.icUserId === session.user.id ||
  incident.scribeUserId === session.user.id ||
  incident.commsUserId === session.user.id;
const canPostPublicUpdate = userIsAdmin || userHoldsRole;

// ... then in the right rail JSX:
{canPostPublicUpdate ? (
  <section>
    <h2 className="mb-2 text-sm font-medium text-zinc-500">Public update</h2>
    <PublicUpdateForm slug={slug} />
  </section>
) : null}
```

> Trust the data layer to enforce — `postPublicStatusUpdate` re-checks the same predicate. UI gating is courtesy.

- [ ] **Step 4: Render the new kind in the timeline**

Edit `src/app/(app)/incidents/[slug]/_components/Timeline.tsx`. In the `TimelineBodyView` switch, **before** the catch-all `postmortem_link` branch (so the new `if` is reached first), add:

```tsx
if (event.kind === 'status_update_published') {
  const body = event.body as { message: string; postedToScope: 'public' | 'team' };
  return (
    <p className="text-neutral-700">
      <span aria-hidden>🔔 </span>
      <span className="mr-2 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-900">
        Public update
      </span>
      <span className="whitespace-pre-wrap">{body.message}</span>
    </p>
  );
}
```

> Refactor opportunity (deferred): this method has now grown to handle 6 kinds; the Plan 5 follow-up #6 already flags the missing `assertNever` exhaustive guard. Do not address here.

- [ ] **Step 5: Extend the SSE per-kind map**

Edit `src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx`. Add the new kind to the `addEventListener` block:

```tsx
es.addEventListener('note', handleEvent('note'));
es.addEventListener('status_change', handleEvent('status_change'));
es.addEventListener('severity_change', handleEvent('severity_change'));
es.addEventListener('role_change', handleEvent('role_change'));
es.addEventListener('postmortem_link', handleEvent('postmortem_link'));
es.addEventListener('status_update_published', handleEvent('status_update_published'));
```

- [ ] **Step 6: Manual smoke (full round-trip)**

Run: `pnpm dev`. Sign in as a user who is the IC of an open incident. Open `/incidents/<slug>` in two browser windows. In window A, type a message in `PublicUpdateForm` → submit. Within ~1 s, window B shows the new event in the timeline with the 🔔 + "Public update" badge. Open `/status` (signed out). Within 15 s the snapshot reflects the latest update under "Active incidents".

Try as a plain team member (no role): the form is hidden in the UI; an attempt to call the action via dev console fetch should error with `ForbiddenError`.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: **PASS**.

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/incidents/[slug]/_components/PublicUpdateForm.tsx \
        src/app/(app)/incidents/[slug]/actions.ts \
        src/app/(app)/incidents/[slug]/page.tsx \
        src/app/(app)/incidents/[slug]/_components/Timeline.tsx \
        src/app/(app)/incidents/[slug]/_components/IncidentLiveProvider.tsx
git commit -m "$(cat <<'EOF'
feat(ui): war-room PublicUpdateForm + timeline render + SSE handler

Form is rendered only for IC/Scribe/Comms or admin (UI courtesy;
data layer enforces the same predicate). postPublicUpdateAction
authenticates → finds the incident scoped to the user → calls
postPublicStatusUpdate, then revalidates the war-room AND /status
+ /status/incidents/[slug] paths so non-SSE clients (curl, screen
readers, broken proxies) still see fresh data. Timeline renders
the new kind with a 🔔 + "Public update" badge. SSE per-kind map
extended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Final wiring — CLAUDE.md, GUARDRAILS.md, follow-ups close-out

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/GUARDRAILS.md`
- Modify: `.claude/memory/foundation_followups.md`

- [ ] **Step 1: Append the Plan 7 entry to `CLAUDE.md` `## Update history`**

Insert after the existing Plan 5 entry:

```md
- 2026-04-29: **Plan 7 (Public status page) implemented**. New `status_snapshots` table (migration 0007: combined with `ALTER TYPE timeline_event_kind ADD VALUE 'status_update_published'`). New `StatusSnapshotPayload` zod schema. Snapshot builders + `compute30dUptime` helper (formula: weighted downtime / 30d, SEV1=1, SEV2=1, SEV3=0.5, SEV4=0). Three new queries in `src/lib/db/queries/status-snapshot.ts` (read/recompute/recomputeAllForTeam) and a public-only reader in `src/lib/db/queries/status-page.ts`. `postPublicStatusUpdate` mutation gated to IC/Scribe/Comms/admin, transactional (timeline event + snapshot recompute + dual notify). Existing mutations (`declareIncident`, `changeIncidentStatus`, `dismissTriagingIncident`) extended to call `recomputeAllSnapshotsForTeam(tx, teamId)` inside their transactions. New `notifySnapshotUpdated` channel (`status_snapshot_updated`) — forward-looking; v1 relies on Next ISR (`revalidate=15`) for /status freshness. Five public routes added: `/status`, `/status/[teamSlug]`, `/status/incidents/[slug]`, `/status/postmortems/[id]`, `/status/maintenance`. Middleware matcher exempts `/status/**` from auth. War-room: `PublicUpdateForm` (gated component) + Server Action; Timeline renders the new kind with 🔔 + "Public update" badge; `IncidentLiveProvider` listens for the new kind. Test count climbed from 164 to NN (X unit + Y integration added — adjust to actual once green).
```

> Replace `NN`, `X`, `Y` with the real numbers after `pnpm test` reports pass count.

- [ ] **Step 2: Promote `/status` from "deferred" to live in CLAUDE.md**

Find the `## Notes` section's "`/metrics` in the sidebar still 404s" line. Update around it so `/status` is listed as live. The exact wording belongs in the same `Notes` block — minimal edit, one sentence.

- [ ] **Step 3: Update `.claude/GUARDRAILS.md`**

Append a row to the table:

```md
| Status page — `src/lib/status/**`, `src/lib/db/queries/status-snapshot.ts`, `src/lib/db/queries/status-page.ts`, `src/lib/realtime/notify-snapshot.ts`, `/status/*` routes, `src/app/(app)/incidents/[slug]/_components/PublicUpdateForm.tsx` | spec §3.3 + §5.2 + §6.5 + §8.4 + `2026-04-29-status-page.md` plan | `status_snapshots` is keyed by scope text PK ('public' | 'team:<uuid>'). Every mutation that changes incident state calls `recomputeAllSnapshotsForTeam(tx, teamId)` inside its `db.transaction(...)`. Public routes are the **only exception** to "authz at the data layer" — they are explicitly unauthenticated (middleware matcher excludes `/status/**`). The data they expose is the explicitly-public subset (snapshot payloads, `status_update_published` events ONLY, postmortems with `public_on_status_page=true AND status='published'`). Internal notes are never read on the public side. Public update mutation (`postPublicStatusUpdate`) is gated to IC/Scribe/Comms/admin — plain team members cannot post. ISR-15 is the v1 cache strategy; `notifySnapshotUpdated` exists as a forward-looking hook for Plan 9+. |
```

- [ ] **Step 4: Update `.claude/memory/foundation_followups.md`**

a) Strike-through Plan 4 follow-up #5 ("Edge-cached status page invalidation via the same `incident_updates` channel") — replace the line with:

```md
5. ~~**Edge-cached status page invalidation via the same `incident_updates` channel.**~~ — **DONE in Plan 7** via a SEPARATE `status_snapshot_updated` channel (the `incident_updates` channel stays per-incident; the snapshot channel is per-scope and decoupled from war-room subscribers). v1 relies on Next ISR (`revalidate=15`) for the actual cache freshness; the channel exists as a forward-looking hook for Plan 9+ to wire `revalidatePath('/status')` from a long-lived listener.
```

b) Strike-through Plan 5 follow-up #12 — replace with:

```md
12. ~~**Postmortem visibility on /status page.**~~ — **DONE in Plan 7**. `listPublicPostmortems` and `findPublicPostmortemById` consume the `public_on_status_page` flag; the public postmortem read view lives at `/status/postmortems/[id]` and 404s when the flag is false or `status != 'published'`.
```

c) Add a new "Plan 7 follow-ups" section at the bottom for any items the code review surfaces (placeholder; populate during Task 17 review):

```md
## Plan 7 follow-ups

Items flagged during Plan 7 final code review and intentionally deferred:

(populate from review checkpoint)
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .claude/GUARDRAILS.md .claude/memory/foundation_followups.md
git commit -m "$(cat <<'EOF'
docs(plan7): update CLAUDE.md + GUARDRAILS + close out follow-ups

Plan 7 entry added to update history. /status promoted from deferred
to live. New guardrails row covers status snapshot module + public
routes + the unauth exception. Plan 4 #5 (status page LISTEN/NOTIFY)
and Plan 5 #12 (postmortem on /status) marked done with explanations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Code review checkpoint

**Files:** none (review only)

- [ ] **Step 1: Run all gates**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: **all green**. Capture the test count and update CLAUDE.md's Plan 7 entry with the real `NN` value (Task 16 Step 1 placeholder).

- [ ] **Step 2: Re-read the spec sections this plan covers**

Confirm one-by-one:

- [ ] **§3.3 (status page resilience)**: `status_snapshots` written in the same transaction as state changes ✓ (Tasks 7, 8). ISR `revalidate=15` ✓ (Tasks 10, 11, 12, 13). 15 s staleness budget documented ✓.
- [ ] **§5.2 (public routes)**: `/status` (Task 10), `/status/[teamSlug]` (Task 11), `/status/incidents/[slug]` (Task 12) all present. Postmortem view (Task 13) is a Plan 7 addition consumed by §6.4's `public_on_status_page` flag.
- [ ] **§6.5 (public status page UI)**: brand line ✓ (Task 9 layout), banner ✓ (StatusBanner), active incident cards with reverse-chronological public updates ✓ (ActiveIncidentCards), services rows with status dot + 30-day uptime ✓ (ServicesTable), 7-day bars ✓ (SevenDayBars). **Internal notes are never shown** ✓ (`findPublicIncidentBySlug` filters on `kind = 'status_update_published'` only).
- [ ] **§8.4 (cache resilience)**: ISR + edge cache (15 s) ✓; pre-deployed `/status/maintenance` ✓ (Task 14).
- [ ] **§4.1 `StatusSnapshot`**: scope text PK + jsonb payload + updated_at ✓.
- [ ] **§6.1 ("Post update to /status" + `status_update_published`)**: PublicUpdateForm in war-room ✓ (Task 15); event kind + body schema ✓ (Tasks 1, 2, 8); rendered in war-room timeline ✓ (Task 15).
- [ ] **§8.1 (optimistic UI policy)**: notes-only optimistic; public updates are NOT optimistic ✓ (PublicUpdateForm has no optimistic insert; uses `useTransition` confirm-then-revalidate pattern).

- [ ] **Step 3: Self-review checks**

- [ ] No TBDs, no "implement appropriate X" placeholders, no "similar to Task N" stubs.
- [ ] `StatusSnapshotPayloadSchema` shape used in Task 3 matches usage in Tasks 5, 8, 10, 11, 12.
- [ ] All transactional mutations call `recomputeAllSnapshotsForTeam` AND both `notifySnapshotUpdated` calls (public + team).
- [ ] `useTestDb()` is called inside a `describe()` block in every integration test (Tasks 5, 7, 8).
- [ ] Strict-mode `.returning()` pattern is preserved (`const [row] = ...; if (!row) throw`).
- [ ] Plan 6 dependency: the `dismissTriagingIncident` amendment (Task 7 Step 4 sub-step d) is clearly marked conditional on Plan 6's existence.

- [ ] **Step 4: Manual acceptance run**

Follow `README.md`'s acceptance checklist — extend the manual smoke list with:
- Visit `/status` signed out — page renders.
- Declare incident → `/status` updates within 15 s.
- IC posts via `PublicUpdateForm` → war-room timeline updates within 1 s; `/status` updates within 15 s; `/status/incidents/<slug>` shows the new update; the team's `/status/<teamSlug>` shows it too.
- Resolve incident → `/status` shows green/operational within 15 s.
- Plain team member: `PublicUpdateForm` is not rendered; calling the action via devtools console errors.
- Publish a postmortem with "Show on /status" → `/status/postmortems/<id>` renders. Toggle off → 404. Delete the toggle (set draft) → 404.

- [ ] **Step 5: Capture review notes**

If the review surfaces any deferred items, add them to `.claude/memory/foundation_followups.md` under the "Plan 7 follow-ups" section seeded in Task 16.

- [ ] **Step 6: Final commit (if review notes were appended)**

Only commit if `.claude/memory/foundation_followups.md` was edited:

```bash
git add .claude/memory/foundation_followups.md
git commit -m "$(cat <<'EOF'
docs(plan7): seed Plan 7 follow-ups from final code review

Items flagged during the post-implementation review and intentionally
deferred. Each will become a Linear/TODO entry in v1.1 cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Implementer notes (rationale, not steps)

- **Why one `status_snapshots` row per scope?** The simplest answer that fits §4.1's "single PK on scope". A future plan that wants per-region or per-environment snapshots can add a composite PK without breaking existing readers.
- **Why two NOTIFY channels (`incident_updates` + `status_snapshot_updated`)?** Decoupling. The dispatcher already holds one connection on `incident_updates`; subscribing to a second channel is one `LISTEN` away. War-room consumers don't care about snapshot churn; future status-page invalidators don't care about per-event noise. Single-channel-with-kind-filter would conflate the two and force every dispatcher to re-fetch the row to decide if it's a snapshot poke.
- **Why `recomputeAllSnapshotsForTeam` and not per-mutation deltas?** Snapshots are tiny (kilobytes) and recompute is cheap (≤ 4 queries + an upsert). Trying to compute deltas would mean parsing the existing payload, mutating it, and writing back — fragile.
- **Why no `revalidatePath('/status')` in the actions yet?** Two reasons: (1) the actions already live in a request scope and `revalidatePath` works fine — they DO call it, see Task 15. (2) The forward-looking notify is for cross-process invalidation (a separate listener that triggers `revalidatePath` even when the mutation came from another process — e.g. a webhook ingress). v1 has one process, so direct `revalidatePath` from the action is enough.
- **Why no e2e test in this plan?** Per Plan 4 / Plan 5 precedent, the route-handler-level e2e is deferred to Plan 11 (Playwright). Each layer is integration-tested individually.
- **Plan 6 ordering risk**: if Plan 6 ships *after* Plan 7, the `dismissTriagingIncident` hook in Task 7 Step 4d simply doesn't apply (no such function exists yet); Plan 6 itself should add the calls when it lands. The follow-ups file should track this.
