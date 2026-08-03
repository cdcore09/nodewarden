# Phase 1 Carry-Forward Notes (for Phase 2 & 3 planning)

Durable record of deferred findings from Phase 1's reviews. Source: SDD ledger + final whole-branch review, 2026-08-01. Each item MUST be triaged into the phase plan named below.

## Phase 2 (invite → accept → confirm) — DISCHARGED 2026-08-02

All Phase 2 obligations below were addressed and verified (branch `feat/organizations-phase-2`, deployed + smoke-tested on vault-test.corderocore.com):

- **Router stub trap:** ✅ new member routes registered above the catch-all (Task 6; verified by final review).
- **Revision bumps go multi-member:** ✅ `bumpAndNotifyMembers` bumps all confirmed members on confirm/remove/rename/delete; delete captures the member list before cascade (Task 3+6).
- **profileOrgs helper:** ✅ `src/utils/profile-orgs.ts` extracted; all three call sites use it (Task 2).
- **Admin delete-user guard interplay:** ✅ member removal is independent of the owner-deletion guard; non-owner removal works and bumps the removed user.

## Phase 3a (collections, grants, access-control chokepoint) — DISCHARGED 2026-08-02

- **Invite-code ↔ membership linkage:** ✅ discharged. `invites` now carries `org_user_id` (migration `0003_invite_org_user.sql`; `storage-schema.ts` bootstrap keeps parity); `revokeInvitesForOrgUser` (`src/services/storage-admin-repo.ts`) revokes every prior active code for the `orgUserId` before resend mints a fresh linked code, and removal of an `invited`/`accepted` member also revokes their outstanding code via the same helper. Covered by `scripts/invite-linkage.test.ts`.

## Phase 3b (org ciphers, sharing enforcement) — Tasks 1-9 DISCHARGED 2026-08-02; Task 10 found one BLOCKING issue (see below, unresolved)

All Phase 3b obligations below (from the original Phase 1 ledger) were addressed and verified
(branch `feat/organizations-phase-3b`). However, Task 10's end-to-end sharing smoke — the first test in
this phase to exercise `POST /api/ciphers` through the actual HTTP handler with a realistic client
request, rather than the storage layer directly — found a real, previously-undetected defect that breaks
org-cipher collection assignment on create. See "Task 10 — BLOCKING FINDING" below; it is intentionally
left unresolved pending review, not silently patched.

- **BLOCKING PREREQUISITE — `organizationId` is silently dropped on every Cipher:** ✅ discharged (Task 1). `src/services/storage-cipher-repo.ts`'s `selectCipherColumns()` now includes `organization_id`, `parseCipherRow` maps it to `organizationId`, and `saveCipher`'s insert/update column list threads it through.
- **Org-cipher cleanup on org delete:** ✅ discharged (Task 8). `deleteOrganization`'s delete flow explicitly removes org-owned ciphers (and their attachment/`cipher_collections` rows) via `deleteOrgCiphers`.
- **Personal-vault query filtering:** ✅ discharged (Task 2). Personal-vault cipher queries filter `organization_id IS NULL`; org ciphers are excluded from personal-vault reads.
- **Backup import referential check:** ✅ discharged (Task 9). `validateBackupPayloadContents` (`src/services/backup-archive.ts`) now validates every cipher's non-null `organization_id` against the imported organization ids, mirroring the existing userIds/folderIds checks — throws `Backup archive contains a cipher for an unknown organization: <id>`. Covered by `scripts/org-backup.test.ts`.
- **collectionName on org create:** ✅ discharged (Task 9). **DECISION: accept-and-ignore.** Phase 3b does NOT auto-create a default collection from the org-create `collectionName` field — the sole-admin creates collections explicitly. The official client's `collectionName` field continues to be accepted (for client compatibility) and ignored server-side.
- **Share/add-to-collection org consistency:** ✅ discharged (Task 6). The share/add-to-collection endpoint validates `collection.orgId === cipher.organizationId` before linking.
- **`hidePasswords` enforcement:** ✅ discharged. **DECISION: CLIENT-enforced.** The server surfaces the `hidePasswords` flag in sync/collection responses but does NOT strip password fields from cipher responses server-side. This matches Vaultwarden's behavior and keeps the cipher response path simple; enforcement is left to the client.

### Task 10 — BLOCKING FINDING: `handleCreateCipher` drops `collectionIds` on org-cipher create (NOT discharged)

