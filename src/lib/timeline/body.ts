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
    .pipe(z.string().min(1))
    .optional(),
  dismissed: z.boolean().optional(),
});

const SeverityChangeBody = z.object({
  kind: z.literal('severity_change'),
  from: z.enum(SEVERITY_VALUES),
  to: z.enum(SEVERITY_VALUES),
});

const RoleChangeBody = z.object({
  kind: z.literal('role_change'),
  role: z.enum(ROLE_VALUES),
  fromUserId: z.string().uuid().nullable(),
  toUserId: z.string().uuid().nullable(),
});

const PostmortemLinkBody = z.object({
  kind: z.literal('postmortem_link'),
  postmortemId: z.string().uuid(),
});

const WebhookBody = z.object({
  kind: z.literal('webhook'),
  sourceId: z.string().uuid(),
  sourceType: z.enum(['generic', 'sentry', 'datadog', 'grafana']),
  sourceName: z.string().min(1).max(200),
  fingerprint: z.string().min(1).max(500),
  sourceUrl: z.string().url().max(2_000).optional(),
  summary: z.string().max(1_000).optional(),
});

export const TimelineEventBodySchema = z.discriminatedUnion('kind', [
  NoteBody,
  StatusChangeBody,
  SeverityChangeBody,
  RoleChangeBody,
  PostmortemLinkBody,
  WebhookBody,
]);

export type TimelineEventBody = z.infer<typeof TimelineEventBodySchema>;

export function parseTimelineEventBody(input: unknown): TimelineEventBody {
  return TimelineEventBodySchema.parse(input);
}
