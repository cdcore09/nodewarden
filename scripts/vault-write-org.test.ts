import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64, decryptStr, sha256Base64 } from '../webapp/src/lib/crypto';
import { orgKeyHalves, encryptWithOrgKey, decryptWithOrgKey } from '../webapp/src/lib/org-crypto';
import { resolveCipherBaseKey, OrgKeyUnavailableError, repairCipherUriChecksums } from '../webapp/src/lib/api/vault';

const personalEnc = new Uint8Array(32).fill(1);
const personalMac = new Uint8Array(32).fill(2);
const orgKeyRaw = new Uint8Array(64); for (let i = 0; i < 64; i++) orgKeyRaw[i] = i + 3;
const orgKeys = { org1: orgKeyRaw };

test('resolveCipherBaseKey returns personal key for personal ciphers', () => {
  const { enc, mac } = resolveCipherBaseKey({ id: 'c', type: 1, organizationId: null } as any, personalEnc, personalMac, orgKeys);
  assert.deepEqual(enc, personalEnc);
  assert.deepEqual(mac, personalMac);
});

test('resolveCipherBaseKey returns ORG key halves for org ciphers', () => {
  const halves = orgKeyHalves(orgKeyRaw);
  const { enc, mac } = resolveCipherBaseKey({ id: 'c', type: 1, organizationId: 'org1' } as any, personalEnc, personalMac, orgKeys);
  assert.deepEqual(enc, halves.enc);
  assert.deepEqual(mac, halves.mac);
  // and crucially NOT the personal key
  assert.notDeepEqual(enc, personalEnc);
});

test('resolveCipherBaseKey THROWS (fails closed) when org key is missing — never personal fallback', () => {
  assert.throws(
    () => resolveCipherBaseKey({ id: 'c', type: 1, organizationId: 'org-unknown' } as any, personalEnc, personalMac, orgKeys),
    (err) => err instanceof OrgKeyUnavailableError
  );
  // also throws when the map is undefined entirely
  assert.throws(
    () => resolveCipherBaseKey({ id: 'c', type: 1, organizationId: 'org1' } as any, personalEnc, personalMac, undefined),
    (err) => err instanceof OrgKeyUnavailableError
  );
});

test('repairCipherUriChecksums repairs an org cipher URI checksum using the ORG mac key, not the personal key', async () => {
  const clearUri = 'https://example.com/org-login';
  const encryptedUri = await encryptWithOrgKey(clearUri, orgKeyRaw);

  const cipher = {
    id: 'org-cipher-1',
    type: 1,
    organizationId: 'org1',
    login: { uris: [{ uri: encryptedUri, uriChecksum: null }] },
  } as any;

  const session: any = {
    symEncKey: bytesToBase64(personalEnc),
    symMacKey: bytesToBase64(personalMac),
  };

  let putBody: any = null;
  const authedFetch: any = async (_url: string, init?: RequestInit) => {
    putBody = JSON.parse(String(init?.body));
    return { ok: true, json: async () => ({}) };
  };

  const repaired = await repairCipherUriChecksums(authedFetch, session, [cipher], orgKeys);
  assert.equal(repaired, 1);
  assert.ok(putBody, 'expected the repair loop to PUT the repaired cipher');

  const repairedChecksum = putBody.login.uris[0].uriChecksum;
  const expectedChecksum = await sha256Base64(clearUri);

  // The repaired checksum must decrypt correctly under the ORG key...
  assert.equal(await decryptWithOrgKey(repairedChecksum, orgKeyRaw), expectedChecksum);

  // ...and must NOT decrypt to the expected checksum under the personal key (proving the
  // repair used the org-mac path, not a personal-key fallback).
  let decryptedWithPersonalKey = '';
  try {
    decryptedWithPersonalKey = await decryptStr(repairedChecksum, personalEnc, personalMac);
  } catch {
    // Expected: MAC mismatch when decrypting org-mac ciphertext with the personal mac key.
  }
  assert.notEqual(decryptedWithPersonalKey, expectedChecksum);
});

test('repairCipherUriChecksums SKIPS an org cipher whose org key is missing from the map (fail-closed, no PUT attempted)', async () => {
  const clearUri = 'https://example.com/org-login-2';
  const encryptedUri = await encryptWithOrgKey(clearUri, orgKeyRaw);

  const cipher = {
    id: 'org-cipher-2',
    type: 1,
    organizationId: 'org-missing', // not present in `orgKeys`
    login: { uris: [{ uri: encryptedUri, uriChecksum: null }] },
  } as any;

  const session: any = {
    symEncKey: bytesToBase64(personalEnc),
    symMacKey: bytesToBase64(personalMac),
  };

  let putCalled = false;
  const authedFetch: any = async () => {
    putCalled = true;
    return { ok: true, json: async () => ({}) };
  };

  const repaired = await repairCipherUriChecksums(authedFetch, session, [cipher], orgKeys);
  assert.equal(repaired, 0);
  assert.equal(putCalled, false, 'must never repair (or even attempt a PUT for) an org cipher with a missing org key');
});
