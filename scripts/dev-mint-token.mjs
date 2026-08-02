// scripts/dev-mint-token.mjs — local smoke helper, mints a JWT the same way
// src/utils/jwt.ts createJWT does (HS256), for a directly-seeded user.
// Usage: node scripts/dev-mint-token.mjs <userId> <securityStamp> <secret>
import crypto from 'node:crypto';

const [userId, sstamp, secret] = process.argv.slice(2);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const now = Math.floor(Date.now() / 1000);
const payload = b64url(
  JSON.stringify({ sub: userId, sstamp, iat: now, exp: now + 3600, iss: 'nodewarden', premium: true, email_verified: true })
);
const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
console.log(`${header}.${payload}.${sig}`);
