# Organizations Phase 4a (Client Org-Crypto + Create/List Orgs + Org-Item Display) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In NodeWarden's own web vault, the operator can create an organization (keys generated in-browser), see their organizations listed, and have that org's collections + ciphers decrypt and display — establishing the client-side org cryptography the rest of the admin UI (4b) builds on.

**Architecture:** The webapp is Preact + `wouter` routing with a per-page component structure (`webapp/src/components/*Page.tsx`), a typed API layer (`webapp/src/lib/api/*.ts`), and Web Crypto primitives in `webapp/src/lib/crypto.ts` (`encryptBw`/`decryptBw`/`base64`) plus RSA-OAEP usage in `account-passkeys.ts` and `admin-backup-portable.ts`. Phase 4a adds: a security-critical `org-crypto.ts` module (unit-tested in isolation, the way 3a's `org-access.ts` was), a webapp org API layer, a create-org flow + Organizations list page, and threading the unwrapped org key into the vault decrypt path so org items render. Backend is complete (Phases 1–3b, on `main`) — this phase is webapp-only.

**Tech Stack:** Preact, TypeScript, Vite, `wouter`, Web Crypto (SubtleCrypto), `tsx --test` (node Web Crypto) for the crypto module.

**Design constraint (READ FIRST):** This is additive UI in an EXISTING web vault with its own design system. Do NOT invent a new aesthetic. MATCH the existing NodeWarden visual language: reuse existing components (`ConfirmDialog`, `StandalonePageFrame`, `LoadingState`, `ToastHost`), existing className conventions (`btn`, `btn-secondary`, `btn-primary`, `small`, card/list patterns — grep an existing page like `SettingsPage.tsx`/`DomainRulesPage.tsx` for the vocabulary), the existing theme tokens, and the existing page/routing/nav patterns. The org admin UI must feel native, not bolted on. When in doubt, copy the structure of the nearest existing management page.

## Global Constraints

- **Mergeable fork.** New files preferred: `webapp/src/lib/org-crypto.ts`, `webapp/src/lib/api/organizations.ts`, `webapp/src/components/OrganizationsPage.tsx` (+ any sub-components), `scripts/org-crypto.test.ts`. Shared files this phase may modify: `webapp/src/components/AppMainRoutes.tsx` (route), the app nav component (nav entry — grep for where existing routes like `/sends`/`/settings` are linked), the vault decrypt/sync path (thread org keys — identify the minimal file), `package.json` (test wiring). Anything else = design deviation, stop and flag.
- **CRYPTO CORRECTNESS IS PARAMOUNT.** All org cryptography lives in `org-crypto.ts` and only there. It is unit-tested with real round-trips before any UI uses it. Never hand-roll crypto in a component. The org key never leaves the browser unencrypted; the server only ever receives: the org name (plaintext — official clients send org names in plaintext, only collection names/cipher fields are E2E-encrypted), the org RSA public key (plaintext spki), the org private key ENCRYPTED with the org symmetric key, and the org symmetric key RSA-wrapped with a member's public key. NEVER send a raw org key.
- **The Bitwarden org-key model (implement exactly):**
  - Org symmetric key `orgKey` = 64 random bytes (enc = `orgKey[0:32]`, mac = `orgKey[32:64]`).
  - Org RSA keypair generated in-browser (RSA-OAEP, 2048, matching `account-passkeys.ts` params).
  - `keys.publicKey` sent to server = org public key, spki, base64.
  - `keys.encryptedPrivateKey` sent = org RSA private key (pkcs8) encrypted with `orgKey` halves via `encryptBw` (Bitwarden enc-string).
  - `key` sent (the OWNER's wrapped org key) = `orgKey` RSA-OAEP-encrypted with the USER'S OWN public key (so the owner can later unwrap it with their account private key). Format: Bitwarden type-4 enc string (`4.<base64>`).
  - **Unwrap (to read org data):** `profile.organizations[].key` is RSA-wrapped with the user's public key → RSA-OAEP-decrypt with the user's ACCOUNT RSA private key → `orgKey`. The account private key is obtained by decrypting `profile.privateKey` with the session vault key — MIRROR the existing pattern in `webapp/src/lib/admin-backup-portable.ts` (it already imports/decrypts `profile.privateKey` for RSA-OAEP). Do not reinvent it.
  - Org collection names + org cipher fields decrypt with `orgKey` halves exactly as personal items decrypt with the user key (reuse `decryptSingleCipher`/`decryptBw` with `orgKey[0:32]`/`orgKey[32:64]`).
- **Session key material** is already available post-unlock (the vault key `sym`; `userEnc = sym[0:32]`, `userMac = sym[32:64]`) — the same material `decryptSingleCipher` uses. Find how the current vault page obtains it and reuse; do NOT re-derive from the master password.
- **Server contract (from Phase 1, do not change):** `POST /api/organizations` body `{ name, key, keys: { publicKey, encryptedPrivateKey } }`; the org appears in `GET /api/sync` → `profile.organizations[]` (each with `id`, `name`, `key`=the user's wrapped org key, `status`, `type`) and its collections in the sync `collections[]` (org-key-encrypted names) and org ciphers in the cipher list (with `organizationId`/`collectionIds`).
- Commit after every task; branch `feat/organizations-phase-4a` (worktree via superpowers:using-git-worktrees, from `main`). NO Co-Authored-By or other trailers; conventional-commit style.
- Never touch `.env`/secrets. Build gate: `npm run build` (vite) must succeed with no new TS errors. Crypto tests: `tsx --test scripts/org-crypto.test.ts` (wire into a new `test:orgs-web` script + add to whatever aggregate the repo runs).

---

### Task 1: `org-crypto.ts` — the client org-crypto module (unit-tested)

**Files:** Create `webapp/src/lib/org-crypto.ts`; Test `scripts/org-crypto.test.ts` (+ `package.json` `test:orgs-web` script).

**Interfaces (FROZEN — 4b imports these):**
- `generateOrgKeys(userPublicKeySpkiB64: string): Promise<{ orgKey: Uint8Array; publicKey: string; encryptedPrivateKey: string; wrappedKeyForOwner: string }>` — orgKey is the raw 64 bytes (kept in memory only); publicKey = org spki b64; encryptedPrivateKey = org priv encrypted with orgKey (enc string); wrappedKeyForOwner = orgKey RSA-wrapped with the user's public key (type-4 enc string) — this is the `key` field POSTed on create.
- `unwrapOrgKey(wrappedKey: string, userRsaPrivateKey: CryptoKey): Promise<Uint8Array>` — RSA-OAEP-decrypt the type-4 wrapped key → orgKey (64 bytes). Throws on malformed/failed.
- `rsaWrapOrgKeyForMember(orgKey: Uint8Array, memberPublicKeySpkiB64: string): Promise<string>` — RSA-OAEP-encrypt orgKey with the member's public key → type-4 enc string (used by 4b confirm; include now, it's pure and testable).
- `orgKeyHalves(orgKey: Uint8Array): { enc: Uint8Array; mac: Uint8Array }`.
- `encryptWithOrgKey(plaintext: string, orgKey: Uint8Array): Promise<string>` and `decryptWithOrgKey(encString: string, orgKey: Uint8Array): Promise<string>` (thin wrappers over `encryptBw`/`decryptStr` with the halves; used for collection names).

Reuse `crypto.ts` primitives (`encryptBw`, `decryptBw`, `decryptStr`, `base64ToBytes`, `bytesToBase64`, `requireWebCrypto`) — do not duplicate them. RSA params must match `account-passkeys.ts` (RSA-OAEP, SHA-1 for the wrap step per Bitwarden's type-4 convention — VERIFY against `admin-backup-portable.ts`'s decrypt params so wrap/unwrap are symmetric).

- [ ] **Step 1: Write the failing round-trip tests** (`scripts/org-crypto.test.ts`): (a) generate a user RSA keypair in the test, `generateOrgKeys(userPubSpkiB64)` → `unwrapOrgKey(result.wrappedKeyForOwner, userPrivKey)` returns bytes equal to `result.orgKey`; (b) the org private key round-trips: decrypt `result.encryptedPrivateKey` with `orgKeyHalves(orgKey)` → import as RSA key without error; (c) `rsaWrapOrgKeyForMember` then unwrap with the member's private key returns the same orgKey; (d) `encryptWithOrgKey`/`decryptWithOrgKey` round-trips a collection name string; (e) `unwrapOrgKey` throws on a garbage string. Use node's `crypto.subtle` (available under tsx, per `scripts/web-crypto-availability.test.ts`).
- [ ] **Step 2: Run to verify fail** — `npx tsx --test scripts/org-crypto.test.ts` (module not found).
- [ ] **Step 3: Implement** `org-crypto.ts` per the interfaces, composing `crypto.ts` primitives + SubtleCrypto RSA-OAEP. Keep each function small and single-purpose.
- [ ] **Step 4: Run to verify pass** (all round-trips green) + `npx tsc --noEmit` for the webapp tsconfig (find it — likely `webapp/tsconfig.json` or the root app config) shows no new errors. Add `"test:orgs-web": "tsx --test scripts/org-crypto.test.ts"` to `package.json`.
- [ ] **Step 5: Commit** — `feat(webapp): add client org-crypto module`.

---

### Task 2: Account RSA private key accessor

**Files:** `webapp/src/lib/org-crypto.ts` (or a tiny `webapp/src/lib/account-keys.ts` if cleaner) + reuse.

**Interfaces:** Produces `getAccountRsaPrivateKey(profilePrivateKey: string, userEnc: Uint8Array, userMac: Uint8Array): Promise<CryptoKey>` — decrypt `profile.privateKey` (an enc string) with the session vault key halves → pkcs8 bytes → `importKey('pkcs8', ..., {name:'RSA-OAEP', hash:'SHA-1'}, ['decrypt'])`. MIRROR `admin-backup-portable.ts` lines ~31–52 (it does exactly this decrypt+import for RSA-OAEP) — extract/share rather than duplicate if that code is reusable.

- [ ] **Step 1:** Read `admin-backup-portable.ts`'s private-key import; if it exposes a reusable helper, use it; else add `getAccountRsaPrivateKey` mirroring it. Add a test to `org-crypto.test.ts`: encrypt a known pkcs8 with a vault key, `getAccountRsaPrivateKey` returns a usable RSA-OAEP decrypt key (use it to unwrap an org key end-to-end with Task 1's functions). **Step 2:** typecheck + test green. **Step 3: Commit** — `feat(webapp): add account RSA private key accessor for org key unwrap`.

---

### Task 3: Webapp org API layer

**Files:** Create `webapp/src/lib/api/organizations.ts`; Test: none (thin typed fetch wrappers; verified by the build + the Task 7 browser smoke). Read an existing api module (`webapp/src/lib/api/vault.ts` or `domains.ts`) for the fetch/auth/error conventions and MIRROR them (auth header, base URL, error translation).

**Interfaces:** Produces (4a uses create + reads; the write member/collection calls are included for 4b but 4a only wires what it needs):
- `createOrganization(input: { name: string; key: string; publicKey: string; encryptedPrivateKey: string }): Promise<{ id: string }>` → `POST /api/organizations`.
- `listOrgCollections(orgId: string): Promise<Array<{ id: string; name: string }>>` → `GET /api/organizations/:id/collections` (names are org-key-encrypted; decrypt in the UI).
- Types for the profile organization entry (`{ id; name; key; status; type }`) — the orgs list reads these from the existing profile/sync state, so export a type + a selector rather than a new fetch if the app already holds profile.

- [ ] **Step 1:** Implement the module mirroring the existing api-layer conventions. **Step 2:** `npm run build` clean. **Step 3: Commit** — `feat(webapp): add organizations API client`.

---

### Task 4: Create-org flow + Organizations list page

**Files:** Create `webapp/src/components/OrganizationsPage.tsx` (+ a `CreateOrganizationDialog` sub-component or inline, matching the existing dialog pattern). Read `SettingsPage.tsx`/`DomainRulesPage.tsx`/`ConfirmDialog.tsx` first for the page frame, list, button, and modal conventions.

**Behavior:**
- Lists the user's organizations from the profile state (`profile.organizations[]`) — name + status; empty state matching existing empty-state styling.
- "New organization" action opens a dialog: input for the org name; on submit, get the user's public key (from profile) + session vault key, call `generateOrgKeys(userPublicKeyB64)`, then `createOrganization({ name, key: wrappedKeyForOwner, publicKey, encryptedPrivateKey })`, then refresh profile/sync so the new org appears. Show a toast on success/failure via the existing `ToastHost` pattern. Handle the Web Crypto unavailable case (reuse `requireWebCrypto`'s message).
- Owner-only: the app already knows the user's role per org from `profile.organizations[].type` (0 = owner); creation is always allowed (any admin-role user — the server enforces the admin gate from Phase 1/3a; surface the server's 400 gracefully if a non-admin tries).

