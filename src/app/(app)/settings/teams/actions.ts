'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  createTeamAsAdmin,
  addMembershipAsAdmin,
  removeMembershipAsAdmin,
} from '@/lib/db/queries/teams-admin';
import { findUserByEmail } from '@/lib/db/queries/users';

const teamSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
});

export async function createTeamAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = teamSchema.parse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });
  await createTeamAsAdmin(db, session.user.id, parsed);
  revalidatePath('/settings/teams');
}

const addMemberSchema = z.object({
  teamId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['lead', 'member']),
});

export async function addMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = addMemberSchema.parse({
    teamId: formData.get('teamId'),
    email: formData.get('email'),
    role: formData.get('role'),
  });
  const target = await findUserByEmail(db, parsed.email);
  if (!target)
    throw new Error(`No user with email ${parsed.email} — they need to sign in once first.`);
  await addMembershipAsAdmin(db, session.user.id, {
    teamId: parsed.teamId,
    userId: target.id,
    role: parsed.role,
  });
  revalidatePath('/settings/teams');
}

const removeMemberSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = removeMemberSchema.parse({
    teamId: formData.get('teamId'),
    userId: formData.get('userId'),
  });
  await removeMembershipAsAdmin(db, session.user.id, parsed);
  revalidatePath('/settings/teams');
}
