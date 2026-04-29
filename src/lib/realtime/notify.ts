import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { IncidentUpdatePayloadSchema, type IncidentUpdatePayload } from './types';

export const NOTIFY_CHANNEL = 'incident_updates';

export async function notifyIncidentUpdate(
  tx: DB,
  payload: IncidentUpdatePayload,
): Promise<void> {
  const validated = IncidentUpdatePayloadSchema.parse(payload);
  await tx.execute(sql`SELECT pg_notify(${NOTIFY_CHANNEL}, ${JSON.stringify(validated)})`);
}
