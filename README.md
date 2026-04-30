# Incident App

A web-first incident management platform for multi-team organizations.

It supports the full incident lifecycle: declaration, war-room collaboration, timeline tracking, postmortems, webhook ingestion from external systems, public status pages, and operational metrics.

## Tech stack

- **Framework:** Next.js 16 (App Router) + React 19
- **Language:** TypeScript (strict)
- **Styling/UI:** Tailwind CSS v4
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Auth:** NextAuth v5 (Google OIDC)
- **Testing:** Vitest + Testcontainers (real Postgres in integration tests)
- **Package manager:** pnpm

## Core capabilities

### Internal app

- Google SSO sign-in with admin allowlist.
- Team and membership management.
- Service catalog with severity-specific runbooks.
- Incident declaration and filtering by severity/status/time window.
- Incident war-room with:
  - timeline events (notes, status changes, severity changes, role assignments)
  - role assignment (IC, Scribe, Comms)
  - guarded status transitions
  - false-positive dismissal flow
- Live incident updates across tabs via SSE + Postgres LISTEN/NOTIFY.

### Postmortems

- Postmortem generation from incidents.
- Rich postmortem editor workflow.
- Action-item tracking linked to postmortems/incidents.

### Webhook ingestion

- Webhook source management (secrets + endpoint creation).
- Signed webhook ingestion endpoints.
- Provider adapters for generic, Datadog, Grafana, and Sentry payload styles.
- Dead-letter handling for malformed/unusable inbound events.

### Public status pages

- Public status page routes.
- Active incident visibility for external consumers.
- Service/status summaries and incident detail pages.
- Public postmortem pages.

### Metrics

- Incident frequency charts.
- MTTA / MTTR visualizations.
- Severity mix and service heatmap views.
- Date range selection and aggregate metrics views.

## Project structure

- `src/app/` — Next.js routes and layouts
  - `src/app/(app)/` — authenticated internal product
  - `src/app/(public)/status/` — public status experience
  - `src/app/api/` — API routes (auth, stream, webhooks, postmortems)
- `src/lib/db/schema/` — Drizzle table definitions
- `src/lib/db/queries/` — database access/query layer
- `src/lib/ingest/` — webhook adapters + ingestion utilities
- `src/lib/realtime/` — SSE dispatch/notification plumbing
- `src/lib/status/` — status snapshot and uptime logic
- `tests/unit/` — unit tests
- `tests/integration/` — integration tests against Postgres container
- `drizzle/` — migrations + metadata

## Getting started

### 1) Configure environment

```bash
cp .env.example .env.local
```

Set required values in `.env.local` (at minimum):

- `AUTH_SECRET` (generate with `openssl rand -base64 32`)
- Google OAuth client values
- `ADMIN_EMAILS`
- Database connection values used by your local Postgres container

### 2) Install deps

```bash
pnpm install
```

### 3) Start Postgres + migrate

```bash
pnpm db:up
pnpm db:migrate
```

### 4) Run app

```bash
pnpm dev
```

Open: `http://localhost:3000`

## Scripts

- `pnpm dev` — run local dev server
- `pnpm build` — production build
- `pnpm start` — run production server
- `pnpm lint` — run ESLint
- `pnpm typecheck` — TypeScript no-emit checks
- `pnpm format` / `pnpm format:check` — Prettier write/check
- `pnpm test` — run all tests
- `pnpm test:watch` — watch mode
- `pnpm test:coverage` — coverage run
- `pnpm db:up` / `pnpm db:down` — manage local Postgres container
- `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:studio` — Drizzle workflows

## Testing philosophy

Integration tests run against a **real PostgreSQL instance** via testcontainers. This repo intentionally avoids DB mocks in integration coverage.

## License suggestion

If your goal is “free to use, modify, and share” with minimal friction and no commercial restriction, use the **MIT License**.

Why MIT is a strong fit here:

- Very permissive and widely understood.
- Allows personal, educational, and commercial use.
- Keeps attribution/disclaimer requirements simple.
- Maximizes adoption and contributions.

If you want to waive even more rights and push this close to public domain, consider **CC0-1.0** instead.
