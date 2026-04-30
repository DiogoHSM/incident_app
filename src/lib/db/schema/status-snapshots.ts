import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const statusSnapshots = pgTable('status_snapshots', {
  // Scope is the PK. Format:
  //   'public'           — org-wide snapshot
  //   'team:<uuid>'      — per-team snapshot
  scope: text('scope').primaryKey(),
  payload: jsonb('payload').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StatusSnapshotRow = typeof statusSnapshots.$inferSelect;
export type NewStatusSnapshotRow = typeof statusSnapshots.$inferInsert;
