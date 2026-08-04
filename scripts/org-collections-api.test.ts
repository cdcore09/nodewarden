import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOrgCollection,
  updateOrgCollection,
  deleteOrgCollection,
  getOrgCollectionUsers,
  putOrgCollectionUsers,
} from '../webapp/src/lib/api/organizations';

function stubFetch(responseBody: unknown, status = 200) {
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const authedFetch = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { authedFetch: authedFetch as any, calls };
}

test('createOrgCollection POSTs {name} to the collections endpoint', async () => {
  const { authedFetch, calls } = stubFetch({ id: 'c1' });
  await createOrgCollection(authedFetch, 'org1', '2.encName|x');
  assert.equal(calls[0].path, '/api/organizations/org1/collections');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { name: '2.encName|x' });
});

test('updateOrgCollection PUTs {name} to the collection endpoint', async () => {
  const { authedFetch, calls } = stubFetch({ id: 'c1' });
  await updateOrgCollection(authedFetch, 'org1', 'c1', '2.newName|y');
  assert.equal(calls[0].path, '/api/organizations/org1/collections/c1');
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { name: '2.newName|y' });
});

test('deleteOrgCollection DELETEs the collection endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await deleteOrgCollection(authedFetch, 'org1', 'c1');
  assert.equal(calls[0].path, '/api/organizations/org1/collections/c1');
  assert.equal(calls[0].method, 'DELETE');
});

test('getOrgCollectionUsers GETs the bare grant array and maps id -> orgUserId', async () => {
  // The server returns a bare array of {id, readOnly, hidePasswords}
  // (org-collections.ts handleGetCollectionUsers).
  const { authedFetch, calls } = stubFetch([{ id: 'ou1', readOnly: true, hidePasswords: false }]);
  const grants = await getOrgCollectionUsers(authedFetch, 'org1', 'c1');
  assert.equal(calls[0].path, '/api/organizations/org1/collections/c1/users');
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(grants, [{ orgUserId: 'ou1', readOnly: true, hidePasswords: false }]);
});

test('putOrgCollectionUsers PUTs {users:[{id,...}]} full-replace', async () => {
  // parseCollectionGrantsRequest (org-shapes.ts) requires {users:[{id,...}]}.
  const { authedFetch, calls } = stubFetch({});
  await putOrgCollectionUsers(authedFetch, 'org1', 'c1', [
    { orgUserId: 'ou1', readOnly: false, hidePasswords: false },
    { orgUserId: 'ou2', readOnly: true, hidePasswords: true },
  ]);
  assert.equal(calls[0].path, '/api/organizations/org1/collections/c1/users');
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, {
    users: [
      { id: 'ou1', readOnly: false, hidePasswords: false },
      { id: 'ou2', readOnly: true, hidePasswords: true },
    ],
  });
});

test('a failed response rejects with a parsed error message', async () => {
  const { authedFetch } = stubFetch({ message: 'nope' }, 400);
  await assert.rejects(() => deleteOrgCollection(authedFetch, 'org1', 'c1'));
});

test('composition: org-key-encrypted name POSTs verbatim and round-trips', async () => {
  const { encryptWithOrgKey, decryptWithOrgKey } = await import('../webapp/src/lib/org-crypto');
  const orgKey = crypto.getRandomValues(new Uint8Array(64));
  const enc = await encryptWithOrgKey('Family Streaming', orgKey);
  assert.ok(enc.startsWith('2.'));

  const { authedFetch, calls } = stubFetch({ id: 'c1' });
  await createOrgCollection(authedFetch, 'org1', enc);
  assert.equal(calls[0].body.name, enc);

  const dec = await decryptWithOrgKey(calls[0].body.name, orgKey);
  assert.equal(dec, 'Family Streaming');
});
