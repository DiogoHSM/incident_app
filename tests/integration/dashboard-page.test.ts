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

describe('dashboard page assembly', () => {
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

  test('all seven dashboard reads resolve on an empty DB without throwing', async () => {
    const db = getTestDb();
    const [active, rca, actions, mttr, activeList, actionList, pmList] = await Promise.all([
      countActiveIncidentsForUser(db, alice.id),
      countOpenRcasForUser(db, alice.id),
      countOpenActionItemsForUser(db, alice.id),
      mttr7dForUser(db, alice.id),
      listActiveIncidentsForUser(db, alice.id, 10),
      listMyOpenActionItems(db, alice.id, 10),
      listRecentPostmortemsForUser(db, alice.id, 5),
    ]);
    expect(active).toBe(0);
    expect(rca).toBe(0);
    expect(actions).toBe(0);
    expect(mttr).toBeNull();
    expect(activeList).toEqual([]);
    expect(actionList).toEqual([]);
    expect(pmList).toEqual([]);
  });

  test('all seven reads return populated payloads on a non-trivial DB', async () => {
    const db = getTestDb();
    const [inc] = await db.insert(incidents).values({
      publicSlug: 'inc-zz000001', teamId: teamA, declaredBy: alice.id,
      severity: 'SEV2', title: 'fire', summary: '', status: 'investigating',
    }).returning();
    if (!inc) throw new Error();

    const [resolvedInc] = await db.insert(incidents).values({
      publicSlug: 'inc-zz000002', teamId: teamA, declaredBy: alice.id,
      severity: 'SEV3', title: 'fixed', summary: '', status: 'resolved',
      declaredAt: new Date(Date.now() - 90 * 60_000),
      resolvedAt: new Date(Date.now() - 60 * 60_000),
    }).returning();
    if (!resolvedInc) throw new Error();
    const [pm] = await db.insert(postmortems).values({
      incidentId: resolvedInc.id, markdownBody: '# pm', status: 'draft',
    }).returning();
    if (!pm) throw new Error();
    await db.insert(actionItems).values({
      postmortemId: pm.id, assigneeUserId: alice.id, title: 'todo', status: 'open',
    });

    const [active, rca, actions, mttr, activeList, actionList, pmList] = await Promise.all([
      countActiveIncidentsForUser(db, alice.id),
      countOpenRcasForUser(db, alice.id),
      countOpenActionItemsForUser(db, alice.id),
      mttr7dForUser(db, alice.id),
      listActiveIncidentsForUser(db, alice.id, 10),
      listMyOpenActionItems(db, alice.id, 10),
      listRecentPostmortemsForUser(db, alice.id, 5),
    ]);
    expect(active).toBe(1);
    expect(rca).toBe(1);
    expect(actions).toBe(1);
    expect(mttr).not.toBeNull();
    expect(Math.round(mttr! / 60_000)).toBe(30);
    expect(activeList).toHaveLength(1);
    expect(actionList).toHaveLength(1);
    expect(pmList).toHaveLength(1);
  });
});
