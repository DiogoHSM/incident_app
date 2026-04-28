# Incident Tracker — Design Spec

**Date:** 2026-04-28
**Status:** Draft, awaiting user review
**Authors:** Diogo (with Claude as scribe)

## 1. Goal

Build a web-first incident coordination tool for an internal organization with multiple engineering teams under SSO. The app is the "war-room" during an active IT/DevOps/SRE incident: the team declares incidents in it, runs the live timeline in it, posts public status updates from it, and writes postmortems in it. Inbound webhooks from Sentry/Datadog/Grafana/generic sources pre-fill incidents to remove busywork.

This is **not** a PagerDuty replacement (no on-call rotations, no paging) and **not** a multi-tenant SaaS (single org). On-call paging and outbound notifications are deferred to a later version.

## 2. Scope

### In scope (v1)

- Declare, run, and resolve incidents through a web UI
- Live timeline with notes, status changes, role assignments, webhook events (server-sent events for real-time)
- Roles per incident: Incident Commander, Scribe, Communications
- Severity (SEV1–SEV4) and status (triaging, investigating, identified, monitoring, resolved)
- Service catalog with severity-keyed runbooks (markdown)
- Postmortem editor with templated sections, auto-imported timeline, action items (with optional Linear/Jira links)
- Public status page (org-wide and per-team), edge-cached, with current incidents and 7-day uptime bars
- Inbound webhooks from Sentry, Datadog, Grafana, and a generic source (HMAC-signed)
- Metrics dashboard: MTTR, MTTA, incident frequency, severity mix, per-service heatmap
- SSO authentication (OIDC/SAML) with first-login auto-provisioning
- Two-level role model: org admin/member + team lead/member

### Deferred (post-v1)

- On-call schedules and paging
- Outbound notifications (Slack, email) when incidents are declared or updated
- Splitting the public status page into a separate edge-deployed app
- Notification preferences per user
- Native mobile clients

### Non-goals

- Replacing the team's existing chat tool — Slack remains the conversation surface; this app is the structured record of the response.
- Replacing the team's existing issue tracker — action items can link out to Linear/Jira.

## 3. Architecture

### 3.1 Deployment

A single Next.js 15 (App Router) application deployed to one runtime (Vercel or self-host on Fly/Railway). Postgres (Neon, Supabase, or RDS) is the system of record. Drizzle ORM owns the schema and migrations.

### 3.2 Real-time

Live timeline updates use **Server-Sent Events**, not WebSockets:

- Each open incident page subscribes to `GET /api/incidents/[id]/stream`.
- Postgres `LISTEN/NOTIFY` is the fan-out mechanism. Channel `incident:[id]`. Every mutation that creates a `TimelineEvent` or changes `status`/`severity` emits `NOTIFY` inside the same DB transaction.
- The Next.js server process holds an open `LISTEN incident_updates` connection and routes notifications to its in-memory SSE clients. Horizontal scaling works because each client is connected to exactly one instance and each instance LISTENs independently.
- Heartbeat every 25 s (SSE comment line) to defeat proxy idle timeouts.
- `Last-Event-ID` reconnect support: on reconnect, the server backfills events from the DB.
- Clients that lose connection for more than 30 s show a yellow "reconnecting…" banner. After reconnect, the page re-fetches the canonical timeline from the DB and reconciles — the stream is never the source of truth alone.

### 3.3 Status page resilience

The public status page is **statically generated with ISR (`revalidate=15`)** plus Vercel edge cache. It reads from a denormalized `status_snapshot` table, updated whenever incident status changes, in the same transaction. So even if the DB is temporarily degraded, the cached page from up to 15 s ago keeps serving. A pre-deployed static fallback at `/status/maintenance` is the last line of defense.

The cost of this approach is up to 15 s of staleness; acceptable for v1. Post-v1 split into a separate edge-deployed status app is on the deferred list.

### 3.4 Auth

NextAuth v5, configured following the Edge/Node split: `auth.config.ts` is Edge-safe (used by middleware to gate routes), `auth.ts` does Node-runtime DB lookups. The IdP provider (Google Workspace, Okta, Azure AD, generic OIDC, SAML) is chosen via env var `AUTH_PROVIDER` and configured via env vars per deployment. Single org → single IdP, no tenant picker.

