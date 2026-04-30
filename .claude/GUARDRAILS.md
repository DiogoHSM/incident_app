# Guardrails — incident_app

> **Always loaded.** "Before touching X, read Y" map — so Claude knows which context to fetch before each edit.

**Last revision**: 2026-04-30 (after Plan 8 merge)

---

## Before editing

Before modifying a file that fits one of these categories, **read the corresponding doc(s)**. If a doc doesn't exist yet, create it from the indicated template.

| When touching… | Read first | Why |
|---|---|---|
| Scope, domain model, v1 decisions | `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` | The spec is the source of truth — every Plan 1/2 decision came from it |
| Active or completed implementation plan, deferred follow-ups | `docs/superpowers/plans/2026-04-28-foundation.md`, `docs/superpowers/plans/2026-04-28-incidents-core.md`, `.claude/memory/foundation_followups.md` | Deferred items are mapped — don't recreate them |
| DB schema (`src/lib/db/schema/*.ts`), migrations (`drizzle/*`), seeds | spec §4.1 + `foundation_followups.md` | Data changes are forward-only; many decisions (severity tiers, FK cascade vs restrict, citext) are already settled |
| Query layer (`src/lib/db/queries/*.ts`) | `CLAUDE.md` (boundary rules) + `src/lib/authz/index.ts` | Only place that calls Drizzle directly. Every read query that takes `userId` either calls `requireTeamMember`/`requireAdmin` or branches on `user.role === 'admin'` for admin-sees-all |
| Incidents schema (`src/lib/db/schema/incidents.ts`), queries (`src/lib/db/queries/incidents.ts`), routes (`src/app/(app)/incidents/**`) | spec §4.1 + §5.1 + §6.3 + `2026-04-28-incidents-core.md` plan | New tables — incidents/incident_services. Slug generator in `src/lib/incidents/slug.ts` is the only place that mints public slugs (3-retry on collision in `declareIncident`). Timeline + status mutations are deferred (Plans 3/4) — don't add them ad-hoc |
| Timeline schema (`src/lib/db/schema/timeline.ts`), queries (`src/lib/db/queries/timeline.ts`), body schemas (`src/lib/timeline/body.ts`), mutation extensions in `src/lib/db/queries/incidents.ts` (changeIncidentStatus / changeIncidentSeverity / assignIncidentRole) | spec §4.1 + §6.1 + `2026-04-29-timeline-mutations` plan | jsonb `body` MUST go through `TimelineEventBodySchema.parse(...)` before insert. Each mutation writes its `TimelineEvent` in the same `db.transaction(...)` as the row update. New event kinds (`webhook`, `postmortem_link`, `attachment`, `status_update_published`) are added in their owning plans — do not pre-add. State machine + IC-required-when-leaving-triaging is enforced in `changeIncidentStatus` and duplicated in `StatusControl.tsx` for UX gating |
| Realtime — `src/lib/realtime/*`, `src/app/api/incidents/[slug]/stream/route.ts`, `IncidentLiveProvider.tsx`, `ConnectionBanner.tsx` | spec §3.2 + §8.1/8.2 + `2026-04-29-realtime-sse.md` plan | NOTIFY payload is the wire contract — every body field that crosses pg_notify must go through `IncidentUpdatePayloadSchema`. The dispatcher is a per-process singleton: do **not** instantiate it from app code, always go through `getRealtimeDispatcher()`. The SSE route MUST stay `runtime = 'nodejs'` (Edge can't hold LISTEN connections). Optimistic UI is **only** for notes; status / severity / role mutations stay confirmed-only per spec §8.1. The route's backfill helper validates `Last-Event-ID` is scoped to the authorized incident. |
| Webhook ingestion — `src/lib/ingest/*`, `src/lib/db/schema/webhook-sources.ts`, `src/lib/db/schema/dead-letters.ts`, `src/lib/db/queries/webhook-sources.ts`, `src/lib/db/queries/dead-letters.ts`, `src/lib/db/queries/incidents-ingest.ts`, `src/app/api/webhooks/[sourceId]/route.ts`, `src/app/(app)/settings/webhooks/**`, `tests/__fixtures__/webhooks/**` | spec §3.5 + §4.1 + §7 + `2026-04-29-webhooks.md` plan | Adapters are pure (no DB); the route is the only impure surface and writes dead-letters on throw. `secret_material` is a jsonb column with two shapes (`aes` for HMAC, `bcrypt` for Grafana) — never bypass `secret-material.ts` to read/write it directly. `findWebhookSourceById` is the one no-actor query — it's authenticated by signature, not by session. `ingestWebhookAlert` is transactional (match-or-create + event(s) + auto-promote + `notifyIncidentUpdate` all in one `db.transaction(...)`); auto-promote requires existing severity > SEV1 AND no `severity_change` in the same window — bumps one tier max. `dismissTriagingIncident` is the only legal way to → resolved from triaging without IC; status_change body carries `dismissed: true`. New env var `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 bytes base64) is required — set in `tests/setup/global.ts` to all-zeros for determinism. SSE `IncidentLiveProvider` lists `webhook` in its per-kind addEventListener map — adding new timeline kinds in future plans must extend that map too. |
| Status page — `src/lib/status/**`, `src/lib/db/queries/status-snapshot.ts`, `src/lib/db/queries/status-page.ts`, `src/lib/realtime/notify-snapshot.ts`, `/status/*` routes, `src/app/(app)/incidents/[slug]/_components/PublicUpdateForm.tsx` | spec §3.3 + §5.2 + §6.5 + §8.4 + `2026-04-29-status-page.md` plan | `status_snapshots` is keyed by scope text PK ('public' \| 'team:<uuid>'). Every mutation that changes incident state calls `recomputeAllSnapshotsForTeam(tx, teamId)` inside its `db.transaction(...)`. Public routes are the **only exception** to "authz at the data layer" — they are explicitly unauthenticated (middleware matcher excludes `/status/**`). The data they expose is the explicitly-public subset (snapshot payloads, `status_update_published` events ONLY, postmortems with `public_on_status_page=true AND status='published'`). Internal notes are never read on the public side. Public update mutation (`postPublicStatusUpdate`) is gated to IC/Scribe/Comms/admin — plain team members cannot post. ISR-15 is the v1 cache strategy; `notifySnapshotUpdated` exists as a forward-looking hook for Plan 9+. |
| Metrics + dashboard — `src/lib/metrics/*`, `src/lib/db/queries/metrics.ts`, `src/lib/db/queries/dashboard.ts`, `src/app/(app)/dashboard/**`, `src/app/(app)/metrics/**` | spec §5.1 + §6.2 + build-seq #10 + `2026-04-29-metrics.md` plan | Read-only on the schema. `teamScope` (metrics.ts) and `actorScope` (dashboard.ts) centralize the admin-vs-member branch — every new metrics/dashboard query MUST go through one of them. MTTR excludes incidents whose status_change body has `dismissed=true` (Plan 6 writer). MTTA filters `declared_by IS NULL` (webhook-declared only; relies on Plan 6's nullable column). recharts charts live in `_components/`; donut + line + stacked-bar are recharts, the heatmap is plain HTML for accessibility. RangeSelector is the only client component on /metrics; everything else is server. Don't add ad-hoc Drizzle calls in the page files — extend the queries module. |
| Postmortems — `src/lib/db/schema/postmortems.ts`, `src/lib/db/schema/action-items.ts`, `src/lib/db/queries/postmortems.ts`, `src/lib/db/queries/action-items.ts`, `src/lib/postmortems/template.ts`, `src/app/api/postmortems/[id]/route.ts`, `src/app/(app)/incidents/[slug]/postmortem/**` | spec §4.1 + §6.4 + §8.3 + `2026-04-29-postmortems.md` plan | One postmortem per incident (unique on incident_id). `publishPostmortem` is the only place that emits the `postmortem_link` timeline event — runs in a `db.transaction(...)` with `notifyIncidentUpdate`. Autosave goes over `POST /api/postmortems/[id]`, NOT a Server Action — keep it that way (per spec §8.3). Publish vs `public_on_status_page` are independent flags. Action item `dueDate` is string-shaped (YYYY-MM-DD), no JS Date round-trip. `IncidentLiveProvider` lists postmortem_link in its per-kind addEventListener map — adding new timeline kinds in future plans must extend that map too. |
| Auth — `src/lib/auth/config.ts` or `src/middleware.ts` | spec §3.4 + `eslint.config.mjs` (no-restricted-imports rule) | Edge-safe boundary. **FORBIDDEN** to import `pg`, `postgres`, `drizzle-orm`, `@/lib/db/*`, `node:*`. Lint will block even if you forget |
| Auth — `src/lib/auth/index.ts`, `src/lib/auth/provision.ts` | spec §3.4 + `foundation_followups.md` | Node-side logic, does DB lookups. `provisionUserOnSignIn` is now atomic via INSERT ... ON CONFLICT — don't regress |
| Server Actions (`src/app/**/actions.ts`) | `foundation_followups.md` (Task 10/11 error UX gap) | Current pattern `throw new Error(...)` falls through to `error.tsx`. v1.1 will migrate to `useFormState` returning `{ ok: false, errors }` |
| Env vars, `.env.example`, `src/lib/env.ts` | `README.md` setup section + spec §3.4 | `.env.local` carries Google placeholders in dev; `.env.example` must reflect the exact shape. Always validate via zod before exporting |
| UI components (`src/app/**/*.tsx`, `src/components/**`) | `CLAUDE.md` boundary rules | Don't call Drizzle directly — always via `queries/*.ts`. Don't compose authz in routes — trust the guards inside queries |
| Integration tests (`tests/integration/*.test.ts`), setup (`tests/setup/global.ts`, `tests/setup/withTx.ts`, `tests/setup/db.ts`) | `CLAUDE.md` (`expectDbError`, strict-mode pattern, useTestDb pattern) | Single shared container + TRUNCATE-per-test pattern. `useTestDb()` must be called *inside* a `describe` block (ESLint rule `react-hooks/rules-of-hooks` flags top-level usage). Keep `fileParallelism: false` in `vitest.config.ts` |
| Deploy, CI, GitHub Actions | (create `.claude/docs/DEPLOYMENT.md` when needed) | No CI yet. When creating a workflow, populate `DEPLOYMENT.md` from the template |
| Stack: new dependencies in `package.json` | `CLAUDE.md` Stack section + spec §10 | Keep aligned with Next 16 / Drizzle 0.45 / NextAuth v5 beta / Vitest 4 / pnpm |

---

## Before destructive or irreversible actions

Stop and confirm if any of these fail:

- [ ] `bash ~/.claude/scripts/check-context.sh` shows no 🔴
- [ ] If DB: recent backup; migration tested via `pnpm test` (testcontainers already verifies apply); user authorized applying in prod
- [ ] If pushing to main: tests pass (currently 128/128); reviewer approved (per-task) or user authorized explicitly
- [ ] If publishing repo / creating cloud resource: user authorized name and visibility

Destructive: `rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, deleting published branches, amending pushed commits, deploying to production, creating public repo, deleting Postgres containers/volumes with data.

---

## Continuous maintenance

- **Whenever a doc is created/removed** in `docs/superpowers/specs|plans/` or `.claude/docs/`: update the table.
- **Whenever you discover a new risk area** not covered: add a row.
- **Keep it short**: this file is loaded into every session.
