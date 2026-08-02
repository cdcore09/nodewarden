# Phase 1 Carry-Forward Notes (for Phase 2 & 3 planning)

Durable record of deferred findings from Phase 1's reviews. Source: SDD ledger + final whole-branch review, 2026-08-01. Each item MUST be triaged into the phase plan named below.

## Phase 2 (invite → accept → confirm) MUST address

- **Router stub trap:** all new org sub-path routes (invite, confirm, members, public-key, etc.) MUST be registered ABOVE the pre-existing `/api/organizations` catch-all stub in `src/router-authenticated.ts` (warning comment now in place at the stub). Routes registered below it are silently swallowed.
- **Revision bumps go multi-member:** Phase 1 bumps only the acting owner's revision on org mutations. Once orgs have >1 member, every org mutation must bump ALL confirmed members' revisions and push-notify them (loop over members using the existing per-user machinery).
- **profileOrgs helper:** the memberships fetch→filter(invited)→map block is triplicated (sync.ts, accounts.ts ×2). Extract `loadProfileOrgs(storage, userId)` before adding a fourth copy.
- **Admin delete-user guard interplay:** deleting a user who owns orgs is refused (400). Phase 2 member removal must ensure removing a *member* (non-owner) from an org still works when that user is later deleted.

## Phase 3 (collections, sharing, ACL) MUST address

- **Org-cipher cleanup on org delete:** `ciphers.organization_id` has NO foreign key. `deleteOrganization` cascades org tables only — Phase 3's delete flow must explicitly handle org-owned ciphers (delete or orphan-prevention) once they can exist.
- **Personal-vault query filtering:** existing cipher queries assume user ownership. When org ciphers become creatable, personal-vault queries must filter `organization_id IS NULL` (creator's `user_id` remains set on org ciphers per the ownership invariant).
- **Backup import referential check:** `validateBackupPayloadContents` does not validate cipher `organization_id` against imported organization ids (no FK either). Add the check alongside the existing userIds/folderIds validation when org ciphers ship.
- **collectionName on org create:** Phase 1 accepts but ignores the official client's `collectionName` field. Phase 3 collections work decides whether to honor it.

## UI phase (4/5) notes

- `webapp/src/lib/api/backup.ts` `AdminBackupImportCounts` type is missing the five new optional org-table count fields (server sends them; untyped consumer ignores them today). Update when touching the webapp.

## Accepted/cosmetic deferrals (no action required)

- `createTestDb(): any` (test-only ergonomics); `ORG_TYPE`/`ORG_STATUS` not `as const`; 404-not-405 on unmatched org methods; stale `STORAGE_SCHEMA_VERSION` comment referencing only 0001; org create handler not retry-idempotent (matches folders.ts pattern); `listMembershipsForUser` double-mapping style.