First-time users are auto-provisioned on successful SSO. `User.email` is the natural key; `sso_subject` (the IdP's stable subject claim) is stored to handle email changes. Initial admins come from an `ADMIN_EMAILS` env-var allowlist; after that, admins promote/demote each other in the UI.

No password login. No email-invite flow. Membership is gated by the IdP.

### 3.5 Authorization

Two role tiers:

1. **Org-level role** on `User` (`admin` | `member`). Admins access `/settings/*` (manage teams, webhook sources, view SSO config).
2. **Team-level role** on `TeamMembership` (`lead` | `member`). Leads can edit team services and runbooks; both can declare incidents and edit any open incident their team owns.

No per-incident permissions during a live response: anyone on the owning team can update anything. Speed beats granularity. The TimelineEvent log is the audit trail.

Authorization is enforced at the **data-access layer**, not the route handler. Pattern:

```
db.incidents.findForUser(userId, filters)   // joins team_membership
db.incidents.requireWrite(userId, incidentId) // throws if not on team
```

UI button-hiding is a courtesy. The Drizzle query helpers are the security boundary.

### 3.6 Multi-team scoping

`Service`, `Incident`, `Runbook`, and `WebhookSource` all carry `team_id`. Users see incidents from teams they belong to (admins see all). Cross-team incidents are owned by the *primary* team (the one that declared it); other teams gain visibility because their service is attached via `IncidentService`. This avoids a more complex multi-owner model in v1.

## 4. Domain model

### 4.1 Entities

**Team** — `id`, `name`, `slug`, `created_at`.

**User** — `id`, `email` (unique), `name`, `sso_subject`, `role` (`admin`|`member`), `created_at`.

**TeamMembership** — `team_id`, `user_id`, `role` (`lead`|`member`). Composite PK.

**Service** — `id`, `team_id` (owner), `name`, `slug`, `description`. Uniq (`team_id`, `slug`).

**Runbook** — `id`, `service_id`, `severity` (`SEV1`..`SEV4`), `markdown_body`, `updated_at`. Uniq (`service_id`, `severity`).

**Incident** — `id`, `public_slug`, `team_id`, `declared_by` (user_id), `severity`, `status`, `title`, `summary`, `declared_at`, `resolved_at?`, `ic_user_id?`, `scribe_user_id?`, `comms_user_id?`. `status` enum: `triaging`, `investigating`, `identified`, `monitoring`, `resolved`.

**IncidentService** — `incident_id`, `service_id`. Composite PK. M:M between incidents and affected services.

**TimelineEvent** — `id`, `incident_id`, `author_user_id?` (null for webhook), `kind`, `body` (jsonb), `occurred_at`. `kind` enum: `note`, `status_change`, `severity_change`, `role_change`, `webhook`, `postmortem_link`, `attachment`, `status_update_published` (the IC posting an update to the public page).

**Postmortem** — `id`, `incident_id` (unique, 1:1), `markdown_body`, `status` (`draft`|`published`), `published_at?`, `public_on_status_page` (bool, default false), `updated_at`.

**ActionItem** — `id`, `postmortem_id`, `assignee_user_id?`, `title`, `status` (`open`|`in_progress`|`done`|`wontfix`), `due_date?`, `external_url?`, `created_at`.

**WebhookSource** — `id`, `team_id`, `type` (`sentry`|`datadog`|`grafana`|`generic`), `name`, `secret_hash`, `default_severity`, `default_service_id?`, `auto_promote_threshold` (default 3), `auto_promote_window_seconds` (default 600), `created_at`.

**StatusSnapshot** — `scope` (PK; `'public'` or `team:{id}`), `payload` (jsonb: `{ services: [...], active_incidents: [...] }`), `updated_at`.

**DeadLetterWebhook** — `id`, `source_id?`, `received_at`, `headers` (jsonb), `body` (text), `error`. For manual replay.

### 4.2 Relationships

- Team 1—N Incident, 1—N Service, N—M User (via TeamMembership).
- Service 1—N Runbook (one per severity).
- Incident 1—N TimelineEvent, 1—1 Postmortem, N—M Service (via IncidentService).
- Postmortem 1—N ActionItem.
- WebhookSource produces TimelineEvent (kind=webhook) and may auto-create Incident.

### 4.3 Severity and status

- Severity is on Incident, four tiers (SEV1..SEV4). Defaultable per `WebhookSource` and per `Service`+severity `Runbook`.
- Status is the standard 5-state SRE lifecycle. `triaging` is distinct from `investigating` to mark "machine alerted, no human confirmed" vs "human is on it".

## 5. Information architecture

### 5.1 Authenticated routes

- `/dashboard` — landing page. Personal: active incidents, my open action items, recent postmortems, MTTR (7d).
- `/incidents` — list with chip filters (status, severity, team, time). Default: last 30 days.
- `/incidents/new` — declare new (or open with pre-filled fields from a webhook).
- `/incidents/[slug]` — the war-room. Two-column layout: timeline (left, primary), context rail (right, runbooks + quick actions). Roles bar pinned to header. Sidebar collapses for focus.
- `/incidents/[slug]/postmortem` — RCA editor with action items rail.
- `/services` — directory, per team.
- `/services/[slug]` — overview + runbooks.
- `/services/[slug]/runbooks/[severity]` — markdown editor.
- `/metrics` — MTTR, MTTA, incident frequency, severity mix, per-service heatmap.
- `/settings/*` — admin only: teams, webhooks, SSO config (read-only display), profile.

### 5.2 Public routes (no auth)

- `/status` — org-wide. Statically generated, ISR every 15 s.
- `/status/[team]` — team-scoped.
- `/status/incidents/[slug]` — public view of a single incident; only "status update" timeline events shown, not internal notes.

### 5.3 API routes

- `POST /api/webhooks/[source-id]` — inbound, HMAC-signed.
- `GET /api/incidents/[id]/stream` — SSE.
- Other CRUD goes through Server Actions or fetch+zod-validated route handlers — chosen per-endpoint, not standardized as tRPC for v1.

### 5.4 Navigation rules

- Dashboard is home. The sidebar shows the five top-level sections (Dashboard, Incidents, Services, Metrics, Settings). Underneath, a passive list of the user's teams is shown as labels (no click-to-switch).
- **No team switcher anywhere in the app.** Team filtering only happens via the chip filter inside list views. This avoids the "wrong team selected" failure mode during incidents (where global state silently scopes what you see).
- Inside an active incident page, the sidebar collapses to give the timeline maximum width — a distinct "responding" mode vs the default "browsing" mode.

## 6. Key screens

### 6.1 War-room (`/incidents/[slug]`)

- Header: severity pill, status pill, title, declared-by + duration, affected services, team. Roles bar (IC/Scribe/Comms) pinned underneath.
- Left column (primary): timeline input box at top (markdown, paste images/logs, attach, link runbook), then the event feed flowing down. Each event shows time, icon, actor, body, kind badge.
- Right rail: Quick actions (Update status, Change severity, Assign role, Post update to /status, Mark resolved); Affected services; Runbooks (auto-filtered to current severity + affected services); Linked alerts; Postmortem trigger.
- Top bar: live indicator + viewer count ("🟢 Live · 4 viewers").
- Keyboard: `D` declares new (from list), `R` opens "mark resolved" confirm, `S` opens "update status".

### 6.2 Dashboard (`/dashboard`)

- 4 stat cards: Active / Open RCAs / My actions / MTTR (7d).
- Active incidents panel: rows with severity, status, title, age, IC.
- My open action items panel.
- Recent postmortems panel.

### 6.3 Incidents list (`/incidents`)

- Top: title + count + red "Declare incident" button (top-right).
- Chip filter bar: status, severity, team, time range.
- Table rows: severity, status, title, primary service, started.

### 6.4 Postmortem editor

- Header: severity/status pills, "draft" or "published" pill, title, date + duration.
- Body: templated markdown sections — Summary, Timeline (auto-imported, editable), Root cause, What went well, What didn't.
- Right rail: Action items (each with assignee, due date, optional external link to Linear/Jira), "+ Add action item" button, Publish button. Publish flips draft→published; a separate toggle controls whether the postmortem is visible on the public status page.
- Autosave every 800 ms after last keystroke. Inline status: "saved 12 s ago" or "⚠ retry".

### 6.5 Public status page (`/status`)

- Brand line at top.
- Overall banner: green "All systems operational" / yellow "Some systems degraded" / red "Major outage".
- Active incidents: cards with title and reverse-chronological status updates (newest at top). Only `status_update_published` timeline events; never internal notes.
- Services: rows with status dot (green/yellow/red), name, status label, 30-day uptime %.
- 7-day bar: one bar per day, color-coded by worst severity that day.

## 7. Webhook ingestion

### 7.1 Flow

1. `POST /api/webhooks/[source-id]` — provider's payload + `X-Signature` HMAC.
2. Verify HMAC against the source's `secret_hash`. Reject with 401 if invalid.
3. Per-source adapter normalizes the payload to `NormalizedAlert { title, fingerprint, severity, services, source_url, raw }`.
4. Match: look up open incidents (`status != resolved`) by fingerprint.
   - **Match found** → append `TimelineEvent { kind: 'webhook' }`. Live SSE pushes the event to anyone watching.
   - **No match** → create `Incident { status: 'triaging', severity: source.default_severity }` with title pre-filled. Affected services come from the alert when present, otherwise from `source.default_service_id` (used as a fallback only when nothing in the payload identifies a service).

### 7.2 Fingerprints (per source)

- Sentry: `issue.id`.
- Datadog: `alert.id + monitor.id`.
- Grafana: `alert.uid`.
- Generic: `fingerprint` field in payload (required, no inference).

### 7.3 Triaging state

- Webhook-created incidents start in `status=triaging`. Distinct from `investigating` — no human has confirmed yet.
- Dashboard "Active" panel shows them with a ⚠ "unconfirmed" tag.
- **Manual promotion**: anyone on the owning team can promote a triaging incident → `investigating` (must assign an IC at that point) or dismiss it as a false positive (archived but counted for metrics).
- **Automatic severity bump**: independent of status. If `auto_promote_threshold` alerts hit the same fingerprint within `auto_promote_window_seconds`, the incident's severity bumps one tier up (max SEV1) and a `severity_change` TimelineEvent is recorded. Defaults: 3 alerts in 600 s. Status stays at `triaging` until a human promotes it. This rule never demotes severity.

### 7.4 Adapter structure

`/lib/ingest/adapters/{sentry,datadog,grafana,generic}.ts`. Each exports:

```
export function verify(req: Request, secret: string): boolean
export function normalize(payload: unknown): NormalizedAlert
```

Pure functions. Tested with captured payloads in `__fixtures__`.

### 7.5 Failure handling

- DB unavailable: webhook returns 503; Sentry/Datadog will retry. Payload also written to `dead_letter_webhooks` for manual replay.
- Invalid signature: 401, log only (no body retained).
- Adapter throws (malformed payload): 422, payload written to `dead_letter_webhooks`.

## 8. Real-time, error handling, and resilience

### 8.1 Optimistic UI

- **Timeline notes** are optimistic: insert client-side as `pending`, replace with the canonical SSE-echoed version. On failure, mark `error` with retry. Dropped messages are visible.
- **Status / severity changes** are NOT optimistic. They have side-effects (`status_snapshot` update, `NOTIFY`); the user must see them confirmed.

### 8.2 Reconnect

- 30 s without server pings → yellow "reconnecting…" banner.
- On reconnect, the page re-fetches the timeline (last 100 events) and reconciles with what's on screen.
- Page reload always works as a hard reset. Never auto-reload mid-incident.

### 8.3 Postmortem autosave

- Debounce 800 ms after last keystroke → POST `/api/postmortems/[id]`.
- Inline status: "saved 12 s ago" / "⚠ retry" / "✗ offline (changes preserved locally)".
- Local state holds full content; if save fails, the user can refresh without loss as long as the tab stays open.

### 8.4 Status page

- ISR cache (`revalidate=15`) + edge cache. DB hit only on cache miss.
- If both DB and cache fail, Vercel serves the pre-deployed `/status/maintenance` static fallback.

### 8.5 Type safety at boundaries

- `zod` schemas on every input: webhook payloads, form inputs, API request/response.
- Drizzle row types are inferred; no parallel "model" classes.
- Server↔client: native `fetch` + zod-validated route handlers in v1. Add tRPC if/when type-sharing pain justifies it.

### 8.6 Observability

- OpenTelemetry traces, exporter chosen via env var (org's existing setup).
- One trace per webhook ingestion, per page view, per mutating Server Action.
- Log levels: `info` for ingestion + state changes, `warn` for retries + reconnects, `error` for crashes.

## 9. Testing strategy

Three layers, in order of value:

1. **Integration tests against a real Postgres** (~70% of test budget). Vitest + `pg-tmp` or `testcontainers`. Apply Drizzle migrations to a fresh DB per run. Cover the data-access layer and authorization rules. Mocking the DB is forbidden — past projects have been burned by mock/prod divergence.
2. **Adapter unit tests** (~20%). Each webhook adapter tested with real captured payloads stored in `__fixtures__/`. Pure functions, fast.
3. **End-to-end Playwright** (~10%). Three flows: declare incident → resolve, webhook → triage → promote, postmortem create → publish.

If a feature has no test, it is not in v1.

## 10. Stack summary

- **Runtime:** Next.js 15 (App Router) on Node, deployable to Vercel or Fly/Railway.
- **DB:** Postgres (Neon, Supabase, or RDS).
- **ORM:** Drizzle.
- **Auth:** NextAuth v5, Edge/Node split, OIDC/SAML provider via env var.
- **UI:** Tailwind + shadcn/ui.
- **Real-time:** Server-Sent Events backed by Postgres LISTEN/NOTIFY.
- **Validation:** zod at all boundaries.
- **Testing:** Vitest + Playwright.
- **Observability:** OpenTelemetry.
- **Package manager:** pnpm.
- **Language:** TypeScript everywhere.

## 11. Build sequence (rough)

This is sketched here for context; the implementation plan will own the concrete sequence.

1. Repo scaffold, env, CI.
2. Drizzle schema + migrations + auth (SSO + Edge/Node split + admin allowlist).
3. Teams, services, runbooks (CRUD + tests).
4. Incidents (declare, list, detail page sans real-time).
5. Timeline events + SSE stream + LISTEN/NOTIFY.
6. Roles + status/severity changes.
7. Postmortem editor + action items.
8. Webhook ingestion (one adapter at a time: generic → sentry → datadog → grafana).
9. Status page (denormalized snapshot, ISR rendering).
10. Metrics dashboard.
11. Polish, accessibility pass, observability wiring, deploy.

## 12. Open questions for follow-up

- **Outbound notifications.** Currently deferred. The team should confirm before merge that they're comfortable with "no Slack/email when an incident is declared" in v1, since it breaks the "team finds out about incidents" loop unless they're already in the dashboard.
- **Status page domain.** Internal subdomain (e.g., `status.acme.internal`) or public (e.g., `status.acme.com`)? Affects DNS, TLS, and edge cache config.
- **Hosting target.** Vercel vs Fly/Railway? Affects ISR + edge cache implementation and OTel exporter config.
- **OIDC vs SAML.** Which IdP does the org use? Affects which provider config to wire up first.
- **Severity tiers.** Spec commits to SEV1–SEV4. If the org uses 3 tiers or P0–P3 conventions, change the enum in the migration before it's applied — it's a small fix early on, painful later.

## 13. Decisions log

- **Web-first, not Slack-first.** Confirmed — this app is the war-room, Slack is just chat.
- **Single org, multi-team, SSO.** Confirmed.
- **Coordination, not paging.** Confirmed.
- **Status page in the same Next.js app, ISR-cached.** Pragmatic v1; split is on the deferred list.
- **No outbound notifications in v1.** Flagged as a risk (see open questions).
- **`triaging` is its own status.** Distinguishes machine-alerted from human-confirmed.
- **Roles as columns on Incident, not a separate table.** Simpler, with role-change history captured in TimelineEvent.
- **Authorization at the data-access layer.** Drizzle query helpers are the boundary; UI gating is courtesy.
- **Integration tests hit a real Postgres.** Mocking the DB is forbidden.
