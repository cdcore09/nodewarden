import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import { StorageService } from '../src/services/storage';
import type { Cipher, Organization, OrganizationUser, Collection, CollectionGrant } from '../src/types';

const now = '2026-08-02T00:00:00.000Z';

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

function orgUser(
  id: string,
  orgId: string,
  userId: string | null,
  email: string,
  role: 'owner' | 'user',
  status: 'invited' | 'accepted' | 'confirmed'
): OrganizationUser {
  return {
    id,
    orgId,
    userId,
    email,
    role,
    status,
    encryptedOrgKey: status === 'confirmed' ? '4.wrapped' : null,
    createdAt: now,
    updatedAt: now,
  };
}

function collection(id: string, orgId: string, name = '2.encColl|abc'): Collection {
  return { id, orgId, name, createdAt: now, updatedAt: now };
}

function makeCipher(id: string, userId: string, organizationId: string | null): Cipher {
  return {
    id,
    userId,
    organizationId,
    type: 1,
    folderId: null,
    name: 'name-' + id,
    notes: null,
    favorite: false,
    login: null,
    card: null,
    identity: null,
    secureNote: null,
    sshKey: null,
    fields: null,
    passwordHistory: null,
    reprompt: 0,
    key: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  };
}

test('getAllCiphers excludes org ciphers and includes only the user\'s personal ciphers', async () => {
  const db = createTestDb();
  await seedUser(db, 'owner1', 'owner@x.y');
  const storage = new StorageService(db as any);

  await storage.createOrganizationWithOwner(org('o1'), orgUser('ou-owner', 'o1', 'owner1', 'owner@x.y', 'owner', 'confirmed'));

  await storage.saveCipher(makeCipher('personal-1', 'owner1', null));
  await storage.saveCipher(makeCipher('org-cipher-1', 'owner1', 'o1'));

  const ciphers = await storage.getAllCiphers('owner1');
  assert.deepEqual(ciphers.map((c) => c.id).sort(), ['personal-1']);
});

test('getAccessibleOrgCiphers: owner sees every cipher in their org; member sees only granted-collection ciphers', async () => {
  const db = createTestDb();
  await seedUser(db, 'owner1', 'owner@x.y');
  await seedUser(db, 'member1', 'member@x.y');
  const storage = new StorageService(db as any);

  await storage.createOrganizationWithOwner(org('o1'), orgUser('ou-owner', 'o1', 'owner1', 'owner@x.y', 'owner', 'confirmed'));

  await storage.createOrgUserInvite(orgUser('ou-member', 'o1', null, 'member@x.y', 'user', 'invited'));
  await storage.acceptOrgUser('ou-member', 'o1', 'member1', now);
  await storage.confirmOrgUser('ou-member', 'o1', '4.wrapped-member', now);

  await storage.createCollection(collection('collA', 'o1'));
  await storage.createCollection(collection('collB', 'o1'));

  // Member is granted access to collection A only.
  await storage.setGrant({ collectionId: 'collA', orgUserId: 'ou-member', readOnly: false, hidePasswords: false });

  await storage.saveCipher(makeCipher('cipher-in-a', 'owner1', 'o1'));
  await storage.addCipherToCollections('cipher-in-a', ['collA']);

  await storage.saveCipher(makeCipher('cipher-in-b', 'owner1', 'o1'));
  await storage.addCipherToCollections('cipher-in-b', ['collB']);

  // Owner sees both org ciphers.
  const ownerCiphers = await storage.getAccessibleOrgCiphers('owner1');
  assert.deepEqual(ownerCiphers.map((c) => c.id).sort(), ['cipher-in-a', 'cipher-in-b']);

  // Every returned org cipher must carry collectionIds (cipherToResponse depends on this).
  const cipherInA = ownerCiphers.find((c) => c.id === 'cipher-in-a');
  assert.deepEqual((cipherInA as any).collectionIds, ['collA']);
  const cipherInB = ownerCiphers.find((c) => c.id === 'cipher-in-b');
  assert.deepEqual((cipherInB as any).collectionIds, ['collB']);

  // Member sees only the cipher in the collection they were granted.
  const memberCiphers = await storage.getAccessibleOrgCiphers('member1');
  assert.deepEqual(memberCiphers.map((c) => c.id).sort(), ['cipher-in-a']);
  assert.deepEqual((memberCiphers[0] as any).collectionIds, ['collA']);
});

test('getAccessibleOrgCiphers: an invited (not confirmed) member sees nothing', async () => {
  const db = createTestDb();
  await seedUser(db, 'owner1', 'owner@x.y');
  await seedUser(db, 'pending1', 'pending@x.y');
  const storage = new StorageService(db as any);

  await storage.createOrganizationWithOwner(org('o1'), orgUser('ou-owner', 'o1', 'owner1', 'owner@x.y', 'owner', 'confirmed'));
  await storage.createCollection(collection('collA', 'o1'));

  await storage.saveCipher(makeCipher('cipher-in-a', 'owner1', 'o1'));
  await storage.addCipherToCollections('cipher-in-a', ['collA']);

  // Invited: never accepted. Even if (hypothetically) a grant existed for
  // this org_user_id, only a confirmed membership should surface ciphers.
  await storage.createOrgUserInvite(orgUser('ou-pending', 'o1', null, 'pending@x.y', 'user', 'invited'));
  await storage.setGrant({ collectionId: 'collA', orgUserId: 'ou-pending', readOnly: false, hidePasswords: false });

  const pendingCiphers = await storage.getAccessibleOrgCiphers('pending1');
  assert.deepEqual(pendingCiphers, []);
});

