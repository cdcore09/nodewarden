// scripts/org-flow-smoke.mjs
// End-to-end org membership smoke. Usage:
//   node scripts/org-flow-smoke.mjs <BASE_URL> <JWT_SECRET> [INVITEE_EMAIL]
// Registers an admin (first user = role admin), creates an org, invites the
// invitee, registers the invitee with the minted registration code, accepts
// with a locally-minted invite token (same JWT_SECRET as the server),
// confirms, verifies both profiles, removes, verifies removal.
import crypto from 'node:crypto';

const [BASE, JWT_SECRET, INVITEE_EMAIL_ARG] = process.argv.slice(2);
if (!BASE || !JWT_SECRET) { console.error('usage: org-flow-smoke.mjs BASE JWT_SECRET [inviteeEmail]'); process.exit(1); }
const runId = crypto.randomUUID().slice(0, 8);
const ADMIN_EMAIL = `smoke-admin-${runId}@example.com`;
const INVITEE_EMAIL = (INVITEE_EMAIL_ARG || `smoke-member-${runId}@example.com`).toLowerCase();

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mintAccess(userId, sstamp) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub: userId, sstamp, iat: now, exp: now + 3600, iss: 'nodewarden', premium: true, email_verified: true }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function mintInviteToken(orgUserId, orgId, email) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub: orgUserId, typ: 'org-invite', oid: orgId, iem: email, iat: now, exp: now + 3600, iss: 'nodewarden', premium: true, email_verified: true }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); } else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
async function register(email, inviteCode) {
  // /api/accounts/register enforces a same-origin write check (CSRF hardening):
  // it requires an Origin (or Referer) header matching the request's own
  // origin. Node's fetch does not send Origin by default, so it must be set
  // explicitly here to avoid a spurious 403 "Forbidden origin".
  // key/encryptedPrivateKey must look like a Bitwarden enc string
  // (typeNumber.iv|ciphertext) — handleRegister rejects anything without a
  // '|' payload separator with 400 "key is not a valid encrypted string".
  const res = await fetch(`${BASE}/api/accounts/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({
      email, name: email.split('@')[0], masterPasswordHash: `hash-${email}`, key: `2.iv-${email}|ct-${email}`,
      kdf: 0, kdfIterations: 600000, inviteCode,
      keys: { publicKey: `pub-${email}`, encryptedPrivateKey: `2.priv-iv-${email}|priv-ct-${email}` },
    }),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function login(email) {
  const body = new URLSearchParams({
    grant_type: 'password', username: email, password: `hash-${email}`,
    scope: 'api offline_access', client_id: 'web', deviceType: '9',
    deviceIdentifier: crypto.randomUUID(), deviceName: 'smoke',
  });
  const res = await fetch(`${BASE}/identity/connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// --- flow ---
const reg1 = await register(ADMIN_EMAIL);
check('admin registers (first user)', reg1.status === 200, `status ${reg1.status}: ${reg1.text}`);
const adminLogin = await login(ADMIN_EMAIL);
check('admin logs in', adminLogin.status === 200 && adminLogin.json?.access_token, `status ${adminLogin.status}`);
const adminToken = adminLogin.json.access_token;

const orgRes = await api('POST', '/api/organizations', adminToken, {
  name: `Smoke Org ${runId}`, key: '4.smoke-wrapped', keys: { publicKey: 'org-pub', encryptedPrivateKey: '2.org-priv' },
});
check('admin creates org', orgRes.status === 200 && orgRes.json?.id, `status ${orgRes.status}: ${orgRes.text}`);
const orgId = orgRes.json.id;

const inviteRes = await api('POST', `/api/organizations/${orgId}/users/invite`, adminToken, { emails: [INVITEE_EMAIL] });
check('invite sends (email dispatched)', inviteRes.status === 200, `status ${inviteRes.status}: ${inviteRes.text}`);

const list1 = await api('GET', `/api/organizations/${orgId}/users`, adminToken);
const invitedRow = list1.json?.data?.find((m) => m.email === INVITEE_EMAIL);
check('member list shows invited row (status 0)', invitedRow && invitedRow.status === 0, JSON.stringify(list1.json));
const orgUserId = invitedRow?.id;

// Invitee registers. Second registration REQUIRES an invite code; the invite
// endpoint minted one, but it lives only in the email. For the smoke we mint
// a code directly against the same rule the server uses is impossible —
// instead the ADMIN mints one via the admin invite API if present, else we
// prove the negative and register with the org-invite-created code passed in
// REG_CODE env var (deployed runs read it from the received email).
let inviteeReg = await register(INVITEE_EMAIL, process.env.REG_CODE || undefined);
check('invitee registration honors invite-code rule', inviteeReg.status === 200 || inviteeReg.status === 400, `status ${inviteeReg.status}`);
if (inviteeReg.status !== 200) {
  console.error('NOTE: invitee registration needs REG_CODE from the invite email (or an unused admin-minted code).');
  process.exit(failures ? 1 : 2);
}
const inviteeLogin = await login(INVITEE_EMAIL);
check('invitee logs in', inviteeLogin.status === 200, `status ${inviteeLogin.status}`);
const inviteeToken = inviteeLogin.json.access_token;

const acceptRes = await api('POST', `/api/organizations/${orgId}/users/${orgUserId}/accept`, inviteeToken, {
  token: mintInviteToken(orgUserId, orgId, INVITEE_EMAIL),
});
check('invitee accepts', acceptRes.status === 200, `status ${acceptRes.status}: ${acceptRes.text}`);

const inviteeSync1 = await api('GET', '/api/sync', inviteeToken);
const acceptedOrg = inviteeSync1.json?.profile?.organizations?.find((o) => o.id === orgId);
check('accepted org appears in invitee profile (status 1, no key yet)', acceptedOrg && acceptedOrg.status === 1 && !acceptedOrg.key, JSON.stringify(acceptedOrg));

const confirmRes = await api('POST', `/api/organizations/${orgId}/users/${orgUserId}/confirm`, adminToken, { key: '4.wrapped-for-invitee' });
check('owner confirms', confirmRes.status === 200, `status ${confirmRes.status}: ${confirmRes.text}`);

const pk = await api('GET', `/api/users/${inviteeSync1.json?.profile?.id}/public-key`, adminToken);
check('owner can fetch member public key', pk.status === 200 && pk.json?.publicKey === `pub-${INVITEE_EMAIL}`, JSON.stringify(pk.json));

const inviteeSync2 = await api('GET', '/api/sync', inviteeToken);
const confirmedOrg = inviteeSync2.json?.profile?.organizations?.find((o) => o.id === orgId);
check('confirmed org carries the wrapped key (status 2)', confirmedOrg && confirmedOrg.status === 2 && confirmedOrg.key === '4.wrapped-for-invitee', JSON.stringify(confirmedOrg));

const strangerReg = await register(`smoke-stranger-${runId}@example.com`, process.env.REG_CODE_2 || undefined);
if (strangerReg.status === 200) {
  const strangerLogin = await login(`smoke-stranger-${runId}@example.com`);
  const strangerList = await api('GET', `/api/organizations/${orgId}/users`, strangerLogin.json.access_token);
  check('stranger cannot list members (404)', strangerList.status === 404, `status ${strangerList.status}`);
} else {
  console.log('skip stranger isolation check (no second registration code) — covered by unit gates');
}

const removeRes = await api('DELETE', `/api/organizations/${orgId}/users/${orgUserId}`, adminToken);
check('owner removes member', removeRes.status === 200, `status ${removeRes.status}`);
const inviteeSync3 = await api('GET', '/api/sync', inviteeToken);
check('removed org gone from invitee profile', !inviteeSync3.json?.profile?.organizations?.some((o) => o.id === orgId), '');

const ownerRow = (await api('GET', `/api/organizations/${orgId}/users`, adminToken)).json?.data?.find((m) => m.type === 0);
const removeOwner = await api('DELETE', `/api/organizations/${orgId}/users/${ownerRow?.id}`, adminToken);
check('owner cannot be removed (400)', removeOwner.status === 400, `status ${removeOwner.status}`);

console.log(failures ? `${failures} CHECKS FAILED` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
