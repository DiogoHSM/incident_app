import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@/lib/db/schema';

// 32 zero bytes, base64 — TEST ONLY
process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ??=
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const uri = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = uri;

  const client = postgres(uri, { max: 2 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
