import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { services } from '@/lib/db/schema/services';
import {
  listResolvedIncidentsInRange,
  listAcknowledgedIncidentsInRange,
  listDeclaredIncidentsInRange,
  listIncidentsByServiceInRange,
} from '@/lib/db/queries/metrics';

describe('listResolvedIncidentsInRange', () => {
  useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let admin: { id: string };
  let teamA: string;
  let teamB: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test', name: 'Alice', ssoSubject: 'sso-alice', adminEmails: [],
    });
    bob = await provisionUserOnSignIn(db, {
      email: 'bob@example.test', name: 'Bob', ssoSubject: 'sso-bob', adminEmails: [],
    });
    admin = await provisionUserOnSignIn(db, {
      email: 'admin@example.test', name: 'Admin', ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });
    const [tA] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    const [tB] = await db.insert(teams).values({ name: 'B', slug: 'b' }).returning();
    if (!tA || !tB) throw new Error('teams');
    teamA = tA.id; teamB = tB.id;
    await db.insert(teamMemberships).values({ teamId: teamA, userId: alice.id, role: 'lead' });
    await db.insert(teamMemberships).values({ teamId: teamB, userId: bob.id, role: 'member' });
  });

  async function declareResolved(opts: {
    teamId: string;
    declaredBy: string;
    declaredAt: Date;
    resolvedAt: Date;
    severity?: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
    slug: string;
    dismissed?: boolean;
  }) {
    const db = getTestDb();
    const [inc] = await db
      .insert(incidents)
      .values({
        publicSlug: opts.slug,
        teamId: opts.teamId,
        declaredBy: opts.declaredBy,
        severity: opts.severity ?? 'SEV2',
        status: 'resolved',
        title: opts.slug,
        summary: '',
        declaredAt: opts.declaredAt,
        resolvedAt: opts.resolvedAt,
      })
      .returning();
    if (!inc) throw new Error('incident');
    await db.insert(timelineEvents).values({
      incidentId: inc.id,
      authorUserId: opts.declaredBy,
      kind: 'status_change',
      body: opts.dismissed
        ? { kind: 'status_change', from: 'triaging', to: 'resolved', dismissed: true }
        : { kind: 'status_change', from: 'investigating', to: 'resolved' },
      occurredAt: opts.resolvedAt,
    });
    return inc;
  }

  test('returns incidents resolved within the window for a team member', async () => {
    await declareResolved({
      teamId: teamA, declaredBy: alice.id,
      declaredAt: new Date('2026-04-20T10:00:00Z'),
      resolvedAt: new Date('2026-04-20T11:00:00Z'),
      slug: 'inc-aa000001',
    });
    const rows = await listResolvedIncidentsInRange(getTestDb(), alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dismissed).toBe(false);
  });

  test('excludes incidents resolved BEFORE the window', async () => {
    await declareResolved({
      teamId: teamA, declaredBy: alice.id,
      declaredAt: new Date('2026-03-01T10:00:00Z'),
      resolvedAt: new Date('2026-03-01T11:00:00Z'),
      slug: 'inc-aa000002',
    });
    const rows = await listResolvedIncidentsInRange(getTestDb(), alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toEqual([]);
  });

  test('flags dismissed incidents with body.dismissed=true', async () => {
    await declareResolved({
      teamId: teamA, declaredBy: alice.id,
      declaredAt: new Date('2026-04-20T10:00:00Z'),
      resolvedAt: new Date('2026-04-20T10:05:00Z'),
      slug: 'inc-aa000003',
      dismissed: true,
    });
    const rows = await listResolvedIncidentsInRange(getTestDb(), alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dismissed).toBe(true);
  });

  test('non-team-member sees zero (cross-team isolation)', async () => {
    await declareResolved({
      teamId: teamA, declaredBy: alice.id,
      declaredAt: new Date('2026-04-20T10:00:00Z'),
      resolvedAt: new Date('2026-04-20T11:00:00Z'),
      slug: 'inc-aa000004',
    });
    const rows = await listResolvedIncidentsInRange(getTestDb(), bob.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toEqual([]);
  });

  test('admin sees all teams (admin-sees-all parity)', async () => {
    await declareResolved({
      teamId: teamA, declaredBy: alice.id,
      declaredAt: new Date('2026-04-20T10:00:00Z'),
      resolvedAt: new Date('2026-04-20T11:00:00Z'),
      slug: 'inc-aa000005',
    });
    await declareResolved({
      teamId: teamB, declaredBy: bob.id,
      declaredAt: new Date('2026-04-21T10:00:00Z'),
      resolvedAt: new Date('2026-04-21T11:00:00Z'),
      slug: 'inc-bb000001',
    });
    const rows = await listResolvedIncidentsInRange(getTestDb(), admin.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toHaveLength(2);
  });

  test('teamId filter narrows admin view to one team', async () => {
    await declareResolved({
      teamId: teamA, declaredBy: alice.id,
      declaredAt: new Date('2026-04-20T10:00:00Z'),
      resolvedAt: new Date('2026-04-20T11:00:00Z'),
      slug: 'inc-aa000006',
    });
    await declareResolved({
      teamId: teamB, declaredBy: bob.id,
      declaredAt: new Date('2026-04-21T10:00:00Z'),
      resolvedAt: new Date('2026-04-21T11:00:00Z'),
      slug: 'inc-bb000002',
    });
    const rows = await listResolvedIncidentsInRange(getTestDb(), admin.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
      teamId: teamA,
    });
    expect(rows).toHaveLength(1);
  });
});

