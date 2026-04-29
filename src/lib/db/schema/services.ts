import { pgTable, pgEnum, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { teams } from './teams';

export const severityEnum = pgEnum('severity', ['SEV1', 'SEV2', 'SEV3', 'SEV4']);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamSlugUniq: unique('services_team_slug_uniq').on(t.teamId, t.slug),
  }),
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
