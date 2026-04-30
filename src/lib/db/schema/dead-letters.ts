import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { webhookSources } from './webhook-sources';

export const deadLetterWebhooks = pgTable(
  'dead_letter_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => webhookSources.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    headers: jsonb('headers').notNull(),
    body: text('body').notNull(),
    error: text('error').notNull(),
  },
  (t) => ({
    receivedAtIdx: index('dead_letter_webhooks_received_at_idx').on(t.receivedAt.desc()),
  }),
);

export type DeadLetterWebhook = typeof deadLetterWebhooks.$inferSelect;
export type NewDeadLetterWebhook = typeof deadLetterWebhooks.$inferInsert;
