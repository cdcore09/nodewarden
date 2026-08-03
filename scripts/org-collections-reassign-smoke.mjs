// scripts/org-collections-reassign-smoke.mjs
// End-to-end smoke for PUT /api/ciphers/:id/collections (org cipher collection
// REASSIGNMENT with replace-semantics). Usage:
//   node scripts/org-collections-reassign-smoke.mjs <BASE_URL> <JWT_SECRET>
// NOT wired into package.json / CI — this is a manual HTTP script to run
// against a local dev server (`wrangler dev` + local D1) or the deployed test
// instance. Mirrors org-sharing-smoke.mjs's helpers verbatim (register, login,
// api, loginCipherBody, invite/accept/confirm-via-minted-token flow).
//
// Semantics under test (see task-2-brief.md / research-backend-collections.md
// §A): unlike /share (personal -> org move), this endpoint operates on a
// cipher that ALREADY has an organizationId, never changes the org, and
// REPLACES the collection set (stale cipher_collections rows are removed).
// Two independent gates apply on every call:
//   1. canWriteCipher(existing) — the caller must have a non-read-only grant
//      on (at least one of) the cipher's CURRENT collections (or be owner).
//   2. requireOrgCipherWriteAccess(..., targetCollectionIds) — every TARGET
//      collection must belong to the same org, and the caller must have a
//      non-read-only grant on each target collection (or be owner).
// Both gates key off "current" vs "target" collections, which differ once a
// reassignment has happened -- the member-access checks below deliberately
// grant against the cipher's CURRENT collection at the time of that call, not
// the collection it started in.
//
// Env:
//   REG_CODE    — registration code for member1's second-user registration
//                 (required; seed locally as documented in the Phase 2 plan
//                 doc, raw sqlite3 against .wrangler/state).
//   REG_CODE_2  — registration code for member2's registration (required for
//                 the writable-grant success check to run; skipped with a
//                 note if unset).
//   REG_CODE_3  — registration code for the second org's admin (cross-org
//                 collection check); skipped with a note if unset.
import crypto from 'node:crypto';

const [BASE, JWT_SECRET] = process.argv.slice(2);
if (!BASE || !JWT_SECRET) { console.error('usage: org-collections-reassign-smoke.mjs BASE JWT_SECRET'); process.exit(1); }
const runId = crypto.randomUUID().slice(0, 8);
const ADMIN_EMAIL = `smoke-coll-admin-${runId}@example.com`;
const MEMBER1_EMAIL = `smoke-coll-member1-${runId}@example.com`;
const MEMBER2_EMAIL = `smoke-coll-member2-${runId}@example.com`;
const ADMIN2_EMAIL = `smoke-coll-admin2-${runId}@example.com`;

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
async function inviteAcceptConfirm(orgId, adminToken, email, regCode) {
  const inviteRes = await api('POST', `/api/organizations/${orgId}/users/invite`, adminToken, { emails: [email] });
  check(`invite ${email} sends`, inviteRes.status === 200, `status ${inviteRes.status}: ${inviteRes.text}`);

  const list = await api('GET', `/api/organizations/${orgId}/users`, adminToken);
  const invitedRow = list.json?.data?.find((m) => m.email === email);
  check(`member list shows invited row for ${email}`, invitedRow && invitedRow.status === 0, JSON.stringify(list.json));
  const orgUserId = invitedRow?.id;

  const reg = await register(email, regCode);
  check(`${email} registers with seeded code`, reg.status === 200, `status ${reg.status}: ${reg.text}`);
  if (reg.status !== 200) return null;

  const loginRes = await login(email);
  check(`${email} logs in`, loginRes.status === 200 && loginRes.json?.access_token, `status ${loginRes.status}`);
  if (loginRes.status !== 200 || !loginRes.json?.access_token) return null;
  const token = loginRes.json.access_token;

  const acceptRes = await api('POST', `/api/organizations/${orgId}/users/${orgUserId}/accept`, token, {
    token: mintInviteToken(orgUserId, orgId, email),
  });
  check(`${email} accepts`, acceptRes.status === 200, `status ${acceptRes.status}: ${acceptRes.text}`);

  const confirmRes = await api('POST', `/api/organizations/${orgId}/users/${orgUserId}/confirm`, adminToken, { key: `4.wrapped-for-${email}` });
  check(`owner confirms ${email}`, confirmRes.status === 200, `status ${confirmRes.status}: ${confirmRes.text}`);

  return { token, orgUserId };
}

// --- 1. admin registers, logs in, creates org, creates collections cA/cB/cC ---
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
  name: `Smoke Collections Org ${runId}`, key: '4.smoke-wrapped', keys: { publicKey: 'org-pub', encryptedPrivateKey: '2.org-priv' },
});
check('admin creates org', orgRes.status === 200 && orgRes.json?.id, `status ${orgRes.status}: ${orgRes.text}`);
const orgId = orgRes.json.id;

