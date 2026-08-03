# Organizations Phase 4c — Members Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-owner **Members** management UI to the web vault: an org-detail page (reached by clicking an org in the existing list) with a Members tab that lists members, invites by email, resends invites, confirms accepted members with a key-fingerprint verification, and removes members.

**Architecture:** Pure **frontend** phase — every backend endpoint and every client-crypto primitive already exists (Phases 2, 3a, 4a). 4a built the org **list** page (`OrganizationsPage.tsx`); 4c adds the org **detail** page at route `/organizations/:id`. The detail page renders a tabbed shell (Members tab now; Collections tab is Phase 4d) driven by a new `useOrgMemberActions` hook that calls new member-API functions in `organizations.ts`. The one non-trivial flow is **confirm-with-fingerprint**: the admin's already-unwrapped org key (from `App.tsx`'s `orgKeysCache`) is wrapped to the accepted member's public key and POSTed — verified by showing the member's fingerprint phrase first.

**Tech Stack:** Preact + wouter 3.10 (native `:id` path params), TypeScript, Web Crypto (existing org-crypto primitives), Node built-in test runner via `tsx --test`.

## Global Constraints

- **No commit/PR trailers.** No `Co-Authored-By`, no AI attribution on any commit or PR (use `/commit` and `/create-pr`). Verbatim standing instruction.
- **Never commit** `.env`, `.dev.vars`, `.wrangler/state`, or any secret; never print secrets.
- **No backend changes.** All member/collection endpoints exist and are owner-gated + state-machine-enforced server-side. This phase touches only `webapp/src/**`, the 10 locale files, and `scripts/*.test.ts`. If an implementer believes a backend change is needed, STOP and flag it — it's out of scope.
- **Routing — hit ALL FOUR registration points (Phase 4a shipped a 404 bug from missing one):** a new authenticated app route must be registered in (1) `webapp/src/App.tsx` — the `isKnownAppRoute` gate (the `APP_ROUTES` Set is EXACT-MATCH with no wildcard, so `/organizations/:id` needs a REGEX matcher OR'd in, mirroring the existing `publicSendMatch` handling near App.tsx:2003-2009), (2) `webapp/src/App.tsx` `currentPageTitle` (the if/else chain ~lines 2040-2055), (3) `webapp/src/components/AppMainRoutes.tsx` — the inner `<Switch>` `<Route>`, and (4) `webapp/src/components/AppAuthenticatedShell.tsx` — broaden the `/organizations` sidebar link's active-state to keep it highlighted on the detail route. Verify each in the task that adds the route.
- **Confirm-crypto is fail-closed:** the confirm flow wraps the admin's org key to a member's public key. If the admin's org key for that org is not in `orgKeysCache` (not unlocked / unwrap failed), the Confirm action MUST be disabled/blocked with a clear message — NEVER attempt a confirm without the real org key. Only offer Confirm for members with `status === 1 (accepted)` and a non-null `userId`.
- **TypeScript baseline:** `npx tsc --noEmit -p webapp/tsconfig.json` currently reports **3 pre-existing errors** (`backup.ts`, `backup-center.ts`, `password-security-cache.ts`). Introduce **no new** tsc errors.
- **Gates per task:** `npm run build` (vite) succeeds; `npm run test:orgs-web` green; `npm run i18n` passes (currently `"errors": []`, all `txt_org_` keys parity-checked across 10 locales) whenever locale files change; backend `npm run test:orgs` stays 93/93 (this phase shouldn't touch it, but confirm it's untouched).
- **i18n:** every user-facing string uses `t('txt_org_...')` added to ALL 10 locale files (`webapp/src/lib/i18n/locales/{en,de,es,fi,fr,it,ru,sv,zh-CN,zh-TW}.ts`) with identical English text (the `txt_org_` prefix is registered intentionally-English in `scripts/i18n-validate.cjs`; parity is still enforced).
- **Match the existing web-vault design.** Reuse `ConfirmDialog` for dialogs and the `settings-category-tabs`/`settings-category-tab` CSS (as in `PasswordGeneratorPage.tsx`) for the tab shell. No new aesthetic.

## Reference: exact backend shapes (do not re-derive)

- **Member row** (`GET /api/organizations/:id/users` → `{ data: OrgMember[], object:'list' }`), per member: `{ id (orgUserId), userId (string|null — null until accepted), organizationId, name (string|null), email, type (0 owner / 2 user), status (0 invited / 1 accepted / 2 confirmed) }`.
- **Invite** `POST /api/organizations/:id/users/invite` body `{ emails: string[] }` (1-20, deduped/lowercased; no role — all invites are `user`). 200 empty on success; 400 if any email already a member; 500 on send failure.
- **Resend** `POST /api/organizations/:id/users/:orgUserId/reinvite` — no body; only valid for `invited` status (else 404). 200 empty.
- **Confirm** `POST /api/organizations/:id/users/:orgUserId/confirm` body `{ key: string }` (type-4 `"4."+base64` org key wrapped to the member's public key, ≤4000 chars); only valid for `accepted` status (else 400).
- **Remove** `POST /api/organizations/:id/users/:orgUserId/remove` (or `DELETE /api/organizations/:id/users/:orgUserId`) — no body; owner members cannot be removed (400). 200 empty.
- **Member public key** `GET /api/users/:userId/public-key` → `{ userId, publicKey (SPKI-base64), object:'userKey' }` (404 if no shared org or no key).

## Client-crypto primitives (all exist in `webapp/src/lib/org-crypto.ts` + `auth-requests.ts`, already tested)

- `rsaWrapOrgKeyForMember(orgKey: Uint8Array, memberPublicKeySpkiB64: string): Promise<string>` → type-4 wrapped key.
- `getFingerprintPhrase(email: string, publicKey: Uint8Array): Promise<string>` (in `auth-requests.ts`) — NOTE it takes `Uint8Array`; callers `base64ToBytes(publicKeyB64)` first.
- The admin's raw org key is `App.tsx` state `orgKeysCache: Record<string, Uint8Array>` (built ~App.tsx:1336-1373). Thread it to the detail page.

---

## File Structure

- `webapp/src/lib/api/organizations.ts` — ADD `OrgMember` type + `listOrgUsers`, `inviteOrgUsers`, `resendOrgInvite`, `confirmOrgUser`, `removeOrgUser`, `getUserPublicKey`.
- `webapp/src/hooks/useOrgMemberActions.ts` — CREATE (actions hook mirroring `useAdminActions.ts`: invite/resend/confirm/remove, each calls the API then refetches then notifies).
- `webapp/src/components/OrganizationDetailPage.tsx` — CREATE (tabbed detail page; Members tab: list + badges + row actions + invite/confirm/remove dialogs).
- `webapp/src/components/OrganizationsPage.tsx` — MODIFY (make rows click-navigate to `/organizations/:id`).
- `webapp/src/components/AppMainRoutes.tsx` — MODIFY (lazy `<Route path="/organizations/:id">`).
- `webapp/src/App.tsx` — MODIFY (org-detail regex into `isKnownAppRoute`; `currentPageTitle` branch; pass `authedFetch`, `orgKeysCache`, `profile`, `onNotify` to the detail page).
- `webapp/src/components/AppAuthenticatedShell.tsx` — MODIFY (broaden `/organizations` active-state).
- `webapp/src/lib/i18n/locales/*.ts` (10) — ADD member-tab keys.
- `scripts/org-members-api.test.ts` — CREATE (unit-test the API functions' URL/body construction + the confirm-flow key composition, via a stubbed `authedFetch`).

---

## Task 1: Member API client functions + types

**Files:**
- Modify: `webapp/src/lib/api/organizations.ts`
- Test: `scripts/org-members-api.test.ts` (new); add to `test:orgs-web` in `package.json`

**Interfaces:**
- Consumes: `AuthedFetch`, `parseJson`, `parseErrorMessage` from `webapp/src/lib/api/shared.ts`; the existing `createOrganization` pattern.
- Produces:
  - `interface OrgMember { id: string; userId: string | null; email: string; name: string | null; type: number; status: number; }`
  - `listOrgUsers(authedFetch: AuthedFetch, orgId: string): Promise<OrgMember[]>` — GET `/api/organizations/:id/users`, returns `body.data` mapped to `OrgMember`.
  - `inviteOrgUsers(authedFetch, orgId: string, emails: string[]): Promise<void>` — POST `/api/organizations/:id/users/invite` body `{ emails }`.
  - `resendOrgInvite(authedFetch, orgId: string, orgUserId: string): Promise<void>` — POST `/api/organizations/:id/users/:orgUserId/reinvite`.
  - `confirmOrgUser(authedFetch, orgId: string, orgUserId: string, wrappedKey: string): Promise<void>` — POST `/api/organizations/:id/users/:orgUserId/confirm` body `{ key: wrappedKey }`.
  - `removeOrgUser(authedFetch, orgId: string, orgUserId: string): Promise<void>` — POST `/api/organizations/:id/users/:orgUserId/remove`.
  - `getUserPublicKey(authedFetch, userId: string): Promise<string>` — GET `/api/users/:userId/public-key`, returns `body.publicKey`.

- [ ] **Step 1: Write the failing test**

Create `scripts/org-members-api.test.ts`. Use a stub `authedFetch` that records `(path, init)` and returns a canned `Response`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listOrgUsers, inviteOrgUsers, resendOrgInvite, confirmOrgUser, removeOrgUser, getUserPublicKey,
} from '../webapp/src/lib/api/organizations';

function stubFetch(responseBody: unknown, status = 200) {
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const authedFetch = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { authedFetch: authedFetch as any, calls };
}

test('listOrgUsers GETs the users endpoint and maps data[]', async () => {
  const { authedFetch, calls } = stubFetch({ data: [{ id: 'ou1', userId: 'u1', email: 'a@b.c', name: 'A', type: 2, status: 1 }], object: 'list' });
  const members = await listOrgUsers(authedFetch, 'org1');
  assert.equal(calls[0].path, '/api/organizations/org1/users');
  assert.equal(calls[0].method, 'GET');
  assert.equal(members.length, 1);
  assert.deepEqual(members[0], { id: 'ou1', userId: 'u1', email: 'a@b.c', name: 'A', type: 2, status: 1 });
});

test('inviteOrgUsers POSTs {emails} to the invite endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await inviteOrgUsers(authedFetch, 'org1', ['x@y.z', 'p@q.r']);
  assert.equal(calls[0].path, '/api/organizations/org1/users/invite');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { emails: ['x@y.z', 'p@q.r'] });
});

