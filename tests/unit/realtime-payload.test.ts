import { describe, expect, it } from 'vitest';
import { IncidentUpdatePayloadSchema } from '@/lib/realtime/types';

describe('IncidentUpdatePayloadSchema', () => {
  it('parses a valid payload', () => {
    const parsed = IncidentUpdatePayloadSchema.parse({
      incidentId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
      kind: 'note',
      occurredAt: '2026-04-29T12:00:00.000Z',
    });
    expect(parsed.kind).toBe('note');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      IncidentUpdatePayloadSchema.parse({
        incidentId: '11111111-1111-4111-8111-111111111111',
        eventId: '22222222-2222-4222-8222-222222222222',
        kind: 'webhook',
        occurredAt: '2026-04-29T12:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects malformed UUIDs', () => {
    expect(() =>
      IncidentUpdatePayloadSchema.parse({
        incidentId: 'not-a-uuid',
        eventId: '22222222-2222-4222-8222-222222222222',
        kind: 'note',
        occurredAt: '2026-04-29T12:00:00.000Z',
      }),
    ).toThrow();
  });
});