const colARes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection A' });
check('create collection A', colARes.status === 200 && colARes.json?.object === 'collection', `status ${colARes.status}: ${colARes.text}`);
const colAId = colARes.json?.id;

const colBRes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection B' });
check('create collection B', colBRes.status === 200 && colBRes.json?.object === 'collection', `status ${colBRes.status}: ${colBRes.text}`);
const colBId = colBRes.json?.id;

const colCRes = await api('POST', `/api/organizations/${orgId}/collections`, adminToken, { name: 'Collection C' });
check('create collection C', colCRes.status === 200 && colCRes.json?.object === 'collection', `status ${colCRes.status}: ${colCRes.text}`);
const colCId = colCRes.json?.id;

// --- 2. admin creates an org cipher assigned to [cA] ---
const cipherRes = await api('POST', '/api/ciphers', adminToken, loginCipherBody('reassign-me', orgId, [colAId]));
check('admin creates org cipher in collection A', cipherRes.status === 200 && cipherRes.json?.id, `status ${cipherRes.status}: ${cipherRes.text}`);
const cipherId = cipherRes.json?.id;

// --- 3. admin reassigns [cA] -> [cB]; replace-semantics: cA gone, cB present ---
const reassignRes = await api('PUT', `/api/ciphers/${cipherId}/collections`, adminToken, { collectionIds: [colBId] });
check('admin reassigns cipher to collection B -> 200', reassignRes.status === 200, `status ${reassignRes.status}: ${reassignRes.text}`);

const syncAfterReassign = await api('GET', '/api/sync', adminToken);
const cipherAfterReassign = (syncAfterReassign.json?.ciphers || []).find((c) => c.id === cipherId);
check(
  'sync shows cipher.collectionIds === [B] (A removed, B present, no stale row)',
  Array.isArray(cipherAfterReassign?.collectionIds) &&
    cipherAfterReassign.collectionIds.length === 1 &&
    cipherAfterReassign.collectionIds[0] === colBId,
  JSON.stringify(cipherAfterReassign)
);

// --- 4. invite/confirm member1 with a READ-ONLY grant on the cipher's
// CURRENT collection (B); member1 attempts a reassignment -> 404
// (canWriteCipher's collection-grant gate fails on a read-only grant,
// regardless of what the target collection set would be). ---
const member1 = await inviteAcceptConfirm(orgId, adminToken, MEMBER1_EMAIL, process.env.REG_CODE);
if (member1) {
  const grantB_readOnly = await api('PUT', `/api/organizations/${orgId}/collections/${colBId}/users`, adminToken, {
    users: [{ id: member1.orgUserId, readOnly: true, hidePasswords: false }],
  });
  check('grant member1 read-only on collection B', grantB_readOnly.status === 200, `status ${grantB_readOnly.status}: ${grantB_readOnly.text}`);

  const member1Reassign = await api('PUT', `/api/ciphers/${cipherId}/collections`, member1.token, { collectionIds: [colCId] });
  check('member1 (read-only on current collection) reassign -> 404', member1Reassign.status === 404, `status ${member1Reassign.status}: ${member1Reassign.text}`);
} else {
  console.log('skip member1 read-only check (member1 registration failed — see REG_CODE note above)');
}

