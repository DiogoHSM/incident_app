# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Next.js + Postgres app where users can SSO in, see their teams, and manage services + runbooks. No incidents yet.

**Architecture:** Monolithic Next.js 15 (App Router) on Node, TypeScript-strict, Drizzle ORM against a Postgres container. NextAuth v5 with the Edge/Node split — `auth.config.ts` is Edge-safe (used by middleware), `auth.ts` does Node DB lookups. Authorization is enforced at the data-access layer via Drizzle helpers. Tests use Vitest with real Postgres (testcontainers) — no DB mocks.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM, Postgres 16, NextAuth v5, Vitest + testcontainers, pnpm.

**Spec reference:** `docs/superpowers/specs/2026-04-28-incident-tracker-design.md`. This plan implements §3.4 (auth), §3.5 (authorization), §3.6 (multi-team scoping), §4.1 entities (User, Team, TeamMembership, Service, Runbook), §5.1 partial (`/services/*`, `/settings/teams`, `/dashboard` placeholder), §9 (test infra).

---

## File structure (lockdown)

```
.
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (sidebar shell)
│   │   ├── page.tsx                # Redirects to /dashboard
│   │   ├── (app)/
│   │   │   ├── layout.tsx          # Authenticated shell
│   │   │   ├── dashboard/page.tsx  # Placeholder, "Hello {user.name}"
│   │   │   ├── services/
│   │   │   │   ├── page.tsx        # List
│   │   │   │   ├── new/page.tsx    # Create form
│   │   │   │   └── [slug]/
│   │   │   │       ├── page.tsx    # Detail + runbooks list
│   │   │   │       └── runbooks/[severity]/page.tsx  # Markdown editor
│   │   │   └── settings/
│   │   │       └── teams/page.tsx  # Admin-only: teams + memberships
│   │   ├── (auth)/
│   │   │   └── signin/page.tsx     # SSO entry point
│   │   └── api/
│   │       └── auth/[...nextauth]/route.ts
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts           # Postgres client + drizzle instance
│   │   │   ├── schema/
│   │   │   │   ├── index.ts        # Re-exports
│   │   │   │   ├── users.ts
│   │   │   │   ├── teams.ts
│   │   │   │   ├── team-memberships.ts
│   │   │   │   ├── services.ts
│   │   │   │   └── runbooks.ts
│   │   │   └── queries/
│   │   │       ├── users.ts
│   │   │       ├── teams.ts
│   │   │       ├── services.ts
│   │   │       └── runbooks.ts
│   │   ├── authz/
│   │   │   └── index.ts            # requireAdmin, requireTeamMember, etc.
│   │   ├── auth/
│   │   │   ├── config.ts           # Edge-safe (NextAuth v5 split)
│   │   │   └── index.ts            # Node — auth() helper, signIn callback
│   │   └── env.ts                  # Validated env via zod
│   ├── components/
│   │   ├── shell/
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   └── ui/                     # shadcn/ui generated
│   └── middleware.ts               # Route gate via auth.config
├── tests/
│   ├── setup/
│   │   └── db.ts                   # testcontainers boot, migration apply, helpers
│   ├── integration/
│   │   ├── users.test.ts
│   │   ├── teams.test.ts
│   │   ├── services.test.ts
│   │   ├── runbooks.test.ts
│   │   └── authz.test.ts
│   └── unit/
│       └── env.test.ts
├── drizzle/                         # generated migrations
├── drizzle.config.ts
├── docker-compose.yml               # Local Postgres only
├── vitest.config.ts
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── package.json
├── .env.example
├── .eslintrc.json
└── README.md
```

**Boundaries:**
- `src/lib/db/queries/*.ts` are the **only** code that calls Drizzle directly. Routes, Server Actions, components import from here.
- `src/lib/authz/index.ts` wraps every query that takes a `userId` with the right team-membership check. Routes never compose authz logic themselves.
- `src/lib/auth/config.ts` must be **Edge-safe** — no `pg`, no `node:*`, no Drizzle. Only the JWT/session shape and provider declaration.
- `tests/setup/db.ts` is the only place that knows about testcontainers. Tests import a `withDb()` helper.

---

## Task 1: Scaffold Next.js, TypeScript, Tailwind, ESLint, Prettier

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.prettierrc`, `.prettierignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `next-env.d.ts`, `README.md`

- [ ] **Step 1: Run create-next-app**

```bash
pnpm dlx create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-eslint \
  --no-turbopack \
  --use-pnpm
```

If it complains about non-empty directory, accept overwrites only for files it creates by default; the existing `CLAUDE.md`, `.claude/`, `docs/`, `.gitignore` must be preserved.

