import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import {
  createCollection,
  getCollection,
  listCollections,
  updateCollectionName,
  deleteCollection,
  setGrant,
  deleteGrant,
  listGrantsForCollection,
  listCollectionsForMember,
  addCipherToCollections,
  getCipherCollectionIds,
  isCipherInGrantedCollection,
} from '../src/services/storage-collection-repo';
import type { Collection, CollectionGrant } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';

async function seedUser(db: any, id: string, email: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, email, 'hash', 'key', 0, 600000, 'stamp-' + id, now, now)
    .run();
}

async function seedOrg(db: any, id: string): Promise<void> {
  await db
    .prepare('INSERT INTO organizations(id, name, public_key, encrypted_private_key, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .bind(id, '2.encName|abc', 'pub', '2.priv', now, now)
    .run();
}

async function seedOrgUser(db: any, id: string, orgId: string, userId: string, email: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, orgId, userId, email, 'user', 'confirmed', '4.wrapped', now, now)
    .run();
}

async function seedCipher(db: any, id: string, userId: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO ciphers(id, user_id, type, folder_id, name, notes, favorite, data, reprompt, key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, userId, 1, null, 'name', null, 0, '{}', null, null, now, now)
    .run();
}

function collection(id: string, orgId: string, name = '2.encName|xyz'): Collection {
  return { id, orgId, name, createdAt: now, updatedAt: now };
}

test('create/get/list/rename/delete a collection', async () => {
  const db = createTestDb();
  await seedOrg(db, 'o1');
  await createCollection(db, collection('c1', 'o1'));
  await createCollection(db, collection('c2', 'o1'));

  const fetched = await getCollection(db, 'c1');
  assert.equal(fetched?.orgId, 'o1');
  assert.equal(fetched?.name, '2.encName|xyz');

  const list = await listCollections(db, 'o1');
  assert.deepEqual(list.map((c) => c.id), ['c1', 'c2']);

  await updateCollectionName(db, 'c1', '2.newName|def', '2026-08-02T00:00:00.000Z');
  const renamed = await getCollection(db, 'c1');
  assert.equal(renamed?.name, '2.newName|def');
  assert.equal(renamed?.updatedAt, '2026-08-02T00:00:00.000Z');

  await deleteCollection(db, 'c1');
  assert.equal(await getCollection(db, 'c1'), null);
  assert.deepEqual((await listCollections(db, 'o1')).map((c) => c.id), ['c2']);
});

test('getCollection returns null for missing id', async () => {
  const db = createTestDb();
  assert.equal(await getCollection(db, 'missing'), null);
});

test('set/list/delete grants', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedOrgUser(db, 'ou1', 'o1', 'u1', 'me@x.y');
  await createCollection(db, collection('c1', 'o1'));

  const grant: CollectionGrant = { collectionId: 'c1', orgUserId: 'ou1', readOnly: true, hidePasswords: false };
  await setGrant(db, grant);

  const grants = await listGrantsForCollection(db, 'c1');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].readOnly, true);
  assert.equal(grants[0].hidePasswords, false);

  // upsert: change flags on same PK
  await setGrant(db, { collectionId: 'c1', orgUserId: 'ou1', readOnly: false, hidePasswords: true });
  const updatedGrants = await listGrantsForCollection(db, 'c1');
  assert.equal(updatedGrants.length, 1);
  assert.equal(updatedGrants[0].readOnly, false);
  assert.equal(updatedGrants[0].hidePasswords, true);

  await deleteGrant(db, 'c1', 'ou1');
  assert.deepEqual(await listGrantsForCollection(db, 'c1'), []);
});

test('listCollectionsForMember returns only granted collections with correct flags', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedOrgUser(db, 'ou1', 'o1', 'u1', 'me@x.y');
  await createCollection(db, collection('c1', 'o1'));
  await createCollection(db, collection('c2', 'o1'));

  await setGrant(db, { collectionId: 'c1', orgUserId: 'ou1', readOnly: true, hidePasswords: false });

  const forMember = await listCollectionsForMember(db, 'ou1');
  assert.equal(forMember.length, 1);
  assert.equal(forMember[0].collection.id, 'c1');
  assert.equal(forMember[0].readOnly, true);
  assert.equal(forMember[0].hidePasswords, false);
});

