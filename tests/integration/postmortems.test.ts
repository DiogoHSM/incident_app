import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/db';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import {
  createDraftForIncident,
  findPostmortemByIdForUser,
  findPostmortemForIncidentSlug,
  updatePostmortemMarkdown,
  publishPostmortem,
  setPostmortemPublicVisibility,
} from '@/lib/db/queries/postmortems';
import { ForbiddenError } from '@/lib/authz';
import { eq } from 'drizzle-orm';

describe('postmortem queries', () => {
  useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let admin: { id: string };
  let teamId: string;
  let incidentId: string;
  let incidentSlug: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test',
      name: 'Alice Anderson',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });
    bob = await provisionUserOnSignIn(db, {
      email: 'bob@example.test',
      name: 'Bob Brown',
      ssoSubject: 'sso-bob',
      adminEmails: [],
    });
    admin = await provisionUserOnSignIn(db, {
      email: 'admin@example.test',
      name: 'Admin',
      ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
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

    const [incident] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-aaaa1111',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV2',
        title: 'Login 500s',
        summary: 'users could not log in',
      })
      .returning();
    if (!incident) throw new Error('incident');
    incidentId = incident.id;
    incidentSlug = incident.publicSlug;
  });

  test('createDraftForIncident creates a draft with starter template', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    expect(pm.status).toBe('draft');
    expect(pm.publicOnStatusPage).toBe(false);
    expect(pm.publishedAt).toBeNull();
    expect(pm.markdownBody).toContain('## Summary');
    expect(pm.markdownBody).toContain('## Timeline');
  });

  test('createDraftForIncident is idempotent — returns existing draft on second call', async () => {
    const first = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const second = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    expect(second.id).toBe(first.id);
  });

  test('createDraftForIncident rejects non-team-member', async () => {
    await expect(createDraftForIncident(getTestDb(), bob.id, incidentId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test('admin can create draft on any team incident', async () => {
    const pm = await createDraftForIncident(getTestDb(), admin.id, incidentId);
    expect(pm.status).toBe('draft');
  });

  test('findPostmortemForIncidentSlug returns null when none exists', async () => {
    const found = await findPostmortemForIncidentSlug(getTestDb(), alice.id, incidentSlug);
    expect(found).toBeNull();
  });

  test('findPostmortemForIncidentSlug returns the draft + incident', async () => {
    await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const found = await findPostmortemForIncidentSlug(getTestDb(), alice.id, incidentSlug);
    expect(found).not.toBeNull();
    expect(found!.postmortem.status).toBe('draft');
    expect(found!.incident.publicSlug).toBe(incidentSlug);
  });

  test('findPostmortemForIncidentSlug returns null for non-team-member non-admin', async () => {
    await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const found = await findPostmortemForIncidentSlug(getTestDb(), bob.id, incidentSlug);
    expect(found).toBeNull();
  });

  test('findPostmortemByIdForUser returns null for non-team-member non-admin', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const found = await findPostmortemByIdForUser(getTestDb(), bob.id, pm.id);
    expect(found).toBeNull();
  });

  test('updatePostmortemMarkdown saves new content + bumps updated_at', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const before = pm.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updatePostmortemMarkdown(
      getTestDb(),
      alice.id,
      pm.id,
      '## Summary\nthe new body',
    );
    expect(updated.markdownBody).toBe('## Summary\nthe new body');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
  });

  test('updatePostmortemMarkdown rejects non-team-member', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    await expect(
      updatePostmortemMarkdown(getTestDb(), bob.id, pm.id, 'nope'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('publishPostmortem flips status, fills published_at, and emits postmortem_link timeline event', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const result = await publishPostmortem(getTestDb(), alice.id, pm.id);

    expect(result.postmortem.status).toBe('published');
    expect(result.postmortem.publishedAt).toBeInstanceOf(Date);

    const events = await getTestDb()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId));
    const linkEvent = events.find((e) => e.kind === 'postmortem_link');
    expect(linkEvent).toBeDefined();
    const body = linkEvent!.body as { kind: string; postmortemId: string };
    expect(body.kind).toBe('postmortem_link');
    expect(body.postmortemId).toBe(pm.id);
  });

  test('publishPostmortem is a no-op when already published', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const first = await publishPostmortem(getTestDb(), alice.id, pm.id);
    const second = await publishPostmortem(getTestDb(), alice.id, pm.id);
    expect(second.postmortem.publishedAt!.getTime()).toBe(
      first.postmortem.publishedAt!.getTime(),
    );

    const events = await getTestDb()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId));
    const linkEvents = events.filter((e) => e.kind === 'postmortem_link');
    expect(linkEvents.length).toBe(1);
  });

  test('setPostmortemPublicVisibility flips the flag', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    const updated = await setPostmortemPublicVisibility(getTestDb(), alice.id, pm.id, true);
    expect(updated.publicOnStatusPage).toBe(true);

    const flippedBack = await setPostmortemPublicVisibility(getTestDb(), alice.id, pm.id, false);
    expect(flippedBack.publicOnStatusPage).toBe(false);
  });

  test('setPostmortemPublicVisibility rejects non-team-member', async () => {
    const pm = await createDraftForIncident(getTestDb(), alice.id, incidentId);
    await expect(
      setPostmortemPublicVisibility(getTestDb(), bob.id, pm.id, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
