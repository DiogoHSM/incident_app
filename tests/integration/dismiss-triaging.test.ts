import { describe, expect, test, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { dismissTriagingIncident } from '@/lib/db/queries/incidents-ingest';
import { ForbiddenError } from '@/lib/authz';

describe('dismissTriagingIncident', () => {
  useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let teamId: string;
  let incidentId: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });
    bob = await provisionUserOnSignIn(db, {
      email: 'bob@example.test',
      name: 'Bob',
      ssoSubject: 'sso-bob',
      adminEmails: [],
    });
    const [t] = await db.insert(teams).values({ name: 'Platform', slug: 'platform' }).returning();
    if (!t) throw new Error('team');
    teamId = t.id;
    await db.insert(teamMemberships).values({ teamId, userId: alice.id, role: 'lead' });

    const [inc] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-dismiss1',
        teamId,
        declaredBy: null,
        severity: 'SEV2',
        status: 'triaging',
        title: 'Auto-fired',
        externalFingerprints: ['fp-1'],
      })
      .returning();
    if (!inc) throw new Error('incident');
    incidentId = inc.id;
  });

  test('flips status to resolved + writes status_change body.dismissed=true', async () => {
    const db = getTestDb();
    const result = await dismissTriagingIncident(db, alice.id, incidentId);
    expect(result.incident.status).toBe('resolved');
    expect(result.incident.resolvedAt).toBeInstanceOf(Date);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId));
    const sc = events.find((e) => e.kind === 'status_change');
    expect(sc).toBeDefined();
    const body = sc!.body as { dismissed?: boolean; from: string; to: string };
    expect(body.from).toBe('triaging');
    expect(body.to).toBe('resolved');
    expect(body.dismissed).toBe(true);
  });

  test('rejects when status is not triaging', async () => {
    const db = getTestDb();
    await db
      .update(incidents)
      .set({ status: 'investigating' })
      .where(eq(incidents.id, incidentId));
    await expect(dismissTriagingIncident(db, alice.id, incidentId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test('rejects non-team-member', async () => {
    const db = getTestDb();
    await expect(dismissTriagingIncident(db, bob.id, incidentId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