test('resendOrgInvite POSTs the reinvite endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await resendOrgInvite(authedFetch, 'org1', 'ou1');
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/reinvite');
  assert.equal(calls[0].method, 'POST');
});

test('confirmOrgUser POSTs {key} to the confirm endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await confirmOrgUser(authedFetch, 'org1', 'ou1', '4.wrapped-key');
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/confirm');
  assert.deepEqual(calls[0].body, { key: '4.wrapped-key' });
});

test('removeOrgUser POSTs the remove endpoint', async () => {
  const { authedFetch, calls } = stubFetch({});
  await removeOrgUser(authedFetch, 'org1', 'ou1');
  assert.equal(calls[0].path, '/api/organizations/org1/users/ou1/remove');
});

test('getUserPublicKey GETs the public-key endpoint and returns publicKey', async () => {
  const { authedFetch, calls } = stubFetch({ userId: 'u1', publicKey: 'SPKI-B64', object: 'userKey' });
  const pk = await getUserPublicKey(authedFetch, 'u1');
  assert.equal(calls[0].path, '/api/users/u1/public-key');
  assert.equal(pk, 'SPKI-B64');
});

test('a failed response rejects with a parsed error message', async () => {
  const { authedFetch } = stubFetch({ message: 'nope' }, 400);
  await assert.rejects(() => inviteOrgUsers(authedFetch, 'org1', ['x@y.z']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/org-members-api.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the functions**

In `webapp/src/lib/api/organizations.ts`, add (match the existing `createOrganization`/`listOrgCollections` style — read them first for the exact `authedFetch`/`parseJson`/`parseErrorMessage`/error-throw idiom, and encode path ids with `encodeURIComponent`):

```ts
export interface OrgMember {
  id: string;          // orgUserId
  userId: string | null;
  email: string;
  name: string | null;
  type: number;        // 0 owner, 2 user
  status: number;      // 0 invited, 1 accepted, 2 confirmed
}

export async function listOrgUsers(authedFetch: AuthedFetch, orgId: string): Promise<OrgMember[]> {
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(orgId)}/users`);
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to load members'));
  const body = await parseJson<{ data?: unknown[] }>(resp);
  const rows = Array.isArray(body?.data) ? body!.data : [];
  return rows.map((r: any) => ({
    id: String(r.id),
    userId: r.userId != null ? String(r.userId) : null,
    email: String(r.email || ''),
    name: r.name != null ? String(r.name) : null,
    type: Number(r.type) || 0,
    status: Number(r.status) || 0,
  }));
}

export async function inviteOrgUsers(authedFetch: AuthedFetch, orgId: string, emails: string[]): Promise<void> {
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(orgId)}/users/invite`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails }),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to invite members'));
}

export async function resendOrgInvite(authedFetch: AuthedFetch, orgId: string, orgUserId: string): Promise<void> {
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(orgUserId)}/reinvite`, { method: 'POST' });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to resend invite'));
}

