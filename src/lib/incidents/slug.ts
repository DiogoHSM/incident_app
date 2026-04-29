import { randomBytes } from 'node:crypto';

export function generateIncidentSlug(): string {
  // 9 random bytes → 12 base64url chars before lowercasing.
  // Strip the two non-alphanumeric base64url chars (- and _) so slugs are
  // [a-z0-9] only, then take the first 8 chars. ~10^12 unique values.
  const raw = randomBytes(9).toString('base64url').toLowerCase();
  const clean = raw.replace(/[^a-z0-9]/g, '');
  return `inc-${clean.slice(0, 8).padEnd(8, '0')}`;
}
