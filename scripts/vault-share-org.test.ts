import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToBase64, decryptStr } from '../webapp/src/lib/crypto';
import { orgKeyHalves } from '../webapp/src/lib/org-crypto';
import { shareCipher } from '../webapp/src/lib/api/vault';
import type { Cipher, SessionState, VaultDraft } from '../webapp/src/lib/types';

function stubFetch(responseBody: unknown, status = 200) {
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const authedFetch = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { authedFetch: authedFetch as any, calls };
}

function makeSession(): SessionState {
  return {
    email: 'owner@example.com',
    symEncKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
    symMacKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
  };
}

function makeDraft(): VaultDraft {
  return {
    type: 1,
    favorite: false,
    name: 'Shared Login',
    folderId: '',
    notes: 'family note',
    reprompt: false,
    loginUsername: 'family-user',
    loginPassword: 'family-pass-123',
    loginTotp: '',
    loginUris: [],
    loginFido2Credentials: [],
  } as unknown as VaultDraft;
}

const baseCipher: Cipher = {
  id: 'cipher-1',
  type: 1,
  organizationId: null,
  // One entry WITHOUT a decrypted value: must be dropped on a key switch, not
  // passed through still encrypted under the personal key.
  passwordHistory: [{ password: '2.personal-key-junk|x|y', lastUsedDate: '2026-01-01T00:00:00.000Z' }],
} as unknown as Cipher;

test('shareCipher re-encrypts under the org key and posts the share payload', async () => {
  const session = makeSession();
  const orgKey = crypto.getRandomValues(new Uint8Array(64));
  const orgKeys = { org1: orgKey };
  const { authedFetch, calls } = stubFetch({ id: 'cipher-1', organizationId: 'org1' });

  await shareCipher(authedFetch, session, baseCipher, makeDraft(), 'org1', ['col1', 'col1', 'col2'], orgKeys);

  assert.equal(calls[0].path, '/api/ciphers/cipher-1/share');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body.collectionIds, ['col1', 'col2']); // deduped
  assert.equal(calls[0].body.cipher.organizationId, 'org1');

  const halves = orgKeyHalves(orgKey);
  assert.equal(await decryptStr(calls[0].body.cipher.name, halves.enc, halves.mac), 'Shared Login');
  assert.equal(await decryptStr(calls[0].body.cipher.login.password, halves.enc, halves.mac), 'family-pass-123');

  // Undecryptable-under-org-key history entry dropped, not passed through.
  assert.equal(calls[0].body.cipher.passwordHistory, null);
});

test('shareCipher fails closed without the org key', async () => {
  const session = makeSession();
  const { authedFetch, calls } = stubFetch({});
  await assert.rejects(() => shareCipher(authedFetch, session, baseCipher, makeDraft(), 'org1', ['col1'], {}));
  assert.equal(calls.length, 0); // nothing hit the network
});

test('shareCipher refuses org-owned ciphers and empty collections', async () => {
  const session = makeSession();
  const orgKeys = { org1: crypto.getRandomValues(new Uint8Array(64)) };
  const { authedFetch } = stubFetch({});
  const orgCipher = { ...baseCipher, organizationId: 'org0' } as Cipher;
  await assert.rejects(() => shareCipher(authedFetch, session, orgCipher, makeDraft(), 'org1', ['col1'], orgKeys));
  await assert.rejects(() => shareCipher(authedFetch, session, baseCipher, makeDraft(), 'org1', [], orgKeys));
});
