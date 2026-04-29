import { z } from 'zod';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';

export const ROLE_VALUES = ['ic', 'scribe', 'comms'] as const;
export type IncidentRole = (typeof ROLE_VALUES)[number];

const NoteBody = z.object({
  kind: z.literal('note'),
  markdown: z.string().min(1).max(50_000),
});

const StatusChangeBody = z.object({
  kind: z.literal('status_change'),
  from: z.enum(INCIDENT_STATUS_VALUES),
  to: z.enum(INCIDENT_STATUS_VALUES),
  reason: z
    .string()
    .max(500)
    .transform((s) => s.trim())
    .optional(),
});

const SeverityChangeBody = z.object({
  kind: z.literal('severity_change'),
  from: z.enum(SEVERITY_VALUES),
  to: z.enum(SEVERITY_VALUES),
});

const RoleChangeBody = z.object({
  kind: z.literal('role_change'),
  role: z.enum(ROLE_VALUES),
  fromUserId: z.string().guid().nullable(),
  toUserId: z.string().guid().nullable(),
});

export const TimelineEventBodySchema = z.discriminatedUnion('kind', [
  NoteBody,
  StatusChangeBody,
  SeverityChangeBody,
  RoleChangeBody,
]);

export type TimelineEventBody = z.infer<typeof TimelineEventBodySchema>;

export function parseTimelineEventBody(input: unknown): TimelineEventBody {
  return TimelineEventBodySchema.parse(input);
}
