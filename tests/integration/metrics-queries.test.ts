import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { listResolvedIncidentsInRange } from '@/lib/db/queries/metrics';

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