// --- 5. invite/confirm member2 with WRITABLE grants on both the cipher's
// current collection (B) and the target collection (C); member2 reassigns
// [B] -> [C] -> 200. ---
if (process.env.REG_CODE_2) {
  const member2 = await inviteAcceptConfirm(orgId, adminToken, MEMBER2_EMAIL, process.env.REG_CODE_2);
  if (member2) {
    const grantB_writable = await api('PUT', `/api/organizations/${orgId}/collections/${colBId}/users`, adminToken, {
      users: [{ id: member2.orgUserId, readOnly: false, hidePasswords: false }],
    });
    check('grant member2 writable on collection B (current)', grantB_writable.status === 200, `status ${grantB_writable.status}: ${grantB_writable.text}`);

    const grantC_writable = await api('PUT', `/api/organizations/${orgId}/collections/${colCId}/users`, adminToken, {
      users: [{ id: member2.orgUserId, readOnly: false, hidePasswords: false }],
    });
    check('grant member2 writable on collection C (target)', grantC_writable.status === 200, `status ${grantC_writable.status}: ${grantC_writable.text}`);

    const member2Reassign = await api('PUT', `/api/ciphers/${cipherId}/collections`, member2.token, { collectionIds: [colCId] });
    check('member2 (writable on current + target) reassign -> 200', member2Reassign.status === 200, `status ${member2Reassign.status}: ${member2Reassign.text}`);

    const syncAfterMember2 = await api('GET', '/api/sync', adminToken);
    const cipherAfterMember2 = (syncAfterMember2.json?.ciphers || []).find((c) => c.id === cipherId);
    check(
      'sync shows cipher.collectionIds === [C] after member2 reassignment',
      Array.isArray(cipherAfterMember2?.collectionIds) &&
        cipherAfterMember2.collectionIds.length === 1 &&
        cipherAfterMember2.collectionIds[0] === colCId,
      JSON.stringify(cipherAfterMember2)
    );

    // --- 5b. TASK 3 REGRESSION: plain (non-collections) PUT /api/ciphers/:id
    // update by a confirmed, non-creator org writer must not 404 on the
    // personal-folder check. Folders are a personal-vault concept keyed to
    // the folder's OWNER (admin here); handleUpdateCipher must ignore
    // folder_id entirely for org ciphers. Reproduce the pre-fix bug
    // precisely: admin creates a personal folder + a personal cipher filed
    // in it, then shares that cipher into collection C (member2 already
    // holds a writable grant there from above). Before the fix,
    // cipher.folderId (admin's personal folder) survived the share and a
    // plain edit by member2 -- who does not own admin's folder -- would
    // 404 out of verifyFolderOwnership even though member2 has a legitimate
    // writable grant on the cipher's collection. After the fix, org ciphers
    // force folderId = null and skip that check, so this must be 200.
    const folderRes = await api('POST', '/api/folders', adminToken, { name: enc('smoke-folder') });
    check('admin creates personal folder', folderRes.status === 200 && folderRes.json?.id, `status ${folderRes.status}: ${folderRes.text}`);
    const folderId = folderRes.json?.id;

    const foldered = loginCipherBody('foldered-personal', null, null);
    foldered.cipher.folderId = folderId;
    const folderedCipherRes = await api('POST', '/api/ciphers', adminToken, foldered);
    check('admin creates personal cipher filed in that folder', folderedCipherRes.status === 200 && folderedCipherRes.json?.id, `status ${folderedCipherRes.status}: ${folderedCipherRes.text}`);
    const folderedCipherId = folderedCipherRes.json?.id;

    const shareFolderedRes = await api(
      'POST',
      `/api/ciphers/${folderedCipherId}/share`,
      adminToken,
      loginCipherBody('foldered-personal', orgId, [colCId])
    );
    check(
      'admin shares foldered personal cipher into collection C (folderId carries over from the personal cipher)',
      shareFolderedRes.status === 200 && shareFolderedRes.json?.organizationId === orgId,
      `status ${shareFolderedRes.status}: ${shareFolderedRes.text}`
    );

    // Plain edit, no folderId in the body -- member2 is not the folder's
    // owner and is not the cipher's creator, only a confirmed org writer.
    const member2PlainEdit = await api(
      'PUT',
      `/api/ciphers/${folderedCipherId}`,
      member2.token,
      loginCipherBody('foldered-personal-edited-by-member2', orgId, null)
    );
    check(
      'member2 (non-creator, writable grant, no folderId sent) plain-edits the shared org cipher -> 200 (was 404)',
      member2PlainEdit.status === 200,
      `status ${member2PlainEdit.status}: ${member2PlainEdit.text}`
    );
  }
} else {
  console.log('skip member2 writable-grant check (no REG_CODE_2)');
}

// --- 6. cross-org collection id in the body -> 400 (never belongs to this org) ---
if (process.env.REG_CODE_3) {
  const admin2Reg = await register(ADMIN2_EMAIL, process.env.REG_CODE_3);
  check('admin2 registers (cross-org check)', admin2Reg.status === 200, `status ${admin2Reg.status}: ${admin2Reg.text}`);
  if (admin2Reg.status === 200) {
    const admin2Login = await login(ADMIN2_EMAIL);
    const admin2Token = admin2Login.json.access_token;
    const org2Res = await api('POST', '/api/organizations', admin2Token, {
      name: `Smoke Collections Org2 ${runId}`, key: '4.smoke-wrapped-2', keys: { publicKey: 'org2-pub', encryptedPrivateKey: '2.org2-priv' },
    });
    check('admin2 creates org2', org2Res.status === 200 && org2Res.json?.id, `status ${org2Res.status}: ${org2Res.text}`);
    const org2Id = org2Res.json?.id;

    const colXRes = await api('POST', `/api/organizations/${org2Id}/collections`, admin2Token, { name: 'Collection X (org2)' });
    check('create collection X in org2', colXRes.status === 200 && colXRes.json?.object === 'collection', `status ${colXRes.status}: ${colXRes.text}`);
    const colXId = colXRes.json?.id;

    const crossOrgReassign = await api('PUT', `/api/ciphers/${cipherId}/collections`, adminToken, { collectionIds: [colXId] });
    check('admin reassign with cross-org collection id -> 400', crossOrgReassign.status === 400, `status ${crossOrgReassign.status}: ${crossOrgReassign.text}`);
  }
} else {
  console.log('skip cross-org collection check (no REG_CODE_3)');
}

console.log(failures ? `${failures} CHECKS FAILED` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
