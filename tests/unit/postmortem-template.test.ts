import { describe, expect, test } from 'vitest';
import {
  buildStarterTemplate,
  formatTimelineEventForMarkdown,
} from '@/lib/postmortems/template';
import type { TimelineEvent } from '@/lib/db/schema/timeline';
import type { Incident } from '@/lib/db/schema/incidents';

const incident: Incident = {
  id: '11111111-1111-4111-8111-111111111111',
  publicSlug: 'inc-abc12345',
  teamId: '22222222-2222-4222-8222-222222222222',
  declaredBy: '33333333-3333-4333-8333-333333333333',
  severity: 'SEV2',
  status: 'resolved',
  title: 'Login 500s',
  summary: 'Users could not log in',
  declaredAt: new Date('2026-04-29T10:30:00Z'),
  resolvedAt: new Date('2026-04-29T11:15:00Z'),
  icUserId: '44444444-4444-4444-8444-444444444444',
  scribeUserId: null,
  commsUserId: null,
  createdAt: new Date('2026-04-29T10:30:00Z'),
  updatedAt: new Date('2026-04-29T11:15:00Z'),
} as Incident;

const noteEvent: TimelineEvent = {
  id: '55555555-5555-4555-8555-555555555555',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'note',
  body: { kind: 'note', markdown: 'Saw 500s on /v1/login' },
  occurredAt: new Date('2026-04-29T10:32:11Z'),
} as TimelineEvent;

const statusEvent: TimelineEvent = {
  id: '66666666-6666-4666-8666-666666666666',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'status_change',
  body: { kind: 'status_change', from: 'triaging', to: 'investigating' },
  occurredAt: new Date('2026-04-29T10:35:42Z'),
} as TimelineEvent;

const severityEvent: TimelineEvent = {
  id: '77777777-7777-4777-8777-777777777777',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'severity_change',
  body: { kind: 'severity_change', from: 'SEV3', to: 'SEV1' },
  occurredAt: new Date('2026-04-29T10:42:11Z'),
} as TimelineEvent;

const roleEvent: TimelineEvent = {
  id: '88888888-8888-4888-8888-888888888888',
  incidentId: incident.id,
  authorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'role_change',
  body: {
    kind: 'role_change',
    role: 'ic',
    fromUserId: null,
    toUserId: '44444444-4444-4444-8444-444444444444',
  },
  occurredAt: new Date('2026-04-29T10:36:00Z'),
} as TimelineEvent;

const authorById = new Map([['44444444-4444-4444-8444-444444444444', 'Alice Anderson']]);

describe('formatTimelineEventForMarkdown', () => {
  test('note → bullet with author and first line', () => {
    expect(formatTimelineEventForMarkdown(noteEvent, authorById)).toBe(
      '- **2026-04-29T10:32:11.000Z** — Note (Alice Anderson): Saw 500s on /v1/login',
    );
  });

  test('status_change → arrow line', () => {
    expect(formatTimelineEventForMarkdown(statusEvent, authorById)).toBe(
      '- **2026-04-29T10:35:42.000Z** — Status: triaging → investigating',
    );
  });

  test('severity_change → arrow line', () => {
    expect(formatTimelineEventForMarkdown(severityEvent, authorById)).toBe(
      '- **2026-04-29T10:42:11.000Z** — Severity: SEV3 → SEV1',
    );
  });

  test('role_change → "IC: — → Alice"', () => {
    expect(formatTimelineEventForMarkdown(roleEvent, authorById)).toBe(
      '- **2026-04-29T10:36:00.000Z** — IC: — → Alice Anderson',
    );
  });

  test('unknown author renders as "(unknown)"', () => {
    const orphan = {
      ...noteEvent,
      authorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    } as TimelineEvent;
    expect(formatTimelineEventForMarkdown(orphan, authorById)).toBe(
      '- **2026-04-29T10:32:11.000Z** — Note (unknown): Saw 500s on /v1/login',
    );
  });

  test('multi-line note keeps only the first line', () => {
    const multi = {
      ...noteEvent,
      body: { kind: 'note', markdown: 'first line\nsecond\nthird' },
    } as TimelineEvent;
    expect(formatTimelineEventForMarkdown(multi, authorById)).toBe(
      '- **2026-04-29T10:32:11.000Z** — Note (Alice Anderson): first line',
    );
  });
});

describe('buildStarterTemplate', () => {
  test('emits the five canonical sections', () => {
    const md = buildStarterTemplate(incident, [noteEvent, statusEvent], authorById);
    expect(md).toContain('## Summary');
    expect(md).toContain('## Timeline');
    expect(md).toContain('## Root cause');
    expect(md).toContain('## What went well');
    expect(md).toContain("## What didn't");
  });

  test('embeds the timeline events as bullet rows', () => {
    const md = buildStarterTemplate(incident, [noteEvent, statusEvent], authorById);
    expect(md).toContain('- **2026-04-29T10:32:11.000Z** — Note (Alice Anderson): Saw 500s on /v1/login');
    expect(md).toContain('- **2026-04-29T10:35:42.000Z** — Status: triaging → investigating');
  });

  test('falls back to a placeholder when there are no events', () => {
    const md = buildStarterTemplate(incident, [], authorById);
    expect(md).toContain('## Timeline\n<!-- no events recorded -->');
  });
});
