// src/app/(app)/incidents/[slug]/postmortem/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findIncidentBySlugForUser } from '@/lib/db/queries/incidents';
import {
  createDraftForIncident,
  findPostmortemByIdForUser,
  publishPostmortem,
  setPostmortemPublicVisibility,
} from '@/lib/db/queries/postmortems';
import {
  createActionItem,
  deleteActionItem,
  updateActionItem,
} from '@/lib/db/queries/action-items';
import { ACTION_ITEM_STATUS_VALUES } from '@/lib/db/schema/action-items';

async function requireSessionUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return session.user.id;
}

export async function createDraftAction(slug: string): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findIncidentBySlugForUser(db, userId, slug);
  if (!found) throw new Error('Incident not found');
  await createDraftForIncident(db, userId, found.incident.id);
  revalidatePath(`/incidents/${slug}`);
  revalidatePath(`/incidents/${slug}/postmortem`);
  redirect(`/incidents/${slug}/postmortem`);
}

export async function publishAction(postmortemId: string, slug: string): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findPostmortemByIdForUser(db, userId, postmortemId);
  if (!found) throw new Error('Postmortem not found');
  await publishPostmortem(db, userId, postmortemId);
  revalidatePath(`/incidents/${slug}`);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

export async function setVisibilityAction(
  postmortemId: string,
  slug: string,
  publicOnStatusPage: boolean,
): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findPostmortemByIdForUser(db, userId, postmortemId);
  if (!found) throw new Error('Postmortem not found');
  await setPostmortemPublicVisibility(db, userId, postmortemId, publicOnStatusPage);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

const CreateActionItemSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  externalUrl: z.string().url().max(500).nullable().optional(),
});

export async function createActionItemAction(
  postmortemId: string,
  slug: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireSessionUserId();
  const found = await findPostmortemByIdForUser(db, userId, postmortemId);
  if (!found) throw new Error('Postmortem not found');

  const raw = {
    title: formData.get('title'),
    assigneeUserId: formData.get('assigneeUserId') || null,
    dueDate: formData.get('dueDate') || null,
    externalUrl: formData.get('externalUrl') || null,
  };
  const parsed = CreateActionItemSchema.parse(raw);
  await createActionItem(db, userId, postmortemId, parsed);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

const UpdateActionItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(ACTION_ITEM_STATUS_VALUES).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  externalUrl: z.string().url().max(500).nullable().optional(),
});

export async function updateActionItemAction(
  actionItemId: string,
  slug: string,
  patch: z.infer<typeof UpdateActionItemSchema>,
): Promise<void> {
  const userId = await requireSessionUserId();
  // We can't load the postmortem from action item id without an extra query,
  // so let updateActionItem enforce — it does its own requireTeamMember.
  const validated = UpdateActionItemSchema.parse(patch);
  await updateActionItem(db, userId, actionItemId, validated);
  revalidatePath(`/incidents/${slug}/postmortem`);
}

export async function deleteActionItemAction(
  actionItemId: string,
  slug: string,
): Promise<void> {
  const userId = await requireSessionUserId();
  await deleteActionItem(db, userId, actionItemId);
  revalidatePath(`/incidents/${slug}/postmortem`);
}
