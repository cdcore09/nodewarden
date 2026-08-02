import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import { StorageService } from '../src/services/storage';
import type { Cipher } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';

async function seedUser(db: any, id: string, email: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, email, 'hash', 'key', 0, 600000, 'stamp-' + id, now, now)
    .run();
}

function makeCipher(id: string, userId: string, organizationId: string | null): Cipher {
  return {
    id,
    userId,
    organizationId,
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
  };
}

test('saveCipher + getCipher round-trips a non-null organizationId', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  const storage = new StorageService(db);

  await storage.saveCipher(makeCipher('c1', 'u1', 'org-1'));
  const fetched = await storage.getCipher('c1');

  assert.equal(fetched?.organizationId, 'org-1');

  // The physical `organization_id` column is the single source of truth for
  // reads (backups, future org-scoped queries, indexes all depend on it
  // being populated) — assert on it directly, not just the parsed object.
  const raw = await db.prepare('SELECT organization_id, data FROM ciphers WHERE id = ?').bind('c1').first<any>();
  assert.equal(raw?.organization_id, 'org-1');

  // Guard against blob/column drift: organizationId must be stripped from
  // the opaque JSON `data` blob now that it has a first-class column, so the
  // column stays authoritative and the two never disagree.
  const parsedData = JSON.parse(raw?.data ?? '{}');
  assert.equal('organizationId' in parsedData, false, 'organizationId must not be duplicated in the data blob');
});

test('saveCipher + getCipher round-trips a personal cipher as null, not undefined', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  const storage = new StorageService(db);

  await storage.saveCipher(makeCipher('c2', 'u1', null));
  const fetched = await storage.getCipher('c2');

  assert.equal(fetched?.organizationId, null);
  assert.notEqual(fetched?.organizationId, undefined);
  assert.ok('organizationId' in (fetched as object), 'organizationId key must be present on the returned object');

  const raw = await db.prepare('SELECT organization_id FROM ciphers WHERE id = ?').bind('c2').first<any>();
  assert.equal(raw?.organization_id, null);
});

test('saveCipher persists organizationId to the physical column even when updating an existing row', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  const storage = new StorageService(db);

  await storage.saveCipher(makeCipher('c3', 'u1', null));
  await storage.saveCipher(makeCipher('c3', 'u1', 'org-2'));

  const raw = await db.prepare('SELECT organization_id FROM ciphers WHERE id = ?').bind('c3').first<any>();
  assert.equal(raw?.organization_id, 'org-2');
});
