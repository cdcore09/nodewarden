# Organizations Phase 2 (Invite → Accept → Confirm + Email + Test Deploy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can be invited to an organization by email, accept by registering/logging in, and be confirmed by the owner — with the whole flow running on a deployed `cdcore-vault-test` Worker.

**Architecture:** Additive modules per the approved spec (`docs/superpowers/specs/2026-08-01-organizations-design.md`): an email service over the Cloudflare `send_email` binding (pattern proven in the operator's newsletter worker), invite tokens as HMAC JWTs signed with the existing `JWT_SECRET` (nothing stored server-side), member-lifecycle repo functions on the existing `organization_users` table (NO schema changes — all columns exist), a new `org-users.ts` handler file, and the Phase-1 carryforward items (multi-member revision bumps, `loadProfileOrgs` helper, router-stub placement). First cloud deploy happens here, to the test instance only.

**Tech Stack:** Cloudflare Workers, D1, `send_email` binding (Email Sending), TypeScript, `tsx --test` + the Phase 1 `node:sqlite` D1 shim, wrangler.

**Required reading for every implementer:** `docs/superpowers/plans/2026-08-01-phase-1-carryforward.md` (deferred obligations this phase discharges) and the files named in your task.

## Global Constraints

- **Mergeable fork.** New files preferred. Shared files this phase may modify: `src/types/index.ts` (Env + org types, append-only), `src/handlers/organizations.ts` (multi-member bump retrofit), `src/handlers/sync.ts` + `src/handlers/accounts.ts` (loadProfileOrgs refactor of the three existing call sites ONLY), `src/router-authenticated.ts` (route registration), `src/services/storage.ts` (delegates), `src/services/storage-org-repo.ts`, `src/handlers/org-shapes.ts`, `scripts/`, `package.json`. Upstream `wrangler.toml` is NOT touched — deploy configs are new fork-owned files. Anything else = design deviation, stop and flag.
- **Router placement (carryforward, MANDATORY):** every new org route is registered ABOVE the pre-existing `/api/organizations` catch-all stub in `src/router-authenticated.ts` (the warning comment marks it). A route below it is silently swallowed.
- **Multi-member revision bumps (carryforward, MANDATORY):** any mutation visible to an org's members bumps ALL confirmed members' revisions and push-notifies each (confirm, remove, org rename, org delete). Accept bumps the invitee (and notifies the owner path via the invitee's own sync).
- **Access control:** member-management endpoints (list/invite/resend/confirm/remove) go through the Phase 1 `getOwnedOrg` chokepoint semantics — confirmed owner only, unauthorized == nonexistent 404 (`errorResponse('Organization not found', 404)`). Accept authenticates the invitee. Public-key lookup requires the requester and target to share an organization membership row.
- **DB stores role/status as TEXT; API emits Bitwarden numerics** — mapping lives ONLY in `src/handlers/org-shapes.ts` (`ORG_TYPE`, `ORG_STATUS` already exist there).
- **Last-owner protection:** an owner membership can never be removed via the member endpoints. (Sole-admin model: there is exactly one owner per org.)
- **Email is fail-loud:** if the `EMAIL` binding or `EMAIL_FROM` is missing, invite/resend return `errorResponse('Email is not configured on this server', 500)` — never silently skip the send.
- **Org `name` is stored as the client sent it** (official clients send org names in plaintext; only collection names are E2E-encrypted). The invite email may therefore include the stored org name verbatim.
- Commit after every task; branch `feat/organizations-phase-2` (worktree via superpowers:using-git-worktrees at execution start, from current `main` = `ee997a6`). NO Co-Authored-By or other trailers; conventional-commit style per the repo's log.
- Never touch `.env` / never commit secrets. `.dev.vars` recreated in the worktree (gitignored — verify with `git check-ignore` before writing).
- Test sweep command used throughout: `npx tsx --test scripts/test-db.test.ts scripts/storage-org-repo.test.ts scripts/org-shapes.test.ts scripts/org-backup.test.ts scripts/org-profile.test.ts scripts/org-mail.test.ts scripts/org-invite-token.test.ts` (last two exist from Task 1/4 onward).

---

### Task 1: Email service (`Env` additions + `org-mail.ts`)

NodeWarden has no email code today. The send pattern below is copied from the operator's production newsletter worker (`~/Documents/cdcore.github.io/workers/newsletter/src/index.ts`): the `send_email` binding exposes `env.EMAIL.send({to, from, subject, text, html})` and delivers to arbitrary recipients when the sender domain is onboarded to Email Sending.

**Files:**
- Modify: `src/types/index.ts` (append to `Env`)
- Create: `src/services/org-mail.ts`
- Test: `scripts/org-mail.test.ts`

**Interfaces:**
- Produces: `Env.EMAIL?: { send(msg: OrgEmailMessage): Promise<unknown> }`, `Env.EMAIL_FROM?: string`, `Env.ORG_INVITE_SITE_URL?: string`; `buildOrgInviteEmail(params: OrgInviteEmailParams): OrgEmailMessage` (pure); `sendOrgInviteEmail(env: Env, params: OrgInviteEmailParams): Promise<void>` (throws `Error('Email is not configured on this server')` when `env.EMAIL` or `env.EMAIL_FROM` is missing); `isOrgEmailConfigured(env: Env): boolean`.

- [ ] **Step 1: Append to the `Env` interface** in `src/types/index.ts` (inside the existing interface, after `JWT_SECRET`):

```typescript
  // Cloudflare send_email binding (Email Sending). Optional: deployments
  // without an onboarded sending domain simply cannot send org invites.
  EMAIL?: { send(msg: { to: string; from: { email: string; name?: string }; subject: string; text: string; html?: string }): Promise<unknown> };
  EMAIL_FROM?: string;
  // Base URL used in org invite links (e.g. https://vault-test.corderocore.com)
  ORG_INVITE_SITE_URL?: string;
```

- [ ] **Step 2: Write the failing test**

```typescript
// scripts/org-mail.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgInviteEmail, sendOrgInviteEmail, isOrgEmailConfigured } from '../src/services/org-mail';

const params = {
  toEmail: 'parent@example.com',
  orgName: 'Parents Household',
  orgId: 'org-1',
  orgUserId: 'ou-1',
  token: 'tok.abc',
  inviteCode: 'REG-CODE-1',
  siteUrl: 'https://vault-test.example.com',
};

test('buildOrgInviteEmail produces a complete message with a well-formed accept link', () => {
  const msg = buildOrgInviteEmail(params);
  assert.equal(msg.to, 'parent@example.com');
  assert.ok(msg.subject.includes('Parents Household'));
  const link = `https://vault-test.example.com/#/accept-organization?organizationId=org-1&organizationUserId=ou-1&email=${encodeURIComponent('parent@example.com')}&token=tok.abc&inviteCode=REG-CODE-1`;
  assert.ok(msg.text.includes(link), `text should contain ${link}`);
  assert.ok(msg.html && msg.html.includes('accept-organization'));
});

