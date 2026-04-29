'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findServiceBySlugForUser } from '@/lib/db/queries/services';
import { upsertRunbook } from '@/lib/db/queries/runbooks';

const schema = z.object({
  slug: z.string(),
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
  markdownBody: z.string().max(50_000),
});

export async function saveRunbookAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const parsed = schema.parse({
    slug: formData.get('slug'),
    severity: formData.get('severity'),
    markdownBody: formData.get('markdownBody') ?? '',
  });

  const service = await findServiceBySlugForUser(db, session.user.id, parsed.slug);
  if (!service) throw new Error('Service not found');

  await upsertRunbook(db, session.user.id, {
    serviceId: service.id,
    severity: parsed.severity,
    markdownBody: parsed.markdownBody,
  });

  revalidatePath(`/services/${parsed.slug}/runbooks/${parsed.severity}`);
}
