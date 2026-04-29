# incident_app — Context for Claude Code

> Web-first incident coordination tool, single org, multi-team, SSO. **Plan 1 (Foundation) shipped 2026-04-28. Plan 2 (Incidents core) shipped 2026-04-28. Plan 3 (Timeline + mutations) shipped 2026-04-29. Plan 4 (Real-time SSE) shipped 2026-04-29.** Public repo at https://github.com/DiogoHSM/incident_app.

## Canonical documentation

Technical docs live in **two places** in this project (not in the standard `.claude/docs/*.md`):

| Doc | Location | Covers |
|---|---|---|
| Design spec (scope + architecture + decisions) | `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` | Replaces PROJECT-SUMMARY + ARCHITECTURE + STACK + CONSTRAINTS + DECISIONS for v1 |
| Foundation implementation plan | `docs/superpowers/plans/2026-04-28-foundation.md` | The 13 Plan 1 (Foundation) tasks that produced the initial state |
| Incidents core implementation plan | `docs/superpowers/plans/2026-04-28-incidents-core.md` | The 12 Plan 2 tasks (3 Plan 1 follow-up prereqs + incidents schema/queries/routes) |
| Timeline + mutations implementation plan | `docs/superpowers/plans/2026-04-29-timeline-mutations.md` | The 8 Plan 3 tasks (timeline_events table + 4 mutation queries + war-room components) |
| Real-time implementation plan | `docs/superpowers/plans/2026-04-29-realtime-sse.md` | The 10 Plan 4 tasks (LISTEN/NOTIFY dispatcher + SSE route + client provider with optimistic notes) |
| README | `README.md` | Local setup, gates, layout, manual acceptance checklist |
| Deferred follow-ups | `.claude/memory/foundation_followups.md` | Items flagged by code reviews and intentionally deferred |
| Guardrails (lazy loading) | `.claude/GUARDRAILS.md` | "Before touching X, read Y" map |

**Do not create `.claude/docs/PROJECT-SUMMARY.md` etc.** — the design spec covers that. Create a per-file doc only when the split is justified (UI-UX, INFRASTRUCTURE specific to prod, etc.).

## Current stack

Next.js 16 (App Router) · TypeScript strict + `noUncheckedIndexedAccess` · Tailwind v4 (CSS-first, no `tailwind.config.ts`) · ESLint flat config (`eslint.config.mjs`) · Prettier · pnpm · Drizzle ORM 0.45 + Postgres 16 (docker-compose, port 5433) · NextAuth v5 beta with Edge/Node split + Google OIDC · Vitest 4 + testcontainers (real Postgres, no DB mocks) · zod at every boundary.

## Local conventions

- **Layering boundary**: `src/lib/db/queries/*.ts` is the only place that calls Drizzle directly. Routes, Server Actions, and components import from there. Enforced by the plans and revalidated in every code review.
- **Authz boundary**: `src/lib/authz/index.ts` (`requireAdmin`, `requireTeamMember`, `ForbiddenError`) is the security boundary. Called from queries, not routes. Queries that branch on `user.role === 'admin'` for read-time admin-sees-all do so consistently across services and incidents.
- **Edge/Node split (NextAuth v5)**: `src/lib/auth/config.ts` is Edge-safe — forbidden to import `pg`, `postgres`, `drizzle-orm`, `@/lib/db/*`, or `node:*`. Enforced by an ESLint rule (`eslint.config.mjs:17-34`, `no-restricted-imports`). `src/lib/auth/index.ts` is Node and does the real work.
- **Strict mode + Drizzle `.returning()`**: always `const [row] = await ...returning(); if (!row) throw new Error(...);` before returning as a non-null type. Pattern repeated in every query.
- **DB errors in tests**: Drizzle 0.45 wraps errors in `DrizzleQueryError`. Use `expectDbError(DB_ERR_UNIQUE)` from `tests/setup/db.ts` (it walks the `cause` chain) — do not use `.toThrow(/duplicate/)` directly.
- **Test infrastructure**: a single Postgres testcontainer is booted in `tests/setup/global.ts` and reused across all integration files. Per-test isolation is via `TRUNCATE` in `useTestDb()` (`tests/setup/withTx.ts`). `vitest.config.ts` has `fileParallelism: false` because TRUNCATE-per-test is incompatible with parallel file execution against a shared schema.
- **Migrations forward-only**, generated via `pnpm db:generate`, applied via `pnpm db:migrate` (which passes `dotenv -e .env.local`). Current migrations: `0000` users/teams/team_memberships, `0001` services/runbooks, `0002` incidents/incident_services, `0003` timeline_events, `0004` incidents.status default → triaging.
- **Incident slugs**: minted only by `src/lib/incidents/slug.ts` (`generateIncidentSlug()`). Format `inc-XXXXXXXX` (8 lowercase alphanumerics from `crypto.randomBytes`). `declareIncident` retries up to 3× on the unique violation.
- **Timeline writes**: every mutation that changes incident state (`changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole`, `appendNote`) writes a `TimelineEvent` row in the same DB transaction. The jsonb body is validated via `TimelineEventBodySchema.parse(...)` (zod discriminated union over `kind`) before insert. Status mutations enforce a state machine and require an IC when leaving `triaging` (except → `resolved`).
- **Realtime fan-out**: every mutation that inserts a `timeline_events` row also calls `notifyIncidentUpdate(tx, ...)` inside the same transaction (`pg_notify` queues until commit). The dispatcher in `src/lib/realtime/dispatcher.ts` is a per-process singleton holding ONE `LISTEN incident_updates` connection plus a small fetch pool; it broadcasts each NOTIFY to in-memory subscribers after resolving the row + author name (and role_change body targets) by id. The SSE route at `src/app/api/incidents/[slug]/stream/route.ts` MUST stay `runtime = 'nodejs'`. Notes are optimistic on the client; status / severity / role mutations are NOT (per spec §8.1).
- **Mandatory co-author trailer** on every commit: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Notes