- [ ] **Step 1:** Build the page + dialog matching existing patterns; wire the create flow through Task 1's `generateOrgKeys` + Task 3's `createOrganization`. **Step 2:** `npm run build` clean; `tsc --noEmit` no new errors. **Step 3: Commit** — `feat(webapp): add organizations page and create-org flow`.

---

### Task 5: Unwrap org keys + decrypt org collections/ciphers for display

**Files:** The vault decrypt/sync path (identify the minimal file — likely `webapp/src/lib/vault-sync.ts` or wherever `decryptSingleCipher` is invoked over the synced ciphers; grep for `decryptSingleCipher` callers) + a small org-keys cache (in-memory map orgId → orgKey bytes, held in the session/vault state).

**Behavior:**
- On vault load/sync, for each `profile.organizations[]` the user can access, `unwrapOrgKey(org.key, accountRsaPrivateKey)` → cache `orgId → orgKey`.
- When decrypting a cipher whose `organizationId` is set, use that org's `orgKey` halves as the item's base key (instead of the user key) in `decryptSingleCipher` — org ciphers may still carry a per-item `cipher.key` that decrypts with the org key. Collection names (from sync `collections[]`) decrypt with the owning org's key via `decryptWithOrgKey`.
- Result: org ciphers render decrypted in the vault list alongside personal items, and collection names are readable — the "admin can see org items" outcome. Do NOT change personal-cipher decryption.

