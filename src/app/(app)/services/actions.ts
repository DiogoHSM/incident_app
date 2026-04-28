'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { createService } from '@/lib/db/queries/services';

const schema = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, dashes; cannot start with dash'),
  description: z.string().max(500).default(''),
});

export async function createServiceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = schema.parse({
    teamId: formData.get('teamId'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: formData.get('description') ?? '',
  });

  await createService(db, session.user.id, parsed);
  redirect(`/services/${parsed.slug}`);
}
