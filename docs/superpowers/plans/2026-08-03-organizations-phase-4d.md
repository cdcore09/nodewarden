# Organizations Phase 4d — Collections Tab Implementation Plan

**Goal:** Add the Collections tab to the org-detail page: list collections (org-key-decrypted names), create/rename/delete, and manage per-member grants (access + readOnly + hidePasswords) via the phase-3a endpoints. Closes #18.

**Architecture:** Pure frontend, mirroring 4c. Backend endpoints exist and are owner-gated (`src/handlers/org-collections.ts`). Collection names are org-key EncStrings (`2.…`) — the UI encrypts/decrypts with `encryptWithOrgKey`/`decryptWithOrgKey` and fails closed on a missing org key (same rule as 4c Confirm; reuse `txt_org_key_unavailable`).

## Global constraints (inherited from 4c)
- No commit/PR trailers or AI attribution. Never commit secrets.
- No backend changes. Frontend + locales + scripts tests only.
- tsc baseline: 3 pre-existing errors; no new ones.
- Gates per task: `npm run build`, `npm run test:orgs-web`, `npm run i18n`, backend `npm run test:orgs` stays 93/93.
- i18n: every string via `t('txt_org_…')` in all 10 locales.
- Match existing design idioms: `ConfirmDialog`, `.table`, `.actions`, `btn` classes.

## Backend contracts (do not re-derive)
- `GET /api/organizations/:id/collections` → `{ data: [{id, name(EncString)}], … }` (client `listOrgCollections` exists)
- `POST /api/organizations/:id/collections` body `{ name: EncString }` → collection
- `PUT /api/organizations/:id/collections/:cid` body `{ name: EncString }`
- `DELETE /api/organizations/:id/collections/:cid`
- `GET /api/organizations/:id/collections/:cid/users` → grants `[{orgUserId, readOnly, hidePasswords}]`
- `PUT …/users` body `{ grants: [{orgUserId, readOnly, hidePasswords}] }` — FULL REPLACE
- Owners implicitly see all collections; grants matter for non-owner members only.

## Task 1: Collection API client functions (TDD)
- `webapp/src/lib/api/organizations.ts`: add `OrgCollectionGrant {orgUserId, readOnly, hidePasswords}`; `createOrgCollection(authedFetch, orgId, encName)`, `updateOrgCollection(…, collectionId, encName)`, `deleteOrgCollection(…, collectionId)`, `getOrgCollectionUsers(…, collectionId): Promise<OrgCollectionGrant[]>`, `putOrgCollectionUsers(…, collectionId, grants)`. Existing idioms (encodeURIComponent, parseErrorMessage).
- `scripts/org-collections-api.test.ts` (new): stubFetch tests for URL/method/body of all five + error rejection; plus composition test: `encryptWithOrgKey(name, orgKey)` → `createOrgCollection` posts that EncString verbatim → `decryptWithOrgKey` round-trips.
- Wire into `test:orgs-web`. Gate + commit.

## Task 2: useOrgCollectionActions hook
- `webapp/src/hooks/useOrgCollectionActions.ts` (new), mirroring `useOrgMemberActions`:
  `{ collections, loading, error, reload, create(name), rename(id, name), remove(id), loadGrants(id), saveGrants(id, grants) }`.
  - `collections: Array<{id, name: string|null}>` — decrypted via `decryptWithOrgKey(orgKeys[orgId])`; name null when key missing or decrypt fails.
  - `create`/`rename` throw `txt_org_key_unavailable` without the org key (fail closed); encrypt then POST/PUT then `reload()` + success toast.
  - `remove` → DELETE + reload + toast. `saveGrants` → PUT + toast.
- Gate + commit.

## Task 3: Collections tab UI
- `OrganizationDetailPage.tsx`: extend tab state to `'members' | 'collections'`, render both tab buttons, Collections table (Name — locked placeholder when null, Members count via grants shown lazily or `—`, Actions: Manage access / Rename / Delete), "New collection" btn in section head (disabled without org key, title hint).
- Create + Rename dialogs (name input, prefilled decrypted name on rename); Delete warning dialog (`danger`, interpolated name).
- i18n keys (~14) ×10 locales. Gate + commit.

## Task 4: Manage Access dialog
- Dialog listing all non-owner members (from the existing members hook): per row an Access checkbox; when checked, secondary "Read only" and "Hide passwords" checkboxes. Loads current grants on open (`loadGrants`); Save calls `saveGrants` with the checked rows (full replace). Invited/accepted members shown with their status badge (grants only take effect once confirmed — help text notes this).
- i18n keys (~8) ×10. Gate + commit.

## Task 5: Verify + ship
- All gates; browser pass in demo (tab renders, dialogs open; API calls fail gracefully in demo).
- PR to fork main, merge, deploy to cdcore-vault-test, live verify: create collection (encrypted name round-trip visible), rename, manage access for the confirmed bitbarrel member, delete.

## Out of scope (unchanged)
Sharing/moving ciphers into collections (phase 5, #19); member-side collection views beyond what sync already exposes.
