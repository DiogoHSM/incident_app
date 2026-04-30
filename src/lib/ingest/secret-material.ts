import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '@/lib/env';

export type AesSecret = {
  kind: 'aes';
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  authTag: string; // base64 (16 bytes)
};

export type BcryptSecret = {
  kind: 'bcrypt';
  hash: string;
};

export type SecretMaterial = AesSecret | BcryptSecret;

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const BCRYPT_COST = 10;

function key(): Buffer {
  return Buffer.from(env.WEBHOOK_SECRET_ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plaintext: string): AesSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    kind: 'aes',
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(material: AesSecret): string {
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(material.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(material.authTag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(material.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

export async function hashBearer(plaintext: string): Promise<BcryptSecret> {
  const hash = await bcrypt.hash(plaintext, BCRYPT_COST);
  return { kind: 'bcrypt', hash };
}

export async function compareBearer(candidate: string, material: BcryptSecret): Promise<boolean> {
  return bcrypt.compare(candidate, material.hash);
}

const AesSecretSchema = z.object({
  kind: z.literal('aes'),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
});

const BcryptSecretSchema = z.object({
  kind: z.literal('bcrypt'),
  hash: z.string().min(1),
});

const SecretMaterialSchema = z.discriminatedUnion('kind', [AesSecretSchema, BcryptSecretSchema]);

/**
 * Type narrowing helper — used by the route to dispatch verify() based on
 * the column shape rather than the source's `type` column directly. They
 * should always agree (HMAC adapters use 'aes', Grafana uses 'bcrypt'),
 * but this function makes the consistency check explicit.
 *
 * Accepts `unknown` (jsonb column) and validates the full shape via zod
 * before narrowing — a malformed stored value throws here with a clear
 * error rather than crashing deeper inside decryptSecret.
 */
export function expectSecretShape<K extends SecretMaterial['kind']>(
  material: unknown,
  kind: K,
): Extract<SecretMaterial, { kind: K }> {
  const parsed = SecretMaterialSchema.parse(material);
  if (parsed.kind !== kind) {
    throw new Error(`Expected secret_material.kind=${kind}, got ${parsed.kind}`);
  }
  return parsed as Extract<SecretMaterial, { kind: K }>;
}
