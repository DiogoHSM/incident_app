import { describe, expect, test } from 'vitest';
import { TimelineEventBodySchema, parseTimelineEventBody } from '@/lib/timeline/body';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';

describe('TimelineEventBodySchema', () => {
  test('accepts a valid note body', () => {
    expect(
      TimelineEventBodySchema.parse({ kind: 'note', markdown: 'Saw 500s on /v1/login' }),
    ).toEqual({ kind: 'note', markdown: 'Saw 500s on /v1/login' });
  });

  test('rejects an empty note', () => {
    expect(() => TimelineEventBodySchema.parse({ kind: 'note', markdown: '' })).toThrow();
  });

  test('rejects an oversized note', () => {
    expect(() =>
      TimelineEventBodySchema.parse({ kind: 'note', markdown: 'x'.repeat(50_001) }),
    ).toThrow();
  });

  test('accepts each valid status_change transition shape', () => {
    for (const from of INCIDENT_STATUS_VALUES) {
      for (const to of INCIDENT_STATUS_VALUES) {
        if (from === to) continue;
        expect(
          TimelineEventBodySchema.parse({ kind: 'status_change', from, to }),
        ).toMatchObject({ kind: 'status_change', from, to });
      }
    }
  });

  test('status_change reason is optional and trimmed', () => {
    const parsed = TimelineEventBodySchema.parse({
      kind: 'status_change',
      from: 'investigating',
      to: 'identified',
      reason: '  rolled back deploy  ',
    });
    expect(parsed).toMatchObject({ reason: 'rolled back deploy' });
  });

  test('severity_change shape', () => {
    expect(
      TimelineEventBodySchema.parse({ kind: 'severity_change', from: 'SEV3', to: 'SEV1' }),
    ).toMatchObject({ kind: 'severity_change', from: 'SEV3', to: 'SEV1' });
  });

  test('role_change shape, allows null on either side', () => {
    expect(
      TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'ic',
        fromUserId: null,
        toUserId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toMatchObject({ kind: 'role_change', role: 'ic' });
  });

  test('role_change rejects unknown role', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'role_change',
        role: 'bogus',
        fromUserId: null,
        toUserId: null,
      }),
    ).toThrow();
  });

  test('parseTimelineEventBody narrows by kind', () => {
    const body = parseTimelineEventBody({ kind: 'note', markdown: 'hi' });
    if (body.kind === 'note') {
      expect(body.markdown).toBe('hi');
    } else {
      throw new Error('expected note kind');
    }
  });
});
