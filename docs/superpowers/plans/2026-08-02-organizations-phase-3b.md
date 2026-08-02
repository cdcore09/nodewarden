# Organizations Phase 3b (Org Ciphers + Sharing Enforcement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ciphers can be shared into organizations and every cipher/attachment read/write is gated by the Phase 3a `org-access.ts` chokepoint — so family members see and use exactly the org items granted to them, through the official Bitwarden clients.

**Architecture:** The chokepoint (`canReadCipher`/`canWriteCipher`) already exists and is matrix-tested (Phase 3a). This phase (1) fixes the repo so `Cipher` objects actually carry `organizationId` (the documented blocking prerequisite), (2) threads the chokepoint through the cipher and attachment handlers, (3) implements the real share endpoint, (4) merges accessible org ciphers into sync while filtering the personal vault to `organization_id IS NULL`, and (5) handles org-cipher cleanup on org delete. All edits to shared cipher/attachment files replace inline ownership checks with chokepoint calls — the security-critical logic stays in `org-access.ts`.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, `tsx --test` + the `node:sqlite` shim, wrangler.

**Required reading for every implementer:** `docs/superpowers/plans/2026-08-01-phase-1-carryforward.md` (the Phase 3b section — the definitive list) and the files named in your task. Phases 1/2/3a are on `main`.

## Global Constraints

- **Mergeable fork.** Shared files this phase modifies: `src/services/storage-cipher-repo.ts`, `src/services/storage.ts`, `src/handlers/ciphers.ts`, `src/handlers/attachments.ts`, `src/handlers/sync.ts`, `src/handlers/organizations.ts` (org-delete cipher cleanup), `src/router-authenticated.ts` (real share/details/collections routes), `src/services/backup-archive.ts`/`backup-import.ts` (referential check), `src/types/index.ts` (Cipher.organizationId), `package.json`, `scripts/`. Anything else = design deviation, stop and flag.
- **The chokepoint is the ONLY access authority.** Every cipher/attachment handler that today does `getCipherForUser(id, userId)` (a personal-only lookup that cannot find org ciphers) is converted to: load via `getCipher(id)`, then gate with `canReadCipher`/`canWriteCipher` from `src/services/org-access.ts`. Deny → `errorResponse('Cipher not found', 404)` (unauthorized == nonexistent, no existence leak). NEVER re-implement access logic inline.
- **Ownership invariant:** an org cipher has `organization_id` set AND keeps `user_id` = its creator. Personal-vault queries filter `organization_id IS NULL`. `canWriteCipher`/`canReadCipher` already encode the full rule — handlers must not add their own org checks beyond calling them.
- **Share/collection-assignment org consistency:** before linking a cipher to collections, validate every target collection's `orgId === cipher.organizationId` (no DB constraint enforces this; `addCipherToCollections` takes ids blind). Reject mismatches 400.
- **`hidePasswords` DECISION (record in carryforward):** Phase 3b keeps `hidePasswords` a CLIENT-enforced flag — the server surfaces the flag in sync/collection responses (already done in 3a) but does NOT strip password fields from cipher responses. This matches Vaultwarden's behavior and keeps the cipher response path simple. Do not add server-side password stripping.
- **`collectionName` DECISION (record in carryforward):** Phase 3b does NOT auto-create a default collection from the org-create `collectionName` field (the sole-admin creates collections explicitly). Continue to accept-and-ignore it. Do not add auto-collection logic.
- **Router placement:** the real share/details handlers replace the existing STUBS in the cipher sub-path block (they currently point at `handleGetCipher`); `/api/collections` GET replaces its hardcoded `{data: []}` stub. These are edits-in-place, not new routes below the org catch-all.
- Commit after every task; branch `feat/organizations-phase-3b` (worktree via superpowers:using-git-worktrees, from current `main`). NO Co-Authored-By or other trailers; conventional-commit style.
- Never touch `.env`/secrets. Test sweep: existing `test:orgs` files + any added this phase (wire new files into `test:orgs`).

---

### Task 1: BLOCKING PREREQUISITE — `Cipher.organizationId` through the cipher repo

