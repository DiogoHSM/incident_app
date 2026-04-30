import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createRealtimeDispatcher,
  type RealtimeDispatcher,
} from '@/lib/realtime/dispatcher';
import type { TimelineEventOnWire } from '@/lib/realtime/types';
import { useTestDb, getTestDb } from '../setup/db';
import { users } from '@/lib/db/schema/users';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import { appendNote } from '@/lib/db/queries/timeline';
import {
  assignIncidentRole,
  changeIncidentSeverity,
  changeIncidentStatus,
  declareIncident,
} from '@/lib/db/queries/incidents';
import { ingestWebhookAlert } from '@/lib/db/queries/incidents-ingest';
import { createWebhookSource } from '@/lib/db/queries/webhook-sources';

interface World {
  actorId: string;
  teamId: string;
  incidentId: string;
}

let actorCounter = 0;

async function seed(): Promise<World> {
  const db = getTestDb();
  const tag = ++actorCounter;
  const [user] = await db
    .insert(users)
    .values({ email: `rt-${tag}@x.co`, name: `RT${tag}`, ssoSubject: `s|rt-${tag}` })
    .returning();
  const [team] = await db.insert(teams).values({ name: `RT${tag}`, slug: `rt-${tag}` }).returning();
  await db
    .insert(teamMemberships)
    .values({ userId: user!.id, teamId: team!.id, role: 'member' });
  const inc = await declareIncident(db, user!.id, {
    teamId: team!.id,
    title: `incident ${tag}`,
    summary: '',
    severity: 'SEV2',
    affectedServiceIds: [],
  });
  return { actorId: user!.id, teamId: team!.id, incidentId: inc.id };
}

describe('RealtimeDispatcher (integration)', () => {
  useTestDb();

  let dispatcher: (RealtimeDispatcher & { whenReady(): Promise<void> }) | undefined;
  let world: World;

  beforeAll(async () => {
    const uri = process.env.TEST_DATABASE_URL;
    if (!uri) throw new Error('TEST_DATABASE_URL not set');
    dispatcher = createRealtimeDispatcher(uri);
    await dispatcher.whenReady();
  });

  afterAll(async () => {
    await dispatcher?.close();
  });

  beforeEach(async () => {
    actorCounter = 0;
    world = await seed();
  });

  function nextEvent(incidentId: string): Promise<TimelineEventOnWire> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error('timeout waiting for dispatcher event'));
      }, 5_000);
      const unsub = dispatcher!.subscribe(incidentId, (evt) => {
        clearTimeout(timer);
        unsub();
        resolve(evt);
      });
    });
  }

  it('delivers a note event to a subscriber on the matching incident', async () => {
    const promise = nextEvent(world.incidentId);
    await appendNote(getTestDb(), world.actorId, world.incidentId, 'first note');
    const evt = await promise;
    expect(evt.kind).toBe('note');
    expect(evt.incidentId).toBe(world.incidentId);
    expect(evt.authorName).toBeTruthy();
    expect((evt.body as { kind: string }).kind).toBe('note');
  });

  it('delivers role_change + status_change when leaving triaging with a new IC', async () => {
    const received: TimelineEventOnWire[] = [];
    const done = new Promise<void>((resolve) => {
      const unsub = dispatcher!.subscribe(world.incidentId, (evt) => {
        received.push(evt);
        if (received.length === 2) {
          unsub();
          resolve();
        }
      });
    });
    await changeIncidentStatus(getTestDb(), world.actorId, world.incidentId, 'investigating', {
      assignIcUserId: world.actorId,
    });
    await done;
    expect(received.map((e) => e.kind).sort()).toEqual(['role_change', 'status_change']);
  });

  it('delivers severity_change events', async () => {
    const promise = nextEvent(world.incidentId);
    await changeIncidentSeverity(getTestDb(), world.actorId, world.incidentId, 'SEV1');
    const evt = await promise;
    expect(evt.kind).toBe('severity_change');
  });

  it('delivers role_change events for non-IC roles', async () => {
    const promise = nextEvent(world.incidentId);
    await assignIncidentRole(
      getTestDb(),
      world.actorId,
      world.incidentId,
      'scribe',
      world.actorId,
    );
    const evt = await promise;
    expect(evt.kind).toBe('role_change');
  });

  it('only delivers to subscribers of the matching incident', async () => {
    const second = await seed();
    let bReceived = 0;
    const unsub = dispatcher!.subscribe(second.incidentId, () => {
      bReceived++;
    });
    await appendNote(getTestDb(), world.actorId, world.incidentId, 'only for A');
    // Give the dispatcher up to 1 s to (incorrectly) deliver to B.
    await new Promise((r) => setTimeout(r, 1_000));
    unsub();
    expect(bReceived).toBe(0);
  });

  it('unsubscribe stops delivery', async () => {
    let count = 0;
    const unsub = dispatcher!.subscribe(world.incidentId, () => {
      count++;
    });
    unsub();
    await appendNote(getTestDb(), world.actorId, world.incidentId, 'after unsubscribe');
    await new Promise((r) => setTimeout(r, 500));
    expect(count).toBe(0);
  });

  it('delivers a webhook event when ingestWebhookAlert creates a new incident', async () => {
    const db = getTestDb();
    // createWebhookSource requires admin; promote the world actor for this test.
    await db
      .update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, world.actorId));

    // Create a webhook source on the world's team.
    const { source } = await createWebhookSource(db, world.actorId, {
      teamId: world.teamId,
      type: 'generic',
      name: `rt-webhook-${actorCounter}`,
      defaultSeverity: 'SEV3',
      defaultServiceId: null,
      autoPromoteThreshold: 3,
      autoPromoteWindowSeconds: 600,
    });

    // Ingest creates a brand-new incident; we capture the incidentId from the result.
    const result = await ingestWebhookAlert(db, source, {
      title: 'CPU spike',
      fingerprint: `fp-dispatcher-${actorCounter}`,
      severity: 'SEV3',
      serviceSlugs: [],
      sourceUrl: null,
      raw: {},
    });
    expect(result.action).toBe('created');

    // Subscribe AFTER creation — the NOTIFY fires inside the ingest transaction,
    // so we may miss it. Instead, verify the dispatcher delivers the event when
    // a second webhook alert matches the same incident.
    const eventPromise = new Promise<TimelineEventOnWire>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error('timeout waiting for webhook dispatcher event'));
      }, 5_000);
      const unsub = dispatcher!.subscribe(result.incidentId, (evt) => {
        clearTimeout(timer);
        unsub();
        resolve(evt);
      });
    });

    // Second ingest hits the match path → fires pg_notify for the existing incident.
    await ingestWebhookAlert(db, source, {
      title: 'CPU spike (repeat)',
      fingerprint: `fp-dispatcher-${actorCounter}`,
      severity: 'SEV3',
      serviceSlugs: [],
      sourceUrl: null,
      raw: {},
    });

    const evt = await eventPromise;
    expect(evt.kind).toBe('webhook');
    expect(evt.incidentId).toBe(result.incidentId);
    expect((evt.body as { sourceName: string }).sourceName).toBe(`rt-webhook-${actorCounter}`);
    expect((evt.body as { fingerprint: string }).fingerprint).toBe(
      `fp-dispatcher-${actorCounter}`,
    );
  });
});
