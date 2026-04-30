import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import * as schema from '@/lib/db/schema';

export type TestDB = ReturnType<typeof drizzle<typeof schema>>;

interface Ctx {
  client: Sql;
  db: TestDB;
}

const ctx: Partial<Ctx> = {};

export function getTestDb(): TestDB {
  if (!ctx.db) throw new Error('Test DB not initialized — did you call useTestDb() in the suite?');
  return ctx.db;
}

const TABLES = [
  'timeline_events',
  'incident_services',
  'action_items',
  'postmortems',
  'incidents',
  'dead_letter_webhooks',
  'webhook_sources',
  'status_snapshots',
  'runbooks',
  'services',
  'team_memberships',
  'teams',
  'users',
] as const;

async function truncateAll(client: Sql): Promise<void> {
  await client.unsafe(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export function useTestDb(): void {
  beforeAll(async () => {
    const uri = process.env.TEST_DATABASE_URL;
    if (!uri) throw new Error('TEST_DATABASE_URL not set; check tests/setup/global.ts');
    ctx.client = postgres(uri, { max: 5 });
    ctx.db = drizzle(ctx.client, { schema });
  });

  beforeEach(async () => {
    if (ctx.client) await truncateAll(ctx.client);
  });

  afterAll(async () => {
    await ctx.client?.end();
    delete ctx.client;
    delete ctx.db;
  });
}

export const DB_ERR_UNIQUE = /duplicate|unique/i;
export const DB_ERR_FK = /foreign key|violates/i;
export const DB_ERR_NOT_NULL = /null value|not-null/i;

export function expectDbError(pattern: RegExp): object {
  return expect.objectContaining({
    cause: expect.objectContaining({ message: expect.stringMatching(pattern) }),
  });
}
