'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  createWebhookSource,
  rotateWebhookSecret,
  deleteWebhookSource,
} from '@/lib/db/queries/webhook-sources';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';
import { WEBHOOK_SOURCE_TYPE_VALUES } from '@/lib/db/schema/webhook-sources';

const CreateInput = z.object({
  teamId: z.string().uuid(),
  type: z.enum(WEBHOOK_SOURCE_TYPE_VALUES),
  name: z.string().min(1).max(200),
  defaultSeverity: z.enum(SEVERITY_VALUES),
  defaultServiceId: z
    .string()
    .uuid()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .optional(),
  autoPromoteThreshold: z.coerce.number().int().min(1).max(100).optional(),
  autoPromoteWindowSeconds: z.coerce.number().int().min(60).max(86_400).optional(),
});

async function actorId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('not authenticated');
  return session.user.id;
}

export async function createSourceAction(formData: FormData): Promise<void> {
  const userId = await actorId();
  const parsed = CreateInput.parse(Object.fromEntries(formData.entries()));
  const { source, plaintextSecret } = await createWebhookSource(db, userId, parsed);
  revalidatePath('/settings/webhooks');
  const { cookies } = await import('next/headers');
  (await cookies()).set(
    'webhook_secret_reveal',
    JSON.stringify({ id: source.id, secret: plaintextSecret }),
    { httpOnly: true, sameSite: 'strict', maxAge: 60, path: '/settings/webhooks' },
  );
  redirect('/settings/webhooks');
}

export async function rotateSecretAction(formData: FormData): Promise<void> {
  const userId = await actorId();
  const sourceId = z.string().uuid().parse(formData.get('sourceId'));
  const { plaintextSecret } = await rotateWebhookSecret(db, userId, sourceId);
  const { cookies } = await import('next/headers');
  (await cookies()).set(
    'webhook_secret_reveal',
    JSON.stringify({ id: sourceId, secret: plaintextSecret }),
    { httpOnly: true, sameSite: 'strict', maxAge: 60, path: '/settings/webhooks' },
  );
  revalidatePath('/settings/webhooks');
  redirect('/settings/webhooks');
}

export async function deleteSourceAction(formData: FormData): Promise<void> {
  const userId = await actorId();
  const sourceId = z.string().uuid().parse(formData.get('sourceId'));
  await deleteWebhookSource(db, userId, sourceId);
  revalidatePath('/settings/webhooks');
  redirect('/settings/webhooks');
}
