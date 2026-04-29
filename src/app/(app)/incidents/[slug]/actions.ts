'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  findIncidentBySlugForUser,
  changeIncidentSeverity,
  changeIncidentStatus,
  assignIncidentRole,
} from '@/lib/db/queries/incidents';
import { appendNote } from '@/lib/db/queries/timeline';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';
import { ROLE_VALUES } from '@/lib/timeline/body';

async function resolveIncidentIdOrThrow(slug: string, userId: string): Promise<string> {
  const found = await findIncidentBySlugForUser(db, userId, slug);
  if (!found) throw new Error('Incident not found');
  return found.incident.id;
}

const noteSchema = z.object({
  slug: z.string().min(1),
  markdown: z.string().min(1).max(50_000),
});

export async function addNoteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = noteSchema.parse({
    slug: formData.get('slug'),
    markdown: formData.get('markdown'),
  });
  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await appendNote(db, session.user.id, incidentId, parsed.markdown);
  revalidatePath(`/incidents/${parsed.slug}`);
}

const statusSchema = z.object({
  slug: z.string().min(1),
  toStatus: z.enum(INCIDENT_STATUS_VALUES),
  reason: z.string().max(500).optional(),
  assignIcUserId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export async function changeStatusAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = statusSchema.parse({
    slug: formData.get('slug'),
    toStatus: formData.get('toStatus'),
    reason: formData.get('reason') ?? undefined,
    assignIcUserId: formData.get('assignIcUserId') ?? undefined,
  });

  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await changeIncidentStatus(db, session.user.id, incidentId, parsed.toStatus, {
    reason: parsed.reason,
    assignIcUserId: parsed.assignIcUserId,
  });
  revalidatePath(`/incidents/${parsed.slug}`);
}

const severitySchema = z.object({
  slug: z.string().min(1),
  toSeverity: z.enum(SEVERITY_VALUES),
});

export async function changeSeverityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = severitySchema.parse({
    slug: formData.get('slug'),
    toSeverity: formData.get('toSeverity'),
  });
  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await changeIncidentSeverity(db, session.user.id, incidentId, parsed.toSeverity);
  revalidatePath(`/incidents/${parsed.slug}`);
}

const roleSchema = z.object({
  slug: z.string().min(1),
  role: z.enum(ROLE_VALUES),
  toUserId: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal('').transform(() => null)),
});

export async function assignRoleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = roleSchema.parse({
    slug: formData.get('slug'),
    role: formData.get('role'),
    toUserId: formData.get('toUserId'),
  });
  const incidentId = await resolveIncidentIdOrThrow(parsed.slug, session.user.id);
  await assignIncidentRole(db, session.user.id, incidentId, parsed.role, parsed.toUserId);
  revalidatePath(`/incidents/${parsed.slug}`);
}
