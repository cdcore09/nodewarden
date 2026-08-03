# Organizations Phase 4b — Org-Item Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make organization ciphers editable/manageable in the NodeWarden web vault by threading the org key into the client write path, adding a collection-reassignment endpoint, and ignoring the personal `folder_id` concept on org ciphers.

**Architecture:** Phase 4a made the *decrypt* path org-aware and left every *write* path fail-closed behind guards (org items are read-only). 4b mirrors 4a's decrypt key-selection onto the write path: the single choke point `getCipherKeys` (webapp `vault.ts`) learns to pick org-key halves vs personal-key halves per `cipher.organizationId`, fail-closed (never fall back to the personal key for an org cipher). The unwrapped-org-key map (`orgKeysCache`, already built in `App.tsx`) is threaded into `useVaultSendActions` and down into the write functions. Non-re-encrypting actions (delete/archive/move/restore) only need their read-only guard removed since the server independently authorizes each via `canWriteCipher`. A new backend `PUT /api/ciphers/:id/collections` endpoint reassigns an org cipher's collection set with replace-semantics, and `handleUpdateCipher` stops applying personal `folder_id` logic to org ciphers (which also fixes a pre-existing spurious 404 for non-creator org writers).

**Tech Stack:** TypeScript, Preact webapp (`webapp/src`), Cloudflare Worker backend (`src`), D1 (SQLite), Web Crypto (RSA-OAEP/SHA-1 + AES-CBC/HMAC), Node built-in test runner via `tsx --test`.

## Global Constraints

