import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import {
  createInvite,
  getInvite,
  getActiveInviteForOrgUser,
  revokeInvitesForOrgUser,
} from '../src/services/storage-admin-repo';
import type { Invite } from '../src/types';

const now = '2026-08-02T00:00:00.000Z';
const future = '2026-08-09T00:00:00.000Z';
const past = '2026-08-01T00:00:00.000Z';

async function seedUser(db: any, id: string, email: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, email, 'hash', 'key', 0, 600000, 'stamp-' + id, now, now)
    .run();
}

function invite(overrides: Partial<Invite> & { code: string }): Invite {
  return {
    createdBy: 'u1',
    usedBy: null,
    expiresAt: future,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    orgUserId: null,
    ...overrides,
  };
}

test('createInvite + getInvite round-trips org_user_id', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c1', orgUserId: 'ou1' }));

  const fetched = await getInvite(db, 'c1');
  assert.equal(fetched?.orgUserId, 'ou1');
});

test('createInvite + getInvite preserves null org_user_id for account-based invites', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c0', orgUserId: null }));

  const fetched = await getInvite(db, 'c0');
  assert.equal(fetched?.orgUserId, null);
});

test('getActiveInviteForOrgUser finds an active, unexpired invite', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c2', orgUserId: 'ou2' }));

  const found = await getActiveInviteForOrgUser(db, 'ou2');
  assert.equal(found?.code, 'c2');
});

test('getActiveInviteForOrgUser ignores expired invites', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c3', orgUserId: 'ou3', expiresAt: past }));

  const found = await getActiveInviteForOrgUser(db, 'ou3');
  assert.equal(found, null);
});

test('getActiveInviteForOrgUser ignores non-active status', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c4', orgUserId: 'ou4', status: 'used' }));

  const found = await getActiveInviteForOrgUser(db, 'ou4');
  assert.equal(found, null);
});

test('getActiveInviteForOrgUser returns null when no invite is linked to the org user', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c5', orgUserId: null }));

  const found = await getActiveInviteForOrgUser(db, 'ou-missing');
  assert.equal(found, null);
});

test('revokeInvitesForOrgUser flips active invites to revoked', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c6', orgUserId: 'ou6' }));

  await revokeInvitesForOrgUser(db, 'ou6');

  const fetched = await getInvite(db, 'c6');
  assert.equal(fetched?.status, 'revoked');

  const found = await getActiveInviteForOrgUser(db, 'ou6');
  assert.equal(found, null);
});

test('revokeInvitesForOrgUser leaves other org users\' invites untouched', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'owner@x.y');
  await createInvite(db, invite({ code: 'c7', orgUserId: 'ou7' }));
  await createInvite(db, invite({ code: 'c8', orgUserId: 'ou8' }));

  await revokeInvitesForOrgUser(db, 'ou7');

  const untouched = await getInvite(db, 'c8');
  assert.equal(untouched?.status, 'active');
});
