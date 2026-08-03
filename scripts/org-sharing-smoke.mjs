// scripts/org-sharing-smoke.mjs
// End-to-end org cipher SHARING smoke. Usage:
//   node scripts/org-sharing-smoke.mjs <BASE_URL> <JWT_SECRET>
// Extends the Phase 2 org-flow-smoke / Phase 3a org-collections-smoke pattern
// (register admin -> create org -> invite/accept/confirm a member via
// locally-minted tokens, two collections with a read-only/writable split)
// then exercises the actual point of Phase 3b: org ciphers created in a
// collection are visible to (and gated for) the members granted access to
// that collection, sharing a personal cipher into an org collection works,
// and deleting an org purges its ciphers from the owner's sync.
//
// Env:
//   REG_CODE   — registration code for the invited member's second-user
//                registration (required; seed locally as documented in the
//                Phase 2 plan doc, raw sqlite3 against .wrangler/state).
//   REG_CODE_2 — registration code for the stranger account used for the
//                cross-tenant isolation check (required for that check to
//                run; without it the check is skipped with a note, matching
//                org-flow-smoke's stranger-isolation fallback).
import crypto from 'node:crypto';

const [BASE, JWT_SECRET] = process.argv.slice(2);
if (!BASE || !JWT_SECRET) { console.error('usage: org-sharing-smoke.mjs BASE JWT_SECRET'); process.exit(1); }
const runId = crypto.randomUUID().slice(0, 8);
const ADMIN_EMAIL = `smoke-share-admin-${runId}@example.com`;
const MEMBER_EMAIL = `smoke-share-member-${runId}@example.com`;
const STRANGER_EMAIL = `smoke-share-stranger-${runId}@example.com`;

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
// Minimal valid enc-string: typeNumber.iv|ciphertext. isValidEncString (in
// src/handlers/ciphers.ts) requires >=2 pipe-separated parts for type 0/1/4,
// but EXACTLY 3 parts (iv|data|mac) for type 2 — use type 0 here so a single
// '|' separator (matching the register()/org-key convention used elsewhere
// in this file) is valid.
const enc = (label) => `0.iv-${label}|ct-${label}`;
function loginCipherBody(name, organizationId, collectionIds) {
  return {
    cipher: {
      type: 1,
      name: enc(name),
      login: { username: enc(`${name}-user`), password: enc(`${name}-pass`) },
      ...(organizationId ? { organizationId } : {}),
    },
    ...(collectionIds ? { collectionIds } : {}),
  };
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
  name: `Smoke Sharing Org ${runId}`, key: '4.smoke-wrapped', keys: { publicKey: 'org-pub', encryptedPrivateKey: '2.org-priv' },
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

// --- 3. create three collections: A (member read-only), B (member writable), C (member ungranted) ---
const colARes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection A' });
check('create collection A', colARes.status === 200 && colARes.json?.object === 'collection', `status ${colARes.status}: ${colARes.text}`);
const colAId = colARes.json?.id;

const colBRes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection B' });
check('create collection B', colBRes.status === 200 && colBRes.json?.object === 'collection', `status ${colBRes.status}: ${colBRes.text}`);
const colBId = colBRes.json?.id;

const colCRes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection C (ungranted)' });
check('create collection C', colCRes.status === 200 && colCRes.json?.object === 'collection', `status ${colCRes.status}: ${colCRes.text}`);
const colCId = colCRes.json?.id;

// --- 4. grant member read-only on A, writable on B; nothing on C ---
const grantARes = await api('PUT', `/api/organizations/${orgId}/collections/${colAId}/users`, adminToken, {
  users: [{ id: memberOrgUserId, readOnly: true, hidePasswords: false }],
});
check('grant member read-only on collection A', grantARes.status === 200, `status ${grantARes.status}: ${grantARes.text}`);

const grantBRes = await api('PUT', `/api/organizations/${orgId}/collections/${colBId}/users`, adminToken, {
  users: [{ id: memberOrgUserId, readOnly: false, hidePasswords: false }],
});
check('grant member writable on collection B', grantBRes.status === 200, `status ${grantBRes.status}: ${grantBRes.text}`);

// --- 5. admin creates an org cipher in A, one in B, and a third in C (ungranted) ---
const cipherARes = await api('POST', '/api/ciphers', adminToken, loginCipherBody('cipher-a', orgId, [colAId]));
check('admin creates org cipher in collection A', cipherARes.status === 200 && cipherARes.json?.id, `status ${cipherARes.status}: ${cipherARes.text}`);
const cipherAId = cipherARes.json?.id;

const cipherBRes = await api('POST', '/api/ciphers', adminToken, loginCipherBody('cipher-b', orgId, [colBId]));
check('admin creates org cipher in collection B', cipherBRes.status === 200 && cipherBRes.json?.id, `status ${cipherBRes.status}: ${cipherBRes.text}`);
const cipherBId = cipherBRes.json?.id;

const cipherCRes = await api('POST', '/api/ciphers', adminToken, loginCipherBody('cipher-c', orgId, [colCId]));
check('admin creates org cipher in ungranted collection C', cipherCRes.status === 200 && cipherCRes.json?.id, `status ${cipherCRes.status}: ${cipherCRes.text}`);
const cipherCId = cipherCRes.json?.id;

// --- 6. member sync shows A and B (with organizationId + collectionIds), NOT C ---
const memberSync1 = await api('GET', '/api/sync', memberToken);
const memberCiphersById1 = new Map((memberSync1.json?.ciphers || []).map((c) => [c.id, c]));
const memberCipherA1 = memberCiphersById1.get(cipherAId);
const memberCipherB1 = memberCiphersById1.get(cipherBId);
check(
  'member sync shows cipher A with organizationId set and collectionIds [A]',
  memberCipherA1?.organizationId === orgId && Array.isArray(memberCipherA1?.collectionIds) && memberCipherA1.collectionIds.includes(colAId),
  JSON.stringify(memberCipherA1)
);
check(
  'member sync shows cipher B with organizationId set and collectionIds [B]',
  memberCipherB1?.organizationId === orgId && Array.isArray(memberCipherB1?.collectionIds) && memberCipherB1.collectionIds.includes(colBId),
  JSON.stringify(memberCipherB1)
);
check(
  'member sync does NOT show cipher C (ungranted collection)',
  !memberCiphersById1.has(cipherCId),
  JSON.stringify([...memberCiphersById1.keys()])
);

// --- 7. member CAN update cipher B (writable grant) ---
const memberUpdateB = await api('PUT', `/api/ciphers/${cipherBId}`, memberToken, loginCipherBody('cipher-b-edited', orgId, [colBId]));
check('member updates cipher B (writable) -> 200', memberUpdateB.status === 200, `status ${memberUpdateB.status}: ${memberUpdateB.text}`);

// --- 8. member CANNOT update cipher A (read-only grant) ---
const memberUpdateA = await api('PUT', `/api/ciphers/${cipherAId}`, memberToken, loginCipherBody('cipher-a-edited', orgId, [colAId]));
check('member updates cipher A (read-only) -> 404', memberUpdateA.status === 404, `status ${memberUpdateA.status}: ${memberUpdateA.text}`);

// --- 9. stranger (separate account) 404s on the org's collections and on cipher A ---
const strangerReg = await register(STRANGER_EMAIL, process.env.REG_CODE_2 || undefined);
if (strangerReg.status === 200) {
  const strangerLoginRes = await login(STRANGER_EMAIL);
  const strangerToken = strangerLoginRes.json.access_token;
  const strangerCollections = await api('GET', `/api/organizations/${orgId}/collections`, strangerToken);
  check('stranger cannot list org collections (404)', strangerCollections.status === 404, `status ${strangerCollections.status}`);
  const strangerCipherA = await api('GET', `/api/ciphers/${cipherAId}`, strangerToken);
  check('stranger cannot read cipher A (404)', strangerCipherA.status === 404, `status ${strangerCipherA.status}`);
  const strangerSync = await api('GET', '/api/sync', strangerToken);
  const strangerCipherIds = new Set((strangerSync.json?.ciphers || []).map((c) => c.id));
  check(
    "stranger's sync includes none of the org's ciphers",
    !strangerCipherIds.has(cipherAId) && !strangerCipherIds.has(cipherBId) && !strangerCipherIds.has(cipherCId),
    JSON.stringify([...strangerCipherIds])
  );
} else {
  console.log('skip stranger isolation check (no REG_CODE_2) — covered by unit gates');
}

// --- 10. admin creates a PERSONAL cipher, then shares it into collection B ---
const personalCipherRes = await api('POST', '/api/ciphers', adminToken, loginCipherBody('personal-to-share', null, null));
check('admin creates personal cipher', personalCipherRes.status === 200 && personalCipherRes.json?.id, `status ${personalCipherRes.status}: ${personalCipherRes.text}`);
const personalCipherId = personalCipherRes.json?.id;
check('personal cipher has no organizationId before share', personalCipherRes.json?.organizationId == null, JSON.stringify(personalCipherRes.json));

const shareRes = await api('POST', `/api/ciphers/${personalCipherId}/share`, adminToken, loginCipherBody('personal-to-share', orgId, [colBId]));
check('admin shares personal cipher into collection B', shareRes.status === 200 && shareRes.json?.organizationId === orgId, `status ${shareRes.status}: ${shareRes.text}`);

const memberSync2 = await api('GET', '/api/sync', memberToken);
const memberSharedCipher = (memberSync2.json?.ciphers || []).find((c) => c.id === personalCipherId);
check(
  'member sees the shared cipher after sync, with organizationId + collectionIds [B]',
  memberSharedCipher?.organizationId === orgId && Array.isArray(memberSharedCipher?.collectionIds) && memberSharedCipher.collectionIds.includes(colBId),
  JSON.stringify(memberSharedCipher)
);

// --- 11. delete the org; owner's next sync no longer shows the org's ciphers ---
const deleteOrgRes = await api('DELETE', `/api/organizations/${orgId}`, adminToken);
check('owner deletes the org', deleteOrgRes.status === 200, `status ${deleteOrgRes.status}: ${deleteOrgRes.text}`);

const ownerSyncAfterDelete = await api('GET', '/api/sync', adminToken);
const ownerCipherIdsAfterDelete = new Set((ownerSyncAfterDelete.json?.ciphers || []).map((c) => c.id));
check(
  "owner's sync no longer shows any of the deleted org's ciphers",
  !ownerCipherIdsAfterDelete.has(cipherAId) &&
    !ownerCipherIdsAfterDelete.has(cipherBId) &&
    !ownerCipherIdsAfterDelete.has(cipherCId) &&
    !ownerCipherIdsAfterDelete.has(personalCipherId),
  JSON.stringify([...ownerCipherIdsAfterDelete])
);

console.log(failures ? `${failures} CHECKS FAILED` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
