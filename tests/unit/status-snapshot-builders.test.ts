import { describe, expect, test } from 'vitest';
import {
  buildPublicSnapshot,
  buildTeamSnapshot,
  serviceStatusFromActive,
  worstSeverityFromIncidents,
} from '@/lib/status/snapshot';
import { StatusSnapshotPayloadSchema } from '@/lib/status/payload';

const teamA = '11111111-1111-4111-8111-111111111111';
const teamB = '22222222-2222-4222-8222-222222222222';
const svc1 = '33333333-3333-4333-8333-333333333333';
const svc2 = '44444444-4444-4444-8444-444444444444';
const svc3 = '55555555-5555-4555-8555-555555555555';
const inc1 = '66666666-6666-4666-8666-666666666666';

describe('serviceStatusFromActive', () => {
  test('no incidents → operational', () => {
    expect(serviceStatusFromActive(svc1, [])).toBe('operational');
  });

  test('SEV1 active and service attached → major_outage', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV1', affectedServiceIds: [svc1] },
      ]),
    ).toBe('major_outage');
  });

  test('SEV2 → partial_outage', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV2', affectedServiceIds: [svc1] },
      ]),
    ).toBe('partial_outage');
  });

  test('SEV3 → degraded', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV3', affectedServiceIds: [svc1] },
      ]),
    ).toBe('degraded');
  });

  test('SEV4 → operational (no public-facing impact)', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: inc1, severity: 'SEV4', affectedServiceIds: [svc1] },
      ]),
    ).toBe('operational');
  });

  test('attached to a different service → operational', () => {
    expect(
      serviceStatusFromActive(svc2, [
        { id: inc1, severity: 'SEV1', affectedServiceIds: [svc1] },
      ]),
    ).toBe('operational');
  });

  test('worst-of when multiple incidents on same service', () => {
    expect(
      serviceStatusFromActive(svc1, [
        { id: 'a', severity: 'SEV3', affectedServiceIds: [svc1] },
        { id: 'b', severity: 'SEV1', affectedServiceIds: [svc1] },
      ]),
    ).toBe('major_outage');
  });
});

describe('worstSeverityFromIncidents', () => {
  test('empty → null', () => {
    expect(worstSeverityFromIncidents([])).toBeNull();
  });

  test('SEV3 + SEV1 → SEV1', () => {
    expect(
      worstSeverityFromIncidents([
        { severity: 'SEV3' },
        { severity: 'SEV1' },
        { severity: 'SEV4' },
      ]),
    ).toBe('SEV1');
  });

  test('SEV4 only → SEV4', () => {
    expect(worstSeverityFromIncidents([{ severity: 'SEV4' }])).toBe('SEV4');
  });
});

describe('buildPublicSnapshot', () => {
  test('empty inputs → all-operational shape', () => {
    const payload = buildPublicSnapshot({
      services: [],
      activeIncidents: [],
      severityByDay: [],
    });
    expect(payload.services).toEqual([]);
    expect(payload.activeIncidents).toEqual([]);
    expect(payload.severityByDay).toEqual([]);
    expect(StatusSnapshotPayloadSchema.parse(payload)).toEqual(payload);
  });

  test('single SEV1 incident affects only attached services', () => {
    const payload = buildPublicSnapshot({
      services: [
        { id: svc1, slug: 'auth', name: 'Auth', teamId: teamA, uptime30d: 0.999 },
        { id: svc2, slug: 'billing', name: 'Billing', teamId: teamA, uptime30d: 1.0 },
      ],
      activeIncidents: [
        {
          slug: 'inc-aaaa1111',
          title: 'Login 500s',
          severity: 'SEV1',
          status: 'investigating',
          declaredAt: new Date('2026-04-29T10:00:00Z'),
          affectedServiceIds: [svc1],
          latestPublicUpdate: {
            body: 'Investigating elevated 500s.',
            postedAt: new Date('2026-04-29T10:05:00Z'),
            author: 'Alice',
          },
        },
      ],
      severityByDay: [],
    });
    expect(payload.services.find((s) => s.id === svc1)?.status).toBe('major_outage');
    expect(payload.services.find((s) => s.id === svc2)?.status).toBe('operational');
    expect(payload.activeIncidents).toHaveLength(1);
    expect(payload.activeIncidents[0]?.latestPublicUpdate?.body).toBe(
      'Investigating elevated 500s.',
    );
    StatusSnapshotPayloadSchema.parse(payload);
  });

  test('null services list still validates', () => {
    const payload = buildPublicSnapshot({
      services: [],
      activeIncidents: [
        {
          slug: 'inc-bbbb2222',
          title: 'Stale cache',
          severity: 'SEV3',
          status: 'identified',
          declaredAt: new Date('2026-04-29T11:00:00Z'),
          affectedServiceIds: [],
        },
      ],
      severityByDay: [],
    });
    expect(payload.services).toEqual([]);
    StatusSnapshotPayloadSchema.parse(payload);
  });

  test('serializes severityByDay as YYYY-MM-DD strings', () => {
    const payload = buildPublicSnapshot({
      services: [],
      activeIncidents: [],
      severityByDay: [
        { date: '2026-04-23', worstSeverity: null },
        { date: '2026-04-24', worstSeverity: 'SEV2' },
      ],
    });
    expect(payload.severityByDay.map((d) => d.date)).toEqual(['2026-04-23', '2026-04-24']);
    StatusSnapshotPayloadSchema.parse(payload);
  });
});

describe('buildTeamSnapshot', () => {
  test('filters services to the given team', () => {
    const payload = buildTeamSnapshot(teamA, {
      services: [
        { id: svc1, slug: 'auth', name: 'Auth', teamId: teamA, uptime30d: 1 },
        { id: svc2, slug: 'billing', name: 'Billing', teamId: teamA, uptime30d: 1 },
        { id: svc3, slug: 'payments', name: 'Payments', teamId: teamB, uptime30d: 1 },
      ],
      activeIncidents: [],
      severityByDay: [],
    });
    expect(payload.services.map((s) => s.id).sort()).toEqual([svc1, svc2].sort());
    StatusSnapshotPayloadSchema.parse(payload);
  });

  test('filters active incidents to those with services on the team', () => {
    const payload = buildTeamSnapshot(teamA, {
      services: [
        { id: svc1, slug: 'auth', name: 'Auth', teamId: teamA, uptime30d: 1 },
        { id: svc3, slug: 'payments', name: 'Payments', teamId: teamB, uptime30d: 1 },
      ],
      activeIncidents: [
        {
          slug: 'inc-aaaa1111',
          title: 'A',
          severity: 'SEV1',
          status: 'investigating',
          declaredAt: new Date(),
          affectedServiceIds: [svc1],
        },
        {
          slug: 'inc-bbbb2222',
          title: 'B',
          severity: 'SEV1',
          status: 'investigating',
          declaredAt: new Date(),
          affectedServiceIds: [svc3],
        },
      ],
      severityByDay: [],
    });
    expect(payload.activeIncidents.map((i) => i.slug)).toEqual(['inc-aaaa1111']);
  });
});