export async function confirmOrgUser(authedFetch: AuthedFetch, orgId: string, orgUserId: string, wrappedKey: string): Promise<void> {
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(orgUserId)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: wrappedKey }),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to confirm member'));
}

export async function removeOrgUser(authedFetch: AuthedFetch, orgId: string, orgUserId: string): Promise<void> {
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(orgUserId)}/remove`, { method: 'POST' });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to remove member'));
}

export async function getUserPublicKey(authedFetch: AuthedFetch, userId: string): Promise<string> {
  const resp = await authedFetch(`/api/users/${encodeURIComponent(userId)}/public-key`);
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to load member key'));
  const body = await parseJson<{ publicKey?: string }>(resp);
  const pk = body?.publicKey;
  if (!pk) throw new Error('Member has no public key');
  return pk;
}
```

(If `parseErrorMessage`'s signature differs — e.g. it takes only `resp` — match the real signature from `shared.ts` and the existing `createOrganization` usage.)

- [ ] **Step 4: Run test to verify it passes + wire the test into the gate**

Run: `npx tsx --test scripts/org-members-api.test.ts` → PASS. Then add the file to the `test:orgs-web` script in `package.json` (append `scripts/org-members-api.test.ts` to the existing list) and run `npm run test:orgs-web` (all pass).

- [ ] **Step 5: Gate + commit**

Run: `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3, no new).

```bash
git add webapp/src/lib/api/organizations.ts scripts/org-members-api.test.ts package.json
git commit -m "feat(webapp): add org member management API client functions"
```

---

## Task 2: Org-detail route + click-through navigation

**Files:**
- Create: `webapp/src/components/OrganizationDetailPage.tsx` (minimal shell for this task — header with org name + a placeholder Members tab; full content in Tasks 3-6)
- Modify: `webapp/src/components/AppMainRoutes.tsx`, `webapp/src/App.tsx`, `webapp/src/components/AppAuthenticatedShell.tsx`, `webapp/src/components/OrganizationsPage.tsx`

**Interfaces:**
- Consumes: wouter `<Route>`/`useParams`, the org list from `getProfileOrganizations(profile)`, `authedFetch`, `orgKeysCache`, `profile`, `onNotify` from App state.
- Produces: `OrganizationDetailPage` component with props `{ orgId: string; profile: Profile; authedFetch: AuthedFetch; orgKeys: Record<string, Uint8Array>; onNotify?: (type,text)=>void }`. Route `/organizations/:id` renders it. Clicking an org row in `OrganizationsPage` navigates there.

- [ ] **Step 1: Create the minimal detail page shell**

Create `webapp/src/components/OrganizationDetailPage.tsx`. It looks up the org by id from the profile (name, role) and renders a header + a back link + a tab shell with a single "Members" tab (placeholder content for now). Mirror `OrganizationsPage.tsx`'s structure/classes and the `settings-category-tabs` tab pattern:

```tsx
import { useMemo, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Profile } from '../lib/types';
import type { AuthedFetch } from '../lib/api/shared';
import { getProfileOrganizations, ORGANIZATION_TYPE_OWNER } from '../lib/api/organizations';
import { t } from '../lib/i18n';

interface OrganizationDetailPageProps {
  orgId: string;
  profile: Profile;
  authedFetch: AuthedFetch;
  orgKeys: Record<string, Uint8Array>;
  onNotify?: (type: 'success' | 'error' | 'warning', text: string) => void;
}

export default function OrganizationDetailPage(props: OrganizationDetailPageProps) {
  const [, navigate] = useLocation();
  const org = useMemo(
    () => getProfileOrganizations(props.profile).find((o) => o.id === props.orgId) || null,
    [props.profile, props.orgId]
  );
  const [tab] = useState<'members'>('members');

  if (!org) {
    return (
      <div className="stack">
        <button className="btn btn-secondary" onClick={() => navigate('/organizations')}>{t('txt_org_back')}</button>
        <p>{t('txt_org_not_found')}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-header">
        <button className="btn btn-secondary" onClick={() => navigate('/organizations')}>{t('txt_org_back')}</button>
        <h1>{org.name}</h1>
      </div>
      <div className="settings-category-tabs" role="tablist" aria-label={t('txt_org_members_tab')}>
        <button role="tab" aria-selected={tab === 'members'} className="settings-category-tab active">{t('txt_org_members_tab')}</button>
      </div>
      {/* Members tab content added in Task 3 */}
      <p>{t('txt_org_members_loading')}</p>
    </div>
  );
}
```

Add the i18n keys used here (`txt_org_back`, `txt_org_not_found`, `txt_org_members_tab`, `txt_org_members_loading`) to all 10 locale files. Verify `ORGANIZATION_TYPE_OWNER` is exported from `organizations.ts` (it's used by OrganizationsPage — reuse it; if it's a local const there, export it).

- [ ] **Step 2: Register the route in AppMainRoutes (wouter :id param)**

In `webapp/src/components/AppMainRoutes.tsx`, add a lazy import and a `<Route>` next to the existing `/organizations` route (~line 254). Use wouter's native param syntax:

```tsx
const OrganizationDetailPage = lazy(() => import('./OrganizationDetailPage'));
// ...inside the <Switch>, near the existing <Route path="/organizations">:
<Route path="/organizations/:id">
  {(params) => (
    <OrganizationDetailPage
      orgId={params.id}
      profile={props.profile}
      authedFetch={props.authedFetch}
      orgKeys={props.orgKeys}
      onNotify={props.onNotify}
    />
  )}
</Route>
```

`props.orgKeys`/`props.authedFetch`/`props.profile`/`props.onNotify` must be available on `AppMainRoutes`' props. Read `AppMainRoutes.tsx`'s props interface and how the existing `/organizations` route gets `profile`/`onNotify`; thread `orgKeys` (the `orgKeysCache`) and `authedFetch` through from `App.tsx` the same way (see Step 4). Declare any new prop on `AppMainRoutes`' props type.

- [ ] **Step 3: Register the route in App.tsx (isKnownAppRoute regex + currentPageTitle)**

In `webapp/src/App.tsx`:
- Add an org-detail matcher mirroring `publicSendMatch`. Near where `isKnownAppRoute` is computed (~line 2003-2008), add e.g. `const orgDetailMatch = routeLocation.match(/^\/organizations\/[^/]+$/);` and OR it into `isKnownAppRoute` (so `/organizations/<id>` is treated as a known app route and does NOT hit `NotFoundPage`). Confirm by reading lines 2000-2015 exactly and integrating.
- Add a `currentPageTitle` branch (~lines 2040-2055): `if (location.startsWith('/organizations/')) return t('txt_org_page_title');` placed BEFORE the exact `/organizations` check is fine (or after — they're mutually exclusive by the `/` suffix; make sure `/organizations` exact still returns the list title and `/organizations/<id>` returns a title too). Reuse `txt_org_page_title` (no new key needed).

- [ ] **Step 4: Thread authedFetch + orgKeysCache into AppMainRoutes**

In `webapp/src/App.tsx`, find where `<AppMainRoutes .../>` is rendered and where the `/organizations` route already receives `profile`/`onNotify`. Pass `authedFetch={authedFetch}` and `orgKeys={orgKeysCache}` to `AppMainRoutes` (the state/const already exist — `orgKeysCache` at ~line 273, `authedFetch` used throughout). Update `AppMainRoutes`' props type accordingly.

- [ ] **Step 5: Broaden the sidebar active-state**

In `webapp/src/components/AppAuthenticatedShell.tsx` line ~135, change the `/organizations` active check from `props.location === '/organizations'` to also match the detail route, e.g. `props.location === '/organizations' || props.location.startsWith('/organizations/')`. So the sidebar item stays highlighted on the detail page.

- [ ] **Step 6: Make org rows navigate**

In `webapp/src/components/OrganizationsPage.tsx`, make each org row click-navigate to `/organizations/${organization.id}`. Import `useLocation` from wouter, get `navigate`, and add an `onClick`/`role="button"`/keyboard handler to the row (or wrap the name cell in a wouter `<Link href={`/organizations/${organization.id}`}>`). Keep the existing table styling; add a pointer cursor / hover affordance consistent with the app. Ensure the create-org dialog button's click does NOT also trigger row navigation (stopPropagation if needed).

- [ ] **Step 7: Verify routing end-to-end (reason through it) + gate**

Reason through: clicking a row calls `navigate('/organizations/<id>')` → `isKnownAppRoute` is true (regex) so App renders the inner router, not NotFoundPage → `AppMainRoutes`' `<Route path="/organizations/:id">` matches → `OrganizationDetailPage` renders with the org name. Back button → `/organizations` list. Confirm the four routing points are all updated.

Run: `npm run build` (vite clean — this catches the lazy import + JSX), `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3), `npm run i18n` (green), `npm run test:orgs-web` (green).

- [ ] **Step 8: Commit**

```bash
git add webapp/src/components/OrganizationDetailPage.tsx webapp/src/components/AppMainRoutes.tsx webapp/src/App.tsx webapp/src/components/AppAuthenticatedShell.tsx webapp/src/components/OrganizationsPage.tsx webapp/src/lib/i18n/locales/
git commit -m "feat(webapp): org-detail route and click-through from the org list"
```

---

## Task 3: Members list + status/role badges + actions hook

**Files:**
- Create: `webapp/src/hooks/useOrgMemberActions.ts`
- Modify: `webapp/src/components/OrganizationDetailPage.tsx` (render the member list)
- Modify: 10 locale files

**Interfaces:**
- Consumes: `listOrgUsers`, `OrgMember` (Task 1); `useState`/`useEffect` for fetch+state.
- Produces: `useOrgMemberActions({ authedFetch, orgId, orgKeys, onNotify, refetch })` returning `{ members, loading, error, reload, invite, resend, confirm, remove }` (invite/resend/confirm/remove added incrementally in Tasks 4-6; this task delivers `members`/`loading`/`error`/`reload` + list rendering). Mirror `webapp/src/hooks/useAdminActions.ts`'s shape (read it first).

- [ ] **Step 1: Create the actions hook (fetch + state)**

Create `webapp/src/hooks/useOrgMemberActions.ts` with the fetch/reload core (invite/resend/confirm/remove are added in Tasks 4-6 — leave clearly-marked stubs or add them now returning `Promise<void>` that call the Task-1 API + `reload()`; if you add them now, wire fully). Minimal for Task 3:

```ts
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AuthedFetch } from '../lib/api/shared';
import { listOrgUsers, type OrgMember } from '../lib/api/organizations';

interface Options {
  authedFetch: AuthedFetch;
  orgId: string;
  onNotify?: (type: 'success' | 'error' | 'warning', text: string) => void;
}

export function useOrgMemberActions(opts: Options) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setMembers(await listOrgUsers(opts.authedFetch, opts.orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [opts.authedFetch, opts.orgId]);

  useEffect(() => { void reload(); }, [reload]);

  return { members, loading, error, reload };
}
```

- [ ] **Step 2: Render the member list in the detail page**

In `OrganizationDetailPage.tsx`, call `useOrgMemberActions({ authedFetch: props.authedFetch, orgId: props.orgId, onNotify: props.onNotify })` and render a table of members: columns Email (or Name/Email), Role (`type === 0` → `t('txt_org_role_owner')` else `t('txt_org_role_member')`), Status badge (`status` 0/1/2 → `t('txt_org_status_invited'|'txt_org_status_accepted'|'txt_org_status_confirmed')`). Show `loading`/`error`/empty states. Reuse the `.table` styling from `OrganizationsPage`.

Add i18n keys: `txt_org_status_invited`, `txt_org_status_accepted`, `txt_org_status_confirmed`, `txt_org_members_empty`, `txt_org_members_error`, `txt_org_col_member`, `txt_org_col_role`, `txt_org_col_status`, `txt_org_col_actions` — to all 10 locales.

- [ ] **Step 3: Gate + commit**

Run: `npm run build`, `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3), `npm run i18n`, `npm run test:orgs-web` — all green.

```bash
git add webapp/src/hooks/useOrgMemberActions.ts webapp/src/components/OrganizationDetailPage.tsx webapp/src/lib/i18n/locales/
git commit -m "feat(webapp): render org members list with status and role"
```

---

## Task 4: Invite members

**Files:**
- Modify: `webapp/src/hooks/useOrgMemberActions.ts` (add `invite`), `webapp/src/components/OrganizationDetailPage.tsx` (invite dialog), 10 locale files

**Interfaces:**
- Consumes: `inviteOrgUsers` (Task 1), `ConfirmDialog`.
- Produces: `invite(emails: string[]): Promise<void>` on the hook (calls `inviteOrgUsers` → `reload()` → notify).

- [ ] **Step 1: Add `invite` to the hook**

```ts
const invite = useCallback(async (emails: string[]) => {
  await inviteOrgUsers(opts.authedFetch, opts.orgId, emails);
  await reload();
  opts.onNotify?.('success', t('txt_org_invite_sent'));
}, [opts.authedFetch, opts.orgId, reload]);
```
(Import `inviteOrgUsers` and `t`. Return `invite` from the hook.)

- [ ] **Step 2: Add the invite dialog to the detail page**

Add an "Invite member" button that opens a `ConfirmDialog` with an email input (single email is enough for the family use case; accept a comma/space-separated list and split → array, trimming/filtering empties). On confirm: `await invite(emails)` inside try/catch → on error `onNotify('error', e.message)`; on success close the dialog (the hook already notified + reloaded). Disable confirm while submitting or when the input is empty/invalid. Mirror `OrganizationsPage`'s create-org `ConfirmDialog` usage.

Add i18n keys: `txt_org_invite_button`, `txt_org_invite_title`, `txt_org_invite_message`, `txt_org_invite_email_placeholder`, `txt_org_invite_sent`, `txt_org_invite_failed` — to all 10 locales.

- [ ] **Step 3: Gate + commit**

Run: `npm run build`, `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3), `npm run i18n`, `npm run test:orgs-web`.

