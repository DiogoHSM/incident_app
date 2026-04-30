import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { incidents } from '@/lib/db/schema/incidents';
import { postmortems } from '@/lib/db/schema/postmortems';
import { actionItems } from '@/lib/db/schema/action-items';
import {
  countActiveIncidentsForUser,
  countOpenRcasForUser,
  countOpenActionItemsForUser,
  mttr7dForUser,
  listActiveIncidentsForUser,
  listMyOpenActionItems,
  listRecentPostmortemsForUser,
} from '@/lib/db/queries/dashboard';

describe('dashboard queries', () => {
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
    if (!tA || !tB) throw new Error();
    teamA = tA.id; teamB = tB.id;
    await db.insert(teamMemberships).values({ teamId: teamA, userId: alice.id, role: 'lead' });
    await db.insert(teamMemberships).values({ teamId: teamB, userId: bob.id, role: 'member' });
  });

  test('countActiveIncidentsForUser counts non-resolved incidents in user teams', async () => {
    const db = getTestDb();
    await db.insert(incidents).values([
      { publicSlug: 'inc-x1', teamId: teamA, declaredBy: alice.id, severity: 'SEV2', title: 't', summary: '', status: 'investigating' },
      { publicSlug: 'inc-x2', teamId: teamA, declaredBy: alice.id, severity: 'SEV3', title: 't', summary: '', status: 'resolved', resolvedAt: new Date() },
      { publicSlug: 'inc-x3', teamId: teamB, declaredBy: bob.id, severity: 'SEV1', title: 't', summary: '', status: 'investigating' },
    ]);
    expect(await countActiveIncidentsForUser(db, alice.id)).toBe(1);
    expect(await countActiveIncidentsForUser(db, bob.id)).toBe(1);
    expect(await countActiveIncidentsForUser(db, admin.id)).toBe(2);
  });

  test('countOpenRcasForUser counts draft postmortems in user teams', async () => {
    const db = getTestDb();
    const [inc] = await db.insert(incidents).values({
      publicSlug: 'inc-y1', teamId: teamA, declaredBy: alice.id,
      severity: 'SEV2', title: 't', summary: '', status: 'resolved',
      resolvedAt: new Date(),
    }).returning();
    if (!inc) throw new Error();
    await db.insert(postmortems).values({ incidentId: inc.id, markdownBody: '# draft', status: 'draft' });

    const [inc2] = await db.insert(incidents).values({
      publicSlug: 'inc-y2', teamId: teamB, declaredBy: bob.id,
      severity: 'SEV2', title: 't', summary: '', status: 'resolved',
      resolvedAt: new Date(),
    }).returning();
    if (!inc2) throw new Error();
    await db.insert(postmortems).values({ incidentId: inc2.id, markdownBody: '# draft', status: 'draft' });

    expect(await countOpenRcasForUser(db, alice.id)).toBe(1);
    expect(await countOpenRcasForUser(db, admin.id)).toBe(2);
  });

  test('countOpenActionItemsForUser counts items assigned to the user with status open|in_progress', async () => {
    const db = getTestDb();
    const [inc] = await db.insert(incidents).values({
      publicSlug: 'inc-z1', teamId: teamA, declaredBy: alice.id,
      severity: 'SEV2', title: 't', summary: '', status: 'resolved', resolvedAt: new Date(),
    }).returning();
    if (!inc) throw new Error();
    const [pm] = await db.insert(postmortems).values({ incidentId: inc.id, markdownBody: 'x' }).returning();
    if (!pm) throw new Error();

    await db.insert(actionItems).values([
      { postmortemId: pm.id, assigneeUserId: alice.id, title: 'a', status: 'open' },
      { postmortemId: pm.id, assigneeUserId: alice.id, title: 'b', status: 'in_progress' },
      { postmortemId: pm.id, assigneeUserId: alice.id, title: 'c', status: 'done' },
      { postmortemId: pm.id, assigneeUserId: bob.id, title: 'd', status: 'open' },
    ]);
    expect(await countOpenActionItemsForUser(db, alice.id)).toBe(2);
    expect(await countOpenActionItemsForUser(db, bob.id)).toBe(1);
  });

  test('mttr7dForUser returns mean of resolved-declared in last 7 days, scoped to user teams', async () => {
    const db = getTestDb();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const declared = new Date(oneHourAgo.getTime() - 30 * 60 * 1000);

    await db.insert(incidents).values({
      publicSlug: 'inc-mttr1',
      teamId: teamA,
      declaredBy: alice.id,
      severity: 'SEV2',
      status: 'resolved',
      title: 't',
      summary: '',
      declaredAt: declared,
      resolvedAt: oneHourAgo,
    });

    const ms = await mttr7dForUser(db, alice.id);
    expect(ms).not.toBeNull();
    expect(Math.round(ms! / 60000)).toBe(30);
  });

  test('mttr7dForUser returns null when no incidents in window', async () => {
    expect(await mttr7dForUser(getTestDb(), alice.id)).toBeNull();
  });

  test('listActiveIncidentsForUser returns top N by declaredAt desc, scoped', async () => {
    const db = getTestDb();
    const now = Date.now();
    await db.insert(incidents).values([
      { publicSlug: 'inc-a1', teamId: teamA, declaredBy: alice.id, severity: 'SEV2', title: 'old', summary: '', status: 'investigating', declaredAt: new Date(now - 3 * 3600_000) },
      { publicSlug: 'inc-a2', teamId: teamA, declaredBy: alice.id, severity: 'SEV1', title: 'mid', summary: '', status: 'identified', declaredAt: new Date(now - 2 * 3600_000) },
      { publicSlug: 'inc-a3', teamId: teamA, declaredBy: alice.id, severity: 'SEV3', title: 'new', summary: '', status: 'monitoring', declaredAt: new Date(now - 1 * 3600_000) },
      { publicSlug: 'inc-a4', teamId: teamB, declaredBy: bob.id, severity: 'SEV1', title: 'other team', summary: '', status: 'investigating' },
    ]);
    const list = await listActiveIncidentsForUser(db, alice.id, 10);
    expect(list.map((i) => i.title)).toEqual(['new', 'mid', 'old']);
  });

  test("listMyOpenActionItems returns only the user's open|in_progress items", async () => {
    const db = getTestDb();
    const [inc] = await db.insert(incidents).values({
      publicSlug: 'inc-w1', teamId: teamA, declaredBy: alice.id,
      severity: 'SEV2', title: 't', summary: '', status: 'resolved', resolvedAt: new Date(),
    }).returning();
    const [pm] = await db.insert(postmortems).values({ incidentId: inc!.id, markdownBody: 'x' }).returning();
    await db.insert(actionItems).values([
      { postmortemId: pm!.id, assigneeUserId: alice.id, title: 'open-1', status: 'open' },
      { postmortemId: pm!.id, assigneeUserId: alice.id, title: 'done-1', status: 'done' },
      { postmortemId: pm!.id, assigneeUserId: bob.id, title: 'bob-only', status: 'open' },
    ]);
    const list = await listMyOpenActionItems(db, alice.id, 10);
    expect(list.map((i) => i.title)).toEqual(['open-1']);
  });

  test('listRecentPostmortemsForUser returns up to N postmortems newest first, scoped', async () => {
    const db = getTestDb();
    async function pmFor(slug: string, teamId: string, by: string, status: 'draft' | 'published', publishedAt: Date | null) {
      const [inc] = await db.insert(incidents).values({
        publicSlug: slug, teamId, declaredBy: by, severity: 'SEV2',
        title: slug, summary: '', status: 'resolved', resolvedAt: new Date(),
      }).returning();
      await db.insert(postmortems).values({
        incidentId: inc!.id,
        markdownBody: 'x',
        status,
        publishedAt,
      });
    }
    const now = Date.now();
    await pmFor('inc-pm1', teamA, alice.id, 'published', new Date(now - 3600_000));
    await pmFor('inc-pm2', teamA, alice.id, 'published', new Date(now - 7200_000));
    await pmFor('inc-pm3', teamB, bob.id, 'published', new Date(now - 1800_000));

    const list = await listRecentPostmortemsForUser(db, alice.id, 5);
    expect(list).toHaveLength(2);
    expect(list[0]?.postmortem.markdownBody).toBeTruthy();
  });
});
