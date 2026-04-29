# incident_app

Web-first incident tracker for an internal multi-team org. See `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` for the full design and `docs/superpowers/plans/2026-04-28-foundation.md` for the foundation plan that produced the current code.

## Stack

Next.js 16 · TypeScript (strict + `noUncheckedIndexedAccess`) · Tailwind v4 · Drizzle ORM + Postgres 16 · NextAuth v5 (Google OIDC) · Vitest + testcontainers · pnpm.

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
pnpm test          # vitest run (31 tests, ~5s with testcontainers)
pnpm build         # next build
```

Integration tests use real Postgres via testcontainers. **No DB mocks anywhere in the codebase.**

## Layout

- `src/app/` — Next.js routes (route groups: `(app)` for auth-walled, `(auth)` for sign-in)
- `src/app/api/` — auth callback + future webhooks
- `src/lib/db/queries/` — only place that talks to the DB
- `src/lib/authz/` — `requireAdmin`, `requireTeamMember`, `ForbiddenError`
- `src/lib/auth/` — NextAuth Edge/Node split (`config.ts` Edge-safe, `index.ts` Node)
- `src/lib/env.ts` — zod-validated env loader
- `src/components/shell/` — top-level layout primitives (Sidebar, Header)
- `tests/integration/` — Vitest + testcontainers integration tests
- `tests/unit/` — pure unit tests
- `tests/setup/` — `db.ts` (testcontainers harness), `test-env.ts` (env stubs)
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
11. [ ] Sign out. Visit `/dashboard` direct → redirected to `/signin`.

If any step fails, see `.claude/memory/foundation_followups.md` for known v1.1 issues.

## Plan 1 deferred items

A number of code-review issues were intentionally deferred to a v1.1 cleanup pass. They're tracked in `.claude/memory/foundation_followups.md`. Notably:

- Concurrent first-login race in `provisionUserOnSignIn`
- End-to-end auth chain test
- Admin-sees-all inconsistency in services queries
- N+1 user lookups in settings page
- Server Action error handling via `useFormState`
- testcontainer scaling (likely needs single-shared-container before Plan 2)

Address these in v1.1 before any production rollout.

## What's next

This repo currently delivers Plan 1 (Foundation) only. Plans 2–8 will add: incidents core, real-time SSE, postmortems, webhooks, status page, metrics, and final polish. See the design spec for the full scope.
