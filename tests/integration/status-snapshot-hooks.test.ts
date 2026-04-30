import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/db';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import { declareIncident, changeIncidentStatus } from '@/lib/db/queries/incidents';
import { eq } from 'drizzle-orm';

describe('snapshot recompute hooks', () => {
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
    teamId = team!.id;
    await db
      .insert(teamMemberships)
      .values({ teamId, userId: alice.id, role: 'lead' });
    const [svc] = await db
      .insert(services)
      .values({ teamId, name: 'Auth', slug: 'auth' })
      .returning();
    svcId = svc!.id;
  });

  test('declareIncident persists snapshots for public + team:<uuid>', async () => {
    const db = getTestDb();
    await declareIncident(db, alice.id, {
      teamId,
      title: 'Login 500s',
      summary: '',
      severity: 'SEV1',
      affectedServiceIds: [svcId],
    });

    const rows = await db.select().from(statusSnapshots);
    const scopes = rows.map((r) => r.scope).sort();
    expect(scopes).toContain('public');
    expect(scopes).toContain(`team:${teamId}`);

    const publicRow = rows.find((r) => r.scope === 'public')!;
    const payload = publicRow.payload as { activeIncidents: Array<{ slug: string }> };
    expect(payload.activeIncidents).toHaveLength(1);
  });

  test('changeIncidentStatus to resolved removes the incident from active', async () => {
    const db = getTestDb();
    const inc = await declareIncident(db, alice.id, {
      teamId,
      title: 't',
      summary: '',
      severity: 'SEV2',
      affectedServiceIds: [svcId],
    });
    await changeIncidentStatus(db, alice.id, inc.id, 'resolved');

    const [pub] = await db
      .select()
      .from(statusSnapshots)
      .where(eq(statusSnapshots.scope, 'public'));
    const payload = pub!.payload as {
      activeIncidents: unknown[];
      services: Array<{ status: string }>;
    };
    expect(payload.activeIncidents).toEqual([]);
    expect(payload.services[0]?.status).toBe('operational');
  });
});
