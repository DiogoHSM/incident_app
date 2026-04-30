import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';

export const SNAPSHOT_NOTIFY_CHANNEL = 'status_snapshot_updated';

/**
 * Fires a pg_notify on the status_snapshot_updated channel inside the
 * caller's transaction. v1 has no live consumer of this channel —
 * /status pages rely on Next ISR (revalidate=15) for cache invalidation.
 * The notify exists as a forward-looking hook so a Plan 9+ deployment
 * can wire revalidatePath('/status') from a long-lived listener
 * without touching every mutation site again.
 */
export async function notifySnapshotUpdated(
  tx: DB,
  scope: 'public' | { type: 'team'; teamId: string },
): Promise<void> {
  const scopeKey = scope === 'public' ? 'public' : `team:${scope.teamId}`;
  const payload = JSON.stringify({ scope: scopeKey, at: new Date().toISOString() });
  await tx.execute(sql`SELECT pg_notify(${SNAPSHOT_NOTIFY_CHANNEL}, ${payload})`);
}
