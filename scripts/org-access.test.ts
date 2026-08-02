import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import { StorageService } from '../src/services/storage';
import { canReadCipher, canWriteCipher } from '../src/services/org-access';
import type { Cipher, OrgRole, OrgUserStatus } from '../src/types';

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

// role/status are parameterized so the matrix can cover every combination.
async function seedOrgUser(
  db: any,
  id: string,
  orgId: string,
  userId: string,
  email: string,
  role: OrgRole,
  status: OrgUserStatus
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, orgId, userId, email, role, status, '4.wrapped', now, now)
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

// Builds a synthetic Cipher object — org-access.ts only reads id/userId/organizationId
// off it, but we populate the full shape to stay honest to the frozen signature.
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
  } as unknown as Cipher;
}

// ---------------------------------------------------------------------------
// Personal ciphers (organizationId === null): owner-only, regardless of op.
// ---------------------------------------------------------------------------

test('personal cipher: owner may read and write', async () => {
  const db = createTestDb();
  const storage = new StorageService(db);
  const cipher = makeCipher('c1', 'u1', null);
  assert.equal(await canReadCipher(storage, 'u1', cipher), true);
  assert.equal(await canWriteCipher(storage, 'u1', cipher), true);
});

test('personal cipher: non-owner may not read or write', async () => {
  const db = createTestDb();
  const storage = new StorageService(db);
  const cipher = makeCipher('c1', 'u1', null);
  assert.equal(await canReadCipher(storage, 'u2', cipher), false);
  assert.equal(await canWriteCipher(storage, 'u2', cipher), false);
});

// ---------------------------------------------------------------------------
// Org ciphers: full decision matrix.
// status x role x grant x op, for status in {invited, accepted, confirmed}.
// status 'none' (no membership row) is a separate, smaller block since role
// and grant are moot when there is no orgUser at all.
// ---------------------------------------------------------------------------

type Grant = 'absent' | 'read-only' | 'writable';

async function setupOrgCipher(opts: {
  status: OrgUserStatus | 'none';
  role: OrgRole;
  grant: Grant;
}): Promise<{ storage: StorageService; cipher: Cipher; db: any }> {
  const db = createTestDb();
  await seedUser(db, 'u1', 'member@x.y');
  await seedUser(db, 'cipher-owner', 'owner@x.y');
  await seedOrg(db, 'o1');
  await seedCipher(db, 'ci1', 'cipher-owner');
  const storage = new StorageService(db);

  if (opts.status !== 'none') {
    await seedOrgUser(db, 'ou1', 'o1', 'u1', 'member@x.y', opts.role, opts.status);
    await storage.createCollection({ id: 'col1', orgId: 'o1', name: '2.enc|x', createdAt: now, updatedAt: now });
    if (opts.grant !== 'absent') {
      await storage.setGrant({
        collectionId: 'col1',
        orgUserId: 'ou1',
        readOnly: opts.grant === 'read-only',
        hidePasswords: false,
      });
      await storage.addCipherToCollections('ci1', ['col1']);
    }
  }

  const cipher = makeCipher('ci1', 'cipher-owner', 'o1');
  return { storage, cipher, db };
}

// status: none — no membership row at all. Deny regardless of op.
test('org cipher: status none denies read and write', async () => {
  const { storage, cipher } = await setupOrgCipher({ status: 'none', role: 'user', grant: 'absent' });
  assert.equal(await canReadCipher(storage, 'u1', cipher), false);
  assert.equal(await canWriteCipher(storage, 'u1', cipher), false);
});

const NON_CONFIRMED_STATUSES: OrgUserStatus[] = ['invited', 'accepted'];
const ROLES: OrgRole[] = ['owner', 'user'];
const GRANTS: Grant[] = ['absent', 'read-only', 'writable'];

for (const status of NON_CONFIRMED_STATUSES) {
  for (const role of ROLES) {
    for (const grant of GRANTS) {
      test(`org cipher: status=${status} role=${role} grant=${grant} denies read and write (not confirmed)`, async () => {
        const { storage, cipher } = await setupOrgCipher({ status, role, grant });
        assert.equal(await canReadCipher(storage, 'u1', cipher), false);
        assert.equal(await canWriteCipher(storage, 'u1', cipher), false);
      });
    }
  }
}

// status: confirmed, role: owner — bypasses collection grants entirely; full
// access regardless of grant state.
for (const grant of GRANTS) {
  test(`org cipher: status=confirmed role=owner grant=${grant} allows read and write (owner bypass)`, async () => {
    const { storage, cipher } = await setupOrgCipher({ status: 'confirmed', role: 'owner', grant });
    assert.equal(await canReadCipher(storage, 'u1', cipher), true);
    assert.equal(await canWriteCipher(storage, 'u1', cipher), true);
  });
}

// status: confirmed, role: user — access follows the collection grant exactly.
test('org cipher: status=confirmed role=user grant=absent denies read and write', async () => {
  const { storage, cipher } = await setupOrgCipher({ status: 'confirmed', role: 'user', grant: 'absent' });
  assert.equal(await canReadCipher(storage, 'u1', cipher), false);
  assert.equal(await canWriteCipher(storage, 'u1', cipher), false);
});

test('org cipher: status=confirmed role=user grant=read-only allows read, denies write', async () => {
  const { storage, cipher } = await setupOrgCipher({ status: 'confirmed', role: 'user', grant: 'read-only' });
  assert.equal(await canReadCipher(storage, 'u1', cipher), true);
  assert.equal(await canWriteCipher(storage, 'u1', cipher), false);
});

test('org cipher: status=confirmed role=user grant=writable allows read and write', async () => {
  const { storage, cipher } = await setupOrgCipher({ status: 'confirmed', role: 'user', grant: 'writable' });
  assert.equal(await canReadCipher(storage, 'u1', cipher), true);
  assert.equal(await canWriteCipher(storage, 'u1', cipher), true);
});

// ---------------------------------------------------------------------------
// Cross-org: a confirmed member of org A evaluated against a cipher whose
// organizationId is org B must be denied both read and write, even though
// they are confirmed (and even owner) in org A.
// ---------------------------------------------------------------------------

test('cross-org: confirmed owner of org A denied on a cipher belonging to org B', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'member@x.y');
  await seedUser(db, 'other-owner', 'otherowner@x.y');
  await seedOrg(db, 'orgA');
  await seedOrg(db, 'orgB');
  await seedOrgUser(db, 'ouA', 'orgA', 'u1', 'member@x.y', 'owner', 'confirmed');
  await seedCipher(db, 'ciB', 'other-owner');
  const storage = new StorageService(db);

  const cipherInOrgB = makeCipher('ciB', 'other-owner', 'orgB');
  assert.equal(await canReadCipher(storage, 'u1', cipherInOrgB), false);
  assert.equal(await canWriteCipher(storage, 'u1', cipherInOrgB), false);
});
