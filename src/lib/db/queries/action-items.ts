import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import {
  actionItems,
  type ActionItem,
  type ActionItemStatus,
} from '@/lib/db/schema/action-items';
import { postmortems } from '@/lib/db/schema/postmortems';
import { incidents, type Incident } from '@/lib/db/schema/incidents';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { findUserById } from '@/lib/db/queries/users';
import { requireTeamMember } from '@/lib/authz';

async function loadIncidentForPostmortem(db: DB, postmortemId: string): Promise<Incident> {
  const [pm] = await db
    .select()
    .from(postmortems)
    .where(eq(postmortems.id, postmortemId))
    .limit(1);
  if (!pm) throw new Error('Postmortem not found');
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, pm.incidentId))
    .limit(1);
  if (!incident) throw new Error('Incident not found');
  return incident;
}

async function loadIncidentForActionItem(db: DB, actionItemId: string): Promise<Incident> {
  const [item] = await db
    .select()
    .from(actionItems)
    .where(eq(actionItems.id, actionItemId))
    .limit(1);
  if (!item) throw new Error('Action item not found');
  return loadIncidentForPostmortem(db, item.postmortemId);
}

export async function listActionItemsForPostmortem(
  db: DB,
  userId: string,
  postmortemId: string,
): Promise<ActionItem[]> {
  const user = await findUserById(db, userId);
  if (!user) return [];
  let incident: Incident;
  try {
    incident = await loadIncidentForPostmortem(db, postmortemId);
  } catch {
    return [];
  }
  if (user.role !== 'admin') {
    const [m] = await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(
        and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, incident.teamId)),
      )
      .limit(1);
    if (!m) return [];
  }
  return db
    .select()
    .from(actionItems)
    .where(eq(actionItems.postmortemId, postmortemId))
    .orderBy(asc(actionItems.createdAt));
}

export interface CreateActionItemInput {
  title: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  externalUrl?: string | null;
}

export async function createActionItem(
  db: DB,
  callerId: string,
  postmortemId: string,
  input: CreateActionItemInput,
): Promise<ActionItem> {
  const incident = await loadIncidentForPostmortem(db, postmortemId);
  await requireTeamMember(db, callerId, incident.teamId);

  const [row] = await db
    .insert(actionItems)
    .values({
      postmortemId,
      title: input.title,
      assigneeUserId: input.assigneeUserId ?? null,
      dueDate: input.dueDate ?? null,
      externalUrl: input.externalUrl ?? null,
    })
    .returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export interface UpdateActionItemInput {
  title?: string;
  status?: ActionItemStatus;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  externalUrl?: string | null;
}

export async function updateActionItem(
  db: DB,
  callerId: string,
  actionItemId: string,
  input: UpdateActionItemInput,
): Promise<ActionItem> {
  const incident = await loadIncidentForActionItem(db, actionItemId);
  await requireTeamMember(db, callerId, incident.teamId);

  const patch: Partial<typeof actionItems.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.status !== undefined) patch.status = input.status;
  if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.externalUrl !== undefined) patch.externalUrl = input.externalUrl;

  const [row] = await db
    .update(actionItems)
    .set(patch)
    .where(eq(actionItems.id, actionItemId))
    .returning();
  if (!row) throw new Error('Update returned no rows');
  return row;
}

export async function deleteActionItem(
  db: DB,
  callerId: string,
  actionItemId: string,
): Promise<void> {
  const incident = await loadIncidentForActionItem(db, actionItemId);
  await requireTeamMember(db, callerId, incident.teamId);

  await db.delete(actionItems).where(eq(actionItems.id, actionItemId));
}
