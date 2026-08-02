# Organizations Phase 3a (Collections + Grants + Access-Control Chokepoint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can create/manage collections and grant per-member access, the server exposes collections in sync, and the `org-access.ts` access-control chokepoint exists and is exhaustively unit-tested — all without yet touching the live cipher handlers (that is Phase 3b).

**Architecture:** Additive per the approved spec (`docs/superpowers/specs/2026-08-01-organizations-design.md`). The collection tables (`collections`, `collection_users`, `cipher_collections`) already exist from Phase 1's `0002` migration — Phase 3a is new logic on existing schema, plus one small migration (`0003`) adding `invites.org_user_id` to discharge the Phase 2 invite-code-linkage carryforward. The security core (`canRead`/`canWrite`) is built and tested in isolation here against synthetic org ciphers/collections/grants in the `node:sqlite` shim; Phase 3b threads it into `ciphers.ts`/`attachments.ts`.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, `tsx --test` + the `node:sqlite` D1 shim, wrangler.

**Required reading for every implementer:** `docs/superpowers/plans/2026-08-01-phase-1-carryforward.md` and the files named in your task. Phase 1 and 2 code is on `main`.

## Global Constraints

- **Mergeable fork.** New files preferred. Shared files this phase may modify: `src/types/index.ts` (append), `src/handlers/org-shapes.ts` (append), `src/handlers/sync.ts` (the `collections: []` line + collections fetch), `src/router-authenticated.ts` (register routes above the catch-all stub), `src/services/storage.ts` (delegates), `src/services/storage-schema.ts` + `migrations/` (the `0003` invite column), `src/services/storage.ts` STORAGE_SCHEMA_VERSION bump, `src/handlers/org-users.ts` + `src/services/storage-org-repo.ts`/`storage-admin-repo.ts` (invite-linkage), `package.json` (test wiring), `scripts/`. Anything else = design deviation, stop and flag.
- **Router placement (carryforward, MANDATORY):** every new route registered ABOVE the `/api/organizations` catch-all stub in `src/router-authenticated.ts` (warning comment marks it). A route below is silently swallowed.
- **Owner-gate + isolation:** collection management endpoints (create/list/get/update/delete/grants) go through the Phase 1 `getOwnedOrg` chokepoint — confirmed owner only, unauthorized == nonexistent == `errorResponse('Organization not found', 404)`. A collection whose `org_id` differs from the gated org yields the same 404 (cross-org isolation, verified by test).
- **Collection `name` is stored as the client sends it** (E2E-encrypted with the org key client-side; server stores the opaque blob).
- **`org-access.ts` is deny-by-default and the ONLY place cipher access decisions live.** `canRead`/`canWrite` signatures are frozen by this plan (Phase 3b imports them verbatim). Personal cipher → requester owns it. Org cipher → requester is a **confirmed** member of the cipher's org AND the cipher is in a collection granted to them; write additionally requires the grant is not `read_only`.
- **DB stores read_only/hide_passwords as INTEGER 0/1; grants API uses booleans** — mapping lives in `org-shapes.ts`.
- **Schema change discipline (repo rule):** the `0003` migration goes to BOTH `migrations/0003_invite_org_user.sql` AND `SCHEMA_STATEMENTS` in `storage-schema.ts`, and bumps `STORAGE_SCHEMA_VERSION`. NOTE: `invites` is NOT in the backup export/import contract (verified — no `invites` reference in `backup-archive.ts`/`backup-import.ts`), so NO backup change is needed for this column. Do not add one.
- Commit after every task; branch `feat/organizations-phase-3a` (worktree via superpowers:using-git-worktrees at execution start, from current `main`). NO Co-Authored-By or other trailers; conventional-commit style.
- Never touch `.env`/secrets. Test sweep command (extend `test:orgs` as files are added): the seven existing org test files plus `scripts/org-access.test.ts` and `scripts/storage-collection-repo.test.ts`.

---

### Task 1: Collection types

**Files:** Modify `src/types/index.ts` (append).

