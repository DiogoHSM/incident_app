import { pgTable, pgEnum, uuid, timestamp, text, date, index } from 'drizzle-orm/pg-core';
import { postmortems } from './postmortems';
import { users } from './users';

export const ACTION_ITEM_STATUS_VALUES = ['open', 'in_progress', 'done', 'wontfix'] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUS_VALUES)[number];

export const actionItemStatusEnum = pgEnum('action_item_status', ACTION_ITEM_STATUS_VALUES);

export const actionItems = pgTable(
  'action_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postmortemId: uuid('postmortem_id')
      .notNull()
      .references(() => postmortems.id, { onDelete: 'cascade' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: actionItemStatusEnum('status').notNull().default('open'),
    dueDate: date('due_date'),
    externalUrl: text('external_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postmortemIdx: index('action_items_postmortem_idx').on(t.postmortemId, t.createdAt),
  }),
);

export type ActionItem = typeof actionItems.$inferSelect;
export type NewActionItem = typeof actionItems.$inferInsert;
