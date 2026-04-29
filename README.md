# incident_app

Web-first incident tracker for an internal multi-team org. See `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` for the full design and the plans under `docs/superpowers/plans/` for the per-phase implementation work.

## Stack

Next.js 16 · TypeScript (strict + `noUncheckedIndexedAccess`) · Tailwind v4 · Drizzle ORM + Postgres 16 · NextAuth v5 (Google OIDC) · Vitest + testcontainers · pnpm.

## What works today

- Plan 1 (Foundation): SSO sign-in (Google OIDC), org admin allowlist, teams + memberships, services, severity-keyed runbooks editor, sidebar shell.
- Plan 2 (Incidents core): declare an incident with severity + summary + affected services; chip-filtered list view with admin-sees-all parity; per-incident detail page showing header, summary, affected services, and severity-keyed runbooks.

Coming next (per spec §11): live timeline + SSE (Plan 3), role mutations and status/severity transitions including "Mark resolved" (Plan 4), postmortems (Plan 5), webhook ingestion (Plan 6), public status page (Plan 7), metrics dashboard (Plan 8).

## Local setup

```bash
cp .env.example .env.local
# Generate AUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Paste into .env.local for AUTH_SECRET.
# Add your email to ADMIN_EMAILS=

# Wire Google OAuth: https://console.cloud.google.com/apis/credentials
#  - Create OAuth client (Web application)
#  - Authorized redirect URI: http://localhost:3000/api/auth/callback/google
#  - Paste client ID and secret into .env.local

pnpm install
pnpm db:up         # boot Postgres 16 container on port 5433
pnpm db:migrate    # apply schema migrations
pnpm dev           # http://localhost:3000
```

## Quality gates

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint .
pnpm format:check  # prettier --check .
pnpm test          # vitest run (55 tests, ~5s with one shared testcontainer)
pnpm build         # next build
```

Integration tests use real Postgres via testcontainers (single container shared across all files, TRUNCATE between tests). **No DB mocks anywhere in the codebase.**

## Layout

- `src/app/` — Next.js routes (route groups: `(app)` for auth-walled, `(auth)` for sign-in)
- `src/app/(app)/incidents/` — list, declare, detail, plus `_components/` for SeverityPill / StatusPill / FilterChips / IncidentRow
- `src/app/api/` — auth callback + future webhooks
- `src/lib/db/queries/` — only place that talks to the DB
- `src/lib/incidents/` — incident-specific helpers (slug generator)
- `src/lib/authz/` — `requireAdmin`, `requireTeamMember`, `ForbiddenError`
- `src/lib/auth/` — NextAuth Edge/Node split (`config.ts` Edge-safe, `index.ts` Node)
- `src/lib/env.ts` — zod-validated env loader
- `src/components/shell/` — top-level layout primitives (Sidebar, Header)
- `tests/integration/` — Vitest + testcontainers integration tests
- `tests/unit/` — pure unit tests
- `tests/setup/` — `global.ts` (boots one container per run), `withTx.ts` (`useTestDb`/`getTestDb`/`expectDbError`), `db.ts` (re-export shim), `test-env.ts` (env stubs)
- `drizzle/` — generated SQL migrations

## Acceptance checklist

After running `pnpm dev` against a real Google OAuth client:

1. [ ] Visit `http://localhost:3000` → redirected to `/signin`.
2. [ ] Click "Sign in with Google" with the email in `ADMIN_EMAILS`. Land on `/dashboard` showing your name.
3. [ ] Sidebar shows: Dashboard, Incidents, Services, Metrics, Settings (Settings only visible to admin).
4. [ ] Visit `/settings/teams`. Create a team `Payments` with slug `payments`.
5. [ ] Sign out. Sign in with a non-admin Google account (different email). Land on `/dashboard`. Settings link is **hidden**.
6. [ ] Direct-visit `/settings/teams` as non-admin → redirected to `/dashboard`.
7. [ ] Sign back in as admin. On `/settings/teams`, add the second user's email as a `member` of `Payments`.
8. [ ] Sign in as the second user. Visit `/services` → "No services yet" (or empty list).
9. [ ] Click "New service". Pick `Payments` from the team selector. Name `checkout-api`, slug `checkout-api`. Submit.
10. [ ] Land on `/services/checkout-api`. Click `SEV2`. Type a markdown body. Save. Reload — body persists.
11. [ ] Visit `/incidents` → empty state. Click **Declare incident**, set title `Login latency`, severity `SEV2`, attach `checkout-api`, submit.
12. [ ] Land on `/incidents/inc-XXXXXXXX` — see severity/status pills, title, declared timestamp + duration, the attached service, and the SEV2 runbook entry for it.
13. [ ] Back on `/incidents`, the row appears. Click chips to filter by status/severity/window — URL updates and the list re-filters.
14. [ ] Sign in as a member of a different team — `/incidents` is empty (their team has no incidents).
15. [ ] Sign in as admin — `/incidents` shows everything across teams.
16. [ ] Sign out. Visit `/dashboard` directly → redirected to `/signin`.

If any step fails, see `.claude/memory/foundation_followups.md` for known v1.1 issues.

## Deferred follow-ups

A number of code-review issues were intentionally deferred to a v1.1 cleanup pass. They're tracked in `.claude/memory/foundation_followups.md`. The three Plan 2 prereqs flagged by the Plan 1 reviewer (testcontainer scaling, admin-sees-all in services queries, `provisionUserOnSignIn` race) are now resolved in Plan 2; remaining items include:

- End-to-end auth chain test
- N+1 user lookups in settings page
- Server Action error handling via `useFormState`
- Severity enum source-of-truth consolidation (resolved in Plan 2)
- `users.email` citext / `lower()` CHECK constraint
- `AdapterUser` type augmentation (drops the `as` casts in auth)
- `middleware.ts` → `proxy.ts` rename for Next 16

Address these in v1.1 before any production rollout.