```bash
git add webapp/src/hooks/useOrgMemberActions.ts webapp/src/components/OrganizationDetailPage.tsx webapp/src/lib/i18n/locales/
git commit -m "feat(webapp): invite org members by email"
```

---

## Task 5: Resend invite + remove member

**Files:**
- Modify: `webapp/src/hooks/useOrgMemberActions.ts` (`resend`, `remove`), `webapp/src/components/OrganizationDetailPage.tsx` (row actions), 10 locale files

**Interfaces:**
- Consumes: `resendOrgInvite`, `removeOrgUser` (Task 1), `ConfirmDialog`.
- Produces: `resend(orgUserId)` and `remove(orgUserId)` on the hook.

- [ ] **Step 1: Add `resend` + `remove` to the hook**

```ts
const resend = useCallback(async (orgUserId: string) => {
  await resendOrgInvite(opts.authedFetch, opts.orgId, orgUserId);
  opts.onNotify?.('success', t('txt_org_invite_resent'));
}, [opts.authedFetch, opts.orgId]);

const remove = useCallback(async (orgUserId: string) => {
  await removeOrgUser(opts.authedFetch, opts.orgId, orgUserId);
  await reload();
  opts.onNotify?.('success', t('txt_org_member_removed'));
}, [opts.authedFetch, opts.orgId, reload]);
```
(Import the API fns; return `resend`/`remove`.)