- [ ] **Step 1:** Thread the org-key cache + org-aware decryption into the sync/decrypt path minimally. Guard: if an org key can't be unwrapped (missing/failed), skip that org's items gracefully (don't crash the whole vault). **Step 2:** `npm run build` + `tsc --noEmit` clean. **Step 3: Commit** — `feat(webapp): decrypt and display org collections and ciphers`.

---

### Task 6: Routing + navigation

**Files:** `webapp/src/components/AppMainRoutes.tsx` (add the `/organizations` route → `OrganizationsPage`, lazy-loaded to match the existing `Suspense`/lazy pattern), and the app nav (add an "Organizations" entry — grep for where `/sends`/`/settings` nav links are rendered and mirror, with an appropriate existing icon).

- [ ] **Step 1:** Register the route + nav entry following existing conventions. **Step 2:** `npm run build` clean. **Step 3: Commit** — `feat(webapp): route and nav entry for organizations`.

---

### Task 7: Build + deploy + browser smoke + gate

**Files:** none new (or a short note in the carryforward).

- [ ] **Step 1: Build gate** — `npm run build` clean; `tsc --noEmit` no new errors; `npx tsx --test scripts/org-crypto.test.ts` green; upstream backend suites (`npm run test:orgs`) still green (this phase is webapp-only, so they must be unchanged).
- [ ] **Step 2: Deploy** the built webapp + worker to `cdcore-vault-test` (the worker serves the built assets): `set -a && source /Users/corderocore/Documents/nodewarden/.env && set +a`; `npm run build`; `npx wrangler deploy -c wrangler.cdcore-test.toml`. (Controller may HOLD this for the user — it touches the Cloudflare account.)
- [ ] **Step 3: Browser smoke** against `https://vault-test.corderocore.com` using claude-in-chrome (or hand to the user): register/log in, open Organizations, create an org (keys generated in-browser), confirm it appears; then via the API or a second step, confirm an org cipher created for that org DECRYPTS and displays in the web vault. Report what was verified. If browser automation isn't available, provide the user a precise manual check script. Purge any test data from the deployed D1 afterward.
- [ ] **Step 4:** `git diff --name-only main...HEAD` all within the allowlist. Update the carryforward doc: Phase 4a done; note what 4b covers (member management: invite/confirm-with-fingerprint/remove; collections CRUD; access matrix). Commit.
- [ ] **Step 5:** Push branch; PR via the user's `/create-pr`. Do NOT merge.

---

## Notes for 4b (member management + collections UI)
- Confirm flow uses `rsaWrapOrgKeyForMember` (built in Task 1) — fetch the member's public key, wrap the org key, POST confirm; show the member's key fingerprint for verification.
- Collection create/rename encrypts the name with `encryptWithOrgKey`.
- The member×collection access matrix drives `PUT /api/organizations/:id/collections/:cid/users`.
