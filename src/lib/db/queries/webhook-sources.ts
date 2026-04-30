import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import {
  webhookSources,
  type WebhookSource,
  type WebhookSourceType,
} from '@/lib/db/schema/webhook-sources';
import type { Severity } from '@/lib/db/schema/services';
import { requireAdmin } from '@/lib/authz';
import { encryptSecret, hashBearer, type SecretMaterial } from '@/lib/ingest/secret-material';

export interface CreateWebhookSourceInput {
  teamId: string;
  type: WebhookSourceType;
  name: string;
  defaultSeverity: Severity;
  defaultServiceId?: string | null;
  autoPromoteThreshold?: number;
  autoPromoteWindowSeconds?: number;
}

function newPlaintextSecret(): string {
  // 32 bytes of randomness, base64url-ified — 43 url-safe characters.
  return randomBytes(32).toString('base64url');
}

async function buildSecretMaterial(
  type: WebhookSourceType,
  plaintext: string,
): Promise<SecretMaterial> {
  if (type === 'grafana') return hashBearer(plaintext);
  return encryptSecret(plaintext);
}

export async function listWebhookSourcesForTeam(
  db: DB,
  actorUserId: string,
  teamId: string,
): Promise<WebhookSource[]> {
  await requireAdmin(db, actorUserId);
  return db.select().from(webhookSources).where(eq(webhookSources.teamId, teamId));
}

export async function findWebhookSourceById(
  db: DB,
  sourceId: string,
): Promise<WebhookSource | null> {
  const [row] = await db
    .select()
    .from(webhookSources)
    .where(eq(webhookSources.id, sourceId))
    .limit(1);
  return row ?? null;
}

export async function createWebhookSource(
  db: DB,
  actorUserId: string,
  input: CreateWebhookSourceInput,
): Promise<{ source: WebhookSource; plaintextSecret: string }> {
  await requireAdmin(db, actorUserId);
  const plaintextSecret = newPlaintextSecret();
  const secretMaterial = await buildSecretMaterial(input.type, plaintextSecret);

  const [row] = await db
    .insert(webhookSources)
    .values({
      teamId: input.teamId,
      type: input.type,
      name: input.name,
      secretMaterial,
      defaultSeverity: input.defaultSeverity,
      defaultServiceId: input.defaultServiceId ?? null,
      autoPromoteThreshold: input.autoPromoteThreshold ?? 3,
      autoPromoteWindowSeconds: input.autoPromoteWindowSeconds ?? 600,
    })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return { source: row, plaintextSecret };
}

export async function rotateWebhookSecret(
  db: DB,
  actorUserId: string,
  sourceId: string,
): Promise<{ source: WebhookSource; plaintextSecret: string }> {
  await requireAdmin(db, actorUserId);
  const existing = await findWebhookSourceById(db, sourceId);
  if (!existing) throw new Error('webhook source not found');

  const plaintextSecret = newPlaintextSecret();
  const secretMaterial = await buildSecretMaterial(existing.type, plaintextSecret);

  const [row] = await db
    .update(webhookSources)
    .set({ secretMaterial })
    .where(eq(webhookSources.id, sourceId))
    .returning();
  if (!row) throw new Error('Update returned no rows');
  return { source: row, plaintextSecret };
}

export async function deleteWebhookSource(
  db: DB,
  actorUserId: string,
  sourceId: string,
): Promise<void> {
  await requireAdmin(db, actorUserId);
  await db.delete(webhookSources).where(eq(webhookSources.id, sourceId));
}