Expected: `package.json`, `tsconfig.json`, `src/app/{layout.tsx,page.tsx,globals.css}`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs` exist.

- [ ] **Step 2: Add lint + format dev deps**

```bash
pnpm add -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-next prettier eslint-config-prettier
```

- [ ] **Step 3: Write `.eslintrc.json`**

```json
{
  "root": true,
  "extends": ["next/core-web-vitals", "next/typescript", "prettier"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

- [ ] **Step 4: Write `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 5: Write `.prettierignore`**

```
.next
node_modules
drizzle
pnpm-lock.yaml
```

- [ ] **Step 6: Tighten `tsconfig.json`**

`create-next-app` generates a `tsconfig.json` with `strict: true`. Add three more flags. The `compilerOptions` object should include these (merge with whatever else is there):

```jsonc
{
  "compilerOptions": {
    // ...existing options stay (target, jsx, paths, plugins, etc.)
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

After editing, run `pnpm typecheck` to make sure the existing scaffold still compiles under the tightened flags. If `noUncheckedIndexedAccess` flags any code in `src/app/` that came from the scaffold, fix the access patterns to use optional chaining or guards (do not weaken the flag).

- [ ] **Step 7: Add scripts to `package.json`**

In `"scripts"`:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

- [ ] **Step 8: Replace `src/app/page.tsx` with a minimal placeholder**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">incident_app — foundation</h1>
    </main>
  );
}
```

- [ ] **Step 9: Verify dev server runs**

```bash
pnpm dev
```

Expected: `▲ Next.js 15.x.x` boot message, `http://localhost:3000` reachable. Visit it in a browser; you see "incident_app — foundation". Stop with `Ctrl+C`.

- [ ] **Step 10: Verify typecheck and lint pass**

```bash
pnpm typecheck
pnpm lint
```

Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore(foundation): scaffold Next.js 15 + TS strict + Tailwind + ESLint/Prettier"
```

---

## Task 2: Add Vitest with one passing smoke test

**Files:**
- Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`
- Modify: `package.json` (scripts), `.gitignore` (coverage)

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest @vitest/coverage-v8
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Write the failing test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 5: Append coverage to `.gitignore`**

Add a line: `coverage/`

- [ ] **Step 6: Run the test**

```bash
pnpm test
```

Expected: `1 passed`. Exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(foundation): add Vitest with smoke test"
```

---

## Task 3: Postgres via docker-compose + Drizzle setup

**Files:**
- Create: `docker-compose.yml`, `drizzle.config.ts`, `src/lib/db/client.ts`, `src/lib/db/schema/index.ts`, `src/lib/env.ts`, `.env.example`, `.env.local` (gitignored)

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add drizzle-orm postgres zod
pnpm add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: incident_app_pg
    ports:
      - '5433:5432'
    environment:
      POSTGRES_USER: incident
      POSTGRES_PASSWORD: incident
      POSTGRES_DB: incident_app
    volumes:
      - incident_app_pg:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U incident -d incident_app']
      interval: 2s
      timeout: 3s
      retries: 10

volumes:
  incident_app_pg:
```

We pick port `5433` so it doesn't collide with a host Postgres on 5432.

- [ ] **Step 3: Write `.env.example`**

```
DATABASE_URL=postgres://incident:incident@localhost:5433/incident_app

# Comma-separated emails of users who become admin on first SSO login.
ADMIN_EMAILS=

# NextAuth v5
AUTH_SECRET=
AUTH_URL=http://localhost:3000

# Auth provider — set this for the IdP you want active.
# Supported in v1: google
AUTH_PROVIDER=google
AUTH_GOOGLE_CLIENT_ID=
AUTH_GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 4: Copy `.env.example` to `.env.local`**

```bash
cp .env.example .env.local
```

Set a real `AUTH_SECRET` for local dev:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the result into `.env.local` for `AUTH_SECRET`. Leave Google credentials empty for now.

- [ ] **Step 5: Write `src/lib/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.string().url(),
  AUTH_PROVIDER: z.enum(['google']),
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
```

- [ ] **Step 6: Write the failing env test**

`tests/unit/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const schema = z.object({
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
});

describe('env.ADMIN_EMAILS', () => {
  it('parses a comma-separated list, lowercases, trims, filters empty', () => {
    const out = schema.parse({ ADMIN_EMAILS: 'A@b.co , c@d.co,, e@f.co ' });
    expect(out.ADMIN_EMAILS).toEqual(['a@b.co', 'c@d.co', 'e@f.co']);
  });

  it('defaults to empty array', () => {
    const out = schema.parse({});
    expect(out.ADMIN_EMAILS).toEqual([]);
  });
});
```

- [ ] **Step 7: Run, see it pass**

```bash
pnpm test
```

Expected: 3 tests pass (smoke + 2 env).

- [ ] **Step 8: Write `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 9: Write `src/lib/db/schema/index.ts` (empty for now)**

```ts
// Schemas are re-exported from this barrel as they're added.
export {};
```

- [ ] **Step 10: Write `src/lib/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

const queryClient = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
```

- [ ] **Step 11: Add `dotenv` and `drizzle-kit` scripts to `package.json`**

```json
{
  "db:up": "docker compose up -d postgres",
  "db:down": "docker compose down",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio"
}
```

Install dotenv-cli for CLI scripts that need .env.local:

```bash
pnpm add -D dotenv-cli
```

Wrap `db:generate` and `db:migrate`:

```json
{
  "db:generate": "dotenv -e .env.local -- drizzle-kit generate",
  "db:migrate": "dotenv -e .env.local -- drizzle-kit migrate",
  "db:studio": "dotenv -e .env.local -- drizzle-kit studio"
}
```

- [ ] **Step 12: Boot Postgres and verify connectivity**

```bash
pnpm db:up
docker compose exec postgres pg_isready -U incident -d incident_app
```

Expected: `accepting connections`.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore(foundation): postgres compose + drizzle config + env schema"
```

---

## Task 4: Schema for users, teams, team_memberships + integration tests

**Files:**
- Create: `src/lib/db/schema/users.ts`, `src/lib/db/schema/teams.ts`, `src/lib/db/schema/team-memberships.ts`, `tests/setup/db.ts`, `tests/integration/users.test.ts`, `tests/integration/teams.test.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Install testcontainers**

```bash
pnpm add -D testcontainers @testcontainers/postgresql
```

- [ ] **Step 2: Write `tests/setup/db.ts`**

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import * as schema from '@/lib/db/schema';

export type TestDB = PostgresJsDatabase<typeof schema>;

export interface TestDBContext {
  container: StartedPostgreSqlContainer;
  client: Sql;
  db: TestDB;
  cleanup: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDBContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const client = postgres(container.getConnectionUri(), { max: 5 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: './drizzle' });

  return {
    container,
    client,
    db,
    cleanup: async () => {
      await client.end();
      await container.stop();
    },
  };
}

export async function truncateAll(client: Sql): Promise<void> {
  await client.unsafe(`
    TRUNCATE TABLE
      team_memberships,
      teams,
      users
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 3: Write the failing integration test for users**

`tests/integration/users.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema/users';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('users schema', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('inserts and reads a user', async () => {
    const [created] = await ctx.db
      .insert(users)
      .values({
        email: 'ana@acme.co',
        name: 'Ana',
        ssoSubject: 'idp|123',
      })
      .returning();

    expect(created.id).toBeTruthy();
    expect(created.role).toBe('member');
    expect(created.createdAt).toBeInstanceOf(Date);

    const [fetched] = await ctx.db.select().from(users).where(eq(users.email, 'ana@acme.co'));
    expect(fetched.name).toBe('Ana');
  });

  it('rejects duplicate emails', async () => {
    await ctx.db.insert(users).values({ email: 'a@b.co', name: 'A', ssoSubject: 'idp|1' });
    await expect(
      ctx.db.insert(users).values({ email: 'a@b.co', name: 'A2', ssoSubject: 'idp|2' }),
    ).rejects.toThrow(/duplicate|unique/i);
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

```bash
pnpm test tests/integration/users.test.ts
```

Expected: FAIL — module `@/lib/db/schema/users` not found.

- [ ] **Step 5: Define `users` schema**

`src/lib/db/schema/users.ts`:

```ts
import { pgTable, pgEnum, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['admin', 'member']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  ssoSubject: text('sso_subject').notNull(),
  role: userRoleEnum('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 6: Define `teams` schema**

`src/lib/db/schema/teams.ts`:

```ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
```

- [ ] **Step 7: Define `team_memberships` schema**

`src/lib/db/schema/team-memberships.ts`:

```ts
import { pgTable, pgEnum, uuid, primaryKey, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { teams } from './teams';

export const teamRoleEnum = pgEnum('team_role', ['lead', 'member']);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.userId] }),
  }),
);

export type TeamMembership = typeof teamMemberships.$inferSelect;
export type NewTeamMembership = typeof teamMemberships.$inferInsert;
```

- [ ] **Step 8: Re-export from the barrel**

`src/lib/db/schema/index.ts`:

```ts
export * from './users';
export * from './teams';
export * from './team-memberships';
```

- [ ] **Step 9: Generate the migration**

```bash
pnpm db:generate
```

Expected: a file like `drizzle/0000_<adjective>_<noun>.sql` is created. Open it; verify it has `CREATE TABLE users`, `CREATE TABLE teams`, `CREATE TABLE team_memberships` and the two enums.

- [ ] **Step 10: Apply migration to the local Postgres**

```bash
pnpm db:migrate
```

Expected: `done`. Verify with `docker compose exec postgres psql -U incident -d incident_app -c "\dt"` — three tables listed.

- [ ] **Step 11: Re-run the integration test, verify it passes**

```bash
pnpm test tests/integration/users.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 12: Add a teams integration test**

