// scripts/org-collections-smoke.mjs
// End-to-end org collections smoke. Usage:
//   node scripts/org-collections-smoke.mjs <BASE_URL> <JWT_SECRET>
// Extends the Phase 2 org-flow-smoke pattern (register admin -> create org ->
// invite/accept/confirm a member via locally-minted tokens) then exercises
// collection CRUD, per-collection member grants, sync visibility/readOnly
// flags, rename propagation, cross-org isolation, and delete propagation.
//
// Env:
//   REG_CODE   — registration code for the invited member's second-user
//                registration (required; seed locally as documented in the
//                Phase 2 plan doc).
//   REG_CODE_2 — registration code for the stranger account used for the
//                cross-org isolation check (required for that check to run;
//                without it the check is skipped with a note, matching
//                org-flow-smoke's stranger-isolation fallback).
import crypto from 'node:crypto';

const [BASE, JWT_SECRET] = process.argv.slice(2);
if (!BASE || !JWT_SECRET) { console.error('usage: org-collections-smoke.mjs BASE JWT_SECRET'); process.exit(1); }
const runId = crypto.randomUUID().slice(0, 8);
const ADMIN_EMAIL = `smoke-collab-admin-${runId}@example.com`;
const MEMBER_EMAIL = `smoke-collab-member-${runId}@example.com`;
const STRANGER_EMAIL = `smoke-collab-stranger-${runId}@example.com`;

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
  // See org-flow-smoke.mjs for why Origin + enc-string key/encryptedPrivateKey
  // values are required here.
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

// --- 1. admin registers, logs in, creates org ---
const adminReg = await register(ADMIN_EMAIL);
check('admin registers (first user)', adminReg.status === 200, `status ${adminReg.status}: ${adminReg.text}`);
const adminLogin = await login(ADMIN_EMAIL);
check('admin logs in', adminLogin.status === 200 && adminLogin.json?.access_token, `status ${adminLogin.status}`);
if (adminLogin.status !== 200 || !adminLogin.json?.access_token) {
  console.log(`${failures} CHECKS FAILED`);
  process.exit(1);
}
const adminToken = adminLogin.json.access_token;

const orgRes = await api('POST', '/api/organizations', adminToken, {
  name: `Smoke Collab Org ${runId}`, key: '4.smoke-wrapped', keys: { publicKey: 'org-pub', encryptedPrivateKey: '2.org-priv' },
});
check('admin creates org', orgRes.status === 200 && orgRes.json?.id, `status ${orgRes.status}: ${orgRes.text}`);
const orgId = orgRes.json.id;

// --- 2. invite/register/accept/confirm the member (Phase 2 flow) ---
const inviteRes = await api('POST', `/api/organizations/${orgId}/users/invite`, adminToken, { emails: [MEMBER_EMAIL] });
check('invite sends', inviteRes.status === 200, `status ${inviteRes.status}: ${inviteRes.text}`);

const list1 = await api('GET', `/api/organizations/${orgId}/users`, adminToken);
const invitedRow = list1.json?.data?.find((m) => m.email === MEMBER_EMAIL);
check('member list shows invited row (status 0)', invitedRow && invitedRow.status === 0, JSON.stringify(list1.json));
const memberOrgUserId = invitedRow?.id;

const memberReg = await register(MEMBER_EMAIL, process.env.REG_CODE || undefined);
check('member registers with seeded code', memberReg.status === 200, `status ${memberReg.status}: ${memberReg.text}`);
if (memberReg.status !== 200) {
  console.error('NOTE: member registration needs REG_CODE seeded in local D1 (see Phase 2 plan doc recipe).');
  process.exit(failures ? 1 : 2);
}
const memberLogin = await login(MEMBER_EMAIL);
check('member logs in', memberLogin.status === 200 && memberLogin.json?.access_token, `status ${memberLogin.status}`);
if (memberLogin.status !== 200 || !memberLogin.json?.access_token) {
  console.log(`${failures} CHECKS FAILED`);
  process.exit(1);
}
const memberToken = memberLogin.json.access_token;

const acceptRes = await api('POST', `/api/organizations/${orgId}/users/${memberOrgUserId}/accept`, memberToken, {
  token: mintInviteToken(memberOrgUserId, orgId, MEMBER_EMAIL),
});
check('member accepts', acceptRes.status === 200, `status ${acceptRes.status}: ${acceptRes.text}`);

const confirmRes = await api('POST', `/api/organizations/${orgId}/users/${memberOrgUserId}/confirm`, adminToken, { key: '4.wrapped-for-member' });
check('owner confirms', confirmRes.status === 200, `status ${confirmRes.status}: ${confirmRes.text}`);

