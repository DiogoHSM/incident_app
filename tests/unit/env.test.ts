import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const schema = z.object({
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
});

describe('env.ADMIN_EMAILS', () => {
  it('parses a comma-separated list, lowercases, trims, filters empty', () => {
    const out = schema.parse({ ADMIN_EMAILS: 'A@b.co , c@d.co,, e@f.co ' });
    expect(out.ADMIN_EMAILS).toEqual(['a@b.co', 'c@d.co', 'e@f.co']);
  });

  it('defaults to empty array', () => {
    const out = schema.parse({});
    expect(out.ADMIN_EMAILS).toEqual([]);
  });
});
