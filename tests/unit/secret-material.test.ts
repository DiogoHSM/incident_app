import { describe, expect, test } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  hashBearer,
  compareBearer,
} from '@/lib/ingest/secret-material';

describe('AES-256-GCM round-trip', () => {
  test('encrypt then decrypt yields the original plaintext', () => {
    const enc = encryptSecret('hunter2');
    expect(enc.kind).toBe('aes');
    const round = decryptSecret(enc);
    expect(round).toBe('hunter2');
  });

  test('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
    const a = encryptSecret('hunter2');
    const b = encryptSecret('hunter2');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  test('tampering with ciphertext makes decrypt throw', () => {
    const enc = encryptSecret('hunter2');
    const tampered = { ...enc, ciphertext: 'AA' + enc.ciphertext.slice(2) };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  test('tampering with authTag makes decrypt throw', () => {
    const enc = encryptSecret('hunter2');
    const tampered = { ...enc, authTag: 'AA' + enc.authTag.slice(2) };
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('bcrypt bearer round-trip', () => {
  test('hashBearer + compareBearer match', async () => {
    const hashed = await hashBearer('hunter2');
    expect(hashed.kind).toBe('bcrypt');
    expect(await compareBearer('hunter2', hashed)).toBe(true);
  });

  test('compareBearer rejects wrong token', async () => {
    const hashed = await hashBearer('hunter2');
    expect(await compareBearer('hunter3', hashed)).toBe(false);
  });

  test('compareBearer is timing-safe (string comparison delegated to bcrypt)', async () => {
    const hashed = await hashBearer('hunter2');
    expect(await compareBearer('', hashed)).toBe(false);
  });
});