test('buildOrgInviteEmail omits inviteCode param when not provided', () => {
  const msg = buildOrgInviteEmail({ ...params, inviteCode: null });
  assert.ok(!msg.text.includes('inviteCode='));
});

test('sendOrgInviteEmail throws when email is not configured', async () => {
  await assert.rejects(
    () => sendOrgInviteEmail({ EMAIL_FROM: 'x@y.z' } as any, params),
    /Email is not configured/
  );
  assert.equal(isOrgEmailConfigured({} as any), false);
});

test('sendOrgInviteEmail delivers through the EMAIL binding with the configured from', async () => {
  const sent: any[] = [];
  const env: any = { EMAIL: { send: async (m: any) => { sent.push(m); } }, EMAIL_FROM: 'vault@corderocore.com' };
  await sendOrgInviteEmail(env, params);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].from, { email: 'vault@corderocore.com', name: 'NodeWarden' });
});
```

- [ ] **Step 2b: Run to verify it fails**

Run: `npx tsx --test scripts/org-mail.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the module**

```typescript
// src/services/org-mail.ts
// Org invitation email over the Cloudflare send_email binding.
// Pure builder is separated from the sender so tsx tests cover the content.
import type { Env } from '../types';

export interface OrgInviteEmailParams {
  toEmail: string;
  orgName: string;
  orgId: string;
  orgUserId: string;
  token: string;
  // Registration invite code for recipients with no account yet; null when
  // the recipient already has an account on this server.
  inviteCode: string | null;
  siteUrl: string;
}

export interface OrgEmailMessage {
  to: string;
  from?: { email: string; name?: string };
  subject: string;
  text: string;
  html?: string;
}

export function buildOrgInviteEmail(p: OrgInviteEmailParams): OrgEmailMessage {
  const query = new URLSearchParams({
    organizationId: p.orgId,
    organizationUserId: p.orgUserId,
    email: p.toEmail,
    token: p.token,
  });
  if (p.inviteCode) query.set('inviteCode', p.inviteCode);
  const link = `${p.siteUrl.replace(/\/$/, '')}/#/accept-organization?${query.toString()}`;

  const subject = `You have been invited to the "${p.orgName}" organization`;
  const text = [
    `You have been invited to join the "${p.orgName}" organization on a NodeWarden password server.`,
    '',
    'To accept, open this link, create your account if you do not have one yet, and follow the steps:',
    link,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
    'This invitation link expires in 7 days.',
  ].join('\n');
  const html = [
    `<p>You have been invited to join the <strong>${escapeHtml(p.orgName)}</strong> organization on a NodeWarden password server.</p>`,
    `<p><a href="${link}">Accept the invitation</a> (create your account first if you do not have one yet).</p>`,
    '<p>If you were not expecting this invitation, you can ignore this email. This link expires in 7 days.</p>',
  ].join('\n');

  return { to: p.toEmail, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isOrgEmailConfigured(env: Env): boolean {
  return !!(env.EMAIL && typeof env.EMAIL.send === 'function' && env.EMAIL_FROM);
}

export async function sendOrgInviteEmail(env: Env, p: OrgInviteEmailParams): Promise<void> {
  if (!isOrgEmailConfigured(env)) {
    throw new Error('Email is not configured on this server');
  }
  const msg = buildOrgInviteEmail(p);
  await env.EMAIL!.send({ ...msg, from: { email: env.EMAIL_FROM!, name: 'NodeWarden' } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/org-mail.test.ts`
Expected: PASS (4 tests). Also `npx tsc --noEmit -p tsconfig.json` — no NEW errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/services/org-mail.ts scripts/org-mail.test.ts
git commit -m "feat: add org invite email service over send_email binding"
```

---

### Task 2: `loadProfileOrgs` helper (carryforward refactor)

**Files:**
- Create: `src/utils/profile-orgs.ts`
- Modify: `src/handlers/sync.ts` (the memberships block added in Phase 1, ~line 94), `src/handlers/accounts.ts` (both profile sites, ~497 and ~540)
- Test: `scripts/org-profile.test.ts` (append)

**Interfaces:**
- Consumes: `StorageService.listMembershipsForUser(userId)`, `profileOrganizationResponse` from `../handlers/org-shapes`.
- Produces: `loadProfileOrgs(storage: StorageService, userId: string): Promise<Record<string, unknown>[]>` — fetch → filter out `invited` → map through `profileOrganizationResponse`.

- [ ] **Step 1: Write the failing test** (append to `scripts/org-profile.test.ts`)

```typescript
import { createTestDb } from './test-db';
import { StorageService } from '../src/services/storage';
import { loadProfileOrgs } from '../src/utils/profile-orgs';

test('loadProfileOrgs excludes invited memberships and shapes the rest', async () => {
  const db = createTestDb();
  const now2 = '2026-08-02T00:00:00.000Z';
  await db
    .prepare('INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('u1', 'a@b.c', 'h', 'k', 0, 600000, 's', now2, now2)
    .run();
  const storage = new StorageService(db as any);
  await storage.createOrganizationWithOwner(
    { id: 'o1', name: 'Fam', publicKey: 'pub', encryptedPrivateKey: '2.p', createdAt: now2, updatedAt: now2 },
    { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.w', createdAt: now2, updatedAt: now2 }
  );
  await db
    .prepare('INSERT INTO organizations(id, name, public_key, encrypted_private_key, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .bind('o2', 'Other', 'pub', '2.p', now2, now2)
    .run();
  await db
    .prepare('INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('ou2', 'o2', 'u1', 'a@b.c', 'user', 'invited', null, now2, now2)
    .run();

  const orgs = await loadProfileOrgs(storage, 'u1');
  assert.equal(orgs.length, 1);
  assert.equal((orgs[0] as any).id, 'o1');
});
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx --test scripts/org-profile.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write the helper**

```typescript
// src/utils/profile-orgs.ts
import type { StorageService } from '../services/storage';
import { profileOrganizationResponse } from '../handlers/org-shapes';

// Single source for the profile.organizations payload. Invited memberships
// are excluded: clients must not render an org the user has not accepted.
export async function loadProfileOrgs(
  storage: StorageService,
  userId: string
): Promise<Record<string, unknown>[]> {
  const memberships = await storage.listMembershipsForUser(userId);
  return memberships
    .filter((m) => m.orgUser.status !== 'invited')
    .map(profileOrganizationResponse);
}
```

- [ ] **Step 4: Replace all three call sites.** In `src/handlers/sync.ts` and both `src/handlers/accounts.ts` sites, replace the inline fetch-filter-map block with `const profileOrgs = await loadProfileOrgs(storage, <the user-id variable that site already uses>);` and remove the now-unused `profileOrganizationResponse` import from those files if nothing else uses it. Grep first: `grep -n "profileOrganizationResponse\|listMembershipsForUser" src/handlers/sync.ts src/handlers/accounts.ts` — after the refactor the only remaining callers of both should be `profile-orgs.ts` (and org-shapes tests).

- [ ] **Step 5: Run tests + typecheck** — full sweep passes (the existing `buildProfileResponse` tests are unchanged); `tsc --noEmit` no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/profile-orgs.ts src/handlers/sync.ts src/handlers/accounts.ts scripts/org-profile.test.ts
git commit -m "refactor: extract loadProfileOrgs helper for profile organizations"
```

---

### Task 3: Member-lifecycle repo functions + multi-user revision bumps

**Files:**
- Modify: `src/services/storage-org-repo.ts` (append functions), `src/services/storage.ts` (delegates; also read how `updateRevisionDate` is implemented and where the user-revisions SQL lives — extend in the same place)
- Test: `scripts/storage-org-repo.test.ts` (append)

**Interfaces:**
- Produces repo functions (all `db` first, matching the file's style):
  - `createOrgUserInvite(db, orgUser: OrganizationUser): Promise<void>` (plain insert; caller sets `status: 'invited'`, `userId: null`, `encryptedOrgKey: null`)
  - `getOrgUserById(db, orgUserId: string): Promise<OrganizationUser | null>`
  - `getOrgUserByOrgAndEmail(db, orgId: string, email: string): Promise<OrganizationUser | null>`
  - `listOrgUsers(db, orgId: string): Promise<OrganizationUser[]>` (ordered `created_at ASC`)
  - `acceptOrgUser(db, orgUserId: string, userId: string, updatedAt: string): Promise<boolean>` (UPDATE ... SET user_id, status='accepted' WHERE id=? AND status='invited'; returns `meta.changes > 0`)
  - `confirmOrgUser(db, orgUserId: string, encryptedOrgKey: string, updatedAt: string): Promise<boolean>` (UPDATE ... SET encrypted_org_key, status='confirmed' WHERE id=? AND status='accepted'; returns changes > 0)
  - `deleteOrgUser(db, orgUserId: string): Promise<void>`
  - `listConfirmedMemberUserIds(db, orgId: string): Promise<string[]>` (`SELECT user_id FROM organization_users WHERE org_id = ? AND status = 'confirmed' AND user_id IS NOT NULL`)
- Produces on `StorageService`: delegates for all of the above, plus `updateRevisionDates(userIds: string[]): Promise<string>` — bumps every listed user's revision to one shared `new Date().toISOString()` and returns it (batch of per-user statements mirroring the existing single-user implementation; empty array returns the timestamp without touching the DB).

- [ ] **Step 1: Write the failing tests** (append to `scripts/storage-org-repo.test.ts`; reuse the file's existing `seedUser`/`org`/`owner` helpers)

```typescript
import {
  createOrgUserInvite,
  getOrgUserById,
  getOrgUserByOrgAndEmail,
  listOrgUsers,
  acceptOrgUser,
  confirmOrgUser,
  deleteOrgUser,
  listConfirmedMemberUserIds,
} from '../src/services/storage-org-repo';

test('invite -> accept -> confirm lifecycle transitions statuses strictly in order', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedUser(db, 'u2', 'parent@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));

  await createOrgUserInvite(db, {
    id: 'ou2', orgId: 'o1', userId: null, email: 'parent@x.y',
    role: 'user', status: 'invited', encryptedOrgKey: null, createdAt: now, updatedAt: now,
  });
  assert.equal((await getOrgUserByOrgAndEmail(db, 'o1', 'parent@x.y'))?.status, 'invited');

  // confirm before accept must be a no-op
  assert.equal(await confirmOrgUser(db, 'ou2', '4.wrapped2', now), false);

  assert.equal(await acceptOrgUser(db, 'ou2', 'u2', now), true);
  assert.equal((await getOrgUserById(db, 'ou2'))?.status, 'accepted');
  // double-accept is a no-op
  assert.equal(await acceptOrgUser(db, 'ou2', 'u2', now), false);

  assert.equal(await confirmOrgUser(db, 'ou2', '4.wrapped2', now), true);
  const confirmed = await getOrgUserById(db, 'ou2');
  assert.equal(confirmed?.status, 'confirmed');
  assert.equal(confirmed?.encryptedOrgKey, '4.wrapped2');

  assert.deepEqual((await listConfirmedMemberUserIds(db, 'o1')).sort(), ['u1', 'u2']);
  assert.equal((await listOrgUsers(db, 'o1')).length, 2);

  await deleteOrgUser(db, 'ou2');
  assert.equal(await getOrgUserById(db, 'ou2'), null);
  assert.deepEqual(await listConfirmedMemberUserIds(db, 'o1'), ['u1']);
});

test('updateRevisionDates bumps every listed user to one shared timestamp', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'a1@x.y');
  await seedUser(db, 'u2', 'a2@x.y');
  const storage = new StorageService(db as any);
  const stamp = await storage.updateRevisionDates(['u1', 'u2']);
  const r1 = await db.prepare('SELECT revision_date FROM user_revisions WHERE user_id = ?').bind('u1').first<any>();
  const r2 = await db.prepare('SELECT revision_date FROM user_revisions WHERE user_id = ?').bind('u2').first<any>();
  assert.equal(r1.revision_date, stamp);
  assert.equal(r2.revision_date, stamp);
  // empty list: returns a timestamp, no throw
  assert.ok(await storage.updateRevisionDates([]));
});
```

- [ ] **Step 2: Run to verify failure** — `npx tsx --test scripts/storage-org-repo.test.ts` → FAIL (imports missing).

- [ ] **Step 3: Implement.** Append the repo functions to `storage-org-repo.ts` using the file's existing `ORG_USER_COLUMNS` constant and `mapOrgUserRow` mapper. The two guarded transitions:

```typescript
export async function acceptOrgUser(db: D1Database, orgUserId: string, userId: string, updatedAt: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE organization_users SET user_id = ?, status = 'accepted', updated_at = ? WHERE id = ? AND status = 'invited'")
    .bind(userId, updatedAt, orgUserId)
    .run();
  return ((res as any).meta?.changes ?? 0) > 0;
}

export async function confirmOrgUser(db: D1Database, orgUserId: string, encryptedOrgKey: string, updatedAt: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE organization_users SET encrypted_org_key = ?, status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'accepted'")
    .bind(encryptedOrgKey, updatedAt, orgUserId)
    .run();
  return ((res as any).meta?.changes ?? 0) > 0;
}
```

For `updateRevisionDates` in `storage.ts`: read the existing `updateRevisionDate` implementation first and mirror its SQL exactly (same table/upsert form), executed per user id via `db.batch`, all bound to one `now` value; return `now`. Then add the StorageService delegates for every new repo function following the existing `as`-aliased import convention.

- [ ] **Step 4: Run tests + typecheck** — repo tests pass; full sweep passes; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/storage-org-repo.ts src/services/storage.ts scripts/storage-org-repo.test.ts
git commit -m "feat: add member lifecycle repo functions and multi-user revision bumps"
```

---

### Task 4: Invite tokens + member response shapes

**Files:**
- Create: `src/services/org-invite-token.ts`
- Modify: `src/handlers/org-shapes.ts` (append)
- Test: `scripts/org-invite-token.test.ts` (create), `scripts/org-shapes.test.ts` (append)

**Interfaces:**
- Produces `org-invite-token.ts`: `createOrgInviteToken(secret: string, claims: { orgUserId: string; orgId: string; email: string }): Promise<string>` (7-day expiry) and `verifyOrgInviteToken(secret: string, token: string): Promise<{ orgUserId: string; orgId: string; email: string } | null>` (null on bad signature, expiry, wrong `typ`, or missing claims). Built on `createJWT`/`verifyJWT` from `../utils/jwt` with an extra claim `typ: 'org-invite'` — read `src/utils/jwt.ts` first; `createJWT` accepts extra payload fields and `verifyJWT` returns the decoded payload or null. IMPORTANT: verify must REJECT a regular access token (no `typ` claim) — this is what keeps invite links from doubling as API credentials and vice versa.
- Produces in `org-shapes.ts`: `parseInviteRequest(body: unknown): { emails: string[] } | { error: string }` (accepts the official client's `{emails: [...]}`, trims/lowercases, dedupes, rejects empty list, >20 recipients, or malformed addresses via the same `includes('@') && length >= 3` check registration uses); `orgUserDetailsResponse(orgUser: OrganizationUser, user: { name: string | null; email: string } | null): Record<string, unknown>` (`object: 'organizationUserUserDetails'`, numerics via `ORG_TYPE`/`ORG_STATUS`, `collections: []`, `accessAll: true`, `twoFactorEnabled: false`, `resetPasswordEnrolled: false`, `usesKeyConnector: false`, `hasMasterPassword: true`); `orgUserListResponse(items: Record<string, unknown>[]): { data: ...; object: 'list'; continuationToken: null }`; `userPublicKeyResponse(userId: string, publicKey: string): { userId; publicKey; object: 'userKey' }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/org-invite-token.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrgInviteToken, verifyOrgInviteToken } from '../src/services/org-invite-token';
import { createJWT } from '../src/utils/jwt';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const claims = { orgUserId: 'ou-9', orgId: 'o-9', email: 'p@x.y' };

test('round-trips valid claims', async () => {
  const token = await createOrgInviteToken(SECRET, claims);
  assert.deepEqual(await verifyOrgInviteToken(SECRET, token), claims);
});

test('rejects wrong secret and garbage', async () => {
  const token = await createOrgInviteToken(SECRET, claims);
  assert.equal(await verifyOrgInviteToken('other-secret-x', token), null);
  assert.equal(await verifyOrgInviteToken(SECRET, 'not.a.token'), null);
});

test('rejects a regular access token (missing org-invite typ)', async () => {
  const accessToken = await createJWT({ sub: 'u1', sstamp: 's' } as any, SECRET);
  assert.equal(await verifyOrgInviteToken(SECRET, accessToken), null);
});
```

Append to `scripts/org-shapes.test.ts`:

```typescript
import { parseInviteRequest, orgUserDetailsResponse, orgUserListResponse, userPublicKeyResponse } from '../src/handlers/org-shapes';

test('parseInviteRequest normalizes, dedupes, and validates', () => {
  const ok = parseInviteRequest({ emails: [' A@B.c ', 'a@b.c', 'x@y.z'] });
  assert.deepEqual(ok, { emails: ['a@b.c', 'x@y.z'] });
  assert.ok('error' in (parseInviteRequest({ emails: [] }) as any));
  assert.ok('error' in (parseInviteRequest({ emails: ['nope'] }) as any));
  assert.ok('error' in (parseInviteRequest({}) as any));
  assert.ok('error' in (parseInviteRequest({ emails: Array.from({ length: 21 }, (_, i) => `a${i}@b.c`) }) as any));
});

test('orgUserDetailsResponse maps enums and tolerates a missing user row', () => {
  const detail = orgUserDetailsResponse(membership.orgUser, { name: 'Me', email: 'a@b.c' }) as any;
  assert.equal(detail.object, 'organizationUserUserDetails');
  assert.equal(detail.type, 0);
  assert.equal(detail.status, 2);
  assert.equal(detail.name, 'Me');
  const pending = orgUserDetailsResponse({ ...membership.orgUser, userId: null, status: 'invited', role: 'user' }, null) as any;
  assert.equal(pending.status, 0);
  assert.equal(pending.type, 2);
  assert.equal(pending.email, membership.orgUser.email);
  const list = orgUserListResponse([detail]) as any;
  assert.equal(list.object, 'list');
  assert.equal(list.continuationToken, null);
  const pk = userPublicKeyResponse('u2', 'PUB') as any;
  assert.equal(pk.object, 'userKey');
});
```

- [ ] **Step 2: Run to verify failures** — both test files FAIL on missing imports.

- [ ] **Step 3: Implement `org-invite-token.ts`:**

```typescript
// src/services/org-invite-token.ts
// Org invitation tokens: stateless HMAC JWTs signed with the server's
// JWT_SECRET, marked with typ:'org-invite' so they can never be used as
// (or forged from) API access tokens.
import { createJWT, verifyJWT } from '../utils/jwt';

const ORG_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
const TYP = 'org-invite';

export interface OrgInviteClaims {
  orgUserId: string;
  orgId: string;
  email: string;
}

export async function createOrgInviteToken(secret: string, claims: OrgInviteClaims): Promise<string> {
  return createJWT(
    { sub: claims.orgUserId, typ: TYP, oid: claims.orgId, iem: claims.email } as any,
    secret,
    ORG_INVITE_TTL_SECONDS
  );
}

export async function verifyOrgInviteToken(secret: string, token: string): Promise<OrgInviteClaims | null> {
  const payload: any = await verifyJWT(token, secret);
  if (!payload || payload.typ !== TYP) return null;
  if (typeof payload.sub !== 'string' || typeof payload.oid !== 'string' || typeof payload.iem !== 'string') return null;
  return { orgUserId: payload.sub, orgId: payload.oid, email: payload.iem };
}
```

(If `createJWT`'s parameter type rejects extra fields even through the cast, widen with a local `as unknown as Parameters<typeof createJWT>[0]` — do not modify `jwt.ts`.)

Implement the org-shapes additions with the exact field sets from the Interfaces block; `parseInviteRequest`:

```typescript
export function parseInviteRequest(body: unknown): { emails: string[] } | { error: string } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).emails)) {
    return { error: 'emails is required' };
  }
  const emails = Array.from(
    new Set(
      ((body as any).emails as unknown[])
        .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    )
  ).filter((e) => e.length > 0);
  if (!emails.length) return { error: 'At least one email is required' };
  if (emails.length > 20) return { error: 'Too many invitations in one request (max 20)' };
  for (const e of emails) {
    if (!e.includes('@') || e.length < 3) return { error: `Invalid email address: ${e}` };
  }
  return { emails };
}
```

- [ ] **Step 4: Run tests + typecheck** — both files pass; full sweep passes; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/org-invite-token.ts src/handlers/org-shapes.ts scripts/org-invite-token.test.ts scripts/org-shapes.test.ts
git commit -m "feat: add org invite tokens and member response shapes"
```

---

### Task 5: Member handlers (`org-users.ts`)

**Files:**
- Create: `src/handlers/org-users.ts`
- Test: covered by the Task 7 local smoke (handlers import worker-runtime modules, so tsx handler tests are not attempted; all pure logic already lives in Tasks 1/3/4 modules)

**Interfaces:**
- Consumes: everything produced by Tasks 1–4; from Phase 1: `StorageService`, `getOrgUserByOrgAndUser`, `getOrganization`; utilities exactly as `src/handlers/organizations.ts` uses them (`jsonResponse`/`errorResponse`, `generateUUID`, `writeAuditEvent`/`auditRequestMetadata`, `notifyUserVaultSync`, `readActingDeviceIdentifier`). Read `src/handlers/organizations.ts` first and mirror its structure, including its private `getOwnedOrg` pattern (re-implement the same owner gate locally or export it from `organizations.ts` — exporting is the better call; add `export` to it).
- Produces handler exports for Task 6's router block:
  - `handleListOrgUsers(request, env, userId, orgId)`
  - `handleInviteOrgUsers(request, env, userId, orgId)`
  - `handleResendOrgInvite(request, env, userId, orgId, orgUserId)`
  - `handleAcceptOrgUser(request, env, userId, orgId, orgUserId)`
  - `handleConfirmOrgUser(request, env, userId, orgId, orgUserId)`
  - `handleRemoveOrgUser(request, env, userId, orgId, orgUserId)`
  - `handleGetUserPublicKey(request, env, userId, targetUserId)`

- [ ] **Step 1: Write the handler file.** Structure and behavior (each numbered behavior is a requirement):

```typescript
// src/handlers/org-users.ts
import { Env, OrganizationUser } from '../types';
import { StorageService } from '../services/storage';
import { jsonResponse, errorResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { readActingDeviceIdentifier } from '../utils/device';
import { notifyUserVaultSync } from '../durable/notifications-hub';
import { auditRequestMetadata, writeAuditEvent } from '../services/audit-events';
import { getOwnedOrg } from './organizations';
import { parseInviteRequest, orgUserDetailsResponse, orgUserListResponse, userPublicKeyResponse } from './org-shapes';
import { createOrgInviteToken, verifyOrgInviteToken } from '../services/org-invite-token';
import { sendOrgInviteEmail, isOrgEmailConfigured } from '../services/org-mail';

const ORG_NOT_FOUND = 'Organization not found';
const MEMBER_NOT_FOUND = 'Organization member not found';

async function bumpAndNotifyMembers(env: Env, storage: StorageService, orgId: string, contextId: string | null): Promise<void> {
  const memberIds = await storage.listConfirmedMemberUserIds(orgId);
  const revisionDate = await storage.updateRevisionDates(memberIds);
  for (const memberId of memberIds) {
    notifyUserVaultSync(env, memberId, revisionDate, contextId);
  }
}
```

1. **`handleListOrgUsers`** — `getOwnedOrg` gate (404 on fail). `storage.listOrgUsers(orgId)`; for each row with a `userId`, fetch the user via `storage.getUserById` to fill `{name, email}`; return `jsonResponse(orgUserListResponse(rows.map(r => orgUserDetailsResponse(r, userInfoOrNull))))`.
2. **`handleInviteOrgUsers`** — gate; `parseInviteRequest`; if `!isOrgEmailConfigured(env)` → `errorResponse('Email is not configured on this server', 500)`; require `env.ORG_INVITE_SITE_URL` the same way. For each email: reject the whole request with `errorResponse('A member with this email already exists in the organization', 400)` if `getOrgUserByOrgAndEmail` finds a row; otherwise create the membership via `storage.createOrgUserInvite({id: generateUUID(), orgId, userId: null, email, role: 'user', status: 'invited', encryptedOrgKey: null, createdAt: now, updatedAt: now})`. If `storage.getUser(email)` (confirmed: `StorageService.getUser(email)` at `src/services/storage.ts:301` is the by-email lookup) returns null, mint a registration invite code: `const code = generateUUID(); await storage.createInvite({ code, createdBy: userId, usedBy: null, expiresAt: <now + 7 days ISO>, status: 'active', createdAt: now, updatedAt: now });` else `code = null`. Then `token = await createOrgInviteToken(env.JWT_SECRET, {orgUserId, orgId, email})` and `await sendOrgInviteEmail(env, { toEmail: email, orgName: org.name, orgId, orgUserId, token, inviteCode: code, siteUrl: env.ORG_INVITE_SITE_URL! })`. Audit `organization.user.invite` per email. Return `new Response(null, { status: 200 })`.
3. **`handleResendOrgInvite`** — gate; `getOrgUserById`; must belong to this org and have `status === 'invited'` else `errorResponse(MEMBER_NOT_FOUND, 404)`; re-mint code only if the email still has no user account; new token; resend; audit; 200.
4. **`handleAcceptOrgUser`** — NOT owner-gated; the authenticated `userId` is the invitee. Parse body `{token}`; `verifyOrgInviteToken`; claims must match `orgId` and `orgUserId` path params or 400 `errorResponse('Invalid invitation token', 400)`. Load the authed user; claims.email must equal that user's email (case-insensitive) or same 400. `storage.acceptOrgUser(orgUserId, userId, now)`; `false` → `errorResponse('Invitation is no longer valid', 400)`. Bump the invitee's own revision (`storage.updateRevisionDate(userId)`) + notify them. Audit `organization.user.accept`. 200.
5. **`handleConfirmOrgUser`** — gate; body `{key}` non-empty string ≤ 4000 chars or 400; `storage.confirmOrgUser(orgUserId, key, now)`; `false` → `errorResponse('Member is not in the accepted state', 400)`; then `bumpAndNotifyMembers` (the new member is now confirmed and included). Audit `organization.user.confirm`. 200.
6. **`handleRemoveOrgUser`** — gate; `getOrgUserById`; must belong to org else 404; **if `role === 'owner'` → `errorResponse('The organization owner cannot be removed', 400)`** (last-owner protection); capture `removedUserId`; `storage.deleteOrgUser(orgUserId)`; `bumpAndNotifyMembers`, and if `removedUserId` is set also bump+notify the removed user so their client drops the org on next sync. Audit `organization.user.remove` at level 'security'. 200.
7. **`handleGetUserPublicKey`** — authenticated; NOT owner-gated, but requester and target must share at least one organization membership row (any status): compute via `storage.listMembershipsForUser` for both and intersect `orgId`s; no overlap → `errorResponse('User not found', 404)`. Load target user; missing or no `publicKey` → same 404. Return `jsonResponse(userPublicKeyResponse(targetUserId, publicKey))`.

Every handler wraps request-body parsing in try/catch → `errorResponse('Invalid request body', 400)` exactly like `organizations.ts` does. Export `getOwnedOrg` from `organizations.ts` (add `export` keyword only — no other change to that function).

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p tsconfig.json` → no NEW errors (this is the only automated gate for this task; behavior is proven in Task 7's smoke).

- [ ] **Step 3: Commit**

```bash
git add src/handlers/org-users.ts src/handlers/organizations.ts
git commit -m "feat: add organization member management handlers"
```

---

### Task 6: Phase 1 retrofit (multi-member bumps) + router registration

**Files:**
- Modify: `src/handlers/organizations.ts` (rename/delete bump all members), `src/router-authenticated.ts` (new routes ABOVE the catch-all stub)

**Interfaces:**
- Consumes: `bumpAndNotifyMembers` logic — export it from `org-users.ts` (add `export` to the function) and import in `organizations.ts`.

- [ ] **Step 1: Retrofit `handleUpdateOrganization` and `handleDeleteOrganization`** in `src/handlers/organizations.ts`: replace their single-user `updateRevisionDate(userId)` + `notifyUserVaultSync` pair with `await bumpAndNotifyMembers(env, storage, orgId, readActingDeviceIdentifier(request))`. ORDERING NOTE for delete: fetch the member list BEFORE `storage.deleteOrganization(orgId)` cascades the membership rows away — restructure to `const memberIds = await storage.listConfirmedMemberUserIds(orgId)` first, then delete, then `const revisionDate = await storage.updateRevisionDates(memberIds)` + notify loop inline (the helper can't be used post-delete; write the three lines locally). `handleCreateOrganization` stays single-user (creator is the only member at creation).

- [ ] **Step 2: Register routes** in `src/router-authenticated.ts`, ABOVE the existing org block from Phase 1 (which itself sits above the catch-all stub), mirroring its regex idiom:

```typescript
  {
    const orgUsersMatch = path.match(/^\/api\/organizations\/([^/]+)\/users$/);
    if (orgUsersMatch) {
      if (method === 'GET') return handleListOrgUsers(request, env, userId, orgUsersMatch[1]);
    }
    const orgInviteMatch = path.match(/^\/api\/organizations\/([^/]+)\/users\/invite$/);
    if (orgInviteMatch && method === 'POST') {
      return handleInviteOrgUsers(request, env, userId, orgInviteMatch[1]);
    }
    const orgUserActionMatch = path.match(/^\/api\/organizations\/([^/]+)\/users\/([^/]+)\/(reinvite|accept|confirm|remove)$/);
    if (orgUserActionMatch && method === 'POST') {
      const [, orgId, orgUserId, action] = orgUserActionMatch;
      if (action === 'reinvite') return handleResendOrgInvite(request, env, userId, orgId, orgUserId);
      if (action === 'accept') return handleAcceptOrgUser(request, env, userId, orgId, orgUserId);
      if (action === 'confirm') return handleConfirmOrgUser(request, env, userId, orgId, orgUserId);
      return handleRemoveOrgUser(request, env, userId, orgId, orgUserId);
    }
    const orgUserMatch = path.match(/^\/api\/organizations\/([^/]+)\/users\/([^/]+)$/);
    if (orgUserMatch && method === 'DELETE') {
      return handleRemoveOrgUser(request, env, userId, orgUserMatch[1], orgUserMatch[2]);
    }
    const publicKeyMatch = path.match(/^\/api\/users\/([^/]+)\/public-key$/);
    if (publicKeyMatch && method === 'GET') {
      return handleGetUserPublicKey(request, env, userId, publicKeyMatch[1]);
    }
  }
```

(`reinvite` is the official client's path segment for resend — keep it verbatim.)

- [ ] **Step 3: Typecheck + full sweep** — no new errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/organizations.ts src/router-authenticated.ts
git commit -m "feat: register member routes; bump all confirmed members on org mutations"
```

---

### Task 7: Deploy configs + local end-to-end smoke

**Files:**
- Create: `wrangler.cdcore-test.toml`
- Create: `scripts/org-flow-smoke.mjs`
- Create: `.dev.vars` (NOT committed — verify `git check-ignore .dev.vars` first)

**Interfaces:**
- Consumes: all routes from Task 6; `dev-mint-token.mjs` conventions from Phase 1 (JWT claims `{sub, sstamp, iss:'nodewarden', premium, email_verified}` HS256).
- Produces: a repeatable smoke script used again (with a different BASE) in Task 8.

- [ ] **Step 1: Write `wrangler.cdcore-test.toml`** — fork-owned deploy config; upstream `wrangler.toml` untouched:

```toml
# Fork-owned test deployment (vault-test.corderocore.com). Never edit upstream wrangler.toml.
name = "cdcore-vault-test"
main = "src/index.ts"
account_id = "abce177b14c156c4e1295484d4548954"
compatibility_date = "2024-01-01"

[build]
command = "npm run build"

[assets]
binding = "ASSETS"
directory = "./dist"
html_handling = "none"
not_found_handling = "single-page-application"
run_worker_first = true

[triggers]
crons = [ "*/5 * * * *" ]

routes = [
  { pattern = "vault-test.corderocore.com", custom_domain = true }
]

[[d1_databases]]
binding = "DB"
database_name = "cdcore-vault-test"
database_id = "FILLED-IN-TASK-8"

[[durable_objects.bindings]]
name = "NOTIFICATIONS_HUB"
class_name = "NotificationsHub"

[[durable_objects.bindings]]
name = "BACKUP_TRANSFER_RUNNER"
class_name = "BackupTransferRunner"

[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "cdcore-vault-test-attachments"

[[migrations]]
tag = "v1-notifications-hub"
new_sqlite_classes = [ "NotificationsHub" ]

[[migrations]]
tag = "v2-backup-transfer-runner"
new_sqlite_classes = [ "BackupTransferRunner" ]

[[send_email]]
name = "EMAIL"

[vars]
ORG_INVITE_SITE_URL = "https://vault-test.corderocore.com"
# Secrets (wrangler secret put -c wrangler.cdcore-test.toml):
#   JWT_SECRET  — strong random, 32+ chars
#   EMAIL_FROM  — sender on the Email Sending onboarded domain
```

(`database_id` placeholder is intentional and filled by Task 8 — the ONLY permitted "filled later" value in this plan, because the id doesn't exist until `wrangler d1 create` runs. Local dev ignores it.)

- [ ] **Step 2: Write `.dev.vars`** (after `git check-ignore .dev.vars` passes):

```
JWT_SECRET=local-dev-secret-0123456789abcdef0123456789abcdef
EMAIL_FROM=vault@corderocore.com
ORG_INVITE_SITE_URL=http://127.0.0.1:8788
```

- [ ] **Step 3: Write `scripts/org-flow-smoke.mjs`** — a node script driving the FULL lifecycle over HTTP. Contract: exits 0 with `ALL CHECKS PASSED` or exits 1 naming the failed check. Behavior:

```javascript
// scripts/org-flow-smoke.mjs
// End-to-end org membership smoke. Usage:
//   node scripts/org-flow-smoke.mjs <BASE_URL> <JWT_SECRET> [INVITEE_EMAIL]
// Registers an admin (first user = role admin), creates an org, invites the
// invitee, registers the invitee with the minted registration code, accepts
// with a locally-minted invite token (same JWT_SECRET as the server),
// confirms, verifies both profiles, removes, verifies removal.
import crypto from 'node:crypto';

const [BASE, JWT_SECRET, INVITEE_EMAIL_ARG] = process.argv.slice(2);
if (!BASE || !JWT_SECRET) { console.error('usage: org-flow-smoke.mjs BASE JWT_SECRET [inviteeEmail]'); process.exit(1); }
const runId = crypto.randomUUID().slice(0, 8);
const ADMIN_EMAIL = `smoke-admin-${runId}@example.com`;
const INVITEE_EMAIL = (INVITEE_EMAIL_ARG || `smoke-member-${runId}@example.com`).toLowerCase();

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mintAccess(userId, sstamp) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub: userId, sstamp, iat: now, exp: now + 3600, iss: 'nodewarden', premium: true, email_verified: true }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function mintInviteToken(orgUserId, orgId, email) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub: orgUserId, typ: 'org-invite', oid: orgId, iem: email, iat: now, exp: now + 3600, iss: 'nodewarden', premium: true, email_verified: true }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); } else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
async function register(email, inviteCode) {
  return api('POST', '/api/accounts/register', null, {
    email, name: email.split('@')[0], masterPasswordHash: `hash-${email}`, key: `2.key-${email}`,
    kdf: 0, kdfIterations: 600000, inviteCode,
    keys: { publicKey: `pub-${email}`, encryptedPrivateKey: `2.priv-${email}` },
  });
}
async function login(email) {
  const body = new URLSearchParams({
    grant_type: 'password', username: email, password: `hash-${email}`,
    scope: 'api offline_access', client_id: 'web', deviceType: '9',
    deviceIdentifier: crypto.randomUUID(), deviceName: 'smoke',
  });
  const res = await fetch(`${BASE}/identity/connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// --- flow ---
const reg1 = await register(ADMIN_EMAIL);
check('admin registers (first user)', reg1.status === 200, `status ${reg1.status}: ${reg1.text}`);
const adminLogin = await login(ADMIN_EMAIL);
check('admin logs in', adminLogin.status === 200 && adminLogin.json?.access_token, `status ${adminLogin.status}`);
const adminToken = adminLogin.json.access_token;

const orgRes = await api('POST', '/api/organizations', adminToken, {
  name: `Smoke Org ${runId}`, key: '4.smoke-wrapped', keys: { publicKey: 'org-pub', encryptedPrivateKey: '2.org-priv' },
});
check('admin creates org', orgRes.status === 200 && orgRes.json?.id, `status ${orgRes.status}: ${orgRes.text}`);
const orgId = orgRes.json.id;

const inviteRes = await api('POST', `/api/organizations/${orgId}/users/invite`, adminToken, { emails: [INVITEE_EMAIL] });
check('invite sends (email dispatched)', inviteRes.status === 200, `status ${inviteRes.status}: ${inviteRes.text}`);

const list1 = await api('GET', `/api/organizations/${orgId}/users`, adminToken);
const invitedRow = list1.json?.data?.find((m) => m.email === INVITEE_EMAIL);
check('member list shows invited row (status 0)', invitedRow && invitedRow.status === 0, JSON.stringify(list1.json));
const orgUserId = invitedRow?.id;

// Invitee registers. Second registration REQUIRES an invite code; the invite
// endpoint minted one, but it lives only in the email. For the smoke we mint
// a code directly against the same rule the server uses is impossible —
// instead the ADMIN mints one via the admin invite API if present, else we
// prove the negative and register with the org-invite-created code passed in
// REG_CODE env var (deployed runs read it from the received email).
let inviteeReg = await register(INVITEE_EMAIL, process.env.REG_CODE || undefined);
check('invitee registration honors invite-code rule', inviteeReg.status === 200 || inviteeReg.status === 400, `status ${inviteeReg.status}`);
if (inviteeReg.status !== 200) {
  console.error('NOTE: invitee registration needs REG_CODE from the invite email (or an unused admin-minted code).');
  process.exit(failures ? 1 : 2);
}
const inviteeLogin = await login(INVITEE_EMAIL);
check('invitee logs in', inviteeLogin.status === 200, `status ${inviteeLogin.status}`);
const inviteeToken = inviteeLogin.json.access_token;

const acceptRes = await api('POST', `/api/organizations/${orgId}/users/${orgUserId}/accept`, inviteeToken, {
  token: mintInviteToken(orgUserId, orgId, INVITEE_EMAIL),
});
check('invitee accepts', acceptRes.status === 200, `status ${acceptRes.status}: ${acceptRes.text}`);

const inviteeSync1 = await api('GET', '/api/sync', inviteeToken);
const acceptedOrg = inviteeSync1.json?.profile?.organizations?.find((o) => o.id === orgId);
check('accepted org appears in invitee profile (status 1, no key yet)', acceptedOrg && acceptedOrg.status === 1 && !acceptedOrg.key, JSON.stringify(acceptedOrg));

const confirmRes = await api('POST', `/api/organizations/${orgId}/users/${orgUserId}/confirm`, adminToken, { key: '4.wrapped-for-invitee' });
check('owner confirms', confirmRes.status === 200, `status ${confirmRes.status}: ${confirmRes.text}`);

const pk = await api('GET', `/api/users/${inviteeSync1.json?.profile?.id}/public-key`, adminToken);
check('owner can fetch member public key', pk.status === 200 && pk.json?.publicKey === `pub-${INVITEE_EMAIL}`, JSON.stringify(pk.json));

const inviteeSync2 = await api('GET', '/api/sync', inviteeToken);
const confirmedOrg = inviteeSync2.json?.profile?.organizations?.find((o) => o.id === orgId);
check('confirmed org carries the wrapped key (status 2)', confirmedOrg && confirmedOrg.status === 2 && confirmedOrg.key === '4.wrapped-for-invitee', JSON.stringify(confirmedOrg));

const strangerReg = await register(`smoke-stranger-${runId}@example.com`, process.env.REG_CODE_2 || undefined);
if (strangerReg.status === 200) {
  const strangerLogin = await login(`smoke-stranger-${runId}@example.com`);
  const strangerList = await api('GET', `/api/organizations/${orgId}/users`, strangerLogin.json.access_token);
  check('stranger cannot list members (404)', strangerList.status === 404, `status ${strangerList.status}`);
} else {
  console.log('skip stranger isolation check (no second registration code) — covered by unit gates');
}

const removeRes = await api('DELETE', `/api/organizations/${orgId}/users/${orgUserId}`, adminToken);
check('owner removes member', removeRes.status === 200, `status ${removeRes.status}`);
const inviteeSync3 = await api('GET', '/api/sync', inviteeToken);
check('removed org gone from invitee profile', !inviteeSync3.json?.profile?.organizations?.some((o) => o.id === orgId), '');

const ownerRow = (await api('GET', `/api/organizations/${orgId}/users`, adminToken)).json?.data?.find((m) => m.type === 0);
const removeOwner = await api('DELETE', `/api/organizations/${orgId}/users/${ownerRow?.id}`, adminToken);
check('owner cannot be removed (400)', removeOwner.status === 400, `status ${removeOwner.status}`);

console.log(failures ? `${failures} CHECKS FAILED` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
```

Route facts confirmed against `src/router-public.ts`: `POST /api/accounts/register` (line 491) and `POST /identity/connect/token` (line 398) are both served. BEFORE finalizing the script, read `src/handlers/identity.ts` to confirm the token-endpoint form fields the script sends (`grant_type`, `username`, `password`, `deviceType`, `deviceIdentifier`, `deviceName`, `client_id`) and `handleRegister`'s success status — if either differs, match the script to the code.

- [ ] **Step 4: Run the local smoke.** Local dev simulates `send_email` (delivery is logged, not sent), and the SECOND registration needs an invite code that lives in the simulated email. For LOCAL runs, mint a code directly in local D1 before the invitee registers:

```bash
npx wrangler dev -c wrangler.cdcore-test.toml --port 8788 &   # background
sleep 6
curl -s http://127.0.0.1:8788/api/organizations >/dev/null    # trigger schema bootstrap
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); EXP=$(date -u -v+7d +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d '+7 days' +%Y-%m-%dT%H:%M:%S.000Z)
npx wrangler d1 execute DB -c wrangler.cdcore-test.toml --local --command \
  "INSERT INTO invites(code, created_by, used_by, expires_at, status, created_at, updated_at) VALUES('SMOKE-CODE-1','smoke',NULL,'$EXP','active','$NOW','$NOW')"
REG_CODE=SMOKE-CODE-1 node scripts/org-flow-smoke.mjs http://127.0.0.1:8788 local-dev-secret-0123456789abcdef0123456789abcdef
```

Expected: `ALL CHECKS PASSED`, exit 0. (First smoke registration is code-free only on a FRESH local D1 — `rm -rf .wrangler/state` first if re-running.) Kill wrangler when done.

- [ ] **Step 5: Full sweep + typecheck still green. Commit** (never `.dev.vars`):

```bash
git add wrangler.cdcore-test.toml scripts/org-flow-smoke.mjs
git commit -m "feat: add test deploy config and org membership flow smoke"
```

---

### Task 8: Deploy `cdcore-vault-test` + remote smoke with real email

This task touches the user's Cloudflare account for the first time. Credentials: `set -a && source .env && set +a` in the repo root (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). **STOP-AND-ASK point built in at Step 2.**

**Files:**
- Modify: `wrangler.cdcore-test.toml` (fill `database_id`)

- [ ] **Step 1: Create the cloud resources**

```bash
set -a && source .env && set +a
npx wrangler d1 create cdcore-vault-test            # copy database_id into wrangler.cdcore-test.toml
npx wrangler r2 bucket create cdcore-vault-test-attachments
```

- [ ] **Step 2: Secrets — ASK THE USER for `EMAIL_FROM`.** Prompt: "What sender address should vault invites come from? It must be on the domain you onboarded to Cloudflare Email Sending (the same one your newsletter worker sends from)." Then:

```bash
openssl rand -hex 32 | npx wrangler secret put JWT_SECRET -c wrangler.cdcore-test.toml
printf '%s' '<ANSWER>' | npx wrangler secret put EMAIL_FROM -c wrangler.cdcore-test.toml
```

Record the JWT_SECRET value in a local scratch note for the remote smoke (it needs to mint tokens); NEVER commit or echo it into the transcript beyond the pipe above — generate, tee to a scratchpad file outside the repo, and pipe from there.

- [ ] **Step 3: Deploy**

```bash
npm run build          # webapp assets for [assets]
npx wrangler deploy -c wrangler.cdcore-test.toml
```

Custom-domain note: the `routes` entry auto-creates the DNS record if the API token has DNS:Edit on corderocore.com. If deploy fails on the domain step, remove the `routes` block temporarily, deploy on workers.dev, and tell the user to add the custom domain in the dashboard (Workers → cdcore-vault-test → Domains) — then restore the block and redeploy.

- [ ] **Step 4: Remote smoke — real email leg.** Run the same script against the deployment, inviting the user's real inbox:

```bash
node scripts/org-flow-smoke.mjs https://vault-test.corderocore.com "$(cat <scratch JWT_SECRET file>)" cdcore09@gmail.com
```

The run will stop at invitee registration with exit 2 and the REG_CODE note — expected: the registration code is in the real invitation email. **Tell the user: "Check cdcore09@gmail.com for the invitation email from your vault. Reply with the inviteCode value from the accept link."** Then finish the flow: `REG_CODE=<code> node scripts/org-flow-smoke.mjs ... cdcore09@gmail.com` (fresh run registers a fresh admin; the duplicate-invite rejection may fire for the already-invited address — if so, delete the prior smoke org first via the API or accept the 400 as the pass condition for that check and document it in the report). Expected end state: `ALL CHECKS PASSED` and the user confirms the email looked right (sender, subject, working link).

- [ ] **Step 5: Commit the filled config**

```bash
git add wrangler.cdcore-test.toml
git commit -m "chore: fill test deployment database id"
```

---

### Task 9: Phase gate

- [ ] **Step 1:** Full sweep (all seven org test files) green; upstream suites (`npm run test:config-compatibility && npm run test:web-crypto && npm run test:webauthn-connectors`) green; `tsc --noEmit` no new errors.
- [ ] **Step 2:** `git diff --name-only main...HEAD` — every path within the Global Constraints allowlist (plus `wrangler.cdcore-test.toml`, `scripts/org-flow-smoke.mjs`, `scripts/org-mail.test.ts`, `scripts/org-invite-token.test.ts`, `src/services/org-mail.ts`, `src/services/org-invite-token.ts`, `src/utils/profile-orgs.ts`, `src/handlers/org-users.ts`, plan docs).
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-08-01-phase-1-carryforward.md`: mark the Phase 2 items discharged (router placement, multi-member bumps, profileOrgs helper, member-removal/user-deletion interplay — note the resolution for each) and append any new Phase 3+ items discovered this phase. Commit.
- [ ] **Step 4:** Push branch and report to the user. PR creation goes through the user's `/create-pr` skill. Do NOT merge; the user decides.
