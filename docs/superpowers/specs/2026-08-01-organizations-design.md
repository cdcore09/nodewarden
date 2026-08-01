# NodeWarden Organizations — Design

**Date:** 2026-08-01
**Status:** Approved (design review conducted interactively; this document records it)
**Fork:** `cdcore09/nodewarden` (upstream: `shuaiplus/nodewarden`)

## Goal

Add Bitwarden-compatible organizations, collections, and sharing to NodeWarden so one operator ("the family tech support") can run multiple mutually-isolated household/team vaults on Cloudflare Workers, administered through the NodeWarden web vault and consumed through official Bitwarden clients.

## Requirements

- **Multiple isolated organizations.** Concretely: the operator's own household, a parents' household, and a siblings' household. Members of one org must not be able to see another org's items, collections, membership, or existence.
- **Sole administrator.** The operator is owner/admin of every org. All other members are plain users. (The role column supports more tiers; no UI or logic is built for them.)
- **Per-collection access** with `read_only` and `hide_passwords` flags stored and toggleable (clients require the fields regardless; defaults grant full access).
- **Clients:** official browser extension, iOS/Android apps, desktop apps (member usage); NodeWarden's custom web vault (all admin work + member usage).
- **Mergeable fork.** Org support is additive; edits to upstream-shared files are minimal and enumerated. Monthly upstream merges must stay cheap.

### Out of scope (deliberately)

Groups, enterprise policies, custom permissions, SSO/SCIM/directory sync, the public/organization API, emergency-access changes, billing/seat logic. The schema must not preclude adding these later, but no code is written for them.

## Architecture

### Zero-knowledge model (unchanged)

All sharing cryptography is client-side, per the standard Bitwarden model: clients generate a symmetric org key and an org RSA keypair; the org key is wrapped per-member with each member's public RSA key at confirm time; org ciphers and collection names are encrypted with the org key. The server stores and serves encrypted blobs and enforces access control. It never holds usable key material.

### New modules (additive)

| Path | Purpose |
|------|---------|
| `migrations/0002_organizations.sql` | All new tables + `ciphers.organization_id` |
| `src/services/storage-org-repo.ts` | Organizations + memberships persistence |
| `src/services/storage-collection-repo.ts` | Collections, grants, cipher↔collection mappings |
| `src/services/org-access.ts` | **The** access-control chokepoint (see below) |
| `src/handlers/organizations.ts` | Org lifecycle + member endpoints |
| `src/handlers/org-collections.ts` | Collection CRUD + grants + sharing endpoints |
| `webapp/src/components/Organizations*.tsx` | Admin + member UI |

### Surgical edits to shared files (the complete list)

- `src/router-authenticated.ts` — register new routes
- `src/handlers/sync.ts` — org data in the sync payload
- `src/handlers/ciphers.ts`, `src/handlers/attachments.ts` — replace inline ownership checks with `org-access.ts` calls
- Webapp route table + vault list components — org badges/filters, share dialog entry point

Any change outside this list during implementation is a design deviation and gets flagged.

## Data model

Five new tables; column semantics follow Vaultwarden's schema so API mapping is direct.

- **`organizations`** — `id`, `name`, `public_key` (plaintext), `encrypted_private_key` (wrapped with org key client-side).
- **`organization_users`** — `id`, `user_id` (nullable until account exists), `org_id`, `email`, `role` (`owner` | `user`), `status` (`invited` → `accepted` → `confirmed`), `encrypted_org_key` (null until confirm), timestamps. Unique on (`org_id`, `email`).
- **`collections`** — `id`, `org_id`, `name` (encrypted with org key).
- **`collection_users`** — `collection_id`, `org_user_id`, `read_only`, `hide_passwords`.
- **`cipher_collections`** — `cipher_id`, `collection_id`.

Altered: **`ciphers`** gains nullable `organization_id` + index. Invariant: a cipher is owned by exactly one of (`user_id`, `organization_id`).

Isolation is structural: every org-scoped query joins through a **confirmed** `organization_users` row for the requesting user. There is no query path that crosses an org boundary.

## API surface (~30 endpoints)

Response/request shapes are copied from Vaultwarden's handlers (the de-facto spec for official-client compatibility).

- **Org lifecycle:** create (client sends pre-encrypted keys), get, update, delete; orgs enumerated via sync/profile.
- **Members:** list, invite, resend invite, confirm, remove, fetch member public key.
- **Collections:** CRUD; per-member grants with `read_only`/`hide_passwords`.
- **Sharing:** move cipher(s) to org + collections; update a cipher's collection assignments. Org attachments follow their cipher.

