import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  findPostmortemByIdForUser,
  updatePostmortemMarkdown,
} from '@/lib/db/queries/postmortems';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  markdownBody: z.string().max(200_000),
});

const IdSchema = z.string().uuid();

export async function POST(request: Request, ctx: RouteCtx): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return new Response('Bad id', { status: 400 });

  // Authorization: load via the user-scoped finder. Returns null both for
  // non-existent and unauthorized — the 404 leaks no information either way.
  const found = await findPostmortemByIdForUser(db, session.user.id, id);
  if (!found) return new Response('Not found', { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 422 });
  }

  const updated = await updatePostmortemMarkdown(
    db,
    session.user.id,
    id,
    parsed.data.markdownBody,
  );

  return Response.json({ updatedAt: updated.updatedAt.toISOString() });
}
