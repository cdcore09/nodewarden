import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import {
  createOrganizationWithOwner,
  getOrganization,
  getOrgUserByOrgAndUser,
  listMembershipsForUser,
  updateOrganizationName,
  deleteOrganization,
  countOwnedOrganizations,
} from '../src/services/storage-org-repo';
import type { Organization, OrganizationUser } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';

async function seedUser(db: any, id: string, email: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, email, 'hash', 'key', 0, 600000, 'stamp-' + id, now, now)
    .run();
}

function org(id: string): Organization {
  return { id, name: '2.encName|abc', publicKey: 'pub', encryptedPrivateKey: '2.priv', createdAt: now, updatedAt: now };
}

function owner(id: string, orgId: string, userId: string, email: string): OrganizationUser {
  return { id, orgId, userId, email, role: 'owner', status: 'confirmed', encryptedOrgKey: '4.wrapped', createdAt: now, updatedAt: now };
}

test('create + get organization with confirmed owner membership', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));

  const fetched = await getOrganization(db, 'o1');
  assert.equal(fetched?.name, '2.encName|abc');

  const member = await getOrgUserByOrgAndUser(db, 'o1', 'u1');
  assert.equal(member?.role, 'owner');
  assert.equal(member?.status, 'confirmed');
  assert.equal(member?.encryptedOrgKey, '4.wrapped');
});

test('listMembershipsForUser returns only that user\'s orgs', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedUser(db, 'u2', 'other@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await createOrganizationWithOwner(db, org('o2'), owner('ou2', 'o2', 'u2', 'other@x.y'));

  const mine = await listMembershipsForUser(db, 'u1');
  assert.deepEqual(mine.map((m) => m.organization.id), ['o1']);
});

test('rename updates name and updated_at only', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await updateOrganizationName(db, 'o1', '2.newName|def', '2026-08-02T00:00:00.000Z');
  const fetched = await getOrganization(db, 'o1');
  assert.equal(fetched?.name, '2.newName|def');
  assert.equal(fetched?.updatedAt, '2026-08-02T00:00:00.000Z');
});

test('deleteOrganization cascades to memberships', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await deleteOrganization(db, 'o1');
  assert.equal(await getOrganization(db, 'o1'), null);
  assert.equal(await getOrgUserByOrgAndUser(db, 'o1', 'u1'), null);
  assert.deepEqual(await listMembershipsForUser(db, 'u1'), []);
});

test('duplicate member email in same org is rejected by unique index', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await assert.rejects(() =>
    createOrganizationWithOwner(db, org('o1b'), owner('ou1b', 'o1', 'u1', 'me@x.y')).then(() => {
      throw new Error('should not reach');
    })
  );
  assert.equal(await getOrganization(db, 'o1b'), null);
});

test('countOwnedOrganizations reflects ownership across create/delete', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');

  assert.equal(await countOwnedOrganizations(db, 'u1'), 0);

  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  assert.equal(await countOwnedOrganizations(db, 'u1'), 1);

  await deleteOrganization(db, 'o1');
  assert.equal(await countOwnedOrganizations(db, 'u1'), 0);
});

import { StorageService } from '../src/services/storage';
import {
  createOrgUserInvite,
  getOrgUserById,
  getOrgUserByOrgAndEmail,
  listOrgUsers,
  acceptOrgUser,
  confirmOrgUser,
  deleteOrgUser,
  listConfirmedMemberUserIds,
} from '../src/services/storage-org-repo';

test('StorageService exposes org repo methods', async () => {
  const db = createTestDb();
  await seedUser(db, 'u9', 'svc@x.y');
  const storage = new StorageService(db as any);
  await storage.createOrganizationWithOwner(org('o9'), owner('ou9', 'o9', 'u9', 'svc@x.y'));
  const memberships = await storage.listMembershipsForUser('u9');
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].orgUser.role, 'owner');
});

test('invite -> accept -> confirm lifecycle transitions statuses strictly in order', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedUser(db, 'u2', 'parent@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));

  await createOrgUserInvite(db, {
    id: 'ou2', orgId: 'o1', userId: null, email: 'parent@x.y',
    role: 'user', status: 'invited', encryptedOrgKey: null, createdAt: now, updatedAt: now,
  });
  assert.equal((await getOrgUserByOrgAndEmail(db, 'o1', 'parent@x.y'))?.status, 'invited');

  // confirm before accept must be a no-op
  assert.equal(await confirmOrgUser(db, 'ou2', '4.wrapped2', now), false);

  assert.equal(await acceptOrgUser(db, 'ou2', 'u2', now), true);
  assert.equal((await getOrgUserById(db, 'ou2'))?.status, 'accepted');
  // double-accept is a no-op
  assert.equal(await acceptOrgUser(db, 'ou2', 'u2', now), false);

  assert.equal(await confirmOrgUser(db, 'ou2', '4.wrapped2', now), true);
  const confirmed = await getOrgUserById(db, 'ou2');
  assert.equal(confirmed?.status, 'confirmed');
  assert.equal(confirmed?.encryptedOrgKey, '4.wrapped2');

  assert.deepEqual((await listConfirmedMemberUserIds(db, 'o1')).sort(), ['u1', 'u2']);
  assert.equal((await listOrgUsers(db, 'o1')).length, 2);

  await deleteOrgUser(db, 'ou2');
  assert.equal(await getOrgUserById(db, 'ou2'), null);
  assert.deepEqual(await listConfirmedMemberUserIds(db, 'o1'), ['u1']);
});

test('updateRevisionDates bumps every listed user to one shared timestamp', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'a1@x.y');
  await seedUser(db, 'u2', 'a2@x.y');
  const storage = new StorageService(db as any);
  const stamp = await storage.updateRevisionDates(['u1', 'u2']);
  const r1 = await db.prepare('SELECT revision_date FROM user_revisions WHERE user_id = ?').bind('u1').first<any>();
  const r2 = await db.prepare('SELECT revision_date FROM user_revisions WHERE user_id = ?').bind('u2').first<any>();
  assert.equal(r1.revision_date, stamp);
  assert.equal(r2.revision_date, stamp);
  // empty list: returns a timestamp, no throw
  assert.ok(await storage.updateRevisionDates([]));
});