### Invitation flow (three steps, Bitwarden's trust model)

1. **Invite** — admin enters email in web vault → `invited` row → email sent via the Worker's `send_email` binding (Cloudflare Email Sending, already onboarded on the account).
2. **Accept** — invitee follows the link, creates/logs into an account on this server → `accepted`. Proves control of the email. No keys yet.
3. **Confirm** — admin reviews the pending member in the web vault; admin's browser fetches the member's public key (fingerprint shown for verification) and wraps the org key to it → `confirmed`. Only now can the member decrypt.

The accept/confirm gap is the defense against intercepted invite emails: acceptance alone yields nothing decryptable.

## Access control & sync

### `org-access.ts` — single chokepoint

Two functions, `canRead(user, cipher)` / `canWrite(user, cipher)`, deny-by-default. Personal cipher: requester owns it. Org cipher: requester has a **confirmed** membership in the cipher's org **and** the cipher is in a collection granted to them; writes additionally require the grant is not `read_only`. All cipher/attachment handlers route through these functions; the security-critical logic lives in one auditable file.

### Sync payload additions (`sync.ts`)

- `profile.organizations[]` — role, status, and the requester's wrapped org key per org.
- `collections[]` — collections visible to the requester.
- Org ciphers merged into the cipher list with `organizationId` and `collectionIds` populated.

Official clients drive all org behavior from this response; shape fidelity is the compatibility contract.

### Notifications

Org cipher mutations bump the revision of, and push (via the existing Durable Object notifications hub) to, every confirmed member of that org. Reuses existing per-user machinery in a loop; no new infrastructure.

### Error behavior

Unauthorized and nonexistent are indistinguishable (same 404) — no existence leaks across org boundaries. Error bodies mimic Bitwarden's shapes so clients render them.

## Web vault UI

Follows existing webapp component patterns and its existing client-side crypto (Web Crypto). New crypto operations — org-key generation, unwrap, encrypt/decrypt with org key, RSA wrap at confirm — are compositions of primitives already in use. No new algorithms or libraries.

**Admin (org owners only):**
- Organizations page: list + create (all key generation in-browser; server receives blobs).
- Org detail: **Members** tab (invite, pending list + resend, confirm with key fingerprint, remove) and **Collections** tab (CRUD + a member×collection access matrix with read-only/hide-passwords toggles).

**Member:**
- Vault list: ownership badge, org/collection filters; org items decrypt with the unwrapped org key from sync.
- "Move to organization" dialog (org + collection picker) — the share action.
- Members see only their own orgs; components render exclusively from server-scoped sync data.

## Testing

- **Unit:** exhaustive decision-matrix tests for `org-access.ts` (ownership type × membership status × grant presence × read-only × read/write — every cell asserted). Repo tests prove query scoping never crosses org boundaries.
- **Adversarial isolation:** an account in org A replaying real IDs from org B (ciphers, collections, attachments, members) receives indistinguishable 404s; accepted-but-unconfirmed members decrypt nothing; removed members lose access on next sync and receive immediate push revocation.
- **Client compatibility:** per-phase checklist against real extension/mobile/desktop: login, sync, view/edit org item, share, revoke, org attachments.
- **Security review gate:** automated security review over the full diff (focus: `org-access.ts`, sync) before any real credential enters the system.

## Deployment & rollout

- **Workers:** `cdcore-vault` (prod, `vault.corderocore.com`) and `cdcore-vault-test` (test, `vault-test.corderocore.com`), each with own D1, R2 bucket, KV, `send_email` binding, secrets via `wrangler secret put`. Wrangler config mirrors the account's existing workers (`cdcore-contact`, `cdcore-newsletter`).
- **Credentials:** scoped Account API Token in `.env` (gitignored) as `CLOUDFLARE_API_TOKEN`; R2 S3 credentials reserved for the backup target.
- **Rollout order:** all phases verified on test with throwaway accounts → prod with operator's vault only (one week) → operator's household → parents → siblings, one org at a time. Scheduled backups (R2 via S3 API) configured and verified **before** the first real vault migrates.
- **Ongoing:** monthly upstream merge + client-update compatibility check.

## Build phases (each gated on its tests passing)

1. Schema + org CRUD + owner membership
2. Invite → accept → confirm flow (email)
3. Collections, sharing, ACL threading through sync/ciphers/attachments
4. Web vault admin UI
5. Web vault member UI

Estimated effort: 4–8 weeks part-time; phase 3 carries the risk concentration.
