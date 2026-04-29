import type { Incident } from '@/lib/db/schema/incidents';
import type { TimelineEvent } from '@/lib/db/schema/timeline';

type AuthorMap = ReadonlyMap<string, string>;

function authorName(event: TimelineEvent, authorById: AuthorMap): string {
  if (!event.authorUserId) return 'system';
  return authorById.get(event.authorUserId) ?? 'unknown';
}

const ROLE_LABEL = { ic: 'IC', scribe: 'Scribe', comms: 'Comms' } as const;

export function formatTimelineEventForMarkdown(
  event: TimelineEvent,
  authorById: AuthorMap,
): string {
  const ts = event.occurredAt.toISOString();
  const prefix = `- **${ts}** — `;

  if (event.kind === 'note') {
    const body = event.body as { markdown: string };
    const firstLine = body.markdown.split('\n', 1)[0] ?? '';
    return `${prefix}Note (${authorName(event, authorById)}): ${firstLine}`;
  }
  if (event.kind === 'status_change') {
    const body = event.body as { from: string; to: string };
    return `${prefix}Status: ${body.from} → ${body.to}`;
  }
  if (event.kind === 'severity_change') {
    const body = event.body as { from: string; to: string };
    return `${prefix}Severity: ${body.from} → ${body.to}`;
  }
  if (event.kind === 'role_change') {
    const body = event.body as {
      role: 'ic' | 'scribe' | 'comms';
      fromUserId: string | null;
      toUserId: string | null;
    };
    const from = body.fromUserId ? (authorById.get(body.fromUserId) ?? 'unknown') : '—';
    const to = body.toUserId ? (authorById.get(body.toUserId) ?? 'unknown') : '—';
    return `${prefix}${ROLE_LABEL[body.role]}: ${from} → ${to}`;
  }
  if (event.kind === 'postmortem_link') {
    return `${prefix}Postmortem published`;
  }
  return `${prefix}(unknown event)`;
}

export function buildStarterTemplate(
  incident: Incident,
  events: readonly TimelineEvent[],
  authorById: AuthorMap,
): string {
  const timelineRows =
    events.length === 0
      ? '<!-- no events recorded -->'
      : events.map((e) => formatTimelineEventForMarkdown(e, authorById)).join('\n');

  return [
    `# Postmortem — ${incident.title}`,
    '',
    '## Summary',
    '<!-- One paragraph: what happened, who saw it, what was the impact. -->',
    '',
    '## Timeline',
    timelineRows,
    '',
    '## Root cause',
    '<!-- The chain of events that produced the failure. -->',
    '',
    '## What went well',
    '',
    "## What didn't",
    '',
  ].join('\n');
}
