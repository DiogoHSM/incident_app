import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  primaryKey,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { teams } from './teams';
import { users } from './users';
import { services, severityEnum } from './services';

export const INCIDENT_STATUS_VALUES = [
  'triaging',
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUS_VALUES)[number];

export const incidentStatusEnum = pgEnum('incident_status', INCIDENT_STATUS_VALUES);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicSlug: text('public_slug').notNull(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    declaredBy: uuid('declared_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    severity: severityEnum('severity').notNull(),
    status: incidentStatusEnum('status').notNull().default('triaging'),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    icUserId: uuid('ic_user_id').references(() => users.id, { onDelete: 'set null' }),
    scribeUserId: uuid('scribe_user_id').references(() => users.id, { onDelete: 'set null' }),
    commsUserId: uuid('comms_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    publicSlugUniq: unique('incidents_public_slug_uniq').on(t.publicSlug),
    teamIdx: index('incidents_team_idx').on(t.teamId),
    statusIdx: index('incidents_status_idx').on(t.status),
    declaredAtIdx: index('incidents_declared_at_idx').on(t.declaredAt),
  }),
);

export const incidentServices = pgTable(
  'incident_services',
  {
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.incidentId, t.serviceId] }),
    serviceIdx: index('incident_services_service_idx').on(t.serviceId),
  }),
);

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type IncidentService = typeof incidentServices.$inferSelect;
