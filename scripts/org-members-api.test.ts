import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listOrgUsers, inviteOrgUsers, resendOrgInvite, confirmOrgUser, removeOrgUser, getUserPublicKey,
} from '../webapp/src/lib/api/organizations';

function stubFetch(responseBody: unknown, status = 200) {
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const authedFetch = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { authedFetch: authedFetch as any, calls };
}

test('listOrgUsers GETs the users endpoint and maps data[]', async () => {
  const { authedFetch, calls } = stubFetch({ data: [{ id: 'ou1', userId: 'u1', email: 'a@b.c', name: 'A', type: 2, status: 1 }], object: 'list' });
  const members = await listOrgUsers(authedFetch, 'org1');
  assert.equal(calls[0].path, '/api/organizations/org1/users');
  assert.equal(calls[0].method, 'GET');
  assert.equal(members.length, 1);
  assert.deepEqual(members[0], { id: 'ou1', userId: 'u1', email: 'a@b.c', name: 'A', type: 2, status: 1 });
});

test('inviteOrgUsers POSTs {emails} to the invite endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await inviteOrgUsers(authedFetch, 'org1', ['x@y.z', 'p@q.r']);
  assert.equal(calls[0].path, '/api/organizations/org1/users/invite');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { emails: ['x@y.z', 'p@q.r'] });
});

test('resendOrgInvite POSTs the reinvite endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await resendOrgInvite(authedFetch, 'org1', 'ou1');
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/reinvite');
  assert.equal(calls[0].method, 'POST');
});

test('confirmOrgUser POSTs {key} to the confirm endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await confirmOrgUser(authedFetch, 'org1', 'ou1', '4.wrapped-key');
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/confirm');
  assert.deepEqual(calls[0].body, { key: '4.wrapped-key' });
});

test('removeOrgUser POSTs the remove endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await removeOrgUser(authedFetch, 'org1', 'ou1');
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/remove');
});

test('getUserPublicKey GETs the public-key endpoint and returns publicKey', async () => {
  const { authedFetch, calls } = stubFetch({ userId: 'u1', publicKey: 'SPKI-B64', object: 'userKey' });
  const pk = await getUserPublicKey(authedFetch, 'u1');
  assert.equal(calls[0].path, '/api/users/u1/public-key');
  assert.equal(pk, 'SPKI-B64');
});

test('a failed response rejects with a parsed error message', async () => {
  const { authedFetch } = stubFetch({ message: 'nope' }, 400);
  await assert.rejects(() => inviteOrgUsers(authedFetch, 'org1', ['x@y.z']));
});

test('confirm flow composition: wrapped org key is POSTed verbatim and round-trips for the member', async () => {
  const { bytesToBase64 } = await import('../webapp/src/lib/crypto');
  const { rsaWrapOrgKeyForMember, unwrapOrgKey } = await import('../webapp/src/lib/org-crypto');

  const RSA_PARAMS = {
    name: 'RSA-OAEP',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-1',
  } as const;
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
  const memberPubB64 = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));

  const orgKey = crypto.getRandomValues(new Uint8Array(64));
  const wrapped = await rsaWrapOrgKeyForMember(orgKey, memberPubB64);
  assert.ok(wrapped.startsWith('4.'));

  const { authedFetch, calls } = stubFetch({});
  await confirmOrgUser(authedFetch, 'org1', 'ou1', wrapped);
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/confirm');
  assert.equal(calls[0].body.key, wrapped);

  const unwrapped = await unwrapOrgKey(calls[0].body.key, pair.privateKey);
  assert.deepEqual(Array.from(unwrapped), Array.from(orgKey));
});
