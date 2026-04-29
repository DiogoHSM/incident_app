import { z } from 'zod';
import { TIMELINE_EVENT_KIND_VALUES } from '@/lib/db/schema/timeline';
import type { TimelineEvent } from '@/lib/db/schema/timeline';

export const IncidentUpdatePayloadSchema = z.object({
  incidentId: z.string().uuid(),
  eventId: z.string().uuid(),
  kind: z.enum(TIMELINE_EVENT_KIND_VALUES),
  occurredAt: z.string().datetime(),
});

export type IncidentUpdatePayload = z.infer<typeof IncidentUpdatePayloadSchema>;

export interface TimelineEventOnWire extends TimelineEvent {
  authorName: string | null;
  fromUserName: string | null;
  toUserName: string | null;
}