Until this lands, every `Cipher` object has `organizationId === undefined` and the chokepoint treats all org ciphers as personal. This MUST be first.

**Files:** `src/services/storage-cipher-repo.ts`, `src/types/index.ts`; Test: `scripts/cipher-org-field.test.ts` (create).

**Interfaces:** Produces `Cipher.organizationId: string | null` explicitly declared; `saveCipher`/`getCipher`/`getCipherForUser`/`getAllCiphers` all round-trip it.

- [ ] **Step 1: Failing test** (`scripts/cipher-org-field.test.ts`, wired into `test:orgs`): via `createTestDb` + StorageService, seed a user, save a Cipher with `organizationId: 'org-1'`, read it back with `getCipher(id)` and assert `organizationId === 'org-1'`; save a personal cipher (`organizationId: null`) and assert it reads back null (not undefined). This fails today (organizationId dropped).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement.** In `src/types/index.ts`, add `organizationId: string | null` to the `Cipher` interface explicitly (it currently relies on the index signature — Phase 3a Task 4 flagged this). In `storage-cipher-repo.ts`: add `organization_id: string | null` to the `CipherRow` interface; add `organization_id` to `selectCipherColumns()`; in `parseCipherRow` set `organizationId: row.organization_id ?? null`; in `saveCipher` add `organization_id` to the INSERT column list, the bound values, and the `ON CONFLICT DO UPDATE SET` clause (`organization_id = excluded.organization_id`). Confirm no other cipher SELECT builds its own column list that would also need it (grep `FROM ciphers` in the repo).
- [ ] **Step 4: Run to verify pass + typecheck + full `test:orgs`.**
- [ ] **Step 5: Commit** — `fix: persist and map cipher organizationId through the cipher repo`.

---

### Task 2: Access-aware cipher queries (personal-vault filter + accessible org ciphers)

**Files:** `src/services/storage-cipher-repo.ts`, `src/services/storage.ts`; Test: `scripts/cipher-access-queries.test.ts` (create, wire into `test:orgs`).

