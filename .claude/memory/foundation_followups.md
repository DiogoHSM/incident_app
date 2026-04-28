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

### Task 4 — testcontainers scaling
Per-file testcontainers will hurt by Task 9-12 (5+ integration files). Decide before starting Task 9 between:
- Cheap: `vitest.config.ts` `fileParallelism: false` (containers boot serially).
- Right: single shared container + `BEGIN/ROLLBACK` per test (5x faster at scale).