The end-to-end sharing smoke (`scripts/org-sharing-smoke.mjs`) found a real product bug, distinct from
everything above (all of which was verified only at the storage/unit layer, never through the actual
`POST /api/ciphers` handler with a realistic client request body). **This is unresolved** — it was
intentionally left unfixed per the task's "stop and report, do not paper over" instruction, pending
review.

`handleCreateCipher` (`src/handlers/ciphers.ts`, ~line 1049) reads `collectionIds` off `cipherData`
(i.e. `body.cipher` when the client sends the standard nested `{ cipher: {...}, collectionIds: [...] }`
shape used by official Bitwarden clients — and specified verbatim in this phase's own task-10 brief).
But the real Bitwarden contract puts `collectionIds` as a **sibling** of `cipher`, at the top level of
the request body, not nested inside it. `handleShareCipher` (same file, ~line 1303) already reads it
correctly from `body`. The two handlers disagree on where to look, and `handleCreateCipher` is the one
that's wrong.

Effect: a client creating an org cipher and assigning it to a collection in one `POST /api/ciphers` call
(the standard flow) has its `collectionIds` silently discarded — `requestedCollectionIds` evaluates to
`[]`. The cipher IS created with `organizationId` set (that part works), but no `cipher_collections` row
is ever inserted. Consequences:
- A non-owner member creating an org cipher gets erroneously rejected with `An organization member must
  assign the item to at least one collection` (400), even though they specified a collection correctly.
- An owner creating an org cipher into a collection gets a silent no-op on the collection assignment —
  the cipher is created, but unreachable to every non-owner member (owners bypass the collection-grant
  check, so they don't notice). This breaks the core deliverable of Phase 3b for anything created via
  `POST /api/ciphers` directly into a collection.

Reproduced in isolation (fresh local D1, `wrangler dev`):
```
POST /api/ciphers
{ "cipher": { "type": 1, "name": "0.iv-x|ct-x", "login": {...}, "organizationId": "<orgId>" },
  "collectionIds": ["<collectionId>"] }

→ 200 { ..., "organizationId": "<orgId>", "collectionIds": [] }   // expected ["<collectionId>"]
```
No existing test (unit or handler-level) exercised this path — the storage-layer tests that DO cover
`collectionIds` (`cipher-access-queries.test.ts`, `cipher-org-field.test.ts`) call
`storage.addCipherToCollections` directly, bypassing the handler's request parsing entirely, so the gap
was invisible until this end-to-end smoke.

**Suggested fix** (not applied): change line ~1049 to read `collectionIds`/`CollectionIds` off `body`
instead of `cipherData`, mirroring `handleShareCipher`'s already-correct pattern exactly.

### Known limitation: `folder_id` is a single shared column, but folders are personal (Task 4 ledger)

Flagged during Task 4 (bulk cipher handlers) and not addressed in Phase 3b — noted here as a known
limitation for a future cleanup phase, not a regression introduced by this phase. `handleBulkMoveCiphers`
(and the single-cipher move/update paths) verify folder ownership against the *acting* user and then
write that user's personal `folderId` onto the cipher's own `folder_id` column — including for org
ciphers the acting user doesn't own but can write via a collection grant. Because `ciphers.folder_id` is
a single column on the shared row, and folders are always personal/private to one user (never shared,
per Task 3's review), one member moving a shared org cipher into their own folder sets a `folder_id` that
belongs to that member's personal folder namespace — a value meaningless (and potentially
non-existent/undecryptable) to every other member who can see the same cipher. Bitwarden's own official
clients avoid this by not surfacing folder-move UI for org items outside "My Vault", but the server here
does not enforce that restriction. Left as an open question for Phase 4/5 (or a dedicated cleanup task)
to decide whether `folder_id` should be rejected outright on org ciphers, or reworked into a per-member
mapping.

## UI phase (4/5) notes

- `webapp/src/lib/api/backup.ts` `AdminBackupImportCounts` type is missing the five new optional org-table count fields (server sends them; untyped consumer ignores them today). Update when touching the webapp.

## Accepted/cosmetic deferrals (no action required)

- `createTestDb(): any` (test-only ergonomics); `ORG_TYPE`/`ORG_STATUS` not `as const`; 404-not-405 on unmatched org methods; stale `STORAGE_SCHEMA_VERSION` comment referencing only 0001; org create handler not retry-idempotent (matches folders.ts pattern); `listMembershipsForUser` double-mapping style.
