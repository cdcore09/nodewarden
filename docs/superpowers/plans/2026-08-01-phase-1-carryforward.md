# Phase 1 Carry-Forward Notes (for Phase 2 & 3 planning)

Durable record of deferred findings from Phase 1's reviews. Source: SDD ledger + final whole-branch review, 2026-08-01. Each item MUST be triaged into the phase plan named below.

## Phase 2 (invite → accept → confirm) — DISCHARGED 2026-08-02

All Phase 2 obligations below were addressed and verified (branch `feat/organizations-phase-2`, deployed + smoke-tested on vault-test.corderocore.com):

- **Router stub trap:** ✅ new member routes registered above the catch-all (Task 6; verified by final review).
- **Revision bumps go multi-member:** ✅ `bumpAndNotifyMembers` bumps all confirmed members on confirm/remove/rename/delete; delete captures the member list before cascade (Task 3+6).
- **profileOrgs helper:** ✅ `src/utils/profile-orgs.ts` extracted; all three call sites use it (Task 2).
- **Admin delete-user guard interplay:** ✅ member removal is independent of the owner-deletion guard; non-owner removal works and bumps the removed user.

## Phase 3a (collections, grants, access-control chokepoint) — DISCHARGED 2026-08-02

- **Invite-code ↔ membership linkage:** ✅ discharged. `invites` now carries `org_user_id` (migration `0003_invite_org_user.sql`; `storage-schema.ts` bootstrap keeps parity); `getActiveInviteForOrgUser` / `revokeInvitesForOrgUser` (`src/services/storage-admin-repo.ts`) let resend revoke-and-remint exactly one code per invitee, and removal of an `invited`/`accepted` member revokes their outstanding code. Covered by `scripts/invite-linkage.test.ts`.

## Phase 3b (org ciphers, sharing enforcement) MUST address

- **BLOCKING PREREQUISITE — `organizationId` is silently dropped on every Cipher:** `src/services/storage-cipher-repo.ts`'s `selectCipherColumns()` (line 98) omits `organization_id` from its `SELECT`, and `saveCipher`'s `INSERT`/`ON CONFLICT DO UPDATE` never writes it either — the column exists (`storage-schema.ts` line 208: `ALTER TABLE ciphers ADD COLUMN organization_id TEXT`) but no repo function reads or writes it. Net effect: **every `Cipher` object in the codebase today has `organizationId === undefined`**, regardless of what's in the `organization_id` DB column. Phase 3b's FIRST task MUST fix `selectCipherColumns()` (add `organization_id`) and `parseCipherRow` (map it to `organizationId`), and thread it through `saveCipher`'s insert/update column list — BEFORE wiring `canReadCipher`/`canWriteCipher` (`src/services/org-access.ts`) into the cipher handlers (`src/handlers/ciphers.ts`). Otherwise every org cipher read/write is evaluated as if `organizationId` is `null`, i.e. as a personal cipher, and the org-access chokepoint added in Phase 3a becomes a no-op for real org ciphers. (`backup-archive.ts` already selects `organization_id` directly and is unaffected — this bug is scoped to `storage-cipher-repo.ts`.)
- **Org-cipher cleanup on org delete:** `ciphers.organization_id` has NO foreign key. `deleteOrganization` cascades org tables only — Phase 3b's delete flow must explicitly handle org-owned ciphers (delete or orphan-prevention).
- **Personal-vault query filtering:** existing cipher queries assume user ownership. Once org ciphers are read/written through the fixed repo above, personal-vault queries must filter `organization_id IS NULL` (creator's `user_id` remains set on org ciphers per the ownership invariant).
- **Backup import referential check:** `validateBackupPayloadContents` does not validate cipher `organization_id` against imported organization ids (no FK either). Add the check alongside the existing userIds/folderIds validation.
- **collectionName on org create:** Phase 1 accepts but ignores the official client's `collectionName` field. Phase 3b decides whether to honor it (auto-create a default collection).

## UI phase (4/5) notes

- `webapp/src/lib/api/backup.ts` `AdminBackupImportCounts` type is missing the five new optional org-table count fields (server sends them; untyped consumer ignores them today). Update when touching the webapp.

## Accepted/cosmetic deferrals (no action required)

- `createTestDb(): any` (test-only ergonomics); `ORG_TYPE`/`ORG_STATUS` not `as const`; 404-not-405 on unmatched org methods; stale `STORAGE_SCHEMA_VERSION` comment referencing only 0001; org create handler not retry-idempotent (matches folders.ts pattern); `listMembershipsForUser` double-mapping style.
