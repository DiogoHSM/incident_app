import { describe, expect, test, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { services } from '@/lib/db/schema/services';
import { incidents, incidentServices } from '@/lib/db/schema/incidents';
import { timelineEvents } from '@/lib/db/schema/timeline';
import {
  findOpenIncidentByFingerprint,
  ingestWebhookAlert,
} from '@/lib/db/queries/incidents-ingest';
import { createWebhookSource } from '@/lib/db/queries/webhook-sources';
import type { NormalizedAlert } from '@/lib/ingest/types';
import type { WebhookSource } from '@/lib/db/schema/webhook-sources';

describe('webhook ingest core', () => {
  useTestDb();
  let admin: { id: string };
  let teamId: string;
  let serviceA: { id: string; slug: string };
  let serviceB: { id: string; slug: string };
  let source: WebhookSource;

  beforeEach(async () => {
    const db = getTestDb();
    admin = await provisionUserOnSignIn(db, {
      email: 'admin@example.test',
      name: 'Admin',
      ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });
    const [t] = await db.insert(teams).values({ name: 'Platform', slug: 'platform' }).returning();
    if (!t) throw new Error('team');
    teamId = t.id;

    const [a] = await db
      .insert(services)
      .values({ teamId, name: 'API', slug: 'api' })
      .returning();
    const [b] = await db
      .insert(services)
      .values({ teamId, name: 'Checkout', slug: 'checkout' })
      .returning();
    if (!a || !b) throw new Error('services');
    serviceA = { id: a.id, slug: a.slug };
    serviceB = { id: b.id, slug: b.slug };

    const created = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'sentry',
      name: 'sentry-prod',
      defaultSeverity: 'SEV3',
      defaultServiceId: serviceA.id,
      autoPromoteThreshold: 3,
      autoPromoteWindowSeconds: 600,
    });
    source = created.source;
  });

  function alert(over: Partial<NormalizedAlert> = {}): NormalizedAlert {
    return {
      title: 'Login 500s',
      fingerprint: 'sentry-issue-1',
      severity: 'SEV2',
      serviceSlugs: ['api'],
      sourceUrl: 'https://sentry.io/issue/1',
      raw: {},
      ...over,
    };
  }

  test('no match → creates triaging incident with declared_by NULL', async () => {
    const db = getTestDb();
    const result = await ingestWebhookAlert(db, source, alert());
    expect(result.action).toBe('created');

    const [row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, result.incidentId))
      .limit(1);
    expect(row?.status).toBe('triaging');
    expect(row?.declaredBy).toBeNull();
    expect(row?.severity).toBe('SEV2');
    expect(row?.externalFingerprints).toEqual(['sentry-issue-1']);

    const links = await db
      .select()
      .from(incidentServices)
      .where(eq(incidentServices.incidentId, result.incidentId));
    expect(links.map((l) => l.serviceId)).toEqual([serviceA.id]);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, result.incidentId));
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('webhook');
    expect(events[0]?.authorUserId).toBeNull();
  });

  test('no match + null severity → uses source.default_severity', async () => {
    const db = getTestDb();
    const result = await ingestWebhookAlert(
      db,
      source,
      alert({ severity: null, fingerprint: 'fp-defaultsev' }),
    );
    const [row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, result.incidentId))
      .limit(1);
    expect(row?.severity).toBe('SEV3'); // source.defaultSeverity
  });

  test('no match + empty serviceSlugs → uses source.default_service_id', async () => {
    const db = getTestDb();
    const result = await ingestWebhookAlert(
      db,
      source,
      alert({ serviceSlugs: [], fingerprint: 'fp-defaultsvc' }),
    );
    const links = await db
      .select()
      .from(incidentServices)
      .where(eq(incidentServices.incidentId, result.incidentId));
    expect(links.map((l) => l.serviceId)).toEqual([serviceA.id]);
  });

  test('no match + empty serviceSlugs + no default_service_id → no service rows (incident still created)', async () => {
    const db = getTestDb();
    const noDefault = await createWebhookSource(getTestDb(), admin.id, {
      teamId,
      type: 'sentry',
      name: 'sentry-no-default',
      defaultSeverity: 'SEV4',
    });
    const result = await ingestWebhookAlert(
      db,
      noDefault.source,
      alert({ serviceSlugs: [], fingerprint: 'fp-no-svc' }),
    );
    const links = await db
      .select()
      .from(incidentServices)
      .where(eq(incidentServices.incidentId, result.incidentId));
    expect(links.length).toBe(0);
  });

  test('match → appends webhook event and idempotently extends external_fingerprints', async () => {
    const db = getTestDb();
    const first = await ingestWebhookAlert(db, source, alert());
    const second = await ingestWebhookAlert(db, source, alert());
    expect(second.action).toBe('matched');
    expect(second.incidentId).toBe(first.incidentId);

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, first.incidentId));
    expect(events.filter((e) => e.kind === 'webhook').length).toBe(2);

    const [row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, first.incidentId))
      .limit(1);
    expect(row?.externalFingerprints).toEqual(['sentry-issue-1']);
  });

  test('match → does NOT match incidents from other teams with the same fingerprint', async () => {
    const db = getTestDb();
    const [otherTeam] = await db
      .insert(teams)
      .values({ name: 'Search', slug: 'search' })
      .returning();
    if (!otherTeam) throw new Error('other team');
    const otherSource = await createWebhookSource(db, admin.id, {
      teamId: otherTeam.id,
      type: 'sentry',
      name: 'sentry-search',
      defaultSeverity: 'SEV3',
    });

    const a = await ingestWebhookAlert(db, source, alert());
    const b = await ingestWebhookAlert(db, otherSource.source, alert());
    expect(a.incidentId).not.toBe(b.incidentId);
  });

  test('match → does NOT match resolved incidents (status filter)', async () => {
    const db = getTestDb();
    const first = await ingestWebhookAlert(db, source, alert());
    await db
      .update(incidents)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(incidents.id, first.incidentId));
    const second = await ingestWebhookAlert(db, source, alert());
    expect(second.incidentId).not.toBe(first.incidentId);
    expect(second.action).toBe('created');
  });

  test('auto-promote bumps severity one tier when threshold reached in window', async () => {
    const db = getTestDb();
    const first = await ingestWebhookAlert(db, source, alert({ severity: 'SEV3' }));
    await ingestWebhookAlert(db, source, alert({ severity: null }));
    const third = await ingestWebhookAlert(db, source, alert({ severity: null }));
    expect(third.action).toBe('auto_bumped');

    const [row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, first.incidentId))
      .limit(1);
    expect(row?.severity).toBe('SEV2');

    const events = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, first.incidentId));
    const sevChange = events.find((e) => e.kind === 'severity_change');
    expect(sevChange).toBeDefined();
  });

  test('auto-promote never goes above SEV1', async () => {
    const db = getTestDb();
    const first = await ingestWebhookAlert(db, source, alert({ severity: 'SEV1' }));
    await ingestWebhookAlert(db, source, alert({ severity: null }));
    await ingestWebhookAlert(db, source, alert({ severity: null }));
    await ingestWebhookAlert(db, source, alert({ severity: null }));
    const [row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, first.incidentId))
      .limit(1);
    expect(row?.severity).toBe('SEV1');
    const events = await db
      .select()
      .from(timelineEvents)
      .where(
        and(eq(timelineEvents.incidentId, first.incidentId), eq(timelineEvents.kind, 'severity_change')),
      );
    expect(events.length).toBe(0);
  });

  test('findOpenIncidentByFingerprint returns null when no match', async () => {
    const db = getTestDb();
    const found = await findOpenIncidentByFingerprint(db, teamId, 'never-seen');
    expect(found).toBeNull();
  });
});
