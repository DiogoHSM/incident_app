import { describe, it, expect } from 'vitest';
import { adminEmailsSchema } from '@/lib/env';

describe('adminEmailsSchema', () => {
  it('parses a comma-separated list, lowercases, trims, filters empty', () => {
    expect(adminEmailsSchema.parse('A@b.co , c@d.co,, e@f.co ')).toEqual([
      'a@b.co',
      'c@d.co',
      'e@f.co',
    ]);
  });

  it('defaults to empty array when input is undefined', () => {
    expect(adminEmailsSchema.parse(undefined)).toEqual([]);
  });
});
