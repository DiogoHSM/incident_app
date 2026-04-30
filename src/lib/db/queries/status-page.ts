import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@/lib/db/client';
import { incidents } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import { users } from '@/lib/db/schema/users';

export interface PublicIncidentDetail {
  slug: string;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  status: 'triaging' | 'investigating' | 'identified' | 'monitoring' | 'resolved';
  declaredAt: Date;
  resolvedAt: Date | null;
  publicUpdates: Array<{
    id: string;
    message: string;
    postedAt: Date;
    author: string | null;
  }>;
}

/**
 * Public reader — no actor authz. Returns headline metadata and the
 * chronological list of `status_update_published` events ONLY.
 * Internal notes are never returned.
 */
export async function findPublicIncidentBySlug(
  db: DB,
  slug: string,
): Promise<PublicIncidentDetail | null> {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.publicSlug, slug))
    .limit(1);
  if (!incident) return null;

  const updateRows = await db
    .select({
      id: timelineEvents.id,
      body: timelineEvents.body,
      occurredAt: timelineEvents.occurredAt,
      authorName: users.name,
    })
    .from(timelineEvents)
    .leftJoin(users, eq(users.id, timelineEvents.authorUserId))
    .where(
      and(
        eq(timelineEvents.incidentId, incident.id),
        eq(timelineEvents.kind, 'status_update_published'),
      ),
    )
    .orderBy(asc(timelineEvents.occurredAt));

  return {
    slug: incident.publicSlug,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    declaredAt: incident.declaredAt,
    resolvedAt: incident.resolvedAt,
    publicUpdates: updateRows.map((r) => ({
      id: r.id,
      message: (r.body as { message: string }).message,
      postedAt: r.occurredAt,
      author: r.authorName ?? null,
    })),
  };
}
