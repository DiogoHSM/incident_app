'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { declareIncident } from '@/lib/db/queries/incidents';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';

const schema = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000).default(''),
  severity: z.enum(SEVERITY_VALUES),
  affectedServiceIds: z.array(z.string().uuid()).default([]),
});

export async function declareIncidentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const parsed = schema.parse({
    teamId: formData.get('teamId'),
    title: formData.get('title'),
    summary: formData.get('summary') ?? '',
    severity: formData.get('severity'),
    affectedServiceIds: formData.getAll('affectedServiceIds'),
  });

  const incident = await declareIncident(db, session.user.id, parsed);
  redirect(`/incidents/${incident.publicSlug}`);
}
