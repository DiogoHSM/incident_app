/**
 * Idempotent dev seed. Re-run any time.
 *
 *   pnpm db:seed
 *
 * Inserts a "Personal" team, two sample services, one SEV2 runbook, and the
 * first email from ADMIN_EMAILS as a team-lead admin so the offline /signin
 * flow lands you on a fully-populated app.
 */
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/lib/db/schema';
import { env } from '@/lib/env';

async function main() {
  const adminEmail = env.ADMIN_EMAILS[0] ?? 'dev-admin@local';
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });

  console.log(`Seeding incident_app — admin: ${adminEmail}`);

  const [team] = await db
    .insert(schema.teams)
    .values({ name: 'Personal', slug: 'personal' })
    .onConflictDoUpdate({ target: schema.teams.slug, set: { name: sql`excluded.name` } })
    .returning();
  if (!team) throw new Error('team upsert returned no rows');

  const [user] = await db
    .insert(schema.users)
    .values({
      email: adminEmail,
      name: adminEmail,
      ssoSubject: `dev:${adminEmail}`,
      role: 'admin',
    })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { name: sql`excluded.name`, ssoSubject: sql`excluded.sso_subject` },
    })
    .returning();
  if (!user) throw new Error('user upsert returned no rows');

  await db
    .insert(schema.teamMemberships)
    .values({ teamId: team.id, userId: user.id, role: 'lead' })
    .onConflictDoNothing();

  for (const svc of [
    { name: 'checkout-api', slug: 'checkout-api', description: 'Payments checkout HTTP API.' },
    { name: 'auth-service', slug: 'auth-service', description: 'Token issuance + session refresh.' },
  ]) {
    await db
      .insert(schema.services)
      .values({ teamId: team.id, ...svc })
      .onConflictDoNothing();
  }

  const checkout = await db.query.services.findFirst({
    where: (s, { and, eq }) => and(eq(s.teamId, team.id), eq(s.slug, 'checkout-api')),
  });
  if (checkout) {
    await db
      .insert(schema.runbooks)
      .values({
        serviceId: checkout.id,
        severity: 'SEV2',
        markdownBody:
          '## Checkout SEV2 runbook\n\n1. Page on-call payments engineer.\n2. Check Stripe webhook backlog.\n3. Fail open to retry queue if webhook lag > 60 s.',
      })
      .onConflictDoNothing();
  }

  console.log('Seed done.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
