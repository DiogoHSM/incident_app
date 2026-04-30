import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import {
  readSnapshotForScope,
  recomputeAndPersistSnapshot,
  recomputeAllSnapshotsForTeam,
} from '@/lib/db/queries/status-snapshot';
import { eq } from 'drizzle-orm';

describe('status-snapshot queries', () => {
  useTestDb();
  let alice: { id: string };
  let teamId: string;
  let svcId: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });

    const [team] = await db
      .insert(teams)
      .values({ name: 'Platform', slug: 'platform' })
      .returning();
    if (!team) throw new Error('team');
    teamId = team.id;
    await db
      .insert(teamMemberships)
      .values({ teamId, userId: alice.id, role: 'lead' });

    const [svc] = await db
      .insert(services)
      .values({ teamId, name: 'Auth', slug: 'auth' })
      .returning();
    if (!svc) throw new Error('svc');
    svcId = svc.id;
  });

  test('readSnapshotForScope returns null when none persisted', async () => {
    const got = await readSnapshotForScope(getTestDb(), 'public');
    expect(got).toBeNull();
  });

  test('recomputeAndPersistSnapshot for public — empty world', async () => {
    const db = getTestDb();
    const payload = await recomputeAndPersistSnapshot(db, 'public');
    expect(payload.services).toHaveLength(1);
    expect(payload.services[0]?.status).toBe('operational');
    expect(payload.activeIncidents).toEqual([]);

    const back = await readSnapshotForScope(db, 'public');
    expect(back).not.toBeNull();
    expect(back!.services[0]?.id).toBe(svcId);
  });

  test('recomputeAndPersistSnapshot reflects an active SEV1 incident', async () => {
    const db = getTestDb();
    const [inc] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-aaaa1111',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV1',
        status: 'investigating',
        title: 'Login 500s',
        summary: '',
      })
      .returning();
    if (!inc) throw new Error('inc');
    await db.insert(incidentServices).values({ incidentId: inc.id, serviceId: svcId });

    const payload = await recomputeAndPersistSnapshot(db, 'public');
    expect(payload.services[0]?.status).toBe('major_outage');
    expect(payload.activeIncidents).toHaveLength(1);
    expect(payload.activeIncidents[0]?.slug).toBe('inc-aaaa1111');
  });

  test('resolved incidents are not in activeIncidents', async () => {
    const db = getTestDb();
    const [inc] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-bbbb2222',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV1',
        status: 'resolved',
        title: 'Resolved',
        summary: '',
        resolvedAt: new Date(),
      })
      .returning();
    if (!inc) throw new Error('inc');
    await db.insert(incidentServices).values({ incidentId: inc.id, serviceId: svcId });

    const payload = await recomputeAndPersistSnapshot(db, 'public');
    expect(payload.activeIncidents).toEqual([]);
    expect(payload.services[0]?.status).toBe('operational');
  });

  test('recomputeAndPersistSnapshot for team:<uuid> only includes team services', async () => {
    const db = getTestDb();
    const [otherTeam] = await db
      .insert(teams)
      .values({ name: 'Payments', slug: 'payments' })
      .returning();
    if (!otherTeam) throw new Error('other team');
    const [otherSvc] = await db
      .insert(services)
      .values({ teamId: otherTeam.id, name: 'Pay', slug: 'pay' })
      .returning();

    const payload = await recomputeAndPersistSnapshot(db, {
      type: 'team',
      teamId,
    });
    expect(payload.services.map((s) => s.id)).toEqual([svcId]);
    expect(payload.services.map((s) => s.id)).not.toContain(otherSvc!.id);
  });

  test('recomputeAllSnapshotsForTeam writes both public and team:<uuid> rows', async () => {
    const db = getTestDb();
    await recomputeAllSnapshotsForTeam(db, teamId);

    const all = await db.select().from(statusSnapshots);
    const scopes = all.map((r) => r.scope).sort();
    expect(scopes).toContain('public');
    expect(scopes).toContain(`team:${teamId}`);
  });

  test('recomputeAndPersistSnapshot upserts (does not duplicate)', async () => {
    const db = getTestDb();
    await recomputeAndPersistSnapshot(db, 'public');
    await recomputeAndPersistSnapshot(db, 'public');
    const rows = await db
      .select()
      .from(statusSnapshots)
      .where(eq(statusSnapshots.scope, 'public'));
    expect(rows).toHaveLength(1);
  });
});
