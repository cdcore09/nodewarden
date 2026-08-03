import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64, decryptStr } from '../webapp/src/lib/crypto';
import { orgKeyHalves } from '../webapp/src/lib/org-crypto';
import { resolveCipherBaseKey, OrgKeyUnavailableError } from '../webapp/src/lib/api/vault';

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
