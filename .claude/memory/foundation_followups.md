---
name: Foundation phase deferred follow-ups
description: Items flagged during code review of Plan 1 tasks that are intentionally deferred to v1.1 — track here so they don't get lost.
type: project
---

Deferred items from Plan 1 (Foundation) code reviews. Should be addressed before v1 ships, but were deferred to keep Plan 1 tight.

**Why:** Each item was flagged Important by the code reviewer but is non-blocking for the next plan(s). Tracking here so a v1.1 cleanup pass picks them up.

**How to apply:** Open this file when planning v1.1; convert each item into a Linear/TODO entry; tackle in order of risk.

## Items

### Task 6 — Edge boundary
- Consider renaming `src/middleware.ts` → `src/proxy.ts` to align with Next.js 16's `proxy` convention (Next 16 emits a deprecation warning otherwise). Just a rename + update the route gate in the file.

### Task 7 — Auth provisioning
1. **Concurrent first-login race in `provisionUserOnSignIn`** (`src/lib/auth/provision.ts`). SELECT-then-INSERT is not atomic. Fix: replace with `INSERT ... ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, sso_subject=EXCLUDED.sso_subject RETURNING *`. Role omitted from SET preserves existing role on re-login.
2. **End-to-end auth propagation chain untested.** Currently only `provisionUserOnSignIn` is tested. The signIn → jwt → session chain is glued by `(user as ...).role` mutation. Add a smoke test that runs all three callbacks in sequence and asserts `session.user.role`. Plan to write this in Task 8 (sign-in page) so the live flow is exercised.
3. **`users.email` is `text`, not citext, no `lower()` CHECK.** External writers could still insert mixed-case duplicates. Cheapest fix: add `CHECK (email = lower(email))` via a follow-up migration. Or `UNIQUE INDEX ... ON (lower(email))`.
4. **`AdapterUser` augmentation missing.** `(user as { role?: ... }).role` casts in `auth/config.ts` and `auth/index.ts` exist because the type augmentation only widens `User`, not `AdapterUser`. Augment `AdapterUser` from `next-auth/adapters` and the casts can drop.
5. **`.env.local` Google credential placeholders** are an undocumented build hack. Document in `.env.example` (a comment line) so the next dev knows why `pnpm build` works but Google sign-in doesn't.
6. **Missing edge-case provision tests:** case-insensitive lookup test (`Foo@X.co` → must hit existing `foo@x.co` row, not unique-violate); empty email rejection at provision boundary; `ssoSubject` overwrite is intentional → add a comment in `provision.ts`.

### Task 10 — Services queries
1. **`listServicesForUser` doesn't honor admin-sees-all** (`src/lib/db/queries/services.ts:7`). Authz helpers admit admins regardless of membership, but list query only joins on `team_memberships`. Inconsistent: admin without explicit memberships gets an empty list. Fix: branch on `user.role === 'admin'` and return all services. Add a regression test. Same issue affects `findServiceBySlugForUser`.
2. **`findServiceBySlugForUser` does list-then-filter** in Node memory. Replace with `select services where slug = ? AND team_id IN (membership subquery)` when traffic justifies. Defer.
3. **Server Action `createServiceAction` has no `useFormState` wiring.** Zod parse failures + unique-constraint errors propagate to `error.tsx` as 500s instead of inline form errors. Add `useFormState` and return `{ ok: false, errors }` from the action.
4. **`updateService` is unused so far.** Annotate as "used by Task 12 settings page" or drop until needed.

### Task 11 — Runbooks
1. **Admin-sees-all leak compounds in editor route.** `findServiceBySlugForUser` 404s admins without team membership, but `requireTeamMember` would let them write. Same root cause as Task 10's services list. Single fix should close both.
2. **`saveRunbookAction` rethrows raw zod / generic errors.** Same as Task 10's `createServiceAction` — needs structured result type.
3. **Textarea has no `maxLength`** matching the server-side `max(50_000)` zod limit. Quick UX fix.
4. **Test gaps:** `getRunbook` outsider denial, `updatedAt` strictly advances on upsert update.
5. **Three sources of truth for `Severity`** (queries/runbooks.ts, page.tsx, actions.ts zod enum). Consolidate via export from `schema/services.ts`.
6. **`page.tsx` returns `null` for no session** instead of `redirect('/signin')`. Safer fallback.

### Task 12 — Settings UI
1. **N+1 user lookup in page render.** `Promise.all(allUserIds.map(findUserById))` issues one query per member. Replace with `inArray(users.id, ids)` single query — same pattern as Tasks 10/11 batching debt.
2. **No "no teams yet" empty state.** Page renders an empty section when no teams. Add a one-liner.
3. **Negative tests missing for 3 of 4 admin queries.** Only `createTeamAsAdmin` tests the non-admin rejection path. `addMembershipAsAdmin`, `listTeamsWithMemberships`, `removeMembershipAsAdmin` rely on `requireAdmin` but aren't tested for it. Add 3 negative tests so refactoring doesn't accidentally drop the guard.

### Task 4 — testcontainers scaling
Per-file testcontainers will hurt by Task 9-12 (5+ integration files). Decide before starting Task 9 between:
- Cheap: `vitest.config.ts` `fileParallelism: false` (containers boot serially).
- Right: single shared container + `BEGIN/ROLLBACK` per test (5x faster at scale).