- [ ] **Step 2: Row actions in the detail page**

Per member row, render an Actions cell:
- If `status === 0 (invited)`: a "Resend" button → `await resend(m.id)` (try/catch → error notify).
- If `type !== 0 (not owner)`: a "Remove" button → opens a `ConfirmDialog` (`variant="warning"`) confirming removal of `m.email`; on confirm `await remove(m.id)`. Owners (`type === 0`) get no Remove button (backend also 400s).

Add i18n keys: `txt_org_resend_button`, `txt_org_invite_resent`, `txt_org_remove_button`, `txt_org_remove_title`, `txt_org_remove_message` (interpolate the email), `txt_org_member_removed`, `txt_org_remove_failed`, `txt_org_resend_failed` — to all 10 locales.

- [ ] **Step 3: Gate + commit**

Run the gates (build/tsc/i18n/test:orgs-web).

```bash
git add webapp/src/hooks/useOrgMemberActions.ts webapp/src/components/OrganizationDetailPage.tsx webapp/src/lib/i18n/locales/
git commit -m "feat(webapp): resend org invites and remove members"
```

---

## Task 6: Confirm member with key fingerprint

**Files:**
- Modify: `webapp/src/hooks/useOrgMemberActions.ts` (`confirm`), `webapp/src/components/OrganizationDetailPage.tsx` (confirm dialog with fingerprint), 10 locale files
- Test: extend `scripts/org-members-api.test.ts` or a new test for the confirm key composition

