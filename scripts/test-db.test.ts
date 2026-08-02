import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';

test('createTestDb applies the schema and supports basic D1 operations', async () => {
  const db = createTestDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind('u1', 'a@b.c', 'hash', 'key', 0, 600000, 'stamp', now, now)
    .run();
  const row = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind('u1').first<any>();
  assert.equal(row.email, 'a@b.c');
  const all = await db.prepare('SELECT id FROM users').all<any>();
  assert.equal((all.results || []).length, 1);
});
