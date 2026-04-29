import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { services, severityEnum } from './services';

export const runbooks = pgTable(
  'runbooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    severity: severityEnum('severity').notNull(),
    markdownBody: text('markdown_body').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serviceSeverityUniq: unique('runbooks_service_severity_uniq').on(t.serviceId, t.severity),
  }),
);

export type Runbook = typeof runbooks.$inferSelect;
export type NewRunbook = typeof runbooks.$inferInsert;
