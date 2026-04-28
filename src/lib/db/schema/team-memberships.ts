import { pgTable, pgEnum, uuid, primaryKey, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { teams } from './teams';

export const teamRoleEnum = pgEnum('team_role', ['lead', 'member']);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.userId] }),
  }),
);

export type TeamMembership = typeof teamMemberships.$inferSelect;
export type NewTeamMembership = typeof teamMemberships.$inferInsert;
