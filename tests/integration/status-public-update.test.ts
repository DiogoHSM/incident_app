import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { services } from '@/lib/db/schema/services';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { statusSnapshots } from '@/lib/db/schema/status-snapshots';
import {
  declareIncident,
  postPublicStatusUpdate,
} from '@/lib/db/queries/incidents';
import { ForbiddenError } from '@/lib/authz';
import { eq } from 'drizzle-orm';

describe('postPublicStatusUpdate', () => {
  useTestDb();
  let ic: { id: string };
  let scribe: { id: string };
  let comms: { id: string };
  let admin: { id: string };
  let bystander: { id: string };
  let outsider: { id: string };
  let teamId: string;
  let incidentId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ic = await provisionUserOnSignIn(db, {
      email: 'ic@example.test', name: 'IC', ssoSubject: 'sso-ic', adminEmails: [],
    });
    scribe = await provisionUserOnSignIn(db, {
      email: 'scribe@example.test', name: 'Scribe', ssoSubject: 'sso-scribe', adminEmails: [],
    });
    comms = await provisionUserOnSignIn(db, {
      email: 'comms@example.test', name: 'Comms', ssoSubject: 'sso-comms', adminEmails: [],
    });
    bystander = await provisionUserOnSignIn(db, {
      email: 'bystander@example.test', name: 'Bystander', ssoSubject: 'sso-by', adminEmails: [],
    });
    admin = await provisionUserOnSignIn(db, {
      email: 'admin@example.test', name: 'Admin', ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });
    outsider = await provisionUserOnSignIn(db, {
      email: 'outsider@example.test', name: 'Outsider', ssoSubject: 'sso-out', adminEmails: [],
    });

    const [team] = await db.insert(teams).values({ name: 'Platform', slug: 'platform' }).returning();
    teamId = team!.id;
    for (const u of [ic, scribe, comms, bystander]) {
      await db.insert(teamMemberships).values({ teamId, userId: u.id, role: 'member' });
    }

    const [svc] = await db.insert(services).values({ teamId, name: 'Auth', slug: 'auth' }).returning();

    const inc = await declareIncident(db, ic.id, {
      teamId, title: 'Login 500s', summary: '', severity: 'SEV2',
      affectedServiceIds: [svc!.id],
    });
    incidentId = inc.id;

    await db
      .update(incidents)
      .set({ icUserId: ic.id, scribeUserId: scribe.id, commsUserId: comms.id })
      .where(eq(incidents.id, incidentId));
  });

  test('IC can post a public update', async () => {
    const event = await postPublicStatusUpdate(
      getTestDb(), ic.id, incidentId, 'Investigating elevated 500s.',
    );
    expect(event.kind).toBe('status_update_published');
    const body = event.body as { kind: string; message: string; postedToScope: string };
    expect(body.message).toBe('Investigating elevated 500s.');
    expect(body.postedToScope).toBe('public');
  });

  test('scribe can post', async () => {
    const event = await postPublicStatusUpdate(getTestDb(), scribe.id, incidentId, 'hi');
    expect(event.kind).toBe('status_update_published');
  });

  test('comms can post', async () => {
    const event = await postPublicStatusUpdate(getTestDb(), comms.id, incidentId, 'hi');
    expect(event.kind).toBe('status_update_published');
  });

  test('admin can post even without being on the team', async () => {
    const event = await postPublicStatusUpdate(getTestDb(), admin.id, incidentId, 'hi');
    expect(event.kind).toBe('status_update_published');
  });

  test('plain team member without a role is rejected', async () => {
    await expect(
      postPublicStatusUpdate(getTestDb(), bystander.id, incidentId, 'hi'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('outsider (not on team) is rejected', async () => {
    await expect(
      postPublicStatusUpdate(getTestDb(), outsider.id, incidentId, 'hi'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('public update appears in the snapshot as latestPublicUpdate', async () => {
    const db = getTestDb();
    await postPublicStatusUpdate(db, ic.id, incidentId, 'Investigating.');
    const [pub] = await db.select().from(statusSnapshots).where(eq(statusSnapshots.scope, 'public'));
    const payload = pub!.payload as {
      activeIncidents: Array<{ latestPublicUpdate?: { body: string } }>;
    };
    expect(payload.activeIncidents[0]?.latestPublicUpdate?.body).toBe('Investigating.');
  });

  test('event row + snapshot are atomic — same transaction', async () => {
    const db = getTestDb();
    await postPublicStatusUpdate(db, ic.id, incidentId, 'first');
    const events = await db.select().from(timelineEvents).where(eq(timelineEvents.incidentId, incidentId));
    const updates = events.filter((e) => e.kind === 'status_update_published');
    expect(updates).toHaveLength(1);
    const [pub] = await db.select().from(statusSnapshots).where(eq(statusSnapshots.scope, 'public'));
    expect(pub).toBeDefined();
  });

  test('rejects empty message', async () => {
    await expect(
      postPublicStatusUpdate(getTestDb(), ic.id, incidentId, ''),
    ).rejects.toThrow();
  });

  test('rejects message longer than 5000 chars', async () => {
    await expect(
      postPublicStatusUpdate(getTestDb(), ic.id, incidentId, 'x'.repeat(5001)),
    ).rejects.toThrow();
  });
});