test('getAccessibleOrgCiphers: member with no grants sees nothing', async () => {
  const db = createTestDb();
  await seedUser(db, 'owner1', 'owner@x.y');
  await seedUser(db, 'member1', 'member@x.y');
  const storage = new StorageService(db as any);

  await storage.createOrganizationWithOwner(org('o1'), orgUser('ou-owner', 'o1', 'owner1', 'owner@x.y', 'owner', 'confirmed'));
  await storage.createOrgUserInvite(orgUser('ou-member', 'o1', null, 'member@x.y', 'user', 'invited'));
  await storage.acceptOrgUser('ou-member', 'o1', 'member1', now);
  await storage.confirmOrgUser('ou-member', 'o1', '4.wrapped-member', now);

  await storage.createCollection(collection('collA', 'o1'));
  await storage.saveCipher(makeCipher('cipher-in-a', 'owner1', 'o1'));
  await storage.addCipherToCollections('cipher-in-a', ['collA']);

  const memberCiphers = await storage.getAccessibleOrgCiphers('member1');
  assert.deepEqual(memberCiphers, []);
});

test('getAccessibleOrgCiphers dedupes a cipher reachable via multiple granted collections', async () => {
  const db = createTestDb();
  await seedUser(db, 'owner1', 'owner@x.y');
  await seedUser(db, 'member1', 'member@x.y');
  const storage = new StorageService(db as any);

  await storage.createOrganizationWithOwner(org('o1'), orgUser('ou-owner', 'o1', 'owner1', 'owner@x.y', 'owner', 'confirmed'));
  await storage.createOrgUserInvite(orgUser('ou-member', 'o1', null, 'member@x.y', 'user', 'invited'));
  await storage.acceptOrgUser('ou-member', 'o1', 'member1', now);
  await storage.confirmOrgUser('ou-member', 'o1', '4.wrapped-member', now);

  await storage.createCollection(collection('collA', 'o1'));
  await storage.createCollection(collection('collB', 'o1'));
  await storage.setGrant({ collectionId: 'collA', orgUserId: 'ou-member', readOnly: false, hidePasswords: false });
  await storage.setGrant({ collectionId: 'collB', orgUserId: 'ou-member', readOnly: false, hidePasswords: false });

  await storage.saveCipher(makeCipher('cipher-in-both', 'owner1', 'o1'));
  await storage.addCipherToCollections('cipher-in-both', ['collA', 'collB']);

  const memberCiphers = await storage.getAccessibleOrgCiphers('member1');
  assert.equal(memberCiphers.length, 1);
  assert.deepEqual((memberCiphers[0] as any).collectionIds.sort(), ['collA', 'collB']);
});

test('getAccessibleOrgCiphers: a stale cipher_collections row from a former org does not leak the cipher across tenants', async () => {
  const db = createTestDb();
  await seedUser(db, 'ownerA', 'ownerA@x.y');
  await seedUser(db, 'ownerB', 'ownerB@x.y');
  await seedUser(db, 'memberA', 'memberA@x.y');
  const storage = new StorageService(db as any);

  // Two separate orgs, A and B.
  await storage.createOrganizationWithOwner(org('orgA'), orgUser('ou-ownerA', 'orgA', 'ownerA', 'ownerA@x.y', 'owner', 'confirmed'));
  await storage.createOrganizationWithOwner(org('orgB'), orgUser('ou-ownerB', 'orgB', 'ownerB', 'ownerB@x.y', 'owner', 'confirmed'));

  // memberA is a confirmed, granted member of Org A's collection.
  await storage.createOrgUserInvite(orgUser('ou-memberA', 'orgA', null, 'memberA@x.y', 'user', 'invited'));
  await storage.acceptOrgUser('ou-memberA', 'orgA', 'memberA', now);
  await storage.confirmOrgUser('ou-memberA', 'orgA', '4.wrapped-memberA', now);
  await storage.createCollection(collection('collA', 'orgA'));
  await storage.setGrant({ collectionId: 'collA', orgUserId: 'ou-memberA', readOnly: false, hidePasswords: false });

  // A cipher that ACTUALLY belongs to Org B (organization_id = orgB) --
  // simulating the state left behind by a reshare from Org A to Org B, where
  // the cipher's organization_id moved but the OLD cipher_collections row
  // pointing at Org A's collection was never cleaned up.
  await storage.saveCipher(makeCipher('reshared-cipher', 'ownerA', 'orgB'));
  await storage.addCipherToCollections('reshared-cipher', ['collA']);

  // memberA (Org A, granted on collA) must NOT see a cipher that now belongs
  // to Org B, even though the stale cipher_collections row still links it to
  // their granted collection.
  const memberACiphers = await storage.getAccessibleOrgCiphers('memberA');
  assert.deepEqual(memberACiphers.map((c) => c.id), []);
});
