import { eq, inArray } from 'drizzle-orm';
import { type DB } from '@/lib/db/client';
import { services, type Service, type NewService } from '@/lib/db/schema/services';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { requireTeamMember } from '@/lib/authz';

export async function listServicesForUser(db: DB, userId: string): Promise<Service[]> {
  const memberships = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));
  if (memberships.length === 0) return [];
  return db
    .select()
    .from(services)
    .where(
      inArray(
        services.teamId,
        memberships.map((m) => m.teamId),
      ),
    );
}

export async function findServiceBySlugForUser(
  db: DB,
  userId: string,
  slug: string,
): Promise<Service | null> {
  const list = await listServicesForUser(db, userId);
  return list.find((s) => s.slug === slug) ?? null;
}

export async function createService(
  db: DB,
  callerId: string,
  input: Pick<NewService, 'teamId' | 'name' | 'slug' | 'description'>,
): Promise<Service> {
  await requireTeamMember(db, callerId, input.teamId);
  const [row] = await db.insert(services).values(input).returning();
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export async function updateService(
  db: DB,
  callerId: string,
  serviceId: string,
  patch: Partial<Pick<NewService, 'name' | 'description'>>,
): Promise<Service> {
  const [existing] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  if (!existing) throw new Error('Service not found');
  await requireTeamMember(db, callerId, existing.teamId);
  const [row] = await db.update(services).set(patch).where(eq(services.id, serviceId)).returning();
  if (!row) throw new Error('Update returned no rows');
  return row;
}