`tests/integration/teams.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { eq } from 'drizzle-orm';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('teams + memberships', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('creates a team with a unique slug', async () => {
    await ctx.db.insert(teams).values({ name: 'Payments', slug: 'payments' });
    await expect(
      ctx.db.insert(teams).values({ name: 'Payments 2', slug: 'payments' }),
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('cascades delete: removing a team removes its memberships', async () => {
    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Infra', slug: 'infra' })
      .returning();
    const [user] = await ctx.db
      .insert(users)
      .values({ email: 'u@x.co', name: 'U', ssoSubject: 'idp|9' })
      .returning();
    await ctx.db.insert(teamMemberships).values({ teamId: team.id, userId: user.id });

    await ctx.db.delete(teams).where(eq(teams.id, team.id));

    const remaining = await ctx.db.select().from(teamMemberships);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 13: Run all tests**

```bash
pnpm test
```

Expected: smoke + 2 env + 2 users + 2 teams = 7 passing.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(db): users, teams, team_memberships schema + tests"
```

---

## Task 5: Authorization helpers + tests

**Files:**
- Create: `src/lib/db/queries/users.ts`, `src/lib/db/queries/teams.ts`, `src/lib/authz/index.ts`, `tests/integration/authz.test.ts`

- [ ] **Step 1: Write the failing authz test**

`tests/integration/authz.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { requireAdmin, requireTeamMember, ForbiddenError } from '@/lib/authz';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('authz helpers', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  async function seed() {
    const [admin] = await ctx.db
      .insert(users)
      .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
      .returning();
    const [member] = await ctx.db
      .insert(users)
      .values({ email: 'm@x.co', name: 'M', ssoSubject: 's|m' })
      .returning();
    const [outsider] = await ctx.db
      .insert(users)
      .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
      .returning();
    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    await ctx.db.insert(teamMemberships).values({ teamId: team.id, userId: member.id });
    return { admin, member, outsider, team };
  }

  it('requireAdmin allows admin users', async () => {
    const { admin } = await seed();
    await expect(requireAdmin(ctx.db, admin.id)).resolves.toBeUndefined();
  });

  it('requireAdmin throws ForbiddenError for non-admins', async () => {
    const { member } = await seed();
    await expect(requireAdmin(ctx.db, member.id)).rejects.toThrow(ForbiddenError);
  });

  it('requireTeamMember allows team members', async () => {
    const { member, team } = await seed();
    await expect(requireTeamMember(ctx.db, member.id, team.id)).resolves.toBeUndefined();
  });

  it('requireTeamMember allows admins even without membership', async () => {
    const { admin, team } = await seed();
    await expect(requireTeamMember(ctx.db, admin.id, team.id)).resolves.toBeUndefined();
  });

  it('requireTeamMember throws ForbiddenError for outsiders', async () => {
    const { outsider, team } = await seed();
    await expect(requireTeamMember(ctx.db, outsider.id, team.id)).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm test tests/integration/authz.test.ts
```

Expected: FAIL — `@/lib/authz` not found.

- [ ] **Step 3: Implement queries — users**

`src/lib/db/queries/users.ts`:

```ts
import { eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { users, type User } from '@/lib/db/schema/users';

export async function findUserById(db: DB, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function findUserByEmail(db: DB, email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 4: Implement queries — teams**

`src/lib/db/queries/teams.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teamMemberships } from '@/lib/db/schema/team-memberships';

export async function isTeamMember(db: DB, userId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}
```

- [ ] **Step 5: Implement `src/lib/authz/index.ts`**

```ts
import { type DB } from '@/lib/db/client';
import { findUserById } from '@/lib/db/queries/users';
import { isTeamMember } from '@/lib/db/queries/teams';

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function requireAdmin(db: DB, userId: string): Promise<void> {
  const user = await findUserById(db, userId);
  if (!user || user.role !== 'admin') {
    throw new ForbiddenError('Admin role required');
  }
}

export async function requireTeamMember(
  db: DB,
  userId: string,
  teamId: string,
): Promise<void> {
  const user = await findUserById(db, userId);
  if (!user) throw new ForbiddenError('Unknown user');
  if (user.role === 'admin') return;
  const ok = await isTeamMember(db, userId, teamId);
  if (!ok) throw new ForbiddenError('Not a member of this team');
}
```

- [ ] **Step 6: Run authz test, verify it passes**

```bash
pnpm test tests/integration/authz.test.ts
```

Expected: 5 passing.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test
```

