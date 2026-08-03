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

## Phase 3b (org ciphers, sharing enforcement) — DISCHARGED 2026-08-02

All Phase 3b obligations below were addressed and verified (branch `feat/organizations-phase-3b`):

- **BLOCKING PREREQUISITE — `organizationId` is silently dropped on every Cipher:** ✅ discharged (Task 1). `src/services/storage-cipher-repo.ts`'s `selectCipherColumns()` now includes `organization_id`, `parseCipherRow` maps it to `organizationId`, and `saveCipher`'s insert/update column list threads it through.
- **Org-cipher cleanup on org delete:** ✅ discharged (Task 8). `deleteOrganization`'s delete flow explicitly removes org-owned ciphers (and their attachment/`cipher_collections` rows) via `deleteOrgCiphers`.
- **Personal-vault query filtering:** ✅ discharged (Task 2). Personal-vault cipher queries filter `organization_id IS NULL`; org ciphers are excluded from personal-vault reads.
- **Backup import referential check:** ✅ discharged (Task 9). `validateBackupPayloadContents` (`src/services/backup-archive.ts`) now validates every cipher's non-null `organization_id` against the imported organization ids, mirroring the existing userIds/folderIds checks — throws `Backup archive contains a cipher for an unknown organization: <id>`. Covered by `scripts/org-backup.test.ts`.
- **collectionName on org create:** ✅ discharged (Task 9). **DECISION: accept-and-ignore.** Phase 3b does NOT auto-create a default collection from the org-create `collectionName` field — the sole-admin creates collections explicitly. The official client's `collectionName` field continues to be accepted (for client compatibility) and ignored server-side.
- **Share/add-to-collection org consistency:** ✅ discharged (Task 6). The share/add-to-collection endpoint validates `collection.orgId === cipher.organizationId` before linking.
- **`hidePasswords` enforcement:** ✅ discharged. **DECISION: CLIENT-enforced.** The server surfaces the `hidePasswords` flag in sync/collection responses but does NOT strip password fields from cipher responses server-side. This matches Vaultwarden's behavior and keeps the cipher response path simple; enforcement is left to the client.

## UI phase (4/5) notes

- `webapp/src/lib/api/backup.ts` `AdminBackupImportCounts` type is missing the five new optional org-table count fields (server sends them; untyped consumer ignores them today). Update when touching the webapp.

## Accepted/cosmetic deferrals (no action required)

- `createTestDb(): any` (test-only ergonomics); `ORG_TYPE`/`ORG_STATUS` not `as const`; 404-not-405 on unmatched org methods; stale `STORAGE_SCHEMA_VERSION` comment referencing only 0001; org create handler not retry-idempotent (matches folders.ts pattern); `listMembershipsForUser` double-mapping style.
