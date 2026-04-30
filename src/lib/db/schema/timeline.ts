import { pgTable, pgEnum, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { incidents } from './incidents';
import { users } from './users';

export const TIMELINE_EVENT_KIND_VALUES = [
  'note',
  'status_change',
  'severity_change',
  'role_change',
  'postmortem_link',
  'webhook',
  'status_update_published',
] as const;
export type TimelineEventKind = (typeof TIMELINE_EVENT_KIND_VALUES)[number];

export const timelineEventKindEnum = pgEnum('timeline_event_kind', TIMELINE_EVENT_KIND_VALUES);

export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: timelineEventKindEnum('kind').notNull(),
    body: jsonb('body').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    incidentOccurredIdx: index('timeline_events_incident_occurred_idx').on(
      t.incidentId,
      t.occurredAt.desc(),
    ),
  }),
);

export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type NewTimelineEvent = typeof timelineEvents.$inferInsert;