**Interfaces:** Produces:
- `getAllCiphers(userId)` — CHANGED to return ONLY personal ciphers (`WHERE user_id = ? AND organization_id IS NULL`). (This is the personal-vault filter. Grep all callers first — `sync.ts`, backup, etc. — and confirm each wants personal-only; sync gets org ciphers separately in Task 5.)
- `getAccessibleOrgCiphers(userId)` — NEW: org ciphers the user may read. For each CONFIRMED membership: if owner, all ciphers where `organization_id = <org>`; else ciphers in collections the member is granted (join `ciphers → cipher_collections → collection_users` on the member's `org_user_id`). Returns `Cipher[]` (dedupe by cipher id across collections). CRITICAL: `cipherToResponse` reads `collectionIds` off the cipher object (confirmed: `src/handlers/ciphers.ts:97` reads `(cipher as any).collectionIds`), so each returned org cipher MUST have `collectionIds` populated — add a `getCollectionIdsForCiphers(cipherIds): Promise<Map<string,string[]>>` helper (one query grouping `cipher_collections` by cipher_id) and attach the array to each Cipher before returning. Personal ciphers keep `collectionIds: []`.

- [ ] **Step 1: Failing tests** — seed org with owner + a confirmed member; create an org cipher in collection A (member granted) and another in collection B (member NOT granted); assert `getAccessibleOrgCiphers(memberId)` returns only the collection-A cipher, `getAccessibleOrgCiphers(ownerId)` returns both; assert `getAllCiphers(memberId)` excludes org ciphers and includes the member's personal ciphers only.
- [ ] **Step 2: fail. Step 3: implement** (mirror repo conventions; the member query is the security-relevant one — it must join through `collection_users` on the member's confirmed `org_user_id`). **Step 4: pass + typecheck + test:orgs. Step 5: Commit** — `feat: add access-scoped cipher queries and personal-vault filtering`.

---

### Task 3: Thread the chokepoint through single-cipher handlers

**Files:** `src/handlers/ciphers.ts`. Gate: `tsc` + `test:orgs` (behavior proven by Task 10 smoke).

The handlers `handleGetCipher`, `handleUpdateCipher`, `handleDeleteCipher`, `handleDeleteCipherCompat`, `handlePermanentDeleteCipher`, `handleRestoreCipher`, `handlePartialUpdateCipher`, `handleArchiveCipher`, `handleUnarchiveCipher` currently do `storage.getCipherForUser(id, userId)` → 404 if null. Convert EACH:

- [ ] **Step 1:** For each read handler (GET, and the details path), replace with: `const cipher = await storage.getCipher(id); if (!cipher || !(await canReadCipher(storage, userId, cipher))) return errorResponse('Cipher not found', 404);`. For each write handler (update/delete/restore/archive/partial), use `canWriteCipher` instead. Import `canReadCipher`/`canWriteCipher` from `../services/org-access`. Preserve every handler's existing post-authorization behavior unchanged (only the load+gate changes). Where a handler both reads then writes (e.g. partial update), gate on `canWriteCipher`.
  - **`handleCreateCipher`:** if the request body sets `organizationId`, the create is an org cipher — validate: the user is a confirmed member of that org (`getOrgUserByOrgAndUser`), and every `collectionId` in the body belongs to that org (`getCollection` per id, `collection.orgId === organizationId`) and the user can write there (owner, or a non-read-only grant on that collection). Reject 400 on any mismatch, 404 if not a member. Then persist with `organization_id` set and link `addCipherToCollections`. Personal create (no organizationId) is unchanged.
- [ ] **Step 2: typecheck + test:orgs green. Step 3: Commit** — `feat: gate single-cipher handlers through the access chokepoint`.

---

### Task 4: Thread the chokepoint through bulk cipher handlers

**Files:** `src/handlers/ciphers.ts`. Gate: `tsc` + `test:orgs`.

`handleBulkDeleteCiphers`, `handleBulkRestoreCiphers`, `handleBulkArchiveCiphers`, `handleBulkUnarchiveCiphers`, `handleBulkPermanentDeleteCiphers`, `handleBulkMoveCiphers` currently operate on `user_id`-scoped id lists.

- [ ] **Step 1:** For each, load the target ciphers per-id via `storage.getCipher(id)` (NOTE: the existing `getCiphersByIds(ids, userId)` is personal-scoped by `user_id` and will NOT find org ciphers the user accesses via grant — do not use it here; use `getCipher(id)` which loads by id regardless of owner, then gate). Filter to those the user `canWriteCipher`, operate ONLY on that filtered set, and silently skip (do not 404 the whole request for) ids the user can't write — matching Bitwarden's bulk semantics. `handleBulkMoveCiphers` (move to folder) stays personal-scoped for folder moves; if it also assigns org/collections, apply the Task 6 org-consistency validation. Document the skip behavior in a code comment.
- [ ] **Step 2: typecheck + test:orgs. Step 3: Commit** — `feat: gate bulk cipher handlers through the access chokepoint`.

---

### Task 5: Org ciphers in sync + `/api/collections` GET + personal-vault filter wired

**Files:** `src/handlers/sync.ts`, `src/router-authenticated.ts` (the `/api/collections` GET stub), and a small handler for `/api/collections` (either inline or a new `handleListAllCollections` in `org-collections.ts` — if the latter, that one file is additionally in scope). Gate: `tsc` + `test:orgs`.

- [ ] **Step 1: Sync ciphers.** In `sync.ts`, the cipher list currently comes from `getAllCiphers(userId)` (now personal-only after Task 2). Merge in `getAccessibleOrgCiphers(userId)`; shape all through the existing `cipherToResponse`, ensuring org ciphers carry `organizationId` and `collectionIds` populated (use the Task 2 helper). Keep the existing sync-cache behavior (revisionDate-keyed; org cipher mutations already bump members via Task 3's create/update going through the org — but ADD: when an org cipher changes, all confirmed members' revisions must bump. If the cipher write handlers don't yet do multi-member bumps, add a `bumpOrgCipherMembers` call in the org-cipher write path — reuse `bumpAndNotifyMembers` from `org-users.ts`).
- [ ] **Step 2: `/api/collections` GET.** Replace the hardcoded `{data: [], object: 'list'}` with the user's accessible collections across all confirmed orgs (owners: all org collections; members: granted), reusing the Phase 3a `listCollectionsForMember`/`listCollections` + `collectionDetailsResponse` logic (extract a shared helper if it duplicates sync's collection logic from 3a Task 7).
- [ ] **Step 3: typecheck + test:orgs. Step 4: Commit** — `feat: merge org ciphers into sync; populate /api/collections`.

---

### Task 6: The real share endpoint

**Files:** `src/handlers/ciphers.ts` (new `handleShareCipher` + a collections-assignment handler if the client uses PUT `/collections`), `src/router-authenticated.ts` (wire `/share` to the real handler, replacing the `handleGetCipher` stub). Gate: `tsc` + `test:orgs`.

- [ ] **Step 1:** Implement `handleShareCipher(request, env, userId, cipherId)` for `POST /api/ciphers/:id/share` (and `/api/ciphers/:id/share` bulk variant if present). Bitwarden's share payload is `{ cipher: {..., organizationId}, collectionIds: [...] }`. Behavior: load the cipher via `getCipher`; require the requester `canWriteCipher` on the CURRENT cipher (they own the personal cipher being shared); validate target `organizationId` membership (confirmed) and that every `collectionId` belongs to that org AND the user can write there; then update the cipher's `organization_id` + payload, `addCipherToCollections(cipherId, collectionIds)`; org attachments follow the cipher automatically (they FK to cipher_id). Bump+notify all confirmed org members. Reject cross-org collection links 400. Wire the route to replace the stub at the `/share` sub-path.
  - Also implement the collection-reassignment path the web/clients use (`PUT /api/ciphers/:id/collections` or `POST .../collections-admin` — check what the router currently routes / what official clients send; if a `/collections` cipher sub-path is expected, add it): replace the cipher's collection set with validation identical to above.
- [ ] **Step 2: typecheck + test:orgs. Step 3: Commit** — `feat: implement cipher share and collection assignment`.

---

### Task 7: Attachment access gating

**Files:** `src/handlers/attachments.ts`. Gate: `tsc` + `test:orgs`.

- [ ] **Step 1:** Each attachment handler loads its parent cipher. Convert `handleGetAttachment`/`handlePublicDownloadAttachment` (reads) to gate on `canReadCipher`; `handleCreateAttachment`/`handleUploadAttachment`/`handleUpdateAttachmentMetadata`/`handleDeleteAttachment` (writes) on `canWriteCipher`. Load via `getCipher(cipherId)` + gate → 404 on deny, replacing any `getCipherForUser` usage. (`handlePublicUploadAttachment`/`handlePublicDownloadAttachment` use send/public-token auth, not user auth — confirm whether they touch org ciphers at all; if they operate only on sends, leave their existing auth and note it.) org attachments follow their cipher's access — no separate attachment ACL.
- [ ] **Step 2: typecheck + test:orgs. Step 3: Commit** — `feat: gate attachment handlers through the access chokepoint`.

---

### Task 8: Org-cipher cleanup on org delete

**Files:** `src/handlers/organizations.ts` (or `src/services/storage-cipher-repo.ts` + delegate). Test: `scripts/org-delete-ciphers.test.ts` (create, wire into `test:orgs`). Gate: `tsc` + `test:orgs`.

`ciphers.organization_id` has NO foreign key, so `deleteOrganization`'s cascade leaves org ciphers orphaned (organization_id pointing at a gone org).

- [ ] **Step 1: Failing test** — create an org, an org cipher (organization_id set) with an attachment row, call the org-delete path's cleanup, assert the org ciphers AND their attachments AND cipher_collections rows are gone.
- [ ] **Step 2: implement** a repo `deleteOrgCiphers(db, orgId)` (DELETE FROM ciphers WHERE organization_id = ? — attachments/cipher_collections cascade via their cipher_id FK) + StorageService delegate; call it in `handleDeleteOrganization` BEFORE `deleteOrganization` (or after — org row delete doesn't cascade to ciphers regardless; do it in the same handler, and also delete any R2 attachment blobs for those ciphers if the attachment-delete path does blob cleanup — check how `handleDeleteAttachment` removes R2 objects and mirror for bulk, or note blob orphaning as a deferred cleanup item if bulk blob deletion is out of scope). **Step 3: pass + test:orgs. Step 4: Commit** — `feat: clean up org ciphers on organization delete`.

---

### Task 9: Backup referential check + decisions recorded

**Files:** `src/services/backup-import.ts` (`validateBackupPayloadContents`), `docs/superpowers/plans/2026-08-01-phase-1-carryforward.md`. Test: extend `scripts/org-backup.test.ts`. Gate: `tsc` + `test:orgs`.

- [ ] **Step 1:** In `validateBackupPayloadContents`, add a check that every cipher's `organization_id` (when non-null) references an organization id present in the import payload — alongside the existing userIds/folderIds validation. Add a test: an import with a cipher referencing an unknown org id is rejected.
- [ ] **Step 2:** Record the `hidePasswords` (client-enforced) and `collectionName` (accept-and-ignore) DECISIONS in the carryforward doc, marking the Phase 3b items discharged. **Step 3: test:orgs + tsc. Step 4: Commit** — `feat: validate cipher org references on backup import; record phase 3b decisions`.

---

### Task 10: Deploy update + end-to-end smoke + phase gate

**Files:** `scripts/org-sharing-smoke.mjs` (create). Gate + deploy.

- [ ] **Step 1: Sharing smoke** (`scripts/org-sharing-smoke.mjs`) extending the Phase 3a collections smoke: register admin → org → confirm a member → create two collections, grant member read-only on A / writable on B → **admin creates an org cipher in collection A and one in B** (POST /api/ciphers with organizationId+collectionIds) → member syncs and sees BOTH ciphers with `organizationId` set → member can UPDATE the collection-B cipher (writable grant) → member CANNOT update the collection-A cipher (read-only → 404) → member CANNOT see a third org cipher in an ungranted collection → a stranger 404s on all → **share a personal cipher**: admin creates a personal cipher then POST /:id/share into collection B, member sees it after sync → delete the org: assert the org ciphers vanish from the owner's sync. Run against `wrangler dev` on fresh local D1 (Phase 2/3a recipe, raw sqlite3 to seed the registration code). `ALL CHECKS PASSED`/exit 0. Kill wrangler after. If a check reveals a real product bug, report it — don't paper over.
- [ ] **Step 2: Deploy** the updated Worker to `cdcore-vault-test` (`set -a && source /Users/corderocore/Documents/nodewarden/.env && set +a`; `npm run build`; `npx wrangler deploy -c wrangler.cdcore-test.toml`). Run the sharing smoke against `https://vault-test.corderocore.com` too (no email leg needed — this is cipher sharing; register the member with a code seeded via remote `wrangler d1 execute --remote`). Purge the smoke test data from the deployed D1 afterward (as Phase 2 did). NOTE: this deploy step touches the user's Cloudflare account — if run headless, the controller may hold it for the user; the local smoke is the hard gate, the remote deploy is confirmation.
- [ ] **Step 3: Full gate** — `test:orgs` green; upstream suites green; `tsc --noEmit` clean; `git diff --name-only main...HEAD` all within the allowlist.
- [ ] **Step 4: Carryforward** — mark ALL Phase 3b items discharged; note any residuals (e.g. R2 blob orphaning on org delete if deferred) for a future cleanup phase. Commit.
- [ ] **Step 5:** Push branch; PR via the user's `/create-pr`. Do NOT merge.

---

## Post-3b state

After 3b merges, organizations are feature-complete on the backend: members see and use exactly the org items granted to them, through official Bitwarden clients. The remaining phases are the NodeWarden web-vault UI (Phase 4 admin: create orgs/collections, manage members; Phase 5 member: share dialog, org filters) — optional, since official clients already drive everything.
