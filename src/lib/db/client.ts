import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  queryClient?: ReturnType<typeof postgres>;
};

const queryClient = globalForDb.queryClient ?? postgres(env.DATABASE_URL, { max: 10 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.queryClient = queryClient;
}

export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