// --- 3. create two collections ---
const colARes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection A' });
check('create collection A (200 + object:collection)', colARes.status === 200 && colARes.json?.object === 'collection', `status ${colARes.status}: ${colARes.text}`);
const colAId = colARes.json?.id;

const colBRes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection B' });
check('create collection B (200 + object:collection)', colBRes.status === 200 && colBRes.json?.object === 'collection', `status ${colBRes.status}: ${colBRes.text}`);
const colBId = colBRes.json?.id;

// --- 4. grant member read-only on A, writable on B ---
const grantARes = await api('PUT', `/api/organizations/${orgId}/collections/${colAId}/users`, adminToken, {
  users: [{ id: memberOrgUserId, readOnly: true, hidePasswords: false }],
});
check('grant member read-only on collection A', grantARes.status === 200, `status ${grantARes.status}: ${grantARes.text}`);

const grantBRes = await api('PUT', `/api/organizations/${orgId}/collections/${colBId}/users`, adminToken, {
  users: [{ id: memberOrgUserId, readOnly: false, hidePasswords: false }],
});
check('grant member writable on collection B', grantBRes.status === 200, `status ${grantBRes.status}: ${grantBRes.text}`);

// --- 5. member sync shows both collections with correct readOnly flags ---
const memberSync1 = await api('GET', '/api/sync', memberToken);
const memberColsById1 = new Map((memberSync1.json?.collections || []).map((c) => [c.id, c]));
const memberColA1 = memberColsById1.get(colAId);
const memberColB1 = memberColsById1.get(colBId);
check(
  'member sync lists collection A as collectionDetails, readOnly:true',
  memberColA1?.object === 'collectionDetails' && memberColA1?.readOnly === true,
  JSON.stringify(memberColA1)
);
check(
  'member sync lists collection B as collectionDetails, readOnly:false',
  memberColB1?.object === 'collectionDetails' && memberColB1?.readOnly === false,
  JSON.stringify(memberColB1)
);

// --- 6. owner sync shows both collections with readOnly:false (sees all) ---
const ownerSync1 = await api('GET', '/api/sync', adminToken);
const ownerColsById1 = new Map((ownerSync1.json?.collections || []).map((c) => [c.id, c]));
check(
  "owner sync lists collection A, readOnly:false (owner sees all)",
  ownerColsById1.get(colAId)?.readOnly === false,
  JSON.stringify(ownerColsById1.get(colAId))
);
check(
  "owner sync lists collection B, readOnly:false (owner sees all)",
  ownerColsById1.get(colBId)?.readOnly === false,
  JSON.stringify(ownerColsById1.get(colBId))
);

// --- 7. rename collection A; member's sync reflects the new name ---
const renameRes = await api('PUT', `/api/organizations/${orgId}/collections/${colAId}`, adminToken, { name: 'Collection A Renamed' });
check('rename collection A', renameRes.status === 200 && renameRes.json?.name === 'Collection A Renamed', `status ${renameRes.status}: ${renameRes.text}`);

const memberSync2 = await api('GET', '/api/sync', memberToken);
const memberColA2 = (memberSync2.json?.collections || []).find((c) => c.id === colAId);
check(
  "member sync reflects renamed collection A after owner mutation bumped the member's revision",
  memberColA2?.name === 'Collection A Renamed',
  JSON.stringify(memberColA2)
);

// --- 8. stranger (separate account) 404s on the org's collections endpoint ---
const strangerReg = await register(STRANGER_EMAIL, process.env.REG_CODE_2 || undefined);
if (strangerReg.status === 200) {
  const strangerLogin = await login(STRANGER_EMAIL);
  const strangerList = await api('GET', `/api/organizations/${orgId}/collections`, strangerLogin.json.access_token);
  check('stranger cannot list collections (404)', strangerList.status === 404, `status ${strangerList.status}`);
} else {
  console.log('skip stranger isolation check (no REG_CODE_2) — covered by unit gates');
}

// --- 9. delete collection B; member's sync no longer lists it ---
const deleteBRes = await api('DELETE', `/api/organizations/${orgId}/collections/${colBId}`, adminToken);
check('delete collection B', deleteBRes.status === 200, `status ${deleteBRes.status}: ${deleteBRes.text}`);

const memberSync3 = await api('GET', '/api/sync', memberToken);
const memberHasB = (memberSync3.json?.collections || []).some((c) => c.id === colBId);
check('deleted collection B no longer in member sync', !memberHasB, JSON.stringify(memberSync3.json?.collections));

console.log(failures ? `${failures} CHECKS FAILED` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