test('addCipherToCollections + getCipherCollectionIds round-trip', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedCipher(db, 'ci1', 'u1');
  await createCollection(db, collection('c1', 'o1'));
  await createCollection(db, collection('c2', 'o1'));

  await addCipherToCollections(db, 'ci1', ['c1', 'c2']);
  const ids = (await getCipherCollectionIds(db, 'ci1')).sort();
  assert.deepEqual(ids, ['c1', 'c2']);

  // insert-or-ignore: re-adding does not throw or duplicate
  await addCipherToCollections(db, 'ci1', ['c1']);
  assert.deepEqual((await getCipherCollectionIds(db, 'ci1')).sort(), ['c1', 'c2']);
});

test('addCipherToCollections with empty array is a no-op', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedCipher(db, 'ci1', 'u1');
  await addCipherToCollections(db, 'ci1', []);
  assert.deepEqual(await getCipherCollectionIds(db, 'ci1'), []);
});

test('isCipherInGrantedCollection: least-restrictive across two grants', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedOrgUser(db, 'ou1', 'o1', 'u1', 'me@x.y');
  await seedCipher(db, 'ci1', 'u1');
  await createCollection(db, collection('c1', 'o1'));
  await createCollection(db, collection('c2', 'o1'));

  // one read-only grant, one writable grant, both applying to the same cipher
  await setGrant(db, { collectionId: 'c1', orgUserId: 'ou1', readOnly: true, hidePasswords: true });
  await setGrant(db, { collectionId: 'c2', orgUserId: 'ou1', readOnly: false, hidePasswords: false });
  await addCipherToCollections(db, 'ci1', ['c1', 'c2']);

  const access = await isCipherInGrantedCollection(db, 'ci1', 'ou1');
  assert.equal(access.granted, true);
  assert.equal(access.readOnly, false); // writable wins
  assert.equal(access.hidePasswords, false); // visible wins
});

test('isCipherInGrantedCollection: single read-only + hide-passwords grant', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedOrgUser(db, 'ou1', 'o1', 'u1', 'me@x.y');
  await seedCipher(db, 'ci1', 'u1');
  await createCollection(db, collection('c1', 'o1'));

  await setGrant(db, { collectionId: 'c1', orgUserId: 'ou1', readOnly: true, hidePasswords: true });
  await addCipherToCollections(db, 'ci1', ['c1']);

  const access = await isCipherInGrantedCollection(db, 'ci1', 'ou1');
  assert.equal(access.granted, true);
  assert.equal(access.readOnly, true);
  assert.equal(access.hidePasswords, true);
});

test('isCipherInGrantedCollection: false when no matching grant', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedOrgUser(db, 'ou1', 'o1', 'u1', 'me@x.y');
  await seedCipher(db, 'ci1', 'u1');
  await createCollection(db, collection('c1', 'o1'));

  // cipher is not in any collection ou1 is granted access to
  const access = await isCipherInGrantedCollection(db, 'ci1', 'ou1');
  assert.equal(access.granted, false);
  assert.equal(access.readOnly, false);
  assert.equal(access.hidePasswords, false);
});

test('deleteCollection cascades to grants and cipher_collections', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedOrg(db, 'o1');
  await seedOrgUser(db, 'ou1', 'o1', 'u1', 'me@x.y');
  await seedCipher(db, 'ci1', 'u1');
  await createCollection(db, collection('c1', 'o1'));

  await setGrant(db, { collectionId: 'c1', orgUserId: 'ou1', readOnly: true, hidePasswords: false });
  await addCipherToCollections(db, 'ci1', ['c1']);

  await deleteCollection(db, 'c1');

  assert.deepEqual(await listGrantsForCollection(db, 'c1'), []);
  assert.deepEqual(await getCipherCollectionIds(db, 'ci1'), []);
});

test('StorageService.createCollection and listCollections round-trip', async () => {
  const { StorageService } = await import('../src/services/storage');
  const db = createTestDb();
  await seedOrg(db, 'o1');

  const storage = new StorageService(db);
  await storage.createCollection(collection('c1', 'o1'));
  await storage.createCollection(collection('c2', 'o1'));

  const list = await storage.listCollections('o1');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((c) => c.id), ['c1', 'c2']);
});
