import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import { buildBackupArchive } from '../src/services/backup-archive';
import { importBackupArchiveBytes } from '../src/services/backup-import';
import type { Env } from '../src/types';

test('org tables round-trip through backup export/import', async () => {
  const source = createTestDb();
  const now = '2026-08-01T00:00:00.000Z';
  await source
    .prepare('INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('u1', 'a@b.c', 'h', 'k', 0, 600000, 's', now, now)
    .run();
  await source
    .prepare('INSERT INTO organizations(id, name, public_key, encrypted_private_key, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .bind('o1', '2.n', 'pub', '2.priv', now, now)
    .run();
  await source
    .prepare('INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('ou1', 'o1', 'u1', 'a@b.c', 'owner', 'confirmed', '4.w', now, now)
    .run();
  await source
    .prepare('INSERT INTO collections(id, org_id, name, created_at, updated_at) VALUES(?,?,?,?,?)')
    .bind('c1', 'o1', '2.collName', now, now)
    .run();
  await source
    .prepare('INSERT INTO collection_users(collection_id, org_user_id, read_only, hide_passwords) VALUES(?,?,?,?)')
    .bind('c1', 'ou1', 0, 0)
    .run();
  await source
    .prepare('INSERT INTO ciphers(id, user_id, organization_id, type, name, data, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind('cph1', 'u1', 'o1', 1, '2.cipherName', '{}', now, now)
    .run();
  await source
    .prepare('INSERT INTO ciphers(id, user_id, type, name, data, created_at, updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind('cph2', 'u1', 1, '2.cipherName2', '{}', now, now)
    .run();
  await source
    .prepare('INSERT INTO cipher_collections(cipher_id, collection_id) VALUES(?,?)')
    .bind('cph1', 'c1')
    .run();

  const sourceEnv = { DB: source } as unknown as Env;
  const bundle = await buildBackupArchive(sourceEnv, new Date(now), { includeAttachments: false });

  assert.equal(bundle.manifest.tableCounts.organizations, 1);
  assert.equal(bundle.manifest.tableCounts.organization_users, 1);
  assert.equal(bundle.manifest.tableCounts.collections, 1);
  assert.equal(bundle.manifest.tableCounts.collection_users, 1);
  assert.equal(bundle.manifest.tableCounts.cipher_collections, 1);

  const target = createTestDb();
  const targetEnv = { DB: target } as unknown as Env;
  const importResult = await importBackupArchiveBytes(bundle.bytes, targetEnv, 'u1', false, undefined, bundle.fileName);

  assert.equal(importResult.result.imported.organizations, 1);
  assert.equal(importResult.result.imported.organizationUsers, 1);
  assert.equal(importResult.result.imported.collections, 1);
  assert.equal(importResult.result.imported.collectionUsers, 1);
  assert.equal(importResult.result.imported.cipherCollections, 1);

  const restoredOrgs = await target.prepare('SELECT id FROM organizations').all<any>();
  assert.equal((restoredOrgs.results || []).length, 1, 'org row must survive backup round-trip');

  const restoredOrgUsers = await target.prepare('SELECT id, org_id, user_id, email, role, status, encrypted_org_key FROM organization_users').all<any>();
  assert.deepEqual((restoredOrgUsers.results || []).map((row: any) => ({ ...row })), [
    { id: 'ou1', org_id: 'o1', user_id: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encrypted_org_key: '4.w' },
  ]);

  const restoredCollections = await target.prepare('SELECT id FROM collections').all<any>();
  assert.equal((restoredCollections.results || []).length, 1);

  const restoredCollectionUsers = await target.prepare('SELECT collection_id, org_user_id FROM collection_users').all<any>();
  assert.deepEqual((restoredCollectionUsers.results || []).map((row: any) => ({ ...row })), [{ collection_id: 'c1', org_user_id: 'ou1' }]);

  const restoredCipherCollections = await target.prepare('SELECT cipher_id, collection_id FROM cipher_collections').all<any>();
  assert.deepEqual((restoredCipherCollections.results || []).map((row: any) => ({ ...row })), [{ cipher_id: 'cph1', collection_id: 'c1' }]);

  const restoredCiphers = await target.prepare('SELECT id, organization_id FROM ciphers ORDER BY id ASC').all<any>();
  assert.deepEqual((restoredCiphers.results || []).map((row: any) => ({ ...row })), [
    { id: 'cph1', organization_id: 'o1' },
    { id: 'cph2', organization_id: null },
  ]);
});

test('import without replaceExisting is rejected when target already has organization data', async () => {
  const now = '2026-08-01T00:00:00.000Z';

  // Empty source: a minimal, valid backup archive with no rows at all.
  const source = createTestDb();
  const sourceEnv = { DB: source } as unknown as Env;
  const bundle = await buildBackupArchive(sourceEnv, new Date(now), { includeAttachments: false });

  // Target has zero ciphers/folders/attachments/sends (the pre-existing
  // freshness check would call this "fresh"), but it already has an
  // organization + org_user row. The freshness gate must still trip.
  const target = createTestDb();
  await target
    .prepare('INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('u1', 'a@b.c', 'h', 'k', 0, 600000, 's', now, now)
    .run();
  await target
    .prepare('INSERT INTO organizations(id, name, public_key, encrypted_private_key, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .bind('o1', '2.n', 'pub', '2.priv', now, now)
    .run();
  await target
    .prepare('INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('ou1', 'o1', 'u1', 'a@b.c', 'owner', 'confirmed', '4.w', now, now)
    .run();

  const targetEnv = { DB: target } as unknown as Env;
  await assert.rejects(
    () => importBackupArchiveBytes(bundle.bytes, targetEnv, 'u1', false, undefined, bundle.fileName),
    (error: unknown) => error instanceof Error && error.message === 'Backup import requires a fresh instance with no vault or send data'
  );

  // The pre-existing org data must survive the rejected import untouched.
  const survivingOrgs = await target.prepare('SELECT id FROM organizations').all<any>();
  assert.equal((survivingOrgs.results || []).length, 1);
});
