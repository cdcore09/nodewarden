// Bitwarden-compatible registration crypto (kdf 0 = PBKDF2-SHA256).
// Mirrors what official clients do at registration time so the official
// CLI can log in to and decrypt an account seeded by this module:
//   masterKey        = PBKDF2(password, lower(email), iterations, 32)
//   masterPasswordHash (server auth) = PBKDF2(masterKey, password, 1, 32) b64
//   stretched enc/mac keys = HKDF-SHA256 expand of masterKey ("enc"/"mac")
//   userKey          = 64 random bytes (enc half + mac half)
//   key              = encType2(userKey, stretchedEnc, stretchedMac)
//   encryptedPrivateKey = encType2(pkcs8, userKey[0:32], userKey[32:64])
import crypto from 'node:crypto';

export function hkdfExpand(prk, info, len) {
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

export function encType2(plain, encKey, macKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, ct])).digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
}

export function decType2(encString, encKey, macKey) {
  const [type, payload] = [encString.slice(0, 1), encString.slice(2)];
  if (type !== '2') throw new Error(`unsupported enc type ${type}`);
  const [ivB64, ctB64, macB64] = payload.split('|');
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const mac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, ct])).digest();
  if (!crypto.timingSafeEqual(mac, Buffer.from(macB64, 'base64'))) throw new Error('mac mismatch');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function makeRegistrationPayload(email, password, iterations = 600000) {
  const masterKey = crypto.pbkdf2Sync(password, email.toLowerCase(), iterations, 32, 'sha256');
  const masterPasswordHash = crypto.pbkdf2Sync(masterKey, password, 1, 32, 'sha256').toString('base64');
  const stretchedEnc = hkdfExpand(masterKey, 'enc', 32);
  const stretchedMac = hkdfExpand(masterKey, 'mac', 32);
  const userKey = crypto.randomBytes(64);
  const key = encType2(userKey, stretchedEnc, stretchedMac);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const encryptedPrivateKey = encType2(privateKey, userKey.subarray(0, 32), userKey.subarray(32, 64));
  return {
    email: email.toLowerCase(),
    name: email.split('@')[0],
    masterPasswordHash,
    key,
    kdf: 0,
    kdfIterations: iterations,
    keys: { publicKey: publicKey.toString('base64'), encryptedPrivateKey },
  };
}
