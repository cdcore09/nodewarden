# Phase 1 Carry-Forward Notes (for Phase 2 & 3 planning)

Durable record of deferred findings from Phase 1's reviews. Source: SDD ledger + final whole-branch review, 2026-08-01. Each item MUST be triaged into the phase plan named below.

## Phase 2 (invite → accept → confirm) — DISCHARGED 2026-08-02

All Phase 2 obligations below were addressed and verified (branch `feat/organizations-phase-2`, deployed + smoke-tested on vault-test.corderocore.com):

- **Router stub trap:** ✅ new member routes registered above the catch-all (Task 6; verified by final review).
- **Revision bumps go multi-member:** ✅ `bumpAndNotifyMembers` bumps all confirmed members on confirm/remove/rename/delete; delete captures the member list before cascade (Task 3+6).
- **profileOrgs helper:** ✅ `src/utils/profile-orgs.ts` extracted; all three call sites use it (Task 2).
- **Admin delete-user guard interplay:** ✅ member removal is independent of the owner-deletion guard; non-owner removal works and bumps the removed user.

## Phase 3 (collections, sharing, ACL) MUST address — NEW from Phase 2

- **Invite-code ↔ membership linkage:** org invites for account-less recipients mint NodeWarden registration codes, but `invites` rows are NOT linked to `organization_users`. Consequence today: **resend deliberately mints NO code** (to avoid leaking unbounded live registration tokens), so a resent invite to someone who never got the original email is codeless and unusable — recovery is admin remove+re-invite. Phase 3 fix: add an `org_user_id` (or email) column to `invites`, so resend can revoke-and-remint exactly one code per invitee. Also revoke the invitee's registration code when an `invited`/`accepted` member is removed.

## Phase 3 (collections, sharing, ACL) MUST address

- **Org-cipher cleanup on org delete:** `ciphers.organization_id` has NO foreign key. `deleteOrganization` cascades org tables only — Phase 3's delete flow must explicitly handle org-owned ciphers (delete or orphan-prevention) once they can exist.
- **Personal-vault query filtering:** existing cipher queries assume user ownership. When org ciphers become creatable, personal-vault queries must filter `organization_id IS NULL` (creator's `user_id` remains set on org ciphers per the ownership invariant).
- **Backup import referential check:** `validateBackupPayloadContents` does not validate cipher `organization_id` against imported organization ids (no FK either). Add the check alongside the existing userIds/folderIds validation when org ciphers ship.
- **collectionName on org create:** Phase 1 accepts but ignores the official client's `collectionName` field. Phase 3 collections work decides whether to honor it.

## UI phase (4/5) notes

- `webapp/src/lib/api/backup.ts` `AdminBackupImportCounts` type is missing the five new optional org-table count fields (server sends them; untyped consumer ignores them today). Update when touching the webapp.

## Accepted/cosmetic deferrals (no action required)

- `createTestDb(): any` (test-only ergonomics); `ORG_TYPE`/`ORG_STATUS` not `as const`; 404-not-405 on unmatched org methods; stale `STORAGE_SCHEMA_VERSION` comment referencing only 0001; org create handler not retry-idempotent (matches folders.ts pattern); `listMembershipsForUser` double-mapping style.