**Interfaces:**
- Consumes: `getUserPublicKey`, `confirmOrgUser` (Task 1); `rsaWrapOrgKeyForMember` (org-crypto), `getFingerprintPhrase` (auth-requests), `base64ToBytes` (crypto); `props.orgKeys` (the `orgKeysCache`).
- Produces: `confirm(member: OrgMember): Promise<void>` on the hook + a two-step confirm dialog (show fingerprint → admin confirms → wrap + POST).

**Security (fail-closed):** the confirm needs the admin's raw org key `orgKeys[orgId]`. If it's missing (not unlocked / unwrap failed), the Confirm action MUST be disabled with a message — never POST without the real wrapped key. Only offer Confirm for `status === 1 (accepted)` members with non-null `userId`.

- [ ] **Step 1: Write the failing test (key composition)**

Add a test asserting the confirm flow wraps the org key to the member's public key and the wrapped key round-trips (reuse `org-crypto.test.ts`'s helpers for generating a member RSA keypair). The pure composition to test: given an `orgKey` (Uint8Array) and a member keypair, `rsaWrapOrgKeyForMember(orgKey, memberPubB64)` → `confirmOrgUser` receives that exact string, and `unwrapOrgKey(wrapped, memberPrivKey)` returns the original `orgKey`. (This mirrors the existing `org-crypto.test.ts:76` round-trip; the new bit is asserting `confirmOrgUser` posts the wrapped key verbatim — already covered by Task 1's confirm test, so this step can extend that with the crypto round-trip if not already present. If fully covered by existing tests, note it and proceed.)

Run: `npx tsx --test scripts/org-members-api.test.ts` (RED if you added a new assertion).

- [ ] **Step 2: Add `confirm` to the hook**

```ts
const confirm = useCallback(async (member: OrgMember) => {
  if (!member.userId) throw new Error(t('txt_org_confirm_no_account'));
  const orgKey = opts.orgKeys[opts.orgId];
  if (!orgKey) throw new Error(t('txt_org_key_unavailable'));           // fail closed
  const publicKey = await getUserPublicKey(opts.authedFetch, member.userId);
  const wrapped = await rsaWrapOrgKeyForMember(orgKey, publicKey);
  await confirmOrgUser(opts.authedFetch, opts.orgId, member.id, wrapped);
  await reload();
  opts.onNotify?.('success', t('txt_org_member_confirmed'));
}, [opts.authedFetch, opts.orgId, opts.orgKeys, reload]);
```
(Add `orgKeys` to the hook's `Options`; thread it from the detail page `props.orgKeys`. Import `rsaWrapOrgKeyForMember`, `getUserPublicKey`, `confirmOrgUser`. Reuse the existing `txt_org_key_unavailable` key for the missing-key case.)

- [ ] **Step 3: Fingerprint confirm dialog in the detail page**

For a `status === 1 (accepted)` member, render a "Confirm" button (disabled with a tooltip/message if `!props.orgKeys[props.orgId]`). Clicking it:
1. `const publicKey = await getUserPublicKey(authedFetch, member.userId!)` then `const phrase = await getFingerprintPhrase(member.email, base64ToBytes(publicKey))`.
2. Open a `ConfirmDialog` showing the fingerprint `phrase` and instructions ("Verify this phrase with the member out-of-band before confirming"). 
3. On confirm: `await confirm(member)` (the hook re-fetches the key + wraps + POSTs — it re-fetches the public key, which is fine; OR pass the already-fetched publicKey into `confirm` to avoid a second GET — either is acceptable, prefer passing it in to avoid a double fetch and a possible key mismatch window).
   - To pass it in, change `confirm(member, publicKey?)` to accept an optional pre-fetched key.
4. On error → `onNotify('error', e.message)`.

Add i18n keys: `txt_org_confirm_button`, `txt_org_confirm_title`, `txt_org_confirm_fingerprint_label`, `txt_org_confirm_fingerprint_help`, `txt_org_member_confirmed`, `txt_org_confirm_failed`, `txt_org_confirm_no_account`, `txt_org_confirm_key_missing` — to all 10 locales.

- [ ] **Step 4: Run test + gates**

Run: `npx tsx --test scripts/org-members-api.test.ts` (green), `npm run build`, `npx tsc --noEmit -p webapp/tsconfig.json` (baseline 3), `npm run i18n`, `npm run test:orgs-web`.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/hooks/useOrgMemberActions.ts webapp/src/components/OrganizationDetailPage.tsx webapp/src/lib/i18n/locales/ scripts/org-members-api.test.ts
git commit -m "feat(webapp): confirm org members with key-fingerprint verification"
```

---

## Self-Review

**1. Spec coverage** (spec "Members tab (invite, pending list + resend, confirm with key fingerprint, remove)"):
- Org-detail page + route → Task 2. ✓
- List members with status/role → Task 3. ✓
- Invite → Task 4. ✓
- Pending list + resend → Task 5 (resend gated on `invited`). ✓
- Remove → Task 5 (gated: not owner). ✓
- Confirm with key fingerprint → Task 6 (fingerprint shown, fail-closed on missing org key, gated on `accepted`). ✓
- OUT of scope (deferred): Collections tab + access matrix (Phase 4d); create-into-org + member share/move-to-org dialog + vault org badges/filters (Phase 5). No backend changes (all endpoints exist).

**2. Placeholder scan:** every code step has real code. The "match the real signature from shared.ts" / "read AppMainRoutes props" notes are verification instructions against named files, not placeholders.

**3. Type consistency:** `OrgMember { id, userId, email, name, type, status }` is identical across Tasks 1/3/6. `useOrgMemberActions` options grow monotonically (Task 3: authedFetch/orgId/onNotify; Task 6 adds orgKeys). Hook return grows: `{members,loading,error,reload}` (T3) → `+invite` (T4) → `+resend,remove` (T5) → `+confirm` (T6). `OrganizationDetailPage` props `{orgId, profile, authedFetch, orgKeys, onNotify}` fixed from Task 2.

**Ordering:** Task 1 (API) → Task 2 (route + shell) → Tasks 3-6 build the Members tab incrementally on the shell. Each task ends green (build + tsc + i18n + tests). Task 2 is the routing task — it MUST update all four registration points (App.tsx isKnownAppRoute regex + currentPageTitle, AppMainRoutes Route, AppAuthenticatedShell active-state) or the detail page 404s like 4a did.

**Post-implementation verification (controller, after review):** deploy to cdcore-vault-test; in the web vault as an owner: open an org → Members tab lists the owner (confirmed); invite an email → appears as `invited`; (a second account accepts via API/client) → shows `accepted` → Confirm shows a fingerprint phrase and, on confirm, flips to `confirmed` and the member's next sync exposes the org key; resend on an invited member; remove a non-owner member. Remember to clear the PWA service worker + caches after redeploy (per 4a/4b).