- **No commit/PR trailers.** No `Co-Authored-By`, no "Generated with", no AI attribution on any commit or PR (use the user's `/commit` and `/create-pr` conventions). Verbatim standing instruction.
- **Never commit** `.env`, `.dev.vars`, `.wrangler/state`, or any secret/key material; never print secrets in output.
- **Security — fail closed, never cross keys:** an org cipher must only ever be encrypted with ITS OWN org key. If the org key for a cipher's `organizationId` is not available (cache miss, unwrap failure, wrong length), the write MUST throw/abort — NEVER fall back to the personal user key or another org's key. This mirrors the decrypt path (`webapp/src/lib/vault-decrypt.ts:147-165`, which `return null`s on a missing/bad org key).
- **TypeScript baseline:** `npx tsc --noEmit -p webapp/tsconfig.json` currently reports **3 pre-existing errors** (in `backup.ts`, `backup-center.ts`, `password-security-cache.ts` — unrelated). Introduce **no new** tsc errors. Backend `npx tsc --noEmit` must stay clean.
- **Gates per task:** `npm run test:orgs` (backend org tests, currently 90/90) must stay green; `npm run test:orgs-web` (webapp crypto tests) must stay green; `npm run build` (vite) must succeed; `npm run i18n` must pass (currently 1552 keys × 10 locales, 0 errors) whenever locale files change.
- **i18n:** any user-facing string added to the webapp must use `t('key')` and be added to **all 10** locale files (`webapp/src/lib/i18n/locales/{en,es,fr,de,it,fi,ru,sv,zh-CN,zh-TW}.ts`) with the same `txt_org_`-prefixed key (registered as intentionally-English in `scripts/i18n-validate.cjs`). Non-English locales carry the English value (do not fabricate translations).
- **Web vault must match the existing design** — no new aesthetic (this plan touches logic only; no new UI screens in 4b).
- **Folder decision (approved):** `folder_id` is IGNORED on org ciphers — the web vault does not persist a personal folder for a shared item, and the server strips/ignores folder changes on org ciphers. (Phase 4b scope is EDIT/manage of *existing* org ciphers; creating a brand-new cipher directly into an org from the web vault is OUT of scope — deferred to 4c, since `VaultDraft` carries no org/collection fields.)

---

## File Structure

**Backend (`src/`)**
- `src/services/storage-collection-repo.ts` — ADD `setCipherCollections(db, cipherId, collectionIds)` (replace-semantics) next to the existing `addCipherToCollections`.
- `src/services/storage.ts` — ADD the `setCipherCollections` StorageService method + import alias, mirroring `addCipherToCollections`.
- `src/handlers/ciphers.ts` — ADD `handleUpdateCipherCollections` (the new endpoint); MODIFY `handleUpdateCipher` for the org `folder_id`-ignore fix.
- `src/router-authenticated.ts` — REGISTER `PUT /api/ciphers/:id/collections` inside the `cipherMatch` block.
- `scripts/storage-collection-repo.test.ts` — ADD unit tests for `setCipherCollections`.
- `scripts/org-collections-reassign-smoke.mjs` — NEW HTTP smoke (manual) for the endpoint, mirroring `scripts/org-sharing-smoke.mjs`.

**Webapp (`webapp/src/`)**
- `webapp/src/lib/api/vault.ts` — ADD exported pure helper `resolveCipherBaseKey`; thread an `orgKeys` map into `getCipherKeys`, `buildCipherPayload`, `createCipher`, `updateCipher`, and the two repair functions; remove the two `if (cipher.organizationId) continue;` skips (Task 6).
- `webapp/src/lib/errors.ts` (or nearest existing error module) — ADD `OrgKeyUnavailableError` (checked to surface a friendly toast).
- `webapp/src/hooks/useVaultSendActions.ts` — ADD `orgKeys` to `UseVaultSendActionsOptions`; thread it into write calls; make the post-write re-decrypt org-aware; REMOVE the 10 read-only guard calls + the two guard definitions.
- `webapp/src/App.tsx` — pass `orgKeysCache` into the `useVaultSendActions({...})` call.
- `webapp/src/lib/api/backup.ts` — ADD the 5 missing org-table count fields to `AdminBackupImportCounts`.
- `webapp/src/lib/i18n/locales/*.ts` (10 files) — ADD `txt_org_key_unavailable`.
- `scripts/vault-write-org.test.ts` — NEW webapp unit test (org-key selection + org-key field encryption + fail-closed).

---

## Task 1: `setCipherCollections` repo helper (replace-semantics)

**Files:**
- Modify: `src/services/storage-collection-repo.ts:112-120` (add sibling function)
- Modify: `src/services/storage.ts:76-77` (import alias), `src/services/storage.ts:770-776` (method)
- Test: `scripts/storage-collection-repo.test.ts`

**Interfaces:**
- Consumes: `db.prepare/bind/batch` (D1), existing `addCipherToCollections(db, cipherId, collectionIds)`, `getCipherCollectionIds(db, cipherId)`.
- Produces: `setCipherCollections(db: D1Database, cipherId: string, collectionIds: string[]): Promise<void>` — after it runs, the cipher's `cipher_collections` rows are EXACTLY `collectionIds` (deduped): rows not in the set are deleted, rows in the set are present. `StorageService.setCipherCollections(cipherId, collectionIds): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/storage-collection-repo.test.ts` (mirror the existing seed helpers in that file / `scripts/cipher-access-queries.test.ts`; if this file has no cipher/collection seed helpers yet, import the same shapes used there):

```ts
test('setCipherCollections replaces the membership set, removing stale rows', async () => {
  const db = await createTestDb();
  const storage = new StorageService(db);
  await storage.createOrganizationWithOwner(
    { id: 'o1', name: '2.n|x', publicKey: 'pub', encryptedPrivateKey: '2.p', createdAt: now, updatedAt: now },
    { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.k', createdAt: now, updatedAt: now }
  );
  await storage.createCollection({ id: 'cA', orgId: 'o1', name: '2.a|x', createdAt: now, updatedAt: now });
  await storage.createCollection({ id: 'cB', orgId: 'o1', name: '2.b|x', createdAt: now, updatedAt: now });
  await storage.createCollection({ id: 'cC', orgId: 'o1', name: '2.c|x', createdAt: now, updatedAt: now });

  // seed initial membership {cA, cB} via the additive helper
  await storage.addCipherToCollections('cipher1', ['cA', 'cB']);
  assert.deepEqual((await storage.getCipherCollectionIds('cipher1')).sort(), ['cA', 'cB']);

  // replace with {cB, cC} — cA must be removed, cC added, cB kept
  await storage.setCipherCollections('cipher1', ['cB', 'cC']);
  assert.deepEqual((await storage.getCipherCollectionIds('cipher1')).sort(), ['cB', 'cC']);

  // replace with [] — all rows removed
  await storage.setCipherCollections('cipher1', []);
  assert.deepEqual(await storage.getCipherCollectionIds('cipher1'), []);
});

test('setCipherCollections dedupes and does not duplicate existing rows', async () => {
  const db = await createTestDb();
  const storage = new StorageService(db);
  await storage.setCipherCollections('cipherX', ['cA', 'cA', 'cB']);
  assert.deepEqual((await storage.getCipherCollectionIds('cipherX')).sort(), ['cA', 'cB']);
});
```

(Reuse the file's existing `now` constant / `createTestDb` import; if absent, add `import { createTestDb } from './test-db';` and `const now = '2026-08-03T00:00:00.000Z';`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/storage-collection-repo.test.ts`
Expected: FAIL — `storage.setCipherCollections is not a function`.

- [ ] **Step 3: Add the repo helper**

In `src/services/storage-collection-repo.ts`, directly after `addCipherToCollections` (line 120):

```ts
export async function setCipherCollections(db: D1Database, cipherId: string, collectionIds: string[]): Promise<void> {
  const desired = Array.from(new Set(collectionIds.map((c) => String(c || '').trim()).filter(Boolean)));
  const stmts: D1PreparedStatement[] = [];
  if (desired.length === 0) {
    stmts.push(db.prepare('DELETE FROM cipher_collections WHERE cipher_id = ?').bind(cipherId));
  } else {
    const placeholders = desired.map(() => '?').join(',');
    stmts.push(
      db
        .prepare(`DELETE FROM cipher_collections WHERE cipher_id = ? AND collection_id NOT IN (${placeholders})`)
        .bind(cipherId, ...desired)
    );
    for (const collectionId of desired) {
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO cipher_collections(cipher_id, collection_id) VALUES(?,?)')
          .bind(cipherId, collectionId)
      );
    }
  }
  await db.batch(stmts);
}
```

- [ ] **Step 4: Wire it through StorageService**

In `src/services/storage.ts`, add to the import block alongside `addCipherToCollections as addStoredCipherToCollections` (near line 76):

```ts
  setCipherCollections as setStoredCipherCollections,
```

And add the method next to `addCipherToCollections` (near line 770):

```ts
  async setCipherCollections(cipherId: string, collectionIds: string[]): Promise<void> {
    await setStoredCipherCollections(this.db, cipherId, collectionIds);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test scripts/storage-collection-repo.test.ts`
Expected: PASS (both new tests + all pre-existing tests in the file).

- [ ] **Step 6: Full backend gate + commit**

Run: `npm run test:orgs` (expect 90 + 2 new = green) and `npx tsc --noEmit` (clean).

```bash
git add src/services/storage-collection-repo.ts src/services/storage.ts scripts/storage-collection-repo.test.ts
git commit -m "feat(org): add setCipherCollections replace-semantics repo helper"
```

---

## Task 2: `PUT /api/ciphers/:id/collections` endpoint

**Files:**
- Modify: `src/handlers/ciphers.ts` (add `handleUpdateCipherCollections`, exported)
- Modify: `src/router-authenticated.ts:367` (register route inside `cipherMatch` block)
- Create: `scripts/org-collections-reassign-smoke.mjs` (manual HTTP smoke)

**Interfaces:**
- Consumes: `StorageService.getCipher`, `canWriteCipher` (from `src/services/org-access.ts`), `requireOrgCipherWriteAccess` (`src/handlers/ciphers.ts:977-1014`), `StorageService.setCipherCollections` (Task 1), `StorageService.saveCipher`, `notifyOrgCipherChange` (`src/handlers/ciphers.ts:99-112`), `readActingDeviceIdentifier`, `readCipherProp`, `errorResponse`, `jsonResponse`, `cipherToResponse`, `cipherResponseOptionsForRequest`, `writeCipherAudit`, `updateRevisionDate`, `notifyVaultSyncForRequest`.
- Produces: `handleUpdateCipherCollections(request: Request, env: Env, userId: string, id: string): Promise<Response>` — reassigns an ALREADY-ORG cipher's collection set (replace-semantics); returns the updated cipher response.

**Semantics (from research `research-backend-collections.md` §A):** unlike `/share` (which requires a personal→org move and rejects an existing `organizationId`), this endpoint operates on a cipher that ALREADY has an `organizationId`, does NOT change the org, and REPLACES the collection set. First-gate on `canWriteCipher(existing)`, then validate the new target collection set with `requireOrgCipherWriteAccess(storage, userId, existing.organizationId, newCollectionIds)`.

- [ ] **Step 1: Add the handler**

In `src/handlers/ciphers.ts`, add after `handleShareCipher` (after line ~1437). Read `collectionIds` from the **top-level** body (matching the share pattern), never from inside a nested `cipher`:

```ts
// PUT /api/ciphers/:id/collections
// Replace the set of collections an EXISTING org cipher belongs to. Unlike
// /share (personal -> org move), the cipher already belongs to an org here and
// its organizationId never changes; only cipher_collections membership is
// rewritten (replace-semantics, so stale rows are removed).
export async function handleUpdateCipherCollections(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const existingCipher = await storage.getCipher(id);

  // Must be able to write the cipher as it stands today (owner or non-read-only grant).
  if (!existingCipher || !(await canWriteCipher(storage, userId, existingCipher))) {
    return errorResponse('Cipher not found', 404);
  }
  // This endpoint only makes sense for org ciphers; a personal cipher has no collections.
  if (!existingCipher.organizationId) {
    return errorResponse('Cipher is not in an organization', 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  const rawCollectionIds = readCipherProp<string[] | null>(body, ['collectionIds', 'CollectionIds']);
  const requestedCollectionIds = Array.isArray(rawCollectionIds.value)
    ? Array.from(new Set(rawCollectionIds.value.map((cid) => String(cid || '').trim()).filter(Boolean)))
    : [];

  // Confirmed membership + every target collection belongs to THIS org + writer can write each.
  const access = await requireOrgCipherWriteAccess(storage, userId, existingCipher.organizationId, requestedCollectionIds);
  if ('errorResponse' in access) return access.errorResponse;

  // Rewrite junction rows (replace-semantics) and keep the cipher's own
  // collectionIds field (stored in its data blob) in sync so getCipher doesn't drift.
  await storage.setCipherCollections(existingCipher.id, requestedCollectionIds);
  const updatedCipher: Cipher = { ...existingCipher, collectionIds: requestedCollectionIds };
  await storage.saveCipher(updatedCipher);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  await notifyOrgCipherChange(env, storage, [existingCipher.organizationId], readActingDeviceIdentifier(request));

  await writeCipherAudit(storage, request, userId, 'cipher.collections', {
    id: updatedCipher.id,
    organizationId: existingCipher.organizationId,
    collectionIds: requestedCollectionIds,
  });

  const attachments = await storage.getAttachmentsByCipher(updatedCipher.id);
  return jsonResponse(cipherToResponse(updatedCipher, attachments, cipherResponseOptionsForRequest(request)));
}
```

(Verify the exact names `canWriteCipher`, `requireOrgCipherWriteAccess`, `readCipherProp`, `writeCipherAudit`, `notifyVaultSyncForRequest`, `readActingDeviceIdentifier`, `cipherToResponse`, `cipherResponseOptionsForRequest` are already imported/defined in `ciphers.ts` — per research they all are. If `writeCipherAudit`'s action-string enum is a closed union, use an existing value like `'cipher.share'` rather than inventing `'cipher.collections'`; check its type and adjust.)

- [ ] **Step 2: Register the route**

In `src/router-authenticated.ts`, inside the `if (cipherMatch) { ... }` block, immediately after the `/share` line (line 367):

```ts
if (subPath === '/collections' && method === 'PUT') return handleUpdateCipherCollections(request, env, userId, cipherId);
```

Add `handleUpdateCipherCollections` to the import from `./handlers/ciphers`.

- [ ] **Step 3: Verify it compiles + backend tests still pass**

Run: `npx tsc --noEmit` (clean) and `npm run test:orgs` (90/90 unchanged — no node:test HTTP harness exercises this route yet; storage-layer coverage came in Task 1).

- [ ] **Step 4: Add the HTTP smoke script**

Create `scripts/org-collections-reassign-smoke.mjs` mirroring `scripts/org-sharing-smoke.mjs`'s helpers verbatim (`register`, `login`, `api`, `loginCipherBody`, org/collection/member setup). The flow:
1. Register admin, create org, create collections `cA`, `cB`.
2. Create an org cipher assigned to `[cA]` (via `POST /api/ciphers` with top-level `collectionIds:[cA]`).
3. `PUT /api/ciphers/:id/collections` with `{ collectionIds: [cB] }` → assert 200 and that a subsequent `GET /api/sync` shows the cipher's `collectionIds === [cB]` (cA removed, cB present — proves replace-semantics + no stale row).
4. Invite + confirm a second member with a READ-ONLY grant on `cA`; `PUT .../collections` as that member → assert 404 (read-only can't write). A member with a WRITABLE grant → assert 200.
5. A cross-org collection id in the body → assert 400.

Document the run command at the top of the file: `node scripts/org-collections-reassign-smoke.mjs <BASE_URL> <JWT_SECRET>` (NOT wired into `package.json`; run manually against a dev server or the deployed test instance during the browser/integration phase).

- [ ] **Step 5: Commit**

```bash
git add src/handlers/ciphers.ts src/router-authenticated.ts scripts/org-collections-reassign-smoke.mjs
git commit -m "feat(org): add PUT /api/ciphers/:id/collections reassignment endpoint"
```

---

## Task 3: Ignore `folder_id` on org ciphers (+ fix non-creator 404)

**Files:**
- Modify: `src/handlers/ciphers.ts:1201-1254` (`handleUpdateCipher`)
- Test: `scripts/cipher-org-field.test.ts` (or the nearest existing handler-adjacent storage test) — verify at the storage/`saveCipher` level that an org cipher persists `folder_id = null`.

**Interfaces:**
- Consumes: `handleUpdateCipher`'s existing merge (`...existingCipher`, `...cipherDataWithoutFlags`), `verifyFolderOwnership`.
- Produces: after update, an org cipher's `folder_id` is always `null` (never the creator's personal folder), and a non-creator org writer no longer gets a spurious `404 Folder not found`.

**Bug (research §B):** when the client omits `folderId`, `cipher.folderId` stays `existingCipher.folderId` (the ORIGINAL CREATOR's folder). `verifyFolderOwnership(storage, cipher.folderId, actingUserId)` then 404s any non-creator org writer. Fix: for org ciphers, force `folderId = null` and skip the ownership check entirely (folders are a personal-vault concept; org ciphers use collections).

- [ ] **Step 1: Write the failing test**

In `scripts/cipher-org-field.test.ts` add a test that drives the fix at the level this suite operates (storage/`saveCipher` round-trip — this suite does not call handlers over HTTP, so assert the invariant the handler must guarantee):

```ts
test('org cipher persists with folder_id null (folders are personal-only)', async () => {
  const db = await createTestDb();
  const storage = new StorageService(db);
  // an org cipher that (incorrectly) arrived carrying a folderId must be stored folderless
  const orgCipher = { /* makeCipher shape */ id: 'oc1', userId: 'u1', organizationId: 'o1',
    type: 1, folderId: 'someones-personal-folder', name: 'n', notes: null, favorite: false,
    login: null, card: null, identity: null, secureNote: null, sshKey: null, fields: null,
    passwordHistory: null, reprompt: 0, key: null, createdAt: now, updatedAt: now,
    archivedAt: null, deletedAt: null };
  await storage.saveCipher({ ...orgCipher, folderId: null }); // handler will null it before saveCipher
  const back = await storage.getCipher('oc1');
  assert.equal(back?.organizationId, 'o1');
  assert.equal(back?.folderId ?? null, null);
});
```

(This asserts the storage layer honors a null folder for org ciphers. The behavioral fix is in the handler; the HTTP-level assertion — non-creator writer no longer 404s — is added to the Task 2 smoke script in Step 4 below, since there is no node:test HTTP harness.)

- [ ] **Step 2: Run test to verify it passes-or-fails appropriately**

Run: `npx tsx --test scripts/cipher-org-field.test.ts`
Expected: this storage-level assertion likely PASSES already (saveCipher honors null). Its purpose is a regression guard; the real change is the handler logic in Step 3. If it passes, proceed — the handler fix is validated by the smoke script.

- [ ] **Step 3: Fix the handler**

In `src/handlers/ciphers.ts` `handleUpdateCipher`, after the `cipher` object is assembled (after line ~1206 where `organizationId` is forced), and BEFORE the folder-ownership check (line ~1215), add an org branch. Replace the folder block (lines 1215-1217 and 1250-1254) so that org ciphers bypass personal-folder handling:

```ts
  if (cipher.organizationId) {
    // Org ciphers have no personal-folder concept (one folder_id column tied to
    // the creator's user_id can't be shared coherently). Never carry the
    // creator's folder onto an org cipher, and never run the personal
    // verifyFolderOwnership check against a non-creator org writer (that check
    // spuriously 404s a legitimate writer who isn't the creator).
    cipher.folderId = null;
  } else {
    if (incomingFolderId.present) {
      cipher.folderId = normalizeOptionalId(incomingFolderId.value);
    }
    if (cipher.folderId) {
      const folderOk = await verifyFolderOwnership(storage, cipher.folderId, userId);
      if (!folderOk) return errorResponse('Folder not found', 404);
    }
  }
```

(Adjust to the exact surrounding structure — the key invariant: org ciphers → `folderId = null` + no `verifyFolderOwnership`; personal ciphers → unchanged existing behavior.)

- [ ] **Step 4: Extend the Task 2 smoke to prove the 404 fix**

In `scripts/org-collections-reassign-smoke.mjs` (or a shared org smoke), add: a confirmed non-owner member with a WRITABLE grant does `PUT /api/ciphers/:id` (a plain edit) on an org cipher WITHOUT sending `folderId` → assert **200** (previously 404). This is the regression proof for the folder bug.

- [ ] **Step 5: Gate + commit**

Run: `npm run test:orgs` (green) + `npx tsc --noEmit` (clean).

```bash
git add src/handlers/ciphers.ts scripts/cipher-org-field.test.ts scripts/org-collections-reassign-smoke.mjs
git commit -m "fix(org): ignore folder_id on org ciphers and fix non-creator update 404"
```

---

## Task 4: Thread the org key into the webapp write path (crypto core)

**Files:**
- Create/Modify: `webapp/src/lib/errors.ts` (or nearest error module) — add `OrgKeyUnavailableError`.
- Modify: `webapp/src/lib/api/vault.ts` — add exported `resolveCipherBaseKey`; add `orgKeys` param to `getCipherKeys`, `buildCipherPayload`, `createCipher`, `updateCipher`.
- Test: `scripts/vault-write-org.test.ts` (new).

**Interfaces:**
- Consumes: `orgKeyHalves` (`webapp/src/lib/org-crypto.ts:154`), `base64ToBytes`, `decryptBw`, `encryptBw` (`webapp/src/lib/crypto`), `Cipher`/`SessionState`/`VaultDraft` types.
- Produces:
  - `resolveCipherBaseKey(cipher: Cipher | null, personalEnc: Uint8Array, personalMac: Uint8Array, orgKeys: Record<string, Uint8Array> | undefined): { enc: Uint8Array; mac: Uint8Array }` — personal key for personal ciphers; org-key halves for org ciphers; **throws `OrgKeyUnavailableError`** if an org cipher's key is missing/wrong-length (never falls back).
  - `class OrgKeyUnavailableError extends Error` with `orgId: string`.
  - `getCipherKeys(cipher, personalEnc, personalMac, orgKeys)` — now selects the base key via `resolveCipherBaseKey` before unwrapping `cipher.key`.
  - `buildCipherPayload(session, draft, cipher, orgKeys)`, `createCipher(authedFetch, session, draft, orgKeys, extraPayload?)`, `updateCipher(authedFetch, session, cipher, draft, orgKeys, extraPayload?, options?)` — all take the `orgKeys` map.

- [ ] **Step 1: Write the failing test**

Create `scripts/vault-write-org.test.ts` (mirror `scripts/org-crypto.test.ts`'s import style). It validates the security-critical selection + that org fields encrypt under the ORG key, and fail-closed:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/vault-write-org.test.ts`
Expected: FAIL — `resolveCipherBaseKey`/`OrgKeyUnavailableError` not exported.

- [ ] **Step 3: Implement the error + helper**

Add `OrgKeyUnavailableError` (in `webapp/src/lib/errors.ts` if it exists, else define+export it at the top of `vault.ts`):

```ts
export class OrgKeyUnavailableError extends Error {
  constructor(public orgId: string) {
    super(`Organization key unavailable for org ${orgId}`);
    this.name = 'OrgKeyUnavailableError';
  }
}
```

Add to `webapp/src/lib/api/vault.ts` (import `orgKeyHalves` from `../org-crypto`):

```ts
// SECURITY: mirrors the decrypt-path selection in vault-decrypt.ts:147-165.
// Personal cipher -> personal key. Org cipher -> that org's key halves. If the
// org key isn't available, THROW — never fall back to the personal key (that
// would silently corrupt the shared cipher for the whole org).
export function resolveCipherBaseKey(
  cipher: Cipher | null,
  personalEnc: Uint8Array,
  personalMac: Uint8Array,
  orgKeys: Record<string, Uint8Array> | undefined
): { enc: Uint8Array; mac: Uint8Array } {
  const orgId = cipher?.organizationId || null;
  if (!orgId) return { enc: personalEnc, mac: personalMac };
  const orgKey = orgKeys?.[orgId];
  if (!orgKey) throw new OrgKeyUnavailableError(orgId);
  const halves = orgKeyHalves(orgKey); // throws on wrong length
  return { enc: halves.enc, mac: halves.mac };
}
```

- [ ] **Step 4: Thread it through `getCipherKeys` and callers**

Change `getCipherKeys` (vault.ts:907) to take the base key from the resolver instead of raw personal params:

```ts
async function getCipherKeys(
  cipher: Cipher | null,
  personalEnc: Uint8Array,
  personalMac: Uint8Array,
  orgKeys: Record<string, Uint8Array> | undefined
): Promise<{ enc: Uint8Array; mac: Uint8Array; key: string | null }> {
  const base = resolveCipherBaseKey(cipher, personalEnc, personalMac, orgKeys); // throws if org key missing
  if (cipher?.key) {
    try {
      const raw = await decryptBw(cipher.key, base.enc, base.mac);
      if (raw.length >= 64) return { enc: raw.slice(0, 32), mac: raw.slice(32, 64), key: cipher.key };
    } catch {
      // fall through to the base (org-or-personal) key — NOT the personal key for an org cipher
    }
  }
  return { enc: base.enc, mac: base.mac, key: null };
}
```

Update `buildCipherPayload` (vault.ts:1276) to accept and forward `orgKeys`:

```ts
async function buildCipherPayload(
  session: SessionState,
  draft: VaultDraft,
  cipher: Cipher | null,
  orgKeys: Record<string, Uint8Array> | undefined
): Promise<Record<string, unknown>> {
  if (!session.symEncKey || !session.symMacKey) throw new Error('Vault key unavailable');
  const personalEnc = base64ToBytes(session.symEncKey);
  const personalMac = base64ToBytes(session.symMacKey);
  const keys = await getCipherKeys(cipher, personalEnc, personalMac, orgKeys);
  // ...rest unchanged (every field already encrypts with keys.enc/keys.mac)...
```

Update `createCipher` (vault.ts:1446) and `updateCipher` (vault.ts:1464) signatures to take `orgKeys` and pass it to `buildCipherPayload`. For `buildCipherImportPayload` (vault.ts:1442, always `cipher: null`), pass `undefined` for `orgKeys` (imports are personal-only) — a null cipher resolves to the personal key regardless.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test scripts/vault-write-org.test.ts` → PASS. Then `npm run test:orgs-web` (existing org-crypto tests still green).

- [ ] **Step 6: Compile check**

Run: `npx tsc --noEmit -p webapp/tsconfig.json`. Expect the 3 baseline errors PLUS temporary errors at the `createCipher`/`updateCipher`/`buildCipherPayload` call sites (the callers in `useVaultSendActions.ts` / repair functions don't pass `orgKeys` yet) — those are fixed in Tasks 5 and 6. Do NOT change callers here beyond `vault.ts`'s own internal calls (repair functions are Task 6; the hook is Task 5). It is acceptable for this task's tsc to show the new call-site arity errors that Tasks 5–6 resolve; note them in the report. (If the reviewer prefers a strictly-green intermediate, temporarily default the new param to `undefined` in the signatures — but prefer required params so the callers are forced to pass keys.)

- [ ] **Step 7: Commit**

```bash
git add webapp/src/lib/api/vault.ts webapp/src/lib/errors.ts scripts/vault-write-org.test.ts
git commit -m "feat(webapp): thread org key into cipher write path (fail-closed key selection)"
```

---

## Task 5: Wire org keys into `useVaultSendActions` and lift the read-only guards

**Files:**
- Modify: `webapp/src/hooks/useVaultSendActions.ts` — add `orgKeys` option; pass to `createCipher`/`updateCipher`; make post-write re-decrypt org-aware; REMOVE the 10 guard calls + 2 guard defs.
- Modify: `webapp/src/App.tsx:1911-1956` — pass `orgKeys: orgKeysCache` into `useVaultSendActions({...})`.
- Modify: `webapp/src/lib/i18n/locales/*.ts` (10) — add `txt_org_key_unavailable`.

**Interfaces:**
- Consumes: `orgKeysCache` (`App.tsx:273`, `Record<string, Uint8Array>`), `updateCipher`/`createCipher` (Task 4, now require `orgKeys`), `OrgKeyUnavailableError` (Task 4), the decrypt entry the hook uses post-write.
- Produces: `UseVaultSendActionsOptions.orgKeys: Record<string, Uint8Array>`; org ciphers are editable/deletable/movable from the vault UI; a fail-closed toast (`txt_org_key_unavailable`) when the org key isn't ready.

**Guard removal rationale (research §C):** the 10 guards enforced a *product* decision (read-only), not crypto safety. Delete/archive/unarchive/move/restore/bulk-* are thin `PUT/DELETE by id` wrappers that never re-encrypt — safe to unguard once the server authorizes each cipher (it does, via `canWriteCipher`) and the server ignores `folder_id` on org ciphers (Task 3, makes `bulkMove` a safe no-op for org items). Only `updateVaultItem`/`createVaultItem` re-encrypt, and `updateVaultItem` is now covered by Task 4's key fix. (`createVaultItem` stays personal-only — creating into an org is out of 4b scope; its draft has no org fields, so it always produces a personal cipher and needs no guard.)

- [ ] **Step 1: Add the i18n key (all 10 locales)**

Add to each `webapp/src/lib/i18n/locales/*.ts` (English value in every file, per the `txt_org_` intentionally-English convention):

```ts
  "txt_org_key_unavailable": "Organization key isn't ready yet. Wait for sync to finish, then try again.",
```

Run: `npm run i18n` → must pass (parity across 10 locales, 1553 keys).

- [ ] **Step 2: Add `orgKeys` to the options + thread into write calls**

In `webapp/src/hooks/useVaultSendActions.ts`:
- Add to `UseVaultSendActionsOptions` (near line 61): `orgKeys: Record<string, Uint8Array>;`
- Destructure `orgKeys` from options in the hook body.
- Pass `orgKeys` to `updateCipher(authedFetch, session, cipher, draft, orgKeys)` (line ~614) and `createCipher(authedFetch, session, draft, orgKeys)` (createVaultItem path). For `createVaultItem`, `orgKeys` is harmless (a personal draft resolves to the personal key).

- [ ] **Step 3: Make the post-write re-decrypt org-aware**

Find the post-write local decrypt (`decryptAndPatch(finalCipher)` in `updateVaultItem`, and any equivalent in create/archive paths) that re-decrypts the server response. It currently uses the personal key only — for an org cipher that would render garbage/null until the next full sync. Pass `orgKeys` into that decrypt call so the just-written org cipher displays correctly immediately. (Trace the exact decrypt helper the hook calls — it should accept the same `orgKeys` map the 4a decrypt path uses, e.g. via the `decryptVaultCore`/single-cipher decrypt used elsewhere in `App.tsx`; if the hook's decrypt helper has no org-key param, add one mirroring `vault-decrypt.ts:147-165`.)

- [ ] **Step 4: Remove the 10 guard calls + 2 guard definitions**

Remove the `requireNotOrgCipher`/`requireNoOrgCiphersById` definitions (lines 322-336) and every call site (the `try { requireX(...) } catch { onNotify(...); throw; }` blocks) at lines 585, 667, 707, 735, 763, 788, 813, 837, 954, 978. Wrap the `updateVaultItem`/`createVaultItem` encryption in a `try/catch` that surfaces `OrgKeyUnavailableError` as the `txt_org_key_unavailable` toast (fail-closed UX, no corruption):

```ts
try {
  await updateCipher(authedFetch, session, cipher, draft, orgKeys);
} catch (err) {
  if (err instanceof OrgKeyUnavailableError) {
    onNotify?.('error', t('txt_org_key_unavailable'));
    // revert optimistic patch here (mirror the existing failure path)
  }
  throw err;
}
```

(The `txt_org_item_readonly` key is now unused — leave it in the locale files to avoid 10-file churn; note it as a deferred cleanup. `i18n-validate` does not flag unused keys.)

- [ ] **Step 5: Wire `orgKeysCache` in App.tsx**

In `webapp/src/App.tsx`, the `useVaultSendActions({...})` call (lines 1911-1956): add `orgKeys: orgKeysCache,` to the options object (the state already exists at line 273 and is built at 1336-1381).

- [ ] **Step 6: Gate**

Run: `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3 only — the Task 4 call-site errors for the hook are now resolved), `npm run test:orgs-web` (green), `npm run build` (vite clean), `npm run i18n` (green).

- [ ] **Step 7: Commit**

```bash
git add webapp/src/hooks/useVaultSendActions.ts webapp/src/App.tsx webapp/src/lib/i18n/locales/
git commit -m "feat(webapp): make org items writable in the vault; lift read-only guards"
```

---

## Task 6: Re-enable the auto-repair paths for org ciphers

**Files:**
- Modify: `webapp/src/lib/api/vault.ts` — `repairCipherUriChecksums` (1007-1070) and `repairCipherKeyMismatches` (1242-1274): remove the `if (cipher.organizationId) continue;` skips (lines 1025, 1259) and thread `orgKeys` through.
- Modify: the callers of these repair functions (grep for `repairCipherUriChecksums(` / `repairCipherKeyMismatches(`) to pass `orgKeys`.

**Interfaces:**
- Consumes: `resolveCipherBaseKey` (Task 4), `updateCipher` (now org-aware), `orgKeys` map.
- Produces: both repair passes handle org ciphers using the org key (fail-closed — skip a cipher whose org key is unavailable rather than repairing it with the personal key).

- [ ] **Step 1: Write the failing test**

Add to `scripts/vault-write-org.test.ts`: a test asserting `repairCipherUriChecksums` uses org-key halves for an org cipher's URI re-checksum (construct an org login cipher with a URI needing a checksum, a known org key, and assert the produced/updated URI checksum matches one computed with the ORG mac key, not the personal mac key). If `repairCipherUriChecksums` isn't directly exportable/testable in isolation, assert the smaller invariant via `resolveCipherBaseKey` already covered in Task 4 and instead cover repair end-to-end in the browser smoke — but prefer exposing enough to unit-test the org-mac path here. (Reviewer note: fail-closed behavior — an org cipher with a missing org key must be SKIPPED by the repair loop, never repaired with the personal key.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test scripts/vault-write-org.test.ts` → FAIL (skip still in place / no org param).

- [ ] **Step 3: Thread org keys + remove the skips**

In `repairCipherUriChecksums`: add an `orgKeys` param; replace the personal-key derivation (`userEnc`/`userMac` at lines 1016-1017) usage with `resolveCipherBaseKey(cipher, personalEnc, personalMac, orgKeys)` per-cipher, wrapped so an `OrgKeyUnavailableError` `continue`s (skips that cipher, fail-closed) rather than throwing out of the loop. Remove the `if (cipher.organizationId) continue;` at line 1025.

In `repairCipherKeyMismatches`: add an `orgKeys` param; remove the `if (cipher.organizationId) continue;` at line 1259; pass `orgKeys` to the `updateCipher(...)` call (line 1262) and to `hasItemKeyFieldMismatch` (make it org-aware via `resolveCipherBaseKey`, skipping — treating as "no mismatch" / `continue` — when the org key is unavailable).

Update all callers of both functions to pass `orgKeys` (grep for call sites — likely in `App.tsx`/vault-sync wiring; pass `orgKeysCache`).

- [ ] **Step 4: Run to verify it passes + full gate**

Run: `npx tsx --test scripts/vault-write-org.test.ts` (green), `npm run test:orgs-web` (green), `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3), `npm run build` (clean).

- [ ] **Step 5: Commit**

```bash
git add webapp/src/lib/api/vault.ts webapp/src/App.tsx scripts/vault-write-org.test.ts
git commit -m "feat(webapp): re-enable org-cipher URI/key auto-repair with org keys"
```

---

## Task 7: Sync `AdminBackupImportCounts` type (cleanup)

**Files:**
- Modify: `webapp/src/lib/api/backup.ts:101-111`

**Interfaces:**
- Produces: `AdminBackupImportCounts` includes the 5 org-table optional count fields the server already returns.

- [ ] **Step 1: Add the fields**

In `webapp/src/lib/api/backup.ts`, extend the interface (lines 101-111):

```ts
export interface AdminBackupImportCounts {
  config: number;
  users: number;
  domainSettings?: number;
  userRevisions: number;
  webauthnCredentials?: number;
  folders: number;
  ciphers: number;
  attachments: number;
  attachmentFiles: number;
  organizations?: number;
  organizationUsers?: number;
  collections?: number;
  collectionUsers?: number;
  cipherCollections?: number;
}
```

(Match the server's actual JSON key casing — verify against `src/services/backup-import.ts` response construction; if the server emits snake_case keys like `organization_users`, use those exact key names as the optional field names instead of camelCase. Adjust to the real wire shape.)

- [ ] **Step 2: Gate + commit**

Run: `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3 unchanged — this is additive/optional so no consumer breaks), `npm run build` (clean).

```bash
git add webapp/src/lib/api/backup.ts
git commit -m "chore(webapp): type org-table counts in AdminBackupImportCounts"
```

---

## Self-Review

**1. Spec/carryforward coverage:**
- Carryforward 4b req (1) "thread the org key into the write path (getCipherKeys)" → Task 4. ✓
- (2) "remove the requireNotOrgCipher/requireNoOrgCiphersById guards" → Task 5. ✓
- (3) "re-enable repairCipherUriChecksums/repairCipherKeyMismatches for org ciphers" → Task 6. ✓
- "PUT /api/ciphers/:id/collections reassignment endpoint (replace-semantics, setCipherCollections helper, org-consistency + write-permission validation)" → Tasks 1+2. ✓
- "folder_id ignore on org ciphers + non-creator verifyFolderOwnership 404 fix" → Task 3. ✓
- "AdminBackupImportCounts missing 5 org-table count fields" → Task 7. ✓
- OUT of scope (documented): creating a new cipher directly into an org from the web vault (VaultDraft has no org/collection fields); Members tab; Collections CRUD UI + access matrix — all deferred to 4c per the approved scope split.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Each code step carries real code. Two intentional "verify the exact name/shape against the file" notes (writeCipherAudit action enum in Task 2; server JSON key casing in Task 7) are verification instructions, not placeholders — the implementer confirms the exact token from the named file.

**3. Type consistency:** `resolveCipherBaseKey`/`OrgKeyUnavailableError`/`getCipherKeys(cipher, personalEnc, personalMac, orgKeys)` signatures are identical across Tasks 4/5/6. `setCipherCollections(db, cipherId, collectionIds)` / `StorageService.setCipherCollections(cipherId, collectionIds)` identical across Tasks 1/2. `orgKeys: Record<string, Uint8Array>` is the same shape as `App.tsx`'s `orgKeysCache` (state line 273) everywhere it's threaded.

**Ordering dependency:** Backend Tasks 1→2→3 are independent of webapp Tasks 4→5→6→7, but within webapp, Task 4 (key fix) MUST land before Task 5 (guard removal) — removing a guard without the key fix reintroduces the corruption bug. Task 6 depends on Task 4's `resolveCipherBaseKey`. Recommended execution order: 1, 2, 3, 4, 5, 6, 7.

**Post-implementation verification (not a task — the deploy/browser-smoke gate, run by the controller after review):** deploy to `cdcore-vault-test`, then in the web vault: (a) edit an existing org item and confirm it persists + re-displays decrypted (proves the org-key write + org-aware post-write decrypt); (b) verify D1 shows the edited cipher's fields re-encrypted under the org key (still type-2 enc strings, decryptable with the org key); (c) reassign its collections via the UI/endpoint and confirm replace-semantics (no stale rows); (d) confirm a personal item still edits normally (no regression). Remember the PWA service-worker/app-shell cache must be cleared to load a fresh bundle after redeploy.
