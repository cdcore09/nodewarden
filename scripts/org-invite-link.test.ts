import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOrgInviteFromHash } from '../webapp/src/lib/org-invite';

const FULL =
  '#/accept-organization?organizationId=org1&organizationUserId=ou1&email=a%40b.c&token=tok.abc&inviteCode=code1';

test('parses a full invite link with registration code', () => {
  const parsed = parseOrgInviteFromHash(FULL);
  assert.deepEqual(parsed, {
    orgId: 'org1',
    orgUserId: 'ou1',
    email: 'a@b.c',
    token: 'tok.abc',
    inviteCode: 'code1',
  });
});

test('parses a link without inviteCode (existing account) as null code', () => {
  const parsed = parseOrgInviteFromHash(
    '#/accept-organization?organizationId=org1&organizationUserId=ou1&email=a%40b.c&token=tok.abc'
  );
  assert.equal(parsed?.inviteCode, null);
  assert.equal(parsed?.token, 'tok.abc');
});

test('tolerates a missing slash after the hash', () => {
  const parsed = parseOrgInviteFromHash(FULL.replace('#/', '#'));
  assert.equal(parsed?.orgId, 'org1');
});

test('returns null for other hashes and missing required params', () => {
  assert.equal(parseOrgInviteFromHash(''), null);
  assert.equal(parseOrgInviteFromHash('#/vault'), null);
  assert.equal(parseOrgInviteFromHash('#/accept-organization?organizationId=org1'), null);
  assert.equal(
    parseOrgInviteFromHash('#/accept-organization?organizationUserId=ou1&email=a%40b.c&token=t'),
    null
  );
});
