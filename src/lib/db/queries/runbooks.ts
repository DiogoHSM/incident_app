import { and, eq } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { runbooks, type Runbook, type NewRunbook } from '@/lib/db/schema/runbooks';
import { services } from '@/lib/db/schema/services';
import { requireTeamMember } from '@/lib/authz';

type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

async function getServiceTeamId(db: DB, serviceId: string): Promise<string> {
  const [row] = await db
    .select({ teamId: services.teamId })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!row) throw new Error('Service not found');
  return row.teamId;
}

export async function getRunbook(
  db: DB,
  userId: string,
  serviceId: string,
  severity: Severity,
): Promise<Runbook | null> {
  const teamId = await getServiceTeamId(db, serviceId);
  await requireTeamMember(db, userId, teamId);
  const [row] = await db
    .select()
    .from(runbooks)
    .where(and(eq(runbooks.serviceId, serviceId), eq(runbooks.severity, severity)))
    .limit(1);
  return row ?? null;
}

export async function upsertRunbook(
  db: DB,
  userId: string,
  input: Pick<NewRunbook, 'serviceId' | 'severity' | 'markdownBody'>,
): Promise<Runbook> {
  const teamId = await getServiceTeamId(db, input.serviceId);
  await requireTeamMember(db, userId, teamId);

  const [row] = await db
    .insert(runbooks)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [runbooks.serviceId, runbooks.severity],
      set: { markdownBody: input.markdownBody, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('Upsert returned no rows');
  return row;
}
