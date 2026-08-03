import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToBase64 } from '../webapp/src/lib/crypto';
import {
  generateOrgKeys,
  unwrapOrgKey,
  rsaWrapOrgKeyForMember,
  orgKeyHalves,
  encryptWithOrgKey,
  decryptWithOrgKey,
} from '../webapp/src/lib/org-crypto';

const RSA_PARAMS = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-1',
} as const;

async function generateRsaKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey; publicKeySpkiB64: string }> {
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeySpkiB64: bytesToBase64(spki),
  };
}

test('generateOrgKeys -> unwrapOrgKey(wrappedKeyForOwner, userPrivKey) round-trips the org key', async () => {
  const owner = await generateRsaKeyPair();
  const result = await generateOrgKeys(owner.publicKeySpkiB64);

  assert.equal(result.orgKey.length, 64);
  assert.match(result.wrappedKeyForOwner, /^4\./);

  const unwrapped = await unwrapOrgKey(result.wrappedKeyForOwner, owner.privateKey);
  assert.deepEqual(unwrapped, result.orgKey);
});

test('encryptedPrivateKey decrypts with orgKeyHalves and imports as an RSA key', async () => {
  const owner = await generateRsaKeyPair();
  const result = await generateOrgKeys(owner.publicKeySpkiB64);

  const { enc, mac } = orgKeyHalves(result.orgKey);
  const { decryptBw } = await import('../webapp/src/lib/crypto');
  const privateKeyPkcs8 = await decryptBw(result.encryptedPrivateKey, enc, mac);

  const importedOrgPrivateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyPkcs8,
    { name: 'RSA-OAEP', hash: 'SHA-1' },
    false,
    ['decrypt']
  );
  assert.equal(importedOrgPrivateKey.type, 'private');

  // Sanity: the exported org public key should be usable to encrypt something
  // that the decrypted org private key can decrypt back.
  const orgPublicKeyBytes = Uint8Array.from(atob(result.publicKey), (c) => c.charCodeAt(0));
  const importedOrgPublicKey = await crypto.subtle.importKey(
    'spki',
    orgPublicKeyBytes,
    { name: 'RSA-OAEP', hash: 'SHA-1' },
    false,
    ['encrypt']
  );
  const plaintext = new TextEncoder().encode('org-crypto self test');
  const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, importedOrgPublicKey, plaintext);
  const decrypted = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, importedOrgPrivateKey, ciphertext);
  assert.deepEqual(new Uint8Array(decrypted), plaintext);
});

test('rsaWrapOrgKeyForMember -> unwrapOrgKey with member private key returns the same orgKey', async () => {
  const owner = await generateRsaKeyPair();
  const member = await generateRsaKeyPair();
  const result = await generateOrgKeys(owner.publicKeySpkiB64);

  const wrappedForMember = await rsaWrapOrgKeyForMember(result.orgKey, member.publicKeySpkiB64);
  assert.match(wrappedForMember, /^4\./);

  const unwrapped = await unwrapOrgKey(wrappedForMember, member.privateKey);
  assert.deepEqual(unwrapped, result.orgKey);
});

test('encryptWithOrgKey / decryptWithOrgKey round-trips a collection name string', async () => {
  const owner = await generateRsaKeyPair();
  const result = await generateOrgKeys(owner.publicKeySpkiB64);

  const plaintext = 'Engineering Team Collection 🔐';
  const encString = await encryptWithOrgKey(plaintext, result.orgKey);
  assert.match(encString, /^2\./);

  const decrypted = await decryptWithOrgKey(encString, result.orgKey);
  assert.equal(decrypted, plaintext);
});

test('unwrapOrgKey throws on a garbage/malformed wrapped key string', async () => {
  const owner = await generateRsaKeyPair();

  await assert.rejects(() => unwrapOrgKey('not-a-valid-enc-string', owner.privateKey));
  await assert.rejects(() => unwrapOrgKey('4.not-valid-base64-ciphertext!!!', owner.privateKey));
  await assert.rejects(() => unwrapOrgKey('4.' + bytesToBase64(new Uint8Array([1, 2, 3])), owner.privateKey));
});
