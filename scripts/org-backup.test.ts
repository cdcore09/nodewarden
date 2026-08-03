import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { createTestDb } from './test-db';
import { buildBackupArchive } from '../src/services/backup-archive';
import { importBackupArchiveBytes } from '../src/services/backup-import';
import type { Env } from '../src/types';

function craftedArchiveBytes(db: Record<string, unknown[]>): Uint8Array {
  const encoder = new TextEncoder();
  return zipSync({
    'manifest.json': encoder.encode(JSON.stringify({
      formatVersion: 1,
      exportedAt: '2026-08-01T00:00:00.000Z',
      appVersion: 'test',
      storageKind: null,
      tableCounts: {},
      includes: { attachments: false },
      blobSummary: { attachmentFiles: 0, totalBytes: 0, largestObjectBytes: 0 },
      attachmentBlobs: [],
    })),
    'db.json': encoder.encode(JSON.stringify(db)),
  }, { level: 0 });
}

function emptyCraftedDb(extra: Record<string, unknown[]> = {}): Record<string, unknown[]> {
  return {
    config: [],
    users: [],
    domain_settings: [],
    user_revisions: [],
    folders: [],
    ciphers: [],
    attachments: [],
    webauthn_credentials: [],
    organizations: [],
    organization_users: [],
    collections: [],
    collection_users: [],
    cipher_collections: [],
    ...extra,
  };
}

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

test('import is rejected when a cipher references an organization id absent from the payload', async () => {
  const now = '2026-08-01T00:00:00.000Z';
  const bytes = craftedArchiveBytes(emptyCraftedDb({
    users: [{ id: 'u1', email: 'a@b.c', master_password_hash: 'h', key: 'k', kdf_type: 0, kdf_iterations: 600000, security_stamp: 's', role: 'user', status: 'active', created_at: now, updated_at: now }],
    // organizations is intentionally empty: 'missing-org' is not present.
    ciphers: [{ id: 'cph1', user_id: 'u1', organization_id: 'missing-org', type: 1, folder_id: null, name: '2.cipherName', notes: null, favorite: 0, data: '{}', reprompt: 0, key: null, created_at: now, updated_at: now, archived_at: null, deleted_at: null }],
  }));

  const target = createTestDb();
  const targetEnv = { DB: target } as unknown as Env;
  await assert.rejects(
    () => importBackupArchiveBytes(bytes, targetEnv, 'u1', false, undefined, 'crafted.zip'),
    (error: unknown) => error instanceof Error && error.message === 'Backup archive contains a cipher for an unknown organization: missing-org'
  );
});

test('import accepts a cipher with a valid organization reference and a cipher with a null organization', async () => {
  const now = '2026-08-01T00:00:00.000Z';
  const bytes = craftedArchiveBytes(emptyCraftedDb({
    users: [{ id: 'u1', email: 'a@b.c', master_password_hash: 'h', key: 'k', kdf_type: 0, kdf_iterations: 600000, security_stamp: 's', role: 'user', status: 'active', created_at: now, updated_at: now }],
    organizations: [{ id: 'o1', name: '2.n', public_key: 'pub', encrypted_private_key: '2.priv', created_at: now, updated_at: now }],
    ciphers: [
      { id: 'cph1', user_id: 'u1', organization_id: 'o1', type: 1, folder_id: null, name: '2.cipherName', notes: null, favorite: 0, data: '{}', reprompt: 0, key: null, created_at: now, updated_at: now, archived_at: null, deleted_at: null },
      { id: 'cph2', user_id: 'u1', organization_id: null, type: 1, folder_id: null, name: '2.cipherName2', notes: null, favorite: 0, data: '{}', reprompt: 0, key: null, created_at: now, updated_at: now, archived_at: null, deleted_at: null },
    ],
  }));

  const target = createTestDb();
  const targetEnv = { DB: target } as unknown as Env;
  const importResult = await importBackupArchiveBytes(bytes, targetEnv, 'u1', false, undefined, 'crafted.zip');

  assert.equal(importResult.result.imported.ciphers, 2);
  const restoredCiphers = await target.prepare('SELECT id, organization_id FROM ciphers ORDER BY id ASC').all<any>();
  assert.deepEqual((restoredCiphers.results || []).map((row: any) => ({ ...row })), [
    { id: 'cph1', organization_id: 'o1' },
    { id: 'cph2', organization_id: null },
  ]);
});