describe('listAcknowledgedIncidentsInRange', () => {
  useTestDb();
  let alice: { id: string };
  let teamA: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test', name: 'Alice', ssoSubject: 'sso-alice', adminEmails: [],
    });
    const [t] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    if (!t) throw new Error();
    teamA = t.id;
    await db.insert(teamMemberships).values({ teamId: teamA, userId: alice.id, role: 'lead' });
  });

  test('webhook-declared incident with first leave-triaging event → ack timestamp set', async () => {
    const db = getTestDb();
    const declaredAt = new Date('2026-04-20T10:00:00Z');
    const ackAt = new Date('2026-04-20T10:05:00Z');

    const [inc] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-aa999991',
        teamId: teamA,
        declaredBy: null,
        severity: 'SEV2',
        status: 'investigating',
        title: 'webhook',
        summary: '',
        declaredAt,
      })
      .returning();
    if (!inc) throw new Error();

    await db.insert(timelineEvents).values({
      incidentId: inc.id,
      authorUserId: alice.id,
      kind: 'status_change',
      body: { kind: 'status_change', from: 'triaging', to: 'investigating' },
      occurredAt: ackAt,
    });

    const rows = await listAcknowledgedIncidentsInRange(db, alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.acknowledgedAt?.toISOString()).toBe(ackAt.toISOString());
  });

  test('human-declared incident is excluded (declared_by IS NOT NULL)', async () => {
    const db = getTestDb();
    await db.insert(incidents).values({
      publicSlug: 'inc-aa999992',
      teamId: teamA,
      declaredBy: alice.id,
      severity: 'SEV2',
      status: 'investigating',
      title: 'human',
      summary: '',
      declaredAt: new Date('2026-04-20T10:00:00Z'),
    });
    const rows = await listAcknowledgedIncidentsInRange(db, alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toHaveLength(0);
  });
});

describe('listDeclaredIncidentsInRange', () => {
  useTestDb();
  let alice: { id: string };
  let teamA: string;
  let svcId: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test', name: 'Alice', ssoSubject: 'sso-alice', adminEmails: [],
    });
    const [t] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    if (!t) throw new Error();
    teamA = t.id;
    await db.insert(teamMemberships).values({ teamId: teamA, userId: alice.id, role: 'lead' });
    const [s] = await db
      .insert(services)
      .values({ teamId: teamA, name: 'Auth', slug: 'auth' })
      .returning();
    if (!s) throw new Error();
    svcId = s.id;
  });

  test('returns one row per incident declared in the window', async () => {
    const db = getTestDb();
    const [a] = await db.insert(incidents).values({
      publicSlug: 'inc-cc000001',
      teamId: teamA,
      declaredBy: alice.id,
      severity: 'SEV1',
      title: 't1',
      summary: '',
      declaredAt: new Date('2026-04-21T08:00:00Z'),
    }).returning();
    if (!a) throw new Error();
    await db.insert(incidentServices).values({ incidentId: a.id, serviceId: svcId });

    await db.insert(incidents).values({
      publicSlug: 'inc-cc000002',
      teamId: teamA,
      declaredBy: alice.id,
      severity: 'SEV3',
      title: 't2',
      summary: '',
      declaredAt: new Date('2026-04-22T08:00:00Z'),
    });

    const rows = await listDeclaredIncidentsInRange(db, alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.severity).sort()).toEqual(['SEV1', 'SEV3']);
  });
});

describe('listIncidentsByServiceInRange', () => {
  useTestDb();
  let alice: { id: string };
  let teamA: string;
  let svcAuth: string;
  let svcBilling: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test', name: 'Alice', ssoSubject: 'sso-alice', adminEmails: [],
    });
    const [t] = await db.insert(teams).values({ name: 'A', slug: 'a' }).returning();
    if (!t) throw new Error();
    teamA = t.id;
    await db.insert(teamMemberships).values({ teamId: teamA, userId: alice.id, role: 'lead' });
    const [s1] = await db.insert(services).values({ teamId: teamA, name: 'Auth', slug: 'auth' }).returning();
    const [s2] = await db.insert(services).values({ teamId: teamA, name: 'Billing', slug: 'billing' }).returning();
    if (!s1 || !s2) throw new Error();
    svcAuth = s1.id; svcBilling = s2.id;
  });

  test('aggregates per (service, severity) within the window', async () => {
    const db = getTestDb();
    async function seed(slug: string, severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4', svcs: string[]) {
      const [inc] = await db.insert(incidents).values({
        publicSlug: slug,
        teamId: teamA,
        declaredBy: alice.id,
        severity,
        title: slug,
        summary: '',
        declaredAt: new Date('2026-04-22T08:00:00Z'),
      }).returning();
      if (!inc) throw new Error();
      for (const sid of svcs) {
        await db.insert(incidentServices).values({ incidentId: inc.id, serviceId: sid });
      }
    }
    await seed('inc-dd000001', 'SEV1', [svcAuth]);
    await seed('inc-dd000002', 'SEV1', [svcAuth]);
    await seed('inc-dd000003', 'SEV2', [svcAuth, svcBilling]);
    await seed('inc-dd000004', 'SEV3', [svcBilling]);

    const rows = await listIncidentsByServiceInRange(db, alice.id, {
      from: new Date('2026-04-15T00:00:00Z'),
      to: new Date('2026-04-29T00:00:00Z'),
    });

    const key = (r: { serviceName: string; severity: string }) =>
      `${r.serviceName}/${r.severity}`;
    const m = new Map(rows.map((r) => [key(r), r.count]));
    expect(m.get('Auth/SEV1')).toBe(2);
    expect(m.get('Auth/SEV2')).toBe(1);
    expect(m.get('Billing/SEV2')).toBe(1);
    expect(m.get('Billing/SEV3')).toBe(1);
  });
});
