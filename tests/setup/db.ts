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
