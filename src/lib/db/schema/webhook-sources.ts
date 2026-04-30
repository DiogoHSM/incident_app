import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { teams } from './teams';
import { services, severityEnum } from './services';

export const WEBHOOK_SOURCE_TYPE_VALUES = ['generic', 'sentry', 'datadog', 'grafana'] as const;
export type WebhookSourceType = (typeof WEBHOOK_SOURCE_TYPE_VALUES)[number];

export const webhookSourceTypeEnum = pgEnum('webhook_source_type', WEBHOOK_SOURCE_TYPE_VALUES);

/**
 * `secret_material` is jsonb to fit two shapes:
 *
 *   { kind: 'aes', ciphertext: string, iv: string, authTag: string }   // Generic / Sentry / Datadog
 *   { kind: 'bcrypt', hash: string }                                    // Grafana (bearer-token compare)
 *
 * The plaintext is never stored. AES uses AES-256-GCM with the env-var key
 * `WEBHOOK_SECRET_ENCRYPTION_KEY`. Bcrypt uses cost 10 (matches NextAuth's default).
 */
export const webhookSources = pgTable(
  'webhook_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    type: webhookSourceTypeEnum('type').notNull(),
    name: text('name').notNull(),
    secretMaterial: jsonb('secret_material').notNull(),
    defaultSeverity: severityEnum('default_severity').notNull(),
    defaultServiceId: uuid('default_service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    autoPromoteThreshold: integer('auto_promote_threshold').notNull().default(3),
    autoPromoteWindowSeconds: integer('auto_promote_window_seconds').notNull().default(600),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamNameUniq: unique('webhook_sources_team_name_uniq').on(t.teamId, t.name),
    teamIdx: index('webhook_sources_team_idx').on(t.teamId),
  }),
);

export type WebhookSource = typeof webhookSources.$inferSelect;
export type NewWebhookSource = typeof webhookSources.$inferInsert;
