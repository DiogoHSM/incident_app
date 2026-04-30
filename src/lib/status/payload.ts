import { z } from 'zod';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';

export const SERVICE_STATUS_VALUES = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
] as const;
export type ServiceStatus = (typeof SERVICE_STATUS_VALUES)[number];

const SnapshotServiceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  teamId: z.string().uuid(),
  status: z.enum(SERVICE_STATUS_VALUES),
  uptime30d: z.number().min(0).max(1),
});

const SnapshotPublicUpdateSchema = z.object({
  body: z.string().min(1).max(5_000),
  postedAt: z.coerce.date(),
  author: z.string().nullable().optional(),
});

const SnapshotActiveIncidentSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(SEVERITY_VALUES),
  status: z.enum(INCIDENT_STATUS_VALUES),
  declaredAt: z.coerce.date(),
  latestPublicUpdate: SnapshotPublicUpdateSchema.optional(),
});

const SnapshotDayCellSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  worstSeverity: z.enum(SEVERITY_VALUES).nullable(),
});

export const StatusSnapshotPayloadSchema = z.object({
  services: z.array(SnapshotServiceSchema),
  activeIncidents: z.array(SnapshotActiveIncidentSchema),
  severityByDay: z.array(SnapshotDayCellSchema),
});

export type StatusSnapshotPayload = z.infer<typeof StatusSnapshotPayloadSchema>;
export type SnapshotService = z.infer<typeof SnapshotServiceSchema>;
export type SnapshotActiveIncident = z.infer<typeof SnapshotActiveIncidentSchema>;
export type SnapshotDayCell = z.infer<typeof SnapshotDayCellSchema>;
