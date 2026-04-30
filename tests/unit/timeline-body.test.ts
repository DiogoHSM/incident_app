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

  test('status_change rejects whitespace-only reason', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'status_change',
        from: 'investigating',
        to: 'identified',
        reason: '   ',
      }),
    ).toThrow();
  });

  test('status_change without reason parses cleanly', () => {
    const parsed = TimelineEventBodySchema.parse({
      kind: 'status_change',
      from: 'investigating',
      to: 'identified',
    });
    expect(parsed).toMatchObject({ kind: 'status_change', from: 'investigating', to: 'identified' });
    if (parsed.kind === 'status_change') {
      expect(parsed.reason).toBeUndefined();
    } else {
      throw new Error('expected status_change');
    }
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
        toUserId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
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

  test('postmortem_link shape — postmortemId required and uuid', () => {
    expect(
      TimelineEventBodySchema.parse({
        kind: 'postmortem_link',
        postmortemId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toMatchObject({ kind: 'postmortem_link' });
  });

  test('postmortem_link rejects non-uuid postmortemId', () => {
    expect(() =>
      TimelineEventBodySchema.parse({ kind: 'postmortem_link', postmortemId: 'not-a-uuid' }),
    ).toThrow();
  });

  test('postmortem_link rejects missing postmortemId', () => {
    expect(() =>
      TimelineEventBodySchema.parse({ kind: 'postmortem_link' }),
    ).toThrow();
  });

  test('webhook shape — required fields parse', () => {
    expect(
      TimelineEventBodySchema.parse({
        kind: 'webhook',
        sourceId: '11111111-1111-4111-8111-111111111111',
        sourceType: 'sentry',
        sourceName: 'sentry-prod',
        fingerprint: 'issue-abc123',
      }),
    ).toMatchObject({ kind: 'webhook', sourceType: 'sentry' });
  });

  test('webhook shape — optional sourceUrl + summary parse', () => {
    const parsed = TimelineEventBodySchema.parse({
      kind: 'webhook',
      sourceId: '11111111-1111-4111-8111-111111111111',
      sourceType: 'datadog',
      sourceName: 'datadog-prod',
      fingerprint: 'alert-1:monitor-2',
      sourceUrl: 'https://app.datadoghq.com/event/1',
      summary: 'CPU > 90%',
    });
    expect(parsed).toMatchObject({ sourceUrl: 'https://app.datadoghq.com/event/1' });
  });

  test('webhook rejects unknown sourceType', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'webhook',
        sourceId: '11111111-1111-4111-8111-111111111111',
        sourceType: 'pagerduty',
        sourceName: 'pd',
        fingerprint: 'x',
      }),
    ).toThrow();
  });

  test('webhook rejects empty fingerprint', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'webhook',
        sourceId: '11111111-1111-4111-8111-111111111111',
        sourceType: 'generic',
        sourceName: 'g',
        fingerprint: '',
      }),
    ).toThrow();
  });

  test('webhook rejects malformed sourceUrl', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'webhook',
        sourceId: '11111111-1111-4111-8111-111111111111',
        sourceType: 'generic',
        sourceName: 'g',
        fingerprint: 'x',
        sourceUrl: 'not a url',
      }),
    ).toThrow();
  });

  test('status_change accepts optional dismissed:true', () => {
    expect(
      TimelineEventBodySchema.parse({
        kind: 'status_change',
        from: 'triaging',
        to: 'resolved',
        dismissed: true,
      }),
    ).toMatchObject({ dismissed: true });
  });

  test('status_change rejects dismissed when not boolean', () => {
    expect(() =>
      TimelineEventBodySchema.parse({
        kind: 'status_change',
        from: 'triaging',
        to: 'resolved',
        dismissed: 'yes',
      }),
    ).toThrow();
  });
});
