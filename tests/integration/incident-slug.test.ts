import { describe, expect, test } from 'vitest';
import { generateIncidentSlug } from '@/lib/incidents/slug';

describe('generateIncidentSlug', () => {
  test('matches the inc-XXXXXXXX shape', () => {
    const slug = generateIncidentSlug();
    expect(slug).toMatch(/^inc-[a-z0-9]{8}$/);
  });

  test('1000 invocations yield 1000 unique values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateIncidentSlug());
    expect(seen.size).toBe(1000);
  });
});
