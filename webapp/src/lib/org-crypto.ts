// Client-side organization cryptography for NodeWarden orgs.
//
// This module is the SECURITY CORE of org support: it owns the Bitwarden
// org-key model (a 64-byte symmetric key split into a 32-byte AES-256 enc
// key + a 32-byte HMAC-SHA256 mac key, wrapped per-member with RSA-OAEP) and
// nothing else should hand-roll this crypto. Compose the primitives from
// `crypto.ts` (`encryptBw`/`decryptStr`/`base64ToBytes`/`bytesToBase64`) —
// do not reimplement AES/HMAC here.
//
// RSA params mirror `account-passkeys.ts` (org keypair generation) and
// `admin-backup-portable.ts` (RSA-OAEP + SHA-1 decrypt), so wrap/unwrap is
// symmetric with the existing Bitwarden type-4 enc-string convention
// (`RSA2048_OAEP_SHA1_B64`, prefix `"4."`).

import { base64ToBytes, bytesToBase64, decryptStr, encryptBw, requireWebCrypto, toBufferSource } from './crypto';

const RSA_ALGORITHM = 'RSA-OAEP';
const RSA_HASH = 'SHA-1';
const RSA_MODULUS_LENGTH = 2048;
const RSA_PUBLIC_EXPONENT = new Uint8Array([1, 0, 1]);
const RSA_ENC_TYPE_PREFIX = '4.';

const ORG_KEY_LENGTH = 64;
const ORG_KEY_ENC_LENGTH = 32;

export interface GeneratedOrgKeys {
  /** Raw 64-byte org key (enc || mac). Keep in memory only; never persist raw. */
  orgKey: Uint8Array;
  /** Org RSA public key, SPKI-encoded, base64. Stored server-side, not secret. */
  publicKey: string;
  /** Org RSA private key (PKCS8), encrypted with the org key itself (Bitwarden enc string). */
  encryptedPrivateKey: string;
  /** The org key, RSA-wrapped with the creating user's public key (type-4 enc string). POSTed as `key` on org create. */
  wrappedKeyForOwner: string;
}

async function importRsaPublicKey(spkiB64: string): Promise<CryptoKey> {
  const subtle = requireWebCrypto().subtle;
  return subtle.importKey(
    'spki',
    toBufferSource(base64ToBytes(spkiB64)),
    { name: RSA_ALGORITHM, hash: RSA_HASH },
    false,
    ['encrypt']
  );
}

async function rsaEncryptToTypeFourEncString(plaintext: Uint8Array, publicKey: CryptoKey): Promise<string> {
  const subtle = requireWebCrypto().subtle;
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: RSA_ALGORITHM }, publicKey, toBufferSource(plaintext))
  );
  return `${RSA_ENC_TYPE_PREFIX}${bytesToBase64(ciphertext)}`;
}

/**
 * Generate a brand-new organization key set:
 *  - a random 64-byte org key (enc || mac halves, Bitwarden convention)
 *  - a fresh org RSA-OAEP keypair, whose private key is encrypted with the org key
 *  - the org key itself, RSA-wrapped with the creating user's public key
 *
 * `userPublicKeySpkiB64` is the creating user's own RSA public key (SPKI, base64),
 * the same key already used for their vault's `key` field.
 */
export async function generateOrgKeys(userPublicKeySpkiB64: string): Promise<GeneratedOrgKeys> {
  const webCrypto = requireWebCrypto();
  const subtle = webCrypto.subtle;

  const orgKey = webCrypto.getRandomValues(new Uint8Array(ORG_KEY_LENGTH));
  const { enc, mac } = orgKeyHalves(orgKey);

  const orgKeyPair = await subtle.generateKey(
    {
      name: RSA_ALGORITHM,
      modulusLength: RSA_MODULUS_LENGTH,
      publicExponent: RSA_PUBLIC_EXPONENT,
      hash: RSA_HASH,
    },
    true,
    ['encrypt', 'decrypt']
  );

  const orgPublicKeySpki = new Uint8Array(await subtle.exportKey('spki', orgKeyPair.publicKey));
  const orgPrivateKeyPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', orgKeyPair.privateKey));

  const encryptedPrivateKey = await encryptBw(orgPrivateKeyPkcs8, enc, mac);

  const userPublicKey = await importRsaPublicKey(userPublicKeySpkiB64);
  const wrappedKeyForOwner = await rsaEncryptToTypeFourEncString(orgKey, userPublicKey);

  return {
    orgKey,
    publicKey: bytesToBase64(orgPublicKeySpki),
    encryptedPrivateKey,
    wrappedKeyForOwner,
  };
}

/**
 * Unwrap a type-4 (`"4."` + base64 RSA-OAEP ciphertext) wrapped org key using
 * the recipient's RSA private key. Throws on a malformed prefix or a failed
 * RSA decrypt (wrong key, corrupt ciphertext, etc).
 */
export async function unwrapOrgKey(wrappedKey: string, userRsaPrivateKey: CryptoKey): Promise<Uint8Array> {
  if (typeof wrappedKey !== 'string' || !wrappedKey.startsWith(RSA_ENC_TYPE_PREFIX)) {
    throw new Error('Invalid wrapped org key: expected a type-4 encrypted string');
  }
  const ciphertextB64 = wrappedKey.slice(RSA_ENC_TYPE_PREFIX.length);
  let ciphertext: Uint8Array;
  try {
    ciphertext = base64ToBytes(ciphertextB64);
  } catch {
    throw new Error('Invalid wrapped org key: malformed base64 ciphertext');
  }

  const subtle = requireWebCrypto().subtle;
  const orgKey = new Uint8Array(
    await subtle.decrypt({ name: RSA_ALGORITHM }, userRsaPrivateKey, toBufferSource(ciphertext))
  );
  return orgKey;
}

/**
 * RSA-OAEP-wrap an existing org key with a member's public key, producing the
 * type-4 enc string stored per-member (used when confirming an invited member).
 */
export async function rsaWrapOrgKeyForMember(orgKey: Uint8Array, memberPublicKeySpkiB64: string): Promise<string> {
  const memberPublicKey = await importRsaPublicKey(memberPublicKeySpkiB64);
  return rsaEncryptToTypeFourEncString(orgKey, memberPublicKey);
}

/** Split the raw 64-byte org key into its AES-256 enc key and HMAC-SHA256 mac key halves. */
export function orgKeyHalves(orgKey: Uint8Array): { enc: Uint8Array; mac: Uint8Array } {
  if (orgKey.length !== ORG_KEY_LENGTH) {
    throw new Error(`Invalid org key: expected ${ORG_KEY_LENGTH} bytes, got ${orgKey.length}`);
  }
  return {
    enc: orgKey.slice(0, ORG_KEY_ENC_LENGTH),
    mac: orgKey.slice(ORG_KEY_ENC_LENGTH, ORG_KEY_LENGTH),
  };
}

/** Encrypt a UTF-8 string with the org key (Bitwarden enc string, type 2). Used for collection names etc. */
export async function encryptWithOrgKey(plaintext: string, orgKey: Uint8Array): Promise<string> {
  const { enc, mac } = orgKeyHalves(orgKey);
  return encryptBw(new TextEncoder().encode(plaintext), enc, mac);
}

/** Decrypt a Bitwarden enc string with the org key back to a UTF-8 string. */
export async function decryptWithOrgKey(encString: string, orgKey: Uint8Array): Promise<string> {
  const { enc, mac } = orgKeyHalves(orgKey);
  return decryptStr(encString, enc, mac);
}
