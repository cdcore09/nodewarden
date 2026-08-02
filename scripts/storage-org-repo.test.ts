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