Expected: 12 total passing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(authz): requireAdmin / requireTeamMember helpers + tests"
```

---

## Task 6: NextAuth v5 Edge/Node split (config files only, no provider yet)

**Files:**
- Create: `src/lib/auth/config.ts`, `src/lib/auth/index.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/middleware.ts`, `next-auth.d.ts`
- Modify: `package.json`

- [ ] **Step 1: Install NextAuth v5**

```bash
pnpm add next-auth@beta @auth/core
```

(`next-auth@beta` is v5 line; check `pnpm view next-auth versions --json` if you want to pin to a stable v5 release once available.)

- [ ] **Step 2: Write `src/lib/auth/config.ts` (Edge-safe)**

```ts
import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/signin',
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const isPublic =
        request.nextUrl.pathname.startsWith('/signin') ||
        request.nextUrl.pathname.startsWith('/api/auth') ||
        request.nextUrl.pathname.startsWith('/status');
      if (isPublic) return true;
      return isLoggedIn;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = (user as { role?: 'admin' | 'member' }).role ?? 'member';
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      if (token.role) (session.user as { role?: 'admin' | 'member' }).role =
        token.role as 'admin' | 'member';
      return session;
    },
  },
};
```

This file must remain free of any Node-only imports (no `pg`, no `@/lib/db/*`).

- [ ] **Step 3: Write `next-auth.d.ts` (type augmentation)**

In project root:

```ts
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: 'admin' | 'member';
    };
  }
  interface User {
    id: string;
    role: 'admin' | 'member';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    role?: 'admin' | 'member';
  }
}
```

- [ ] **Step 4: Write `src/lib/auth/index.ts` (Node — placeholder, no provider)**

```ts
import NextAuth from 'next-auth';
import { authConfig } from './config';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [],
});
```

- [ ] **Step 5: Wire route handler**

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from '@/lib/auth';
```

- [ ] **Step 6: Wire middleware**

`src/middleware.ts`:

```ts
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 7: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exit 0. We do not run `pnpm build` here because no provider is wired yet — that comes in Task 7.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): NextAuth v5 Edge/Node split scaffolding"
```

---

## Task 7: Google OIDC provider + first-login auto-provision + admin allowlist

**Files:**
- Modify: `src/lib/auth/index.ts`, `src/lib/auth/config.ts`
- Create: `src/lib/auth/provision.ts`, `tests/integration/auth-provision.test.ts`

- [ ] **Step 1: Write the failing provision test**

`tests/integration/auth-provision.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { users } from '@/lib/db/schema/users';
import { eq } from 'drizzle-orm';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('provisionUserOnSignIn', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('creates a new user with role=member by default', async () => {
    const result = await provisionUserOnSignIn(ctx.db, {
      email: 'NEW@x.co',
      name: 'New',
      ssoSubject: 'sub|1',
      adminEmails: [],
    });
    expect(result.role).toBe('member');
    expect(result.email).toBe('new@x.co');
  });

  it('creates a new user with role=admin if email matches allowlist', async () => {
    const result = await provisionUserOnSignIn(ctx.db, {
      email: 'admin@x.co',
      name: 'Admin',
      ssoSubject: 'sub|2',
      adminEmails: ['admin@x.co'],
    });
    expect(result.role).toBe('admin');
  });

  it('updates name and ssoSubject on subsequent sign-in but does not change role', async () => {
    await provisionUserOnSignIn(ctx.db, {
      email: 'p@x.co',
      name: 'Old Name',
      ssoSubject: 'sub|old',
      adminEmails: [],
    });
    const updated = await provisionUserOnSignIn(ctx.db, {
      email: 'p@x.co',
      name: 'New Name',
      ssoSubject: 'sub|new',
      adminEmails: ['p@x.co'],
    });
    expect(updated.name).toBe('New Name');
    expect(updated.ssoSubject).toBe('sub|new');
    expect(updated.role).toBe('member');

    const [row] = await ctx.db.select().from(users).where(eq(users.email, 'p@x.co'));
    expect(row.role).toBe('member');
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm test tests/integration/auth-provision.test.ts
```

Expected: FAIL — `@/lib/auth/provision` not found.

- [ ] **Step 3: Implement `src/lib/auth/provision.ts`**

```ts
import { eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { users, type User } from '@/lib/db/schema/users';

export interface ProvisionInput {
  email: string;
  name: string;
  ssoSubject: string;
  adminEmails: string[];
}

export async function provisionUserOnSignIn(db: DB, input: ProvisionInput): Promise<User> {
  const email = input.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ name: input.name, ssoSubject: input.ssoSubject })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }

  const role = input.adminEmails.includes(email) ? 'admin' : 'member';
  const [created] = await db
    .insert(users)
    .values({ email, name: input.name, ssoSubject: input.ssoSubject, role })
    .returning();
  return created;
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test tests/integration/auth-provision.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Wire Google provider in `src/lib/auth/index.ts`**

```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { authConfig } from './config';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { provisionUserOnSignIn } from './provision';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_CLIENT_ID,
      clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (!user.email || !account?.providerAccountId) return false;
      const provisioned = await provisionUserOnSignIn(db, {
        email: user.email,
        name: user.name ?? user.email,
        ssoSubject: account.providerAccountId,
        adminEmails: env.ADMIN_EMAILS,
      });
      user.id = provisioned.id;
      (user as { role?: 'admin' | 'member' }).role = provisioned.role;
      return true;
    },
  },
});
```

- [ ] **Step 6: Tighten env validation for Google**

In `src/lib/env.ts`, replace the optional Google fields with a refinement:

```ts
const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.string().url(),
    AUTH_PROVIDER: z.enum(['google']),
    AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  })
  .refine(
    (v) => v.AUTH_PROVIDER !== 'google' || (v.AUTH_GOOGLE_CLIENT_ID && v.AUTH_GOOGLE_CLIENT_SECRET),
    { message: 'AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET required when AUTH_PROVIDER=google' },
  );

export const env = schema.parse(process.env);
```

The Google ID/secret types stay optional in the inferred type but the runtime check guarantees presence when needed. In the auth file, narrow with a runtime check:

In `src/lib/auth/index.ts`, replace the `Google({ clientId, clientSecret })` line with:

```ts
Google({
  clientId: env.AUTH_GOOGLE_CLIENT_ID!,
  clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET!,
}),
```

The non-null assertion is justified by the env refinement above.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test
```

Expected: 15 passing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): Google OIDC provider + first-login auto-provisioning + admin allowlist"
```

---

## Task 8: Sign-in page + session-aware app shell

**Files:**
- Create: `src/app/(auth)/signin/page.tsx`, `src/app/(app)/layout.tsx`, `src/components/shell/Sidebar.tsx`, `src/components/shell/Header.tsx`, `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/page.tsx`, `src/app/layout.tsx`

- [ ] **Step 1: Write `src/app/(auth)/signin/page.tsx`**

```tsx
import { signIn } from '@/lib/auth';

export default function SignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/dashboard' });
        }}
      >
        <button
          type="submit"
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm shadow-sm hover:bg-neutral-50"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Replace root `src/app/page.tsx` to redirect**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
```

- [ ] **Step 3: Write the authenticated shell layout**

`src/app/(app)/layout.tsx`:

```tsx
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/shell/Sidebar';
import { Header } from '@/components/shell/Header';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin');

  return (
    <div className="flex min-h-screen">
      <Sidebar role={session.user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={{ name: session.user.name ?? session.user.email, email: session.user.email }} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Sidebar component**

`src/components/shell/Sidebar.tsx`:

```tsx
import Link from 'next/link';

interface Props {
  role: 'admin' | 'member';
}

const items: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/services', label: 'Services' },
  { href: '/metrics', label: 'Metrics' },
];

export function Sidebar({ role }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4">
      <div className="mb-6 text-sm font-semibold">incident_app</div>
      <nav className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded px-2 py-1.5 hover:bg-white"
          >
            {item.label}
          </Link>
        ))}
        {role === 'admin' && (
          <Link href="/settings/teams" className="rounded px-2 py-1.5 hover:bg-white">
            Settings
          </Link>
        )}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Header component**

`src/components/shell/Header.tsx`:

```tsx
import { signOut } from '@/lib/auth';

interface Props {
  user: { name: string; email: string };
}

export function Header({ user }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="text-sm text-neutral-600">{user.email}</div>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/signin' });
        }}
      >
        <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
          Sign out
        </button>
      </form>
    </header>
  );
}
```

- [ ] **Step 6: Dashboard placeholder**

`src/app/(app)/dashboard/page.tsx`:

```tsx
import { auth } from '@/lib/auth';

export default async function Dashboard() {
  const session = await auth();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome, {session?.user.name ?? session?.user.email}</h1>
      <p className="mt-2 text-sm text-neutral-500">Foundation phase. No incidents yet.</p>
    </div>
  );
}
```

- [ ] **Step 7: Manually verify**

Set up a Google OAuth test client (https://console.cloud.google.com/ → APIs & Services → Credentials → OAuth client ID → Web application; redirect URI `http://localhost:3000/api/auth/callback/google`). Put the client ID and secret into `.env.local`. Add your own email to `ADMIN_EMAILS=`.

```bash
pnpm db:up
pnpm db:migrate
pnpm dev
```

Visit `http://localhost:3000`. You're redirected to `/signin`. Click "Sign in with Google", complete the consent flow. You land on `/dashboard` with your name. Verify a row exists:

```bash
docker compose exec postgres psql -U incident -d incident_app -c "SELECT email, role FROM users"
```

Your email is there with `role=admin`.

- [ ] **Step 8: Run full test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck clean, 15 tests passing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(auth): sign-in page + authenticated app shell + dashboard placeholder"
```

---

## Task 9: Schema for services + runbooks + tests

**Files:**
- Create: `src/lib/db/schema/services.ts`, `src/lib/db/schema/runbooks.ts`, `tests/integration/services.test.ts`, `tests/integration/runbooks.test.ts`
- Modify: `src/lib/db/schema/index.ts`, `tests/setup/db.ts`

- [ ] **Step 1: Define severity enum + services schema**

`src/lib/db/schema/services.ts`:

```ts
import { pgTable, pgEnum, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { teams } from './teams';

export const severityEnum = pgEnum('severity', ['SEV1', 'SEV2', 'SEV3', 'SEV4']);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamSlugUniq: unique('services_team_slug_uniq').on(t.teamId, t.slug),
  }),
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
```

- [ ] **Step 2: Define runbooks schema**

`src/lib/db/schema/runbooks.ts`:

```ts
import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { services, severityEnum } from './services';

export const runbooks = pgTable(
  'runbooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    severity: severityEnum('severity').notNull(),
    markdownBody: text('markdown_body').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serviceSeverityUniq: unique('runbooks_service_severity_uniq').on(t.serviceId, t.severity),
  }),
);

export type Runbook = typeof runbooks.$inferSelect;
export type NewRunbook = typeof runbooks.$inferInsert;
```

- [ ] **Step 3: Re-export**

`src/lib/db/schema/index.ts`:

```ts
export * from './users';
export * from './teams';
export * from './team-memberships';
export * from './services';
export * from './runbooks';
```

- [ ] **Step 4: Update `truncateAll` to include new tables**

In `tests/setup/db.ts`:

```ts
export async function truncateAll(client: Sql): Promise<void> {
  await client.unsafe(`
    TRUNCATE TABLE
      runbooks,
      services,
      team_memberships,
      teams,
      users
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 5: Generate the migration**

```bash
pnpm db:generate
```

A new file appears in `drizzle/`. Open it and verify it has `CREATE TYPE severity`, `CREATE TABLE services`, `CREATE TABLE runbooks`.

- [ ] **Step 6: Apply locally**

```bash
pnpm db:migrate
```

- [ ] **Step 7: Write the failing services test**

`tests/integration/services.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('services schema', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('enforces unique (team_id, slug)', async () => {
    const [team] = await ctx.db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    await ctx.db.insert(services).values({ teamId: team.id, name: 'Checkout', slug: 'checkout' });
    await expect(
      ctx.db.insert(services).values({ teamId: team.id, name: 'Checkout 2', slug: 'checkout' }),
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('allows the same slug across different teams', async () => {
    const [t1] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    const [t2] = await ctx.db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
    await ctx.db.insert(services).values({ teamId: t1.id, name: 'api', slug: 'api' });
    await ctx.db.insert(services).values({ teamId: t2.id, name: 'api', slug: 'api' });
    const all = await ctx.db.select().from(services);
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Write the failing runbooks test**

`tests/integration/runbooks.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import { runbooks } from '@/lib/db/schema/runbooks';
import { startTestDb, truncateAll, type TestDBContext } from '../setup/db';

describe('runbooks schema', () => {
  let ctx: TestDBContext;

  beforeAll(async () => {
    ctx = await startTestDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await truncateAll(ctx.client);
  });

  it('enforces one runbook per (service, severity)', async () => {
    const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId: team.id, name: 'api', slug: 'api' })
      .returning();
    await ctx.db.insert(runbooks).values({ serviceId: svc.id, severity: 'SEV2', markdownBody: '' });
    await expect(
      ctx.db.insert(runbooks).values({ serviceId: svc.id, severity: 'SEV2', markdownBody: 'x' }),
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('cascades delete with the parent service', async () => {
    const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    const [svc] = await ctx.db
      .insert(services)
      .values({ teamId: team.id, name: 'api', slug: 'api' })
      .returning();
    await ctx.db.insert(runbooks).values({ serviceId: svc.id, severity: 'SEV1', markdownBody: 'x' });
    const { eq } = await import('drizzle-orm');
    await ctx.db.delete(services).where(eq(services.id, svc.id));
    const remaining = await ctx.db.select().from(runbooks);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 9: Run, verify both pass**

```bash
pnpm test tests/integration/services.test.ts tests/integration/runbooks.test.ts
```

Expected: 4 passing.

- [ ] **Step 10: Run full suite**

```bash
pnpm test
```

Expected: 19 passing.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(db): services + runbooks schema + tests"
```

---

## Task 10: Services queries (with authz) + tests + routes

**Files:**
- Create: `src/lib/db/queries/services.ts`, `src/app/(app)/services/page.tsx`, `src/app/(app)/services/new/page.tsx`, `src/app/(app)/services/[slug]/page.tsx`, `src/app/(app)/services/actions.ts`
- Modify: `tests/integration/services.test.ts` (add query tests)

- [ ] **Step 1: Add failing query tests to `tests/integration/services.test.ts`**

Append at the end of the file (inside the `describe`):

```ts
import { listServicesForUser, createService } from '@/lib/db/queries/services';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { ForbiddenError } from '@/lib/authz';

it('listServicesForUser returns only services from teams the user belongs to', async () => {
  const [u1] = await ctx.db
    .insert(users)
    .values({ email: 'u1@x.co', name: 'U1', ssoSubject: 's|1' })
    .returning();
  const [t1] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  const [t2] = await ctx.db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
  await ctx.db.insert(teamMemberships).values({ teamId: t1.id, userId: u1.id });
  await ctx.db.insert(services).values({ teamId: t1.id, name: 'mine', slug: 'mine' });
  await ctx.db.insert(services).values({ teamId: t2.id, name: 'other', slug: 'other' });

  const out = await listServicesForUser(ctx.db, u1.id);
  expect(out.map((s) => s.slug)).toEqual(['mine']);
});

it('createService rejects callers who are not members of the team', async () => {
  const [u1] = await ctx.db
    .insert(users)
    .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
    .returning();
  const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  await expect(
    createService(ctx.db, u1.id, { teamId: team.id, name: 'svc', slug: 'svc' }),
  ).rejects.toThrow(ForbiddenError);
});

it('createService inserts when caller is a team member', async () => {
  const [u1] = await ctx.db
    .insert(users)
    .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
    .returning();
  const [team] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  await ctx.db.insert(teamMemberships).values({ teamId: team.id, userId: u1.id });
  const created = await createService(ctx.db, u1.id, { teamId: team.id, name: 'svc', slug: 'svc' });
  expect(created.id).toBeTruthy();
  expect(created.slug).toBe('svc');
});
```

- [ ] **Step 2: Run, verify the new tests fail**

```bash
pnpm test tests/integration/services.test.ts
```

Expected: 3 new tests fail (`@/lib/db/queries/services` not found).

- [ ] **Step 3: Implement `src/lib/db/queries/services.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { services, type Service, type NewService } from '@/lib/db/schema/services';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { requireTeamMember } from '@/lib/authz';

export async function listServicesForUser(db: DB, userId: string): Promise<Service[]> {
  const memberships = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));
  if (memberships.length === 0) return [];
  return db
    .select()
    .from(services)
    .where(inArray(services.teamId, memberships.map((m) => m.teamId)));
}

export async function findServiceBySlugForUser(
  db: DB,
  userId: string,
  slug: string,
): Promise<Service | null> {
  const list = await listServicesForUser(db, userId);
  return list.find((s) => s.slug === slug) ?? null;
}

export async function createService(
  db: DB,
  callerId: string,
  input: Pick<NewService, 'teamId' | 'name' | 'slug' | 'description'>,
): Promise<Service> {
  await requireTeamMember(db, callerId, input.teamId);
  const [row] = await db.insert(services).values(input).returning();
  return row;
}

export async function updateService(
  db: DB,
  callerId: string,
  serviceId: string,
  patch: Partial<Pick<NewService, 'name' | 'description'>>,
): Promise<Service> {
  const [existing] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  if (!existing) throw new Error('Service not found');
  await requireTeamMember(db, callerId, existing.teamId);
  const [row] = await db
    .update(services)
    .set(patch)
    .where(eq(services.id, serviceId))
    .returning();
  return row;
}
```

- [ ] **Step 4: Run, verify all services tests pass**

```bash
pnpm test tests/integration/services.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Write services list page**

`src/app/(app)/services/page.tsx`:

```tsx
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listServicesForUser } from '@/lib/db/queries/services';

export default async function ServicesPage() {
  const session = await auth();
  if (!session?.user) return null;
  const list = await listServicesForUser(db, session.user.id);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Services</h1>
        <Link
          href="/services/new"
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          New service
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-neutral-500">No services yet. Create one to get started.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={`/services/${s.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-neutral-500">{s.slug}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write Server Action for create**

`src/app/(app)/services/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { createService } from '@/lib/db/queries/services';

const schema = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, dashes; cannot start with dash'),
  description: z.string().max(500).default(''),
});

export async function createServiceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = schema.parse({
    teamId: formData.get('teamId'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: formData.get('description') ?? '',
  });

  await createService(db, session.user.id, parsed);
  redirect(`/services/${parsed.slug}`);
}
```

- [ ] **Step 7: Write services/new page**

`src/app/(app)/services/new/page.tsx`:

```tsx
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { eq } from 'drizzle-orm';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { teams } from '@/lib/db/schema/teams';
import { createServiceAction } from '../actions';

export default async function NewServicePage() {
  const session = await auth();
  if (!session?.user) return null;

  const myTeams = await db
    .select({ id: teams.id, name: teams.name, slug: teams.slug })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, session.user.id));

  if (myTeams.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        You aren&apos;t in any team yet. Ask an admin to add you.
      </p>
    );
  }

  return (
    <form action={createServiceAction} className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold">New service</h1>
      <label className="block text-sm">
        Team
        <select name="teamId" required className="mt-1 w-full rounded border px-2 py-1.5">
          {myTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Name
        <input name="name" required className="mt-1 w-full rounded border px-2 py-1.5" />
      </label>
      <label className="block text-sm">
        Slug
        <input
          name="slug"
          required
          pattern="^[a-z0-9][a-z0-9-]*$"
          className="mt-1 w-full rounded border px-2 py-1.5"
        />
      </label>
      <label className="block text-sm">
        Description
        <textarea
          name="description"
          rows={3}
          className="mt-1 w-full rounded border px-2 py-1.5"
        />
      </label>
      <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
        Create
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Service detail placeholder**

`src/app/(app)/services/[slug]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findServiceBySlugForUser } from '@/lib/db/queries/services';

const severities = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;

export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) return null;
  const service = await findServiceBySlugForUser(db, session.user.id, slug);
  if (!service) notFound();

  return (
    <div>
      <h1 className="text-xl font-semibold">{service.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">{service.description || 'No description.'}</p>

      <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Runbooks
      </h2>
      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
        {severities.map((sev) => (
          <li key={sev}>
            <Link
              href={`/services/${slug}/runbooks/${sev}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
            >
              <span className="font-medium">{sev}</span>
              <span className="text-xs text-neutral-500">edit →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 9: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck clean, 22 tests passing.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(services): queries with authz + list/detail/new routes"
```

---

## Task 11: Runbooks queries + editor route

**Files:**
- Create: `src/lib/db/queries/runbooks.ts`, `src/app/(app)/services/[slug]/runbooks/[severity]/page.tsx`, `src/app/(app)/services/[slug]/runbooks/[severity]/actions.ts`
- Modify: `tests/integration/runbooks.test.ts`

- [ ] **Step 1: Add failing query tests**

Append to `tests/integration/runbooks.test.ts` (inside the describe):

```ts
import { upsertRunbook, getRunbook } from '@/lib/db/queries/runbooks';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { users } from '@/lib/db/schema/users';
import { ForbiddenError } from '@/lib/authz';

async function seedUserAndService() {
  const [u] = await ctx.db
    .insert(users)
    .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
    .returning();
  const [t] = await ctx.db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
  await ctx.db.insert(teamMemberships).values({ teamId: t.id, userId: u.id });
  const [svc] = await ctx.db
    .insert(services)
    .values({ teamId: t.id, name: 'api', slug: 'api' })
    .returning();
  return { user: u, team: t, service: svc };
}

it('upsertRunbook creates then updates the same row', async () => {
  const { user, service } = await seedUserAndService();
  const a = await upsertRunbook(ctx.db, user.id, {
    serviceId: service.id,
    severity: 'SEV2',
    markdownBody: 'first',
  });
  const b = await upsertRunbook(ctx.db, user.id, {
    serviceId: service.id,
    severity: 'SEV2',
    markdownBody: 'second',
  });
  expect(a.id).toBe(b.id);
  expect(b.markdownBody).toBe('second');
});

it('upsertRunbook denies non-team-members', async () => {
  const { service } = await seedUserAndService();
  const [outsider] = await ctx.db
    .insert(users)
    .values({ email: 'o@x.co', name: 'O', ssoSubject: 's|o' })
    .returning();
  await expect(
    upsertRunbook(ctx.db, outsider.id, {
      serviceId: service.id,
      severity: 'SEV2',
      markdownBody: 'x',
    }),
  ).rejects.toThrow(ForbiddenError);
});

it('getRunbook returns null when none exists', async () => {
  const { user, service } = await seedUserAndService();
  const got = await getRunbook(ctx.db, user.id, service.id, 'SEV1');
  expect(got).toBeNull();
});
```

- [ ] **Step 2: Run, verify failures**

```bash
pnpm test tests/integration/runbooks.test.ts
```

- [ ] **Step 3: Implement `src/lib/db/queries/runbooks.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { runbooks, type Runbook, type NewRunbook } from '@/lib/db/schema/runbooks';
import { services } from '@/lib/db/schema/services';
import { requireTeamMember } from '@/lib/authz';

type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

async function getServiceTeamId(db: DB, serviceId: string): Promise<string> {
  const [row] = await db
    .select({ teamId: services.teamId })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!row) throw new Error('Service not found');
  return row.teamId;
}

export async function getRunbook(
  db: DB,
  userId: string,
  serviceId: string,
  severity: Severity,
): Promise<Runbook | null> {
  const teamId = await getServiceTeamId(db, serviceId);
  await requireTeamMember(db, userId, teamId);
  const [row] = await db
    .select()
    .from(runbooks)
    .where(and(eq(runbooks.serviceId, serviceId), eq(runbooks.severity, severity)))
    .limit(1);
  return row ?? null;
}

export async function upsertRunbook(
  db: DB,
  userId: string,
  input: Pick<NewRunbook, 'serviceId' | 'severity' | 'markdownBody'>,
): Promise<Runbook> {
  const teamId = await getServiceTeamId(db, input.serviceId);
  await requireTeamMember(db, userId, teamId);

  const [row] = await db
    .insert(runbooks)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [runbooks.serviceId, runbooks.severity],
      set: { markdownBody: input.markdownBody, updatedAt: new Date() },
    })
    .returning();
  return row;
}
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm test tests/integration/runbooks.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Server Action for runbook save**

`src/app/(app)/services/[slug]/runbooks/[severity]/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findServiceBySlugForUser } from '@/lib/db/queries/services';
import { upsertRunbook } from '@/lib/db/queries/runbooks';

const schema = z.object({
  slug: z.string(),
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
  markdownBody: z.string().max(50_000),
});

export async function saveRunbookAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = schema.parse({
    slug: formData.get('slug'),
    severity: formData.get('severity'),
    markdownBody: formData.get('markdownBody') ?? '',
  });

  const service = await findServiceBySlugForUser(db, session.user.id, parsed.slug);
  if (!service) throw new Error('Service not found');

  await upsertRunbook(db, session.user.id, {
    serviceId: service.id,
    severity: parsed.severity,
    markdownBody: parsed.markdownBody,
  });

  revalidatePath(`/services/${parsed.slug}/runbooks/${parsed.severity}`);
}
```

- [ ] **Step 6: Runbook editor page**

`src/app/(app)/services/[slug]/runbooks/[severity]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findServiceBySlugForUser } from '@/lib/db/queries/services';
import { getRunbook } from '@/lib/db/queries/runbooks';
import { saveRunbookAction } from './actions';

const allowed = new Set(['SEV1', 'SEV2', 'SEV3', 'SEV4']);

type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

export default async function RunbookEditor({
  params,
}: {
  params: Promise<{ slug: string; severity: string }>;
}) {
  const { slug, severity } = await params;
  if (!allowed.has(severity)) notFound();
  const session = await auth();
  if (!session?.user) return null;
  const service = await findServiceBySlugForUser(db, session.user.id, slug);
  if (!service) notFound();
  const runbook = await getRunbook(db, session.user.id, service.id, severity as Severity);

  return (
    <form action={saveRunbookAction} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="severity" value={severity} />
      <h1 className="text-xl font-semibold">
        {service.name} — {severity} runbook
      </h1>
      <textarea
        name="markdownBody"
        rows={20}
        defaultValue={runbook?.markdownBody ?? ''}
        className="w-full rounded border border-neutral-200 bg-white p-3 font-mono text-sm"
        placeholder="Markdown content..."
      />
      <div className="flex items-center gap-3 text-sm">
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-white">
          Save
        </button>
        {runbook?.updatedAt && (
          <span className="text-neutral-500">
            last saved {runbook.updatedAt.toISOString()}
          </span>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 7: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 25 passing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(runbooks): upsert query + per-severity editor route"
```

---

## Task 12: Settings UI for teams + memberships (admin-only)

**Files:**
- Create: `src/lib/db/queries/teams-admin.ts`, `src/app/(app)/settings/teams/page.tsx`, `src/app/(app)/settings/teams/actions.ts`
- Modify: `tests/integration/teams.test.ts`

- [ ] **Step 1: Add failing admin-query tests**

Append to `tests/integration/teams.test.ts`:

```ts
import {
  createTeamAsAdmin,
  addMembershipAsAdmin,
  removeMembershipAsAdmin,
} from '@/lib/db/queries/teams-admin';
import { ForbiddenError } from '@/lib/authz';

it('createTeamAsAdmin requires admin role', async () => {
  const [member] = await ctx.db
    .insert(users)
    .values({ email: 'm@x.co', name: 'M', ssoSubject: 's|m' })
    .returning();
  await expect(
    createTeamAsAdmin(ctx.db, member.id, { name: 'X', slug: 'x' }),
  ).rejects.toThrow(ForbiddenError);
});

it('createTeamAsAdmin creates a team for admin caller', async () => {
  const [admin] = await ctx.db
    .insert(users)
    .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
    .returning();
  const team = await createTeamAsAdmin(ctx.db, admin.id, { name: 'Payments', slug: 'payments' });
  expect(team.slug).toBe('payments');
});

it('add + remove membership round-trips', async () => {
  const [admin] = await ctx.db
    .insert(users)
    .values({ email: 'a@x.co', name: 'A', ssoSubject: 's|a', role: 'admin' })
    .returning();
  const [u] = await ctx.db
    .insert(users)
    .values({ email: 'u@x.co', name: 'U', ssoSubject: 's|u' })
    .returning();
  const [team] = await ctx.db.insert(teams).values({ name: 'X', slug: 'x' }).returning();
  await addMembershipAsAdmin(ctx.db, admin.id, { teamId: team.id, userId: u.id, role: 'member' });
  const after = await ctx.db.select().from(teamMemberships);
  expect(after).toHaveLength(1);
  await removeMembershipAsAdmin(ctx.db, admin.id, { teamId: team.id, userId: u.id });
  const after2 = await ctx.db.select().from(teamMemberships);
  expect(after2).toHaveLength(0);
});
```

You'll need imports at the top of the file (add if missing): `import { teamMemberships } from '@/lib/db/schema/team-memberships';` and `import { users } from '@/lib/db/schema/users';`.

- [ ] **Step 2: Run, verify failures**

```bash
pnpm test tests/integration/teams.test.ts
```

- [ ] **Step 3: Implement `src/lib/db/queries/teams-admin.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { teams, type Team, type NewTeam } from '@/lib/db/schema/teams';
import { teamMemberships, type NewTeamMembership } from '@/lib/db/schema/team-memberships';
import { requireAdmin } from '@/lib/authz';

export async function createTeamAsAdmin(
  db: DB,
  callerId: string,
  input: Pick<NewTeam, 'name' | 'slug'>,
): Promise<Team> {
  await requireAdmin(db, callerId);
  const [row] = await db.insert(teams).values(input).returning();
  return row;
}

export async function addMembershipAsAdmin(
  db: DB,
  callerId: string,
  input: Pick<NewTeamMembership, 'teamId' | 'userId' | 'role'>,
): Promise<void> {
  await requireAdmin(db, callerId);
  await db
    .insert(teamMemberships)
    .values(input)
    .onConflictDoUpdate({
      target: [teamMemberships.teamId, teamMemberships.userId],
      set: { role: input.role ?? 'member' },
    });
}

export async function removeMembershipAsAdmin(
  db: DB,
  callerId: string,
  input: { teamId: string; userId: string },
): Promise<void> {
  await requireAdmin(db, callerId);
  await db
    .delete(teamMemberships)
    .where(
      and(eq(teamMemberships.teamId, input.teamId), eq(teamMemberships.userId, input.userId)),
    );
}

export async function listTeamsWithMemberships(
  db: DB,
  callerId: string,
): Promise<Array<Team & { members: Array<{ userId: string; role: 'lead' | 'member' }> }>> {
  await requireAdmin(db, callerId);
  const allTeams = await db.select().from(teams);
  const memberships = await db.select().from(teamMemberships);
  return allTeams.map((t) => ({
    ...t,
    members: memberships
      .filter((m) => m.teamId === t.id)
      .map((m) => ({ userId: m.userId, role: m.role })),
  }));
}
```

- [ ] **Step 4: Run team tests, verify all pass**

```bash
pnpm test tests/integration/teams.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Settings actions**

`src/app/(app)/settings/teams/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  createTeamAsAdmin,
  addMembershipAsAdmin,
  removeMembershipAsAdmin,
} from '@/lib/db/queries/teams-admin';
import { findUserByEmail } from '@/lib/db/queries/users';

const teamSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
});

export async function createTeamAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = teamSchema.parse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });
  await createTeamAsAdmin(db, session.user.id, parsed);
  revalidatePath('/settings/teams');
}

const addMemberSchema = z.object({
  teamId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['lead', 'member']),
});

export async function addMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = addMemberSchema.parse({
    teamId: formData.get('teamId'),
    email: formData.get('email'),
    role: formData.get('role'),
  });
  const target = await findUserByEmail(db, parsed.email);
  if (!target) throw new Error(`No user with email ${parsed.email} — they need to sign in once first.`);
  await addMembershipAsAdmin(db, session.user.id, {
    teamId: parsed.teamId,
    userId: target.id,
    role: parsed.role,
  });
  revalidatePath('/settings/teams');
}

const removeMemberSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = removeMemberSchema.parse({
    teamId: formData.get('teamId'),
    userId: formData.get('userId'),
  });
  await removeMembershipAsAdmin(db, session.user.id, parsed);
  revalidatePath('/settings/teams');
}
```

- [ ] **Step 6: Settings page**

`src/app/(app)/settings/teams/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listTeamsWithMemberships } from '@/lib/db/queries/teams-admin';
import { findUserById } from '@/lib/db/queries/users';
import { addMemberAction, createTeamAction, removeMemberAction } from './actions';

export default async function TeamsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/signin');
  if (session.user.role !== 'admin') redirect('/dashboard');

  const teamsWithMembers = await listTeamsWithMemberships(db, session.user.id);
  const allUserIds = teamsWithMembers.flatMap((t) => t.members.map((m) => m.userId));
  const userMap = new Map<string, string>();
  await Promise.all(
    allUserIds.map(async (id) => {
      const u = await findUserById(db, id);
      if (u) userMap.set(id, u.email);
    }),
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Teams</h1>
        <form action={createTeamAction} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="Team name"
            required
            className="rounded border px-2 py-1.5 text-sm"
          />
          <input
            name="slug"
            placeholder="slug"
            required
            pattern="^[a-z0-9][a-z0-9-]*$"
            className="rounded border px-2 py-1.5 text-sm"
          />
          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            Add team
          </button>
        </form>
      </section>

      <section className="space-y-4">
        {teamsWithMembers.map((t) => (
          <div key={t.id} className="rounded border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-neutral-500">{t.slug}</div>
              </div>
              <div className="text-xs text-neutral-500">{t.members.length} member(s)</div>
            </div>

            <ul className="mt-3 divide-y divide-neutral-100">
              {t.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-2 text-sm">
                  <span>{userMap.get(m.userId) ?? m.userId}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">
                      {m.role}
                    </span>
                    <form action={removeMemberAction}>
                      <input type="hidden" name="teamId" value={t.id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        remove
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>

            <form action={addMemberAction} className="mt-3 flex gap-2">
              <input type="hidden" name="teamId" value={t.id} />
              <input
                name="email"
                placeholder="user@example.com"
                required
                className="flex-1 rounded border px-2 py-1.5 text-sm"
              />
              <select name="role" className="rounded border px-2 py-1.5 text-sm">
                <option value="member">member</option>
                <option value="lead">lead</option>
              </select>
              <button type="submit" className="rounded border px-3 py-1.5 text-sm">
                Add member
              </button>
            </form>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck + full tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 28 passing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(settings): admin-only teams + memberships UI"
```

---

## Task 13: Manual acceptance + README + final commit

**Files:**
- Create: `README.md`
- Modify: nothing

- [ ] **Step 1: Write `README.md`**

```markdown
# incident_app

Web-first incident tracker for an internal multi-team org. See `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` for the full design.

## Stack
Next.js 15 · TypeScript · Drizzle + Postgres · NextAuth v5 · Tailwind · Vitest + testcontainers · pnpm.

## Local setup

```bash
cp .env.example .env.local
# Fill AUTH_SECRET (run: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
# Fill AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET (Google Cloud Console)
# Add your email to ADMIN_EMAILS=
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev
```

## Tests

```bash
pnpm test               # all
pnpm test:watch         # interactive
```

Integration tests use real Postgres via testcontainers. No DB mocks anywhere in the codebase.

## Layout
- `src/app/` — Next.js routes (route groups: `(app)` for auth-walled, `(auth)` for sign-in)
- `src/lib/db/queries/` — only place that talks to the DB
- `src/lib/authz/` — authorization helpers
- `tests/integration/` — Vitest + testcontainers
```

- [ ] **Step 2: Manual acceptance run**

Boot:

```bash
pnpm db:up
pnpm dev
```

Walk through:

1. Visit `http://localhost:3000` → redirected to `/signin`.
2. Sign in with the Google account whose email is in `ADMIN_EMAILS`.
3. Land on `/dashboard` showing your name.
4. Navigate to **Settings** in the sidebar (visible because you're admin).
5. Create a team `Payments` slug `payments`.
6. Sign out. Sign back in with a *non-admin* Google account.
7. They land on `/dashboard`. They see no Settings link.
8. Sign back in as admin. Add the second user's email as a member of `Payments`.
9. Sign in as that second user. Navigate to **Services**, then **New service**. Pick `Payments`, name `checkout-api`, slug `checkout-api`. Submit.
10. You land on `/services/checkout-api`. Click `SEV2`. Type a markdown body. Save. Reload — body persists.
11. Sign out. Try visiting `/dashboard` directly while signed out → redirected to `/signin`. Try `/settings/teams` while signed in as a non-admin → redirected to `/dashboard`.

Each step works.

- [ ] **Step 3: Stop services, run final checks**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(foundation): README + manual acceptance checklist"
```

---

## Done — Foundation phase

At this point the repo is at a clean stopping point:
- Anyone with a Google account on the IdP can sign in.
- Admins (allowlisted) can manage teams and memberships.
- Members can browse services they own and edit per-severity runbooks.
- Authorization is enforced at the data layer; UI is just a courtesy.
- 28+ integration tests against real Postgres pass on every change.
- No incident logic exists yet — that's **Plan 2: Incidents core**, written next.

### Explicitly deferred from this plan
- **CI workflow.** The spec's build sequence step 1 names "CI" alongside the scaffold; we ship without it because the repo has no remote yet. Add a `.github/workflows/ci.yml` running `typecheck`, `lint`, `test`, and `build` once the repo is pushed to GitHub — first PR after the remote is set up.
- **Sidebar passive team list.** Spec §5.4 says the sidebar shows the user's teams as passive labels under the main nav. The Sidebar component in Task 8 omits this section because no team filtering exists yet. Plan 2 (Incidents core) will add team filter chips and re-evaluate whether the sidebar list adds value or is redundant.
- **Other auth providers.** `AUTH_PROVIDER` is hard-coded to `google` in the env enum. Adding `okta`, `azuread`, `saml`, `oidc` is a few extra branches in `src/lib/auth/index.ts` plus matching env vars — left for the deployment team to extend on demand.

Notify the user; review against the spec; greenlight Plan 2.