**Interfaces:** Produces `Collection { id; orgId; name; createdAt; updatedAt }`, `CollectionGrant { collectionId; orgUserId; readOnly: boolean; hidePasswords: boolean }`, `CollectionWithGrant { collection: Collection; readOnly: boolean; hidePasswords: boolean }` (a member's view of a collection they can access).

- [ ] **Step 1: Append to `src/types/index.ts`** (after the Phase 1/2 org types):

```typescript
// --- Collections (Phase 3a) ---
export interface Collection {
  id: string;
  orgId: string;
  name: string; // opaque, org-key-encrypted client-side
  createdAt: string;
  updatedAt: string;
}

export interface CollectionGrant {
  collectionId: string;
  orgUserId: string;
  readOnly: boolean;
  hidePasswords: boolean;
}

export interface CollectionWithGrant {
  collection: Collection;
  readOnly: boolean;
  hidePasswords: boolean;
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p tsconfig.json`, no NEW errors vs a pre-change baseline count.
- [ ] **Step 3: Commit** — `git add src/types/index.ts && git commit -m "feat: add collection types"`

---

### Task 2: Collection repo (`storage-collection-repo.ts`)

**Files:** Create `src/services/storage-collection-repo.ts`; Test `scripts/storage-collection-repo.test.ts`.

**Interfaces:** Consumes types (Task 1), schema (existing), `createTestDb`. Produces (all `db` first, mirroring `storage-org-repo.ts` style with mapper functions and column constants):
- `createCollection(db, c: Collection): Promise<void>`
- `getCollection(db, collectionId: string): Promise<Collection | null>`
- `listCollections(db, orgId: string): Promise<Collection[]>` (order `created_at ASC`)
- `updateCollectionName(db, collectionId: string, name: string, updatedAt: string): Promise<void>`
- `deleteCollection(db, collectionId: string): Promise<void>` (FK cascades grants + cipher_collections)
- `setGrant(db, g: CollectionGrant): Promise<void>` (upsert on PK `(collection_id, org_user_id)`)
- `deleteGrant(db, collectionId: string, orgUserId: string): Promise<void>`
- `listGrantsForCollection(db, collectionId: string): Promise<CollectionGrant[]>`
- `listCollectionsForMember(db, orgUserId: string): Promise<CollectionWithGrant[]>` (join collections + collection_users where org_user_id = ?)
- `addCipherToCollections(db, cipherId: string, collectionIds: string[]): Promise<void>` (insert-or-ignore into cipher_collections; used by org-access tests now, by 3b sharing later)
- `getCipherCollectionIds(db, cipherId: string): Promise<string[]>`
- `isCipherInGrantedCollection(db, cipherId: string, orgUserId: string): Promise<{ granted: boolean; readOnly: boolean; hidePasswords: boolean }>` — EXISTS join `cipher_collections` → `collection_users` for that org_user; returns granted=false if none. When multiple grants match, `readOnly` is the AND of all (any writable grant makes it writable — least-restrictive wins, matching Bitwarden), `hidePasswords` is the AND likewise.

- [ ] **Step 1: Write failing tests** (`scripts/storage-collection-repo.test.ts`) covering: create/get/list/rename/delete a collection; set/list/delete grants; `listCollectionsForMember` returns only granted collections with correct flags; `addCipherToCollections` + `getCipherCollectionIds` round-trip; `isCipherInGrantedCollection` returns granted with least-restrictive flags when two grants (one read-only, one writable) apply, and false when no grant. Seed orgs/members via direct inserts (mirror `storage-org-repo.test.ts` helpers). Include a delete-cascade assertion (deleting a collection removes its grants and cipher_collections rows).

- [ ] **Step 2: Run to verify fail** — `npx tsx --test scripts/storage-collection-repo.test.ts` → module-not-found.

- [ ] **Step 3: Implement** the repo mirroring `storage-org-repo.ts` conventions (mapper functions, `COLLECTION_COLUMNS` constant, snake_case SQL, `?`-bound). For `isCipherInGrantedCollection`, one query joining `cipher_collections cc JOIN collection_users cu ON cu.collection_id = cc.collection_id WHERE cc.cipher_id = ? AND cu.org_user_id = ?`, aggregating `MIN(read_only)`/`MIN(hide_passwords)` (least-restrictive) and a COUNT for granted.

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `feat: add collection storage repo`.

---

### Task 3: StorageService wiring

**Files:** Modify `src/services/storage.ts`; Test `scripts/storage-collection-repo.test.ts` (append one StorageService round-trip test).

**Interfaces:** Produces delegates on `StorageService` for all Task 2 functions, following the `as`-aliased import convention.

- [ ] **Step 1: Append failing test** exercising `new StorageService(db).createCollection(...)` + `listCollections`. **Step 2: fail.** **Step 3: Wire** imports + delegates. **Step 4: pass + typecheck.** **Step 5: Commit** — `feat: wire collection repo into StorageService`.

---

### Task 4: `org-access.ts` — the chokepoint

**Files:** Create `src/services/org-access.ts`; Test `scripts/org-access.test.ts`.

**Interfaces:** Consumes StorageService (Task 3), `getOrgUserByOrgAndUser` (Phase 1). Produces the FROZEN signatures Phase 3b will import:
- `canReadCipher(storage: StorageService, userId: string, cipher: Cipher): Promise<boolean>`
- `canWriteCipher(storage: StorageService, userId: string, cipher: Cipher): Promise<boolean>`

Semantics (deny-by-default): if `cipher.organizationId` is null → return `cipher.userId === userId`. Else load `getOrgUserByOrgAndUser(cipher.organizationId, userId)`; deny unless `status === 'confirmed'`. Owners (`role === 'owner'`) bypass collection checks (full access to all org ciphers — matches the spec's `allowAdminAccessToAllCollectionItems: true` and the sole-admin model). Otherwise evaluate `isCipherInGrantedCollection(cipher.id, orgUser.id)`: read requires `granted`; write requires `granted && !readOnly`.

- [ ] **Step 1: Write the exhaustive failing test** (`scripts/org-access.test.ts`) — a decision matrix: personal cipher (owner match / non-match); org cipher × member status (none/invited/accepted/confirmed) × role (owner/user) × grant (absent/read-only/writable) × operation (read/write). Every cell asserted. Include the cross-org case: a confirmed member of org A, evaluated against a cipher in org B, denies. Build synthetic `Cipher` objects (`{ id, userId, organizationId, ... }`) and seed collections/grants/cipher_collections via the repo.

- [ ] **Step 2: Run to verify fail.** **Step 3: Implement** `org-access.ts` per the semantics above — small, readable, deny-by-default, one function calling the other's shared membership-load where sensible but keeping both independently correct. **Step 4: Run to verify pass** (this is the security core — every matrix cell must be green). **Step 5: Wire `scripts/org-access.test.ts` + `scripts/storage-collection-repo.test.ts` into `package.json` `test:orgs`.** **Step 6: Commit** — `feat: add org-access control chokepoint (canRead/canWrite)`.

---

### Task 5: Collection response shapes

**Files:** Modify `src/handlers/org-shapes.ts` (append); Test `scripts/org-shapes.test.ts` (append).

**Interfaces:** Produces (Bitwarden-shaped): `parseCollectionRequest(body)` → `{ name: string } | { error }` (non-empty, ≤ 1000 chars); `parseCollectionGrantsRequest(body)` → `{ grants: {orgUserId; readOnly; hidePasswords}[] } | { error }` (from the client's `{users:[{id, readOnly, hidePasswords}]}` shape); `collectionResponse(c: Collection)` → `{ id; organizationId; name; externalId: null; object: 'collection' }`; `collectionDetailsResponse(c, readOnly, hidePasswords)` → adds `readOnly`, `hidePasswords`, `manage: false`, `object: 'collectionDetails'`; `collectionListResponse(items)` → `{ data; object: 'list'; continuationToken: null }`.

- [ ] **Step 1: Failing tests** asserting each shape's object tag and field set, and that `parseCollectionGrantsRequest` maps `readOnly`/`hidePasswords` booleans through. **Step 2: fail.** **Step 3: implement.** **Step 4: pass.** **Step 5: Commit** — `feat: add collection request/response shapes`.

---

### Task 6: Collection handlers (`org-collections.ts`)

**Files:** Create `src/handlers/org-collections.ts`. Automated gate: `tsc` + `test:orgs` (behavior proven by Task 9 smoke; handlers import worker modules so no tsx handler tests).

**Interfaces:** Consumes Tasks 2–5, `getOwnedOrg` (exported Phase 2), utilities as `org-users.ts` uses them. Produces owner-gated handlers:
- `handleListCollections(request, env, userId, orgId)` — all org collections as `collectionListResponse`.
- `handleGetCollection(request, env, userId, orgId, collectionId)` — cross-org-checked (collection.orgId === orgId else 404 `Collection not found`).
- `handleCreateCollection(request, env, userId, orgId)` — `parseCollectionRequest`; create; audit `organization.collection.create`; return `collectionResponse`.
- `handleUpdateCollection(...collectionId)` — rename; cross-org check; audit.
- `handleDeleteCollection(...collectionId)` — cross-org check; delete (cascades grants + cipher_collections); audit at level 'security'.
- `handleGetCollectionUsers(...collectionId)` — list grants as `[{id: orgUserId, readOnly, hidePasswords}]`.
- `handlePutCollectionUsers(...collectionId)` — `parseCollectionGrantsRequest`; replace grants (delete-all-then-set, or diff); each `orgUserId` must belong to this org (validate against `listOrgUsers`) else 400; audit.

All collection mutations bump+notify all confirmed members (`bumpAndNotifyMembers` from `org-users.ts`), since collection/grant changes alter what members can see.

- [ ] **Step 1: Write the handler file** per the above; mirror `org-users.ts` structure (try/catch body parse → 400, `getOwnedOrg` first, audit, notify). **Step 2: Typecheck + test:orgs green.** **Step 3: Commit** — `feat: add collection management handlers`.

---

### Task 7: Collections in sync + router registration

**Files:** Modify `src/handlers/sync.ts` (replace `collections: []`), `src/router-authenticated.ts` (routes above the stub).

**Interfaces:** Consumes `getOrgUserByOrgAndUser` + `listCollectionsForMember`, `collectionDetailsResponse`.

- [ ] **Step 1: Sync collections.** In `src/handlers/sync.ts`, replace the hardcoded `collections: []` (line ~120): for the syncing user, gather their confirmed memberships (already loaded for `profileOrgs`), and for each, `listCollectionsForMember(orgUser.id)`, mapping through `collectionDetailsResponse`. Owners see ALL org collections (with readOnly=false, hidePasswords=false) — union appropriately. Flatten across orgs. Keep the sync-cache key correct: collection changes bump member revisions (Task 6), and the cache key already includes revisionDate, so no separate invalidation needed.

- [ ] **Step 2: Register routes** ABOVE the catch-all stub, mirroring the Phase 2 regex idiom:
  - `GET /api/organizations/:id/collections` → list
  - `POST /api/organizations/:id/collections` → create
  - `GET|PUT|DELETE /api/organizations/:id/collections/:cid` → get/update/delete
  - `GET|PUT /api/organizations/:id/collections/:cid/users` → grants

- [ ] **Step 3: Typecheck + test:orgs green.** **Step 4: Commit** — `feat: expose collections in sync; register collection routes`.

---

### Task 8: Invite-code ↔ membership linkage (carryforward discharge)

**Files:** `migrations/0003_invite_org_user.sql` (create), `src/services/storage-schema.ts` (append + version bump in `storage.ts`), `src/services/storage-admin-repo.ts` (+ `storage.ts` delegate), `src/handlers/org-users.ts` (invite/resend/remove), `scripts/storage-org-repo.test.ts` or a new test file (append). (No backup-contract change — `invites` is not in it.)

**Interfaces:** Adds nullable `invites.org_user_id`. Produces `getActiveInviteForOrgUser(db, orgUserId)`, `revokeInvitesForOrgUser(db, orgUserId)`.

- [ ] **Step 1: Migration** — `ALTER TABLE invites ADD COLUMN org_user_id TEXT` in both `0003_invite_org_user.sql` and `SCHEMA_STATEMENTS` (idempotent-by-ignored-error like existing ALTERs); index `idx_invites_org_user`. Bump `STORAGE_SCHEMA_VERSION` to `2026-08-02-invite-org-user`. No backup-contract change (`invites` is not in it).
- [ ] **Step 2: Repo + failing test** — `getActiveInviteForOrgUser` (status='active', not expired), `revokeInvitesForOrgUser` (set status='revoked'). Test the round-trip.
- [ ] **Step 3: Wire into handlers.** `handleInviteOrgUsers`: when minting a registration code for an account-less invitee, set `org_user_id` on the invite. `handleResendOrgInvite`: if the invitee still has no account, `revokeInvitesForOrgUser(orgUserId)` then mint a fresh linked code (restores working resend — replaces the Phase 2 codeless behavior; update the code comment). `handleRemoveOrgUser`: `revokeInvitesForOrgUser(orgUserId)` before deleting the row, so a dis-invited recipient can no longer register.
- [ ] **Step 4: test:orgs + tsc green.** **Step 5: Commit** — `feat: link invite codes to memberships; restore working resend`.

---

### Task 9: Local smoke + phase gate

**Files:** `scripts/org-collections-smoke.mjs` (create).

- [ ] **Step 1: Smoke script** extending the Phase 2 pattern (register admin → create org → invite/accept/confirm a member via the same minted-token approach) then: create two collections; grant the member read-only on one and writable on the other; GET the member's sync and assert both collections appear with correct `readOnly` flags; rename a collection and assert the member's revision bumped; a stranger 404s on the collections endpoints; delete a collection and assert it leaves the member's sync. Run against `wrangler dev` on a fresh local D1 (mint a registration code in local D1 as in Phase 2). Kill wrangler after. `ALL CHECKS PASSED`/exit 0.
- [ ] **Step 2: Full gate** — `test:orgs` all green; upstream suites green; `tsc --noEmit` clean; `git diff --name-only main...HEAD` all within the allowlist.
- [ ] **Step 3: Update `docs/superpowers/plans/2026-08-01-phase-1-carryforward.md`** — mark invite-code-linkage discharged; carry the remaining Phase 3b items (org-cipher cleanup on org delete, personal-vault `organization_id IS NULL` filtering, backup cipher-org referential check, collectionName-on-create) into a Phase 3b section. Commit.
- [ ] **Step 4:** Push branch; PR via the user's `/create-pr`. Do NOT merge.
