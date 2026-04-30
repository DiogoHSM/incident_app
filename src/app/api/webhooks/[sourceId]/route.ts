import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { findWebhookSourceById } from '@/lib/db/queries/webhook-sources';
import { recordDeadLetter } from '@/lib/db/queries/dead-letters';
import { ingestWebhookAlert } from '@/lib/db/queries/incidents-ingest';
import { getAdapter } from '@/lib/ingest/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ sourceId: string }>;
}

function headerMap(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((v, k) => {
    obj[k] = v;
  });
  return obj;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { sourceId } = await ctx.params;
  const rawBody = await req.text();

  // 1. Lookup source.
  let source;
  try {
    source = await findWebhookSourceById(db, sourceId);
  } catch {
    try {
      await recordDeadLetter(db, {
        sourceId: null,
        headers: headerMap(req.headers),
        body: rawBody,
        error: 'db error during source lookup',
      });
    } catch {
      // Last-resort log. Sentry/Datadog will retry.
    }
    return new NextResponse('Service unavailable', { status: 503 });
  }
  if (!source) {
    return new NextResponse('Source not found', { status: 404 });
  }

  // 2. Verify signature/bearer.
  const adapter = getAdapter(source.type);
  const verifyResult = await adapter.verify({ headers: req.headers, rawBody, source });
  if (!verifyResult.ok) {
    // Per spec §7.5: invalid signature is 401, no body retained.
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 3. Parse + normalize.
  let normalized;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    normalized = adapter.normalize(parsed);
  } catch (e) {
    const error = e instanceof Error ? `adapter: ${e.message}` : 'adapter threw';
    try {
      await recordDeadLetter(db, {
        sourceId: source.id,
        headers: headerMap(req.headers),
        body: rawBody,
        error,
      });
    } catch {
      return new NextResponse('Service unavailable', { status: 503 });
    }
    return new NextResponse('Unprocessable entity', { status: 422 });
  }

  // 4. Ingest.
  try {
    const result = await ingestWebhookAlert(db, source, normalized);
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    const error = e instanceof Error ? `ingest: ${e.message}` : 'ingest threw';
    try {
      await recordDeadLetter(db, {
        sourceId: source.id,
        headers: headerMap(req.headers),
        body: rawBody,
        error,
      });
    } catch {
      // Fall through.
    }
    return new NextResponse('Service unavailable', { status: 503 });
  }
}
