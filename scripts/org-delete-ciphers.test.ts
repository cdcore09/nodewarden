import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import { StorageService } from '../src/services/storage';
import type { Cipher, Organization, OrganizationUser, Collection, Attachment } from '../src/types';

// Covers Task 8: ciphers.organization_id has NO foreign key to organizations
// (by design — see storage-cipher-repo.ts), so deleting an org must
// explicitly purge its ciphers or they're orphaned (organization_id pointing
// at a gone org, invisible/inaccessible but still occupying storage).
// attachments.cipher_id and cipher_collections.cipher_id DO have
// `ON DELETE CASCADE` FKs to ciphers(id) (migrations/0001_init.sql,
// migrations/0002_organizations.sql), so deleting the cipher rows must
// cascade-remove their attachment + cipher_collections rows too.

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

function collection(id: string, orgId: string): Collection {
  return { id, orgId, name: '2.encName|xyz', createdAt: now, updatedAt: now };
}

function makeOrgCipher(id: string, userId: string, orgId: string): Cipher {
  return {
    id,
    userId,
    organizationId: orgId,
    type: 1,
    folderId: null,
    name: 'name',
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
  } as Cipher;
}

function makeAttachment(id: string, cipherId: string): Attachment {
  return { id, cipherId, fileName: '2.encName', size: 10, sizeName: '10 Bytes', key: '2.encKey' };
}

test('deleteOrgCiphers removes org ciphers plus their attachment and cipher_collections rows (cascade)', async () => {
  const db = createTestDb();
  const storage = new StorageService(db);

  await seedUser(db, 'u1', 'owner@x.y');
  await storage.createOrganizationWithOwner(org('o1'), owner('ou1', 'o1', 'u1', 'owner@x.y'));
  await storage.createCollection(collection('col1', 'o1'));

  await storage.saveCipher(makeOrgCipher('c1', 'u1', 'o1'));
  await storage.addCipherToCollections('c1', ['col1']);
  await storage.saveAttachment(makeAttachment('a1', 'c1'));

  // Sanity: everything exists before cleanup.
  assert.ok(await storage.getCipher('c1'), 'precondition: cipher exists');
  const attBefore = await db.prepare('SELECT id FROM attachments WHERE id = ?').bind('a1').first<any>();
  assert.ok(attBefore, 'precondition: attachment exists');
  const ccBefore = await db.prepare('SELECT * FROM cipher_collections WHERE cipher_id = ?').bind('c1').all<any>();
  assert.equal((ccBefore.results || []).length, 1, 'precondition: cipher_collections row exists');

  await storage.deleteOrgCiphers('o1');

  assert.equal(await storage.getCipher('c1'), null, 'org cipher should be deleted');
  const attAfter = await db.prepare('SELECT id FROM attachments WHERE id = ?').bind('a1').first<any>();
  assert.equal(attAfter, null, 'attachment should cascade-delete with its cipher');
  const ccAfter = await db.prepare('SELECT * FROM cipher_collections WHERE cipher_id = ?').bind('c1').all<any>();
  assert.equal((ccAfter.results || []).length, 0, 'cipher_collections row should cascade-delete with its cipher');
});

test('deleteOrgCiphers only removes ciphers belonging to the given org', async () => {
  const db = createTestDb();
  const storage = new StorageService(db);

  await seedUser(db, 'u1', 'owner@x.y');
  await storage.createOrganizationWithOwner(org('o1'), owner('ou1', 'o1', 'u1', 'owner@x.y'));
  await storage.createOrganizationWithOwner(org('o2'), owner('ou2', 'o2', 'u1', 'owner2@x.y'));

  await storage.saveCipher(makeOrgCipher('c1', 'u1', 'o1'));
  await storage.saveCipher(makeOrgCipher('c2', 'u1', 'o2'));

  await storage.deleteOrgCiphers('o1');

  assert.equal(await storage.getCipher('c1'), null, 'o1 cipher deleted');
  assert.ok(await storage.getCipher('c2'), 'o2 cipher untouched');
});
