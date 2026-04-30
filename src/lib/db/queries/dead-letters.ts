import { desc } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import {
  deadLetterWebhooks,
  type DeadLetterWebhook,
} from '@/lib/db/schema/dead-letters';
import { requireAdmin } from '@/lib/authz';

export interface RecordDeadLetterInput {
  sourceId: string | null;
  headers: Record<string, string>;
  body: string;
  error: string;
}

/**
 * Route-internal: writes a dead letter without an actor. The route never
 * exposes this directly to a session; it's called from within the route's
 * error path (HMAC fail → DON'T record, per spec §7.5; adapter throw →
 * record; DB blip → record from a fresh connection).
 */
export async function recordDeadLetter(
  db: DB,
  input: RecordDeadLetterInput,
): Promise<DeadLetterWebhook> {
  const [row] = await db
    .insert(deadLetterWebhooks)
    .values({
      sourceId: input.sourceId,
      headers: input.headers,
      body: input.body,
      error: input.error,
    })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export interface ListDeadLettersOptions {
  limit: number;
}

export async function listDeadLetters(
  db: DB,
  actorUserId: string,
  options: ListDeadLettersOptions,
): Promise<DeadLetterWebhook[]> {
  await requireAdmin(db, actorUserId);
  return db
    .select()
    .from(deadLetterWebhooks)
    .orderBy(desc(deadLetterWebhooks.receivedAt))
    .limit(options.limit);
}
