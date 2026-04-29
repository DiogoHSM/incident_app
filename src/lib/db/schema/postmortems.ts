import { pgTable, pgEnum, uuid, timestamp, text, boolean } from 'drizzle-orm/pg-core';
import { incidents } from './incidents';

export const POSTMORTEM_STATUS_VALUES = ['draft', 'published'] as const;
export type PostmortemStatus = (typeof POSTMORTEM_STATUS_VALUES)[number];

export const postmortemStatusEnum = pgEnum('postmortem_status', POSTMORTEM_STATUS_VALUES);

export const postmortems = pgTable('postmortems', {
  id: uuid('id').primaryKey().defaultRandom(),
  incidentId: uuid('incident_id')
    .notNull()
    .unique()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  markdownBody: text('markdown_body').notNull(),
  status: postmortemStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publicOnStatusPage: boolean('public_on_status_page').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Postmortem = typeof postmortems.$inferSelect;
export type NewPostmortem = typeof postmortems.$inferInsert;