- **`.env.local` carries placeholders** for `AUTH_GOOGLE_CLIENT_ID/SECRET` (needed for `pnpm build` to pass the env schema refinement). Swap for real credentials before attempting sign-in. Documented in `.env.example` as a deferred item.
- **Middleware deprecation warning**: Next 16 wants `proxy.ts`, but `middleware.ts` still works. Rename is in the follow-ups.
- **`/metrics` in the sidebar still 404s** — that route arrives in Plan 8. `/incidents` is fully live with optimistic notes + SSE-driven timeline updates after Plan 4. `revalidatePath` stays as a fallback for non-SSE clients (curl, screen readers, broken proxies). Decide between placeholder route or disabled link for `/metrics` before showing the app to users.

## Update history

- 2026-04-28: Initial structure (`.claude/`, `CLAUDE.md`, `GUARDRAILS.md`, `MEMORY.md`).
- 2026-04-28: **Plan 1 (Foundation) implemented and merged to main**. 26 commits, 31 integration tests passing. Public repo created at https://github.com/DiogoHSM/incident_app. CLAUDE.md + GUARDRAILS.md updated to reflect the real stack.
- 2026-04-28: **Plan 2 (Incidents core) implemented**. Three Plan 1 follow-up prereqs resolved (testcontainer scaling, admin-sees-all in services queries, `provisionUserOnSignIn` ON CONFLICT). New `incidents` + `incident_services` tables, `declareIncident`/`listIncidentsForUser`/`findIncidentBySlugForUser` queries with admin-sees-all parity. Routes live: `/incidents`, `/incidents/new`, `/incidents/[slug]` (no real-time, no role mutations, no timeline events — those are Plan 3/4). Test count climbed from 31 to 55. All project content is now English-only (per `.claude/memory/feedback_language_english.md`).
- 2026-04-29: **Plan 3 (Timeline + mutations) implemented**. New `timeline_events` table (4 kinds: note, status_change, severity_change, role_change). Four mutation queries (`appendNote`, `changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentRole`) with state-machine guards, IC-required-when-leaving-triaging, atomic event emission inside `db.transaction(...)`. Four Server Actions wire the page form controls. Five new components on `/incidents/[slug]`: `Timeline`, `NoteForm`, `StatusControl`, `SeverityControl`, `RolePickers`. `react-markdown` + `remark-gfm` added for note rendering. Test count climbed from 55 to 118.
- 2026-04-29: **Plan 4 (Real-time SSE) implemented**. New `src/lib/realtime/` module: `types.ts` (zod payload schema + `TimelineEventOnWire` with resolved author + role-change target names), `notify.ts` (`pg_notify` helper, validates payload before fire), `dispatcher.ts` (per-process singleton holding `LISTEN incident_updates` + a small fetch pool; resolves names server-side and broadcasts to in-memory subscribers). New SSE route at `/api/incidents/[slug]/stream` (Node runtime, 25 s typed-event heartbeat, `Last-Event-ID` backfill scoped to the authorized incident). Client `IncidentLiveProvider` owns the `EventSource` and exposes `addOptimisticNote` / `markOptimisticError` / `reconcileOptimistic` via React context; `Timeline` and `NoteForm` are now context consumers. Optimistic UI is notes-only per spec §8.1. `revalidatePath` stays as a fallback. Schema fix surfaced during testing: `incidents.status` default is now `triaging` (was `investigating`) to match spec §3 line 136. Test count climbed from 118 to 128 (3 unit + 6 integration added — payload schema + dispatcher round-trip).
