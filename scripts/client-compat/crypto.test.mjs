// Round-trip tests for the Bitwarden-compatible registration crypto.
// Run with: node --test scripts/client-compat/crypto.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encType2, decType2, makeRegistrationPayload } from './crypto.mjs';

test('encType2 produces a type-2 enc string that decType2 round-trips', () => {
  const encKey = crypto.randomBytes(32);
  const macKey = crypto.randomBytes(32);
  const plain = Buffer.from('the quick brown fox');
  const enc = encType2(plain, encKey, macKey);
  const [type, payload] = [enc.split('.')[0], enc.split('.')[1]];
  assert.equal(type, '2');
  assert.equal(payload.split('|').length, 3); // iv|ct|mac
  assert.deepEqual(decType2(enc, encKey, macKey), plain);
});

test('decType2 rejects a tampered MAC', () => {
  const encKey = crypto.randomBytes(32);
  const macKey = crypto.randomBytes(32);
  const enc = encType2(Buffer.from('data'), encKey, macKey);
  const parts = enc.slice(2).split('|');
  const bad = `2.${parts[0]}|${parts[1]}|${Buffer.from(crypto.randomBytes(32)).toString('base64')}`;
  assert.throws(() => decType2(bad, encKey, macKey), /mac/i);
});

test('makeRegistrationPayload emits a payload the server shape-checks accept', () => {
  const p = makeRegistrationPayload('compat@example.com', 'CompatPassw0rd!', 600000);
  assert.equal(p.kdf, 0);
  assert.equal(p.kdfIterations, 600000);
  assert.match(p.key, /^2\..+\|.+\|.+$/);
  assert.match(p.keys.encryptedPrivateKey, /^2\..+\|.+\|.+$/);
  assert.ok(Buffer.from(p.keys.publicKey, 'base64').length > 200); // DER SPKI RSA-2048
  assert.equal(Buffer.from(p.masterPasswordHash, 'base64').length, 32);
});

test('the protected user key decrypts with the stretched master key', () => {
  // Re-derive exactly as a Bitwarden client would and prove the key round-trips.
  const email = 'compat@example.com';
  const password = 'CompatPassw0rd!';
  const p = makeRegistrationPayload(email, password, 600000);
  const masterKey = crypto.pbkdf2Sync(password, email.toLowerCase(), 600000, 32, 'sha256');
  const encKey = hkdfExpand(masterKey, 'enc', 32);
  const macKey = hkdfExpand(masterKey, 'mac', 32);
  const userKey = decType2(p.key, encKey, macKey);
  assert.equal(userKey.length, 64);
  // And the private key decrypts under the user key halves.
  const priv = decType2(p.keys.encryptedPrivateKey, userKey.subarray(0, 32), userKey.subarray(32, 64));
  crypto.createPrivateKey({ key: priv, format: 'der', type: 'pkcs8' }); // throws if invalid
});

// Local copy of HKDF-expand for verification independence from crypto.mjs.
function hkdfExpand(prk, info, len) {
  let prev = Buffer.alloc(0);
  let out = Buffer.alloc(0);
  let i = 1;
  while (out.length < len) {
    const h = crypto.createHmac('sha256', prk);
    h.update(Buffer.concat([prev, Buffer.from(info, 'utf8'), Buffer.from([i])]));
    prev = h.digest();
    out = Buffer.concat([out, prev]);
    i++;
  }
  return out.subarray(0, len);
}
