import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileResponse } from '../src/utils/profile-response';
import { profileOrganizationResponse } from '../src/handlers/org-shapes';
import type { OrgMembership, User } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';
const user = {
  id: 'u1', email: 'a@b.c', name: 'A', key: 'k', privateKey: 'pk', publicKey: 'pub',
  masterPasswordHash: 'h', masterPasswordHint: null, kdfType: 0, kdfIterations: 600000,
  kdfMemory: null, kdfParallelism: null, securityStamp: 's', role: 'user', status: 'active',
  verifyDevices: false, totpSecret: null, totpRecoveryCode: null, apiKey: null,
  createdAt: now, updatedAt: now,
} as unknown as User;

const membership: OrgMembership = {
  organization: { id: 'o1', name: '2.n', publicKey: 'pub', encryptedPrivateKey: '2.p', createdAt: now, updatedAt: now },
  orgUser: { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.w', createdAt: now, updatedAt: now },
};

test('buildProfileResponse without orgs keeps empty arrays (backward compatible)', () => {
  const p = buildProfileResponse(user) as any;
  assert.deepEqual(p.organizations, []);
  assert.deepEqual(p.organizationsNew, []);
});

test('buildProfileResponse threads organizations into both fields', () => {
  const orgs = [profileOrganizationResponse(membership)];
  const p = buildProfileResponse(user, undefined, orgs) as any;
  assert.equal(p.organizations.length, 1);
  assert.equal(p.organizations[0].id, 'o1');
  assert.equal(p.organizationsNew, p.organizations);
});

import { createTestDb } from './test-db';
import { StorageService } from '../src/services/storage';
import { loadProfileOrgs } from '../src/utils/profile-orgs';

test('loadProfileOrgs excludes invited memberships and shapes the rest', async () => {
  const db = createTestDb();
  const now2 = '2026-08-02T00:00:00.000Z';
  await db
    .prepare('INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('u1', 'a@b.c', 'h', 'k', 0, 600000, 's', now2, now2)
    .run();
  const storage = new StorageService(db as any);
  await storage.createOrganizationWithOwner(
    { id: 'o1', name: 'Fam', publicKey: 'pub', encryptedPrivateKey: '2.p', createdAt: now2, updatedAt: now2 },
    { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.w', createdAt: now2, updatedAt: now2 }
  );
  await db
    .prepare('INSERT INTO organizations(id, name, public_key, encrypted_private_key, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .bind('o2', 'Other', 'pub', '2.p', now2, now2)
    .run();
  await db
    .prepare('INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('ou2', 'o2', 'u1', 'a@b.c', 'user', 'invited', null, now2, now2)
    .run();

  const orgs = await loadProfileOrgs(storage, 'u1');
  assert.equal(orgs.length, 1);
  assert.equal((orgs[0] as any).id, 'o1');
});
