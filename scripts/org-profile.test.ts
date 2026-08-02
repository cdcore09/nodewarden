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
