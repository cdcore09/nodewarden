import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrgInviteToken, verifyOrgInviteToken } from '../src/services/org-invite-token';
import { createJWT } from '../src/utils/jwt';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const claims = { orgUserId: 'ou-9', orgId: 'o-9', email: 'p@x.y' };

test('round-trips valid claims', async () => {
  const token = await createOrgInviteToken(SECRET, claims);
  assert.deepEqual(await verifyOrgInviteToken(SECRET, token), claims);
});

test('rejects wrong secret and garbage', async () => {
  const token = await createOrgInviteToken(SECRET, claims);
  assert.equal(await verifyOrgInviteToken('other-secret-x', token), null);
  assert.equal(await verifyOrgInviteToken(SECRET, 'not.a.token'), null);
});

test('rejects a regular access token (missing org-invite typ)', async () => {
  const accessToken = await createJWT({ sub: 'u1', sstamp: 's' } as any, SECRET);
  assert.equal(await verifyOrgInviteToken(SECRET, accessToken), null);
});
