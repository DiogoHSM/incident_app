import { describe, expect, test, beforeEach } from 'vitest';
import { useTestDb, getTestDb } from '../setup/withTx';
import { provisionUserOnSignIn } from '@/lib/auth/provision';
import { teams } from '@/lib/db/schema/teams';
import { teamMemberships } from '@/lib/db/schema/team-memberships';
import {
  listWebhookSourcesForTeam,
  findWebhookSourceById,
  createWebhookSource,
  rotateWebhookSecret,
  deleteWebhookSource,
} from '@/lib/db/queries/webhook-sources';
import { ForbiddenError } from '@/lib/authz';
import { decryptSecret, compareBearer } from '@/lib/ingest/secret-material';

describe('webhook-sources queries', () => {
  useTestDb();
  let alice: { id: string };
  let bob: { id: string };
  let admin: { id: string };
  let teamId: string;
  let otherTeamId: string;

  beforeEach(async () => {
    const db = getTestDb();
    alice = await provisionUserOnSignIn(db, {
      email: 'alice@example.test',
      name: 'Alice',
      ssoSubject: 'sso-alice',
      adminEmails: [],
    });
    bob = await provisionUserOnSignIn(db, {
      email: 'bob@example.test',
      name: 'Bob',
      ssoSubject: 'sso-bob',
      adminEmails: [],
    });
    admin = await provisionUserOnSignIn(db, {
      email: 'admin@example.test',
      name: 'Admin',
      ssoSubject: 'sso-admin',
      adminEmails: ['admin@example.test'],
    });

    const [t1] = await db.insert(teams).values({ name: 'Platform', slug: 'platform' }).returning();
    if (!t1) throw new Error('team');
    teamId = t1.id;
    const [t2] = await db.insert(teams).values({ name: 'Search', slug: 'search' }).returning();
    if (!t2) throw new Error('other team');
    otherTeamId = t2.id;

    await db.insert(teamMemberships).values({ teamId, userId: alice.id, role: 'lead' });
  });

  test('createWebhookSource (admin) returns plaintext secret + AES-encrypted material for HMAC types', async () => {
    const db = getTestDb();
    const { source, plaintextSecret } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'generic-prod',
      defaultSeverity: 'SEV3',
    });
    expect(source.type).toBe('generic');
    expect(source.name).toBe('generic-prod');
    expect(plaintextSecret.length).toBeGreaterThanOrEqual(32);
    const material = source.secretMaterial as { kind: string };
    expect(material.kind).toBe('aes');
    expect(decryptSecret(material as never)).toBe(plaintextSecret);
  });

  test('createWebhookSource (admin) returns bcrypt material for grafana', async () => {
    const db = getTestDb();
    const { source, plaintextSecret } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'grafana',
      name: 'grafana-prod',
      defaultSeverity: 'SEV3',
    });
    const material = source.secretMaterial as { kind: string };
    expect(material.kind).toBe('bcrypt');
    expect(await compareBearer(plaintextSecret, material as never)).toBe(true);
  });

  test('createWebhookSource rejects non-admin (alice is team lead)', async () => {
    const db = getTestDb();
    await expect(
      createWebhookSource(db, alice.id, {
        teamId,
        type: 'generic',
        name: 'leak',
        defaultSeverity: 'SEV3',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('createWebhookSource rejects non-admin even on their own team', async () => {
    const db = getTestDb();
    await expect(
      createWebhookSource(db, bob.id, {
        teamId,
        type: 'generic',
        name: 'leak',
        defaultSeverity: 'SEV3',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('createWebhookSource rejects duplicate (team_id, name)', async () => {
    const db = getTestDb();
    await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'dup',
      defaultSeverity: 'SEV3',
    });
    await expect(
      createWebhookSource(db, admin.id, {
        teamId,
        type: 'sentry',
        name: 'dup',
        defaultSeverity: 'SEV3',
      }),
    ).rejects.toThrow();
  });

  test('createWebhookSource allows same name on different teams', async () => {
    const db = getTestDb();
    await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'shared-name',
      defaultSeverity: 'SEV3',
    });
    const second = await createWebhookSource(db, admin.id, {
      teamId: otherTeamId,
      type: 'generic',
      name: 'shared-name',
      defaultSeverity: 'SEV3',
    });
    expect(second.source.teamId).toBe(otherTeamId);
  });

  test('listWebhookSourcesForTeam (admin) returns rows for the requested team', async () => {
    const db = getTestDb();
    await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'a',
      defaultSeverity: 'SEV3',
    });
    await createWebhookSource(db, admin.id, {
      teamId: otherTeamId,
      type: 'generic',
      name: 'b',
      defaultSeverity: 'SEV3',
    });
    const rows = await listWebhookSourcesForTeam(db, admin.id, teamId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe('a');
  });

  test('listWebhookSourcesForTeam rejects non-admin', async () => {
    const db = getTestDb();
    await expect(listWebhookSourcesForTeam(db, alice.id, teamId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test('findWebhookSourceById (no actor) returns the row by id', async () => {
    const db = getTestDb();
    const { source } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'a',
      defaultSeverity: 'SEV3',
    });
    const found = await findWebhookSourceById(db, source.id);
    expect(found?.id).toBe(source.id);
  });

  test('findWebhookSourceById returns null for unknown id', async () => {
    const db = getTestDb();
    const found = await findWebhookSourceById(db, '00000000-0000-4000-8000-000000000000');
    expect(found).toBeNull();
  });

  test('rotateWebhookSecret returns a new plaintext + invalidates the old hash', async () => {
    const db = getTestDb();
    const { source, plaintextSecret: original } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'rot',
      defaultSeverity: 'SEV3',
    });
    const { source: rotated, plaintextSecret: fresh } = await rotateWebhookSecret(
      db,
      admin.id,
      source.id,
    );
    expect(fresh).not.toBe(original);
    const material = rotated.secretMaterial as { kind: string };
    expect(material.kind).toBe('aes');
    expect(decryptSecret(material as never)).toBe(fresh);
    expect(decryptSecret(material as never)).not.toBe(original);
  });

  test('rotateWebhookSecret rejects non-admin', async () => {
    const db = getTestDb();
    const { source } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'rot',
      defaultSeverity: 'SEV3',
    });
    await expect(rotateWebhookSecret(db, alice.id, source.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test('deleteWebhookSource removes the row', async () => {
    const db = getTestDb();
    const { source } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'rm',
      defaultSeverity: 'SEV3',
    });
    await deleteWebhookSource(db, admin.id, source.id);
    expect(await findWebhookSourceById(db, source.id)).toBeNull();
  });

  test('deleteWebhookSource rejects non-admin', async () => {
    const db = getTestDb();
    const { source } = await createWebhookSource(db, admin.id, {
      teamId,
      type: 'generic',
      name: 'rm',
      defaultSeverity: 'SEV3',
    });
    await expect(deleteWebhookSource(db, alice.id, source.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
