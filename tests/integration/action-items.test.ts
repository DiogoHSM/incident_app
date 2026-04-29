import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/db';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { createDraftForIncident } from '@/lib/db/queries/postmortems';
import {
  listActionItemsForPostmortem,
  createActionItem,
  updateActionItem,
  deleteActionItem,
} from '@/lib/db/queries/action-items';
import { ForbiddenError } from '@/lib/authz';

describe('action item queries', () => {
  useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let postmortemId: string;

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

    const [team] = await db
      .insert(teams)
      .values({ name: 'Platform', slug: 'platform' })
      .returning();
    if (!team) throw new Error('team');
    const teamId = team.id;
    await db
      .insert(teamMemberships)
      .values({ teamId, userId: alice.id, role: 'lead' });

    const [incident] = await db
      .insert(incidents)
      .values({
        publicSlug: 'inc-bbbb2222',
        teamId,
        declaredBy: alice.id,
        severity: 'SEV3',
        title: 'Cache thrash',
        summary: 'redis evictions',
      })
      .returning();
    if (!incident) throw new Error('incident');
    const pm = await createDraftForIncident(db, alice.id, incident.id);
    postmortemId = pm.id;
  });

  test('createActionItem creates a row with defaults (status=open, no assignee)', async () => {
    const item = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 'Add backpressure to cache writes',
    });
    expect(item.title).toBe('Add backpressure to cache writes');
    expect(item.status).toBe('open');
    expect(item.assigneeUserId).toBeNull();
    expect(item.dueDate).toBeNull();
    expect(item.externalUrl).toBeNull();
  });

  test('createActionItem accepts assignee + due_date + url', async () => {
    const item = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 'Write integration test',
      assigneeUserId: alice.id,
      dueDate: '2026-05-15',
      externalUrl: 'https://linear.app/team/issue/PER-100',
    });
    expect(item.assigneeUserId).toBe(alice.id);
    expect(item.dueDate).toBe('2026-05-15');
    expect(item.externalUrl).toBe('https://linear.app/team/issue/PER-100');
  });

  test('createActionItem rejects non-team-member', async () => {
    await expect(
      createActionItem(getTestDb(), bob.id, postmortemId, { title: 'nope' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('listActionItemsForPostmortem returns items in createdAt order', async () => {
    await createActionItem(getTestDb(), alice.id, postmortemId, { title: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    await createActionItem(getTestDb(), alice.id, postmortemId, { title: 'second' });
    const items = await listActionItemsForPostmortem(getTestDb(), alice.id, postmortemId);
    expect(items.map((i) => i.title)).toEqual(['first', 'second']);
  });

  test('listActionItemsForPostmortem returns empty for non-team-member non-admin', async () => {
    await createActionItem(getTestDb(), alice.id, postmortemId, { title: 'first' });
    const items = await listActionItemsForPostmortem(getTestDb(), bob.id, postmortemId);
    expect(items).toEqual([]);
  });

  test('updateActionItem changes title + status + assignee', async () => {
    const created = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 'old',
    });
    const updated = await updateActionItem(getTestDb(), alice.id, created.id, {
      title: 'new',
      status: 'in_progress',
      assigneeUserId: alice.id,
    });
    expect(updated.title).toBe('new');
    expect(updated.status).toBe('in_progress');
    expect(updated.assigneeUserId).toBe(alice.id);
  });

  test('updateActionItem can clear assignee + due_date + url with explicit nulls', async () => {
    const created = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 't',
      assigneeUserId: alice.id,
      dueDate: '2026-05-15',
      externalUrl: 'https://example.test/x',
    });
    const updated = await updateActionItem(getTestDb(), alice.id, created.id, {
      assigneeUserId: null,
      dueDate: null,
      externalUrl: null,
    });
    expect(updated.assigneeUserId).toBeNull();
    expect(updated.dueDate).toBeNull();
    expect(updated.externalUrl).toBeNull();
  });

  test('updateActionItem rejects non-team-member', async () => {
    const created = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 't',
    });
    await expect(
      updateActionItem(getTestDb(), bob.id, created.id, { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('deleteActionItem removes the row', async () => {
    const created = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 't',
    });
    await deleteActionItem(getTestDb(), alice.id, created.id);
    const items = await listActionItemsForPostmortem(getTestDb(), alice.id, postmortemId);
    expect(items).toEqual([]);
  });

  test('deleteActionItem rejects non-team-member', async () => {
    const created = await createActionItem(getTestDb(), alice.id, postmortemId, {
      title: 't',
    });
    await expect(deleteActionItem(getTestDb(), bob.id, created.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
