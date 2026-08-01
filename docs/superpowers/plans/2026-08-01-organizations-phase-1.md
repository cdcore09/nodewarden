# Organizations Phase 1 (Schema + Org CRUD + Owner Membership) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the organizations data layer and org lifecycle API to NodeWarden so the operator can create/rename/delete organizations, is recorded as confirmed owner, and sees their orgs in `profile.organizations` via sync.

**Architecture:** Additive modules per the approved spec (`docs/superpowers/specs/2026-08-01-organizations-design.md`): new tables in both schema locations, a new repo, new pure shape/validation module, a new handler, and minimal surgical edits (router registration, `buildProfileResponse` gains an organizations parameter, 3 call sites). All sharing crypto is client-side; the server stores encrypted blobs only.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), TypeScript, `tsx --test` (node:test runner), `node:sqlite` for a local D1 shim in tests, wrangler for local dev.

**Plan scope note:** The spec has 5 gated phases. This plan is Phase 1 only. Phases 2–5 (invite flow, ACL+sync ciphers, admin UI, member UI) each get their own plan document written at their phase boundary.

## Global Constraints

- **Mergeable fork:** new files preferred; the only shared files this phase may modify are `src/services/storage-schema.ts`, `src/services/storage.ts`, `src/services/backup-archive.ts`, `src/services/backup-import.ts`, `src/utils/profile-response.ts`, `src/handlers/sync.ts`, `src/handlers/accounts.ts`, `src/router-authenticated.ts`, `src/types/index.ts`, `migrations/`, `package.json` (test script), `scripts/`. Anything else = design deviation, stop and flag.
- **Schema changes go to BOTH** `migrations/0002_organizations.sql` AND `SCHEMA_STATEMENTS` in `src/services/storage-schema.ts`, AND bump `STORAGE_SCHEMA_VERSION` in `src/services/storage.ts`, AND extend the backup export/import contract (repo rule, see headers of those files).
- **DB stores role/status as TEXT** (`'owner'|'user'`, `'invited'|'accepted'|'confirmed'`); **API emits Bitwarden numerics** (type: owner=0, user=2; status: invited=0, accepted=1, confirmed=2). Mapping lives ONLY in `src/handlers/org-shapes.ts`.
- **Cipher ownership invariant:** a cipher is org-owned iff `organization_id IS NOT NULL`; `user_id` remains NOT NULL and records the creator. (Personal-vault query filtering on `organization_id IS NULL` happens in Phase 3, when org ciphers first become creatable.)
- **Unauthorized == nonexistent:** org endpoints return the same 404 (`errorResponse('Organization not found', 404)`) for both.
- Commit after every task; branch `feat/organizations` (create via superpowers:using-git-worktrees at execution start). Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never touch `.env` / never commit secrets. `.dev.vars` must be confirmed gitignored before writing it (Task 9).

---

### Task 1: Test DB harness (D1 shim over node:sqlite)

The repo has no DB-level tests. Repos take `db: D1Database` as a plain argument, so a small shim over `node:sqlite` lets us test real SQL against the real schema with zero mocks.

**Files:**
- Modify: `src/services/storage-schema.ts` (one-token change: `const SCHEMA_STATEMENTS` → `export const SCHEMA_STATEMENTS`)
- Create: `scripts/test-db.ts`
- Test: `scripts/test-db.test.ts`
- Modify: `package.json` (add test scripts)

**Interfaces:**
- Produces: `createTestDb(): D1Database` — in-memory DB with the full NodeWarden schema applied; the returned object implements `prepare(sql).bind(...).first()/all()/run()`, `batch(stmts)`, `exec(sql)`.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-db.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';

test('createTestDb applies the schema and supports basic D1 operations', async () => {
  const db = createTestDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind('u1', 'a@b.c', 'hash', 'key', 0, 600000, 'stamp', now, now)
    .run();
  const row = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind('u1').first<any>();
  assert.equal(row.email, 'a@b.c');
  const all = await db.prepare('SELECT id FROM users').all<any>();
  assert.equal((all.results || []).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/test-db.test.ts`
Expected: FAIL (cannot find module './test-db')

- [ ] **Step 3: Export SCHEMA_STATEMENTS and write the shim**

In `src/services/storage-schema.ts` change `const SCHEMA_STATEMENTS: readonly string[] = [` to `export const SCHEMA_STATEMENTS: readonly string[] = [` (keep any existing export at the bottom of the file working — if the file already exports it via another symbol, do not duplicate).

```typescript
// scripts/test-db.ts
// Minimal D1Database shim over node:sqlite for repo-level tests.
// Implements only what NodeWarden's repos use: prepare/bind/first/all/run, batch, exec.
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_STATEMENTS } from '../src/services/storage-schema';

class ShimStatement {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]): ShimStatement {
    return new ShimStatement(this.db, this.sql, params);
  }
  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as any[]));
    return (row as T) ?? null;
  }
  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: {} }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as any[]));
    return { results: rows as T[], success: true, meta: {} };
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.params as any[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export function createTestDb(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const stmt of SCHEMA_STATEMENTS) {
    // Mirrors ensureStorageSchema(): idempotent statements; ALTERs for
    // already-present columns throw and are intentionally ignored.
    try {
      db.exec(stmt);
    } catch {
      /* ignore, same as runtime bootstrap */
    }
  }
  return {
    prepare(sql: string) {
      return new ShimStatement(db, sql);
    },
    async batch(statements: ShimStatement[]) {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test scripts/test-db.test.ts`
Expected: PASS. If `node:sqlite` is unavailable, the installed Node is too old — check `node --version` (needs ≥ 22.5) and stop to report rather than substituting a dependency.

- [ ] **Step 5: Add test scripts to package.json**

In `package.json` `scripts`, add (keep existing scripts untouched):

```json
"test:orgs": "tsx --test scripts/test-db.test.ts scripts/storage-org-repo.test.ts scripts/org-shapes.test.ts scripts/org-backup.test.ts scripts/org-profile.test.ts",
```

(The listed files accumulate over later tasks; `tsx --test` tolerates the list only once files exist — until then run files individually as shown per task.)

- [ ] **Step 6: Commit**

```bash
git add scripts/test-db.ts scripts/test-db.test.ts src/services/storage-schema.ts package.json
git commit -m "test: add node:sqlite-backed D1 shim for repo tests"
```

---

### Task 2: Organizations schema (both locations + version bump)

**Files:**
- Create: `migrations/0002_organizations.sql`
- Modify: `src/services/storage-schema.ts` (append to `SCHEMA_STATEMENTS`)
- Modify: `src/services/storage.ts` (bump `STORAGE_SCHEMA_VERSION`)
- Test: `scripts/test-db.test.ts` (extend)

**Interfaces:**
- Produces: tables `organizations`, `organization_users`, `collections`, `collection_users`, `cipher_collections`; column `ciphers.organization_id`.

- [ ] **Step 1: Write the failing test** (append to `scripts/test-db.test.ts`)

```typescript
test('organizations schema exists', async () => {
  const db = createTestDb();
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organizations','organization_users','collections','collection_users','cipher_collections') ORDER BY name"
    )
    .all<any>();
  assert.deepEqual(
    (tables.results || []).map((r: any) => r.name),
    ['cipher_collections', 'collection_users', 'collections', 'organization_users', 'organizations']
  );
  const cipherCols = await db.prepare("SELECT name FROM pragma_table_info('ciphers') WHERE name='organization_id'").all<any>();
  assert.equal((cipherCols.results || []).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/test-db.test.ts`
Expected: FAIL (deepEqual mismatch — no org tables)

- [ ] **Step 3: Write the migration file**

```sql
-- migrations/0002_organizations.sql
-- Organizations / collections / sharing schema (see docs/superpowers/specs/2026-08-01-organizations-design.md).
-- Keep in sync with src/services/storage-schema.ts (SCHEMA_STATEMENTS).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key TEXT,
  encrypted_private_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'invited',
  encrypted_org_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_users_org_email ON organization_users(org_id, email);
CREATE INDEX IF NOT EXISTS idx_org_users_user ON organization_users(user_id);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collections_org ON collections(org_id);

CREATE TABLE IF NOT EXISTS collection_users (
  collection_id TEXT NOT NULL,
  org_user_id TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  hide_passwords INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, org_user_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (org_user_id) REFERENCES organization_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cipher_collections (
  cipher_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  PRIMARY KEY (cipher_id, collection_id),
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

ALTER TABLE ciphers ADD COLUMN organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ciphers_org ON ciphers(organization_id);
```

- [ ] **Step 4: Append the same statements to `SCHEMA_STATEMENTS`** in `src/services/storage-schema.ts`, following the file's single-quoted string-concatenation style, at the END of the array (order matters: `ALTER TABLE ciphers ADD COLUMN organization_id TEXT` is idempotent-by-ignored-error like the existing ALTERs). Add each `CREATE TABLE`, each index, and the `ALTER TABLE` as separate array entries.

- [ ] **Step 5: Bump the schema version** in `src/services/storage.ts`:

```typescript
const STORAGE_SCHEMA_VERSION = '2026-08-01-organizations';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --test scripts/test-db.test.ts`
Expected: PASS (both tests)

- [ ] **Step 7: Commit**

```bash
git add migrations/0002_organizations.sql src/services/storage-schema.ts src/services/storage.ts scripts/test-db.test.ts
git commit -m "feat: add organizations/collections schema (migration + runtime bootstrap)"
```

---

### Task 3: Types

**Files:**
- Modify: `src/types/index.ts` (append; do not reorder existing exports)

**Interfaces:**
- Produces (exact shapes later tasks rely on):

- [ ] **Step 1: Append the following to `src/types/index.ts`**

```typescript
// --- Organizations (docs/superpowers/specs/2026-08-01-organizations-design.md) ---
export type OrgRole = 'owner' | 'user';
export type OrgUserStatus = 'invited' | 'accepted' | 'confirmed';

export interface Organization {
  id: string;
  name: string;
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationUser {
  id: string;
  orgId: string;
  userId: string | null;
  email: string;
  role: OrgRole;
  status: OrgUserStatus;
  encryptedOrgKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMembership {
  organization: Organization;
  orgUser: OrganizationUser;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20` (use the repo's tsconfig; if multiple, the root one)
Expected: no NEW errors versus a pre-change run (record the pre-change error count first; upstream may not be zero-error).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add organization types"
```

---

### Task 4: `storage-org-repo.ts`

**Files:**
- Create: `src/services/storage-org-repo.ts`
- Test: `scripts/storage-org-repo.test.ts`

**Interfaces:**
- Consumes: schema from Task 2, types from Task 3, `createTestDb` from Task 1.
- Produces (exact signatures; `db` first like every repo in this codebase):
  - `createOrganizationWithOwner(db, org: Organization, owner: OrganizationUser): Promise<void>`
  - `getOrganization(db, orgId: string): Promise<Organization | null>`
  - `getOrgUserByOrgAndUser(db, orgId: string, userId: string): Promise<OrganizationUser | null>`
  - `listMembershipsForUser(db, userId: string): Promise<OrgMembership[]>` (any status; callers filter)
  - `updateOrganizationName(db, orgId: string, name: string, updatedAt: string): Promise<void>`
  - `deleteOrganization(db, orgId: string): Promise<void>` (FK cascades handle children)

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/storage-org-repo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';
import {
  createOrganizationWithOwner,
  getOrganization,
  getOrgUserByOrgAndUser,
  listMembershipsForUser,
  updateOrganizationName,
  deleteOrganization,
} from '../src/services/storage-org-repo';
import type { Organization, OrganizationUser } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';

async function seedUser(db: any, id: string, email: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .bind(id, email, 'hash', 'key', 0, 600000, 'stamp-' + id, now, now)
    .run();
}

function org(id: string): Organization {
  return { id, name: '2.encName|abc', publicKey: 'pub', encryptedPrivateKey: '2.priv', createdAt: now, updatedAt: now };
}

function owner(id: string, orgId: string, userId: string, email: string): OrganizationUser {
  return { id, orgId, userId, email, role: 'owner', status: 'confirmed', encryptedOrgKey: '4.wrapped', createdAt: now, updatedAt: now };
}

test('create + get organization with confirmed owner membership', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));

  const fetched = await getOrganization(db, 'o1');
  assert.equal(fetched?.name, '2.encName|abc');

  const member = await getOrgUserByOrgAndUser(db, 'o1', 'u1');
  assert.equal(member?.role, 'owner');
  assert.equal(member?.status, 'confirmed');
  assert.equal(member?.encryptedOrgKey, '4.wrapped');
});

test('listMembershipsForUser returns only that user\'s orgs', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await seedUser(db, 'u2', 'other@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await createOrganizationWithOwner(db, org('o2'), owner('ou2', 'o2', 'u2', 'other@x.y'));

  const mine = await listMembershipsForUser(db, 'u1');
  assert.deepEqual(mine.map((m) => m.organization.id), ['o1']);
});

test('rename updates name and updated_at only', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await updateOrganizationName(db, 'o1', '2.newName|def', '2026-08-02T00:00:00.000Z');
  const fetched = await getOrganization(db, 'o1');
  assert.equal(fetched?.name, '2.newName|def');
  assert.equal(fetched?.updatedAt, '2026-08-02T00:00:00.000Z');
});

test('deleteOrganization cascades to memberships', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await deleteOrganization(db, 'o1');
  assert.equal(await getOrganization(db, 'o1'), null);
  assert.equal(await getOrgUserByOrgAndUser(db, 'o1', 'u1'), null);
  assert.deepEqual(await listMembershipsForUser(db, 'u1'), []);
});

test('duplicate member email in same org is rejected by unique index', async () => {
  const db = createTestDb();
  await seedUser(db, 'u1', 'me@x.y');
  await createOrganizationWithOwner(db, org('o1'), owner('ou1', 'o1', 'u1', 'me@x.y'));
  await assert.rejects(() =>
    createOrganizationWithOwner(db, org('o1b'), owner('ou1b', 'o1', 'u1', 'me@x.y')).then(() => {
      throw new Error('should not reach');
    })
  );
});
```

(Note: the last test relies on `createOrganizationWithOwner` inserting the membership row for an existing `org_id`; the org insert for `o1b` will succeed but the duplicate `(org_id, email)` membership must reject. If the implementation inserts org first and membership second without a transaction, add cleanup of the orphan org row inside the catch — see Step 3.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test scripts/storage-org-repo.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the repo** (mirror `storage-folder-repo.ts` style exactly: mapper functions, snake_case SQL, `db` first param)

```typescript
// src/services/storage-org-repo.ts
import type { Organization, OrganizationUser, OrgMembership } from '../types';

function mapOrgRow(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    publicKey: row.public_key ?? null,
    encryptedPrivateKey: row.encrypted_private_key ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrgUserRow(row: any): OrganizationUser {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id ?? null,
    email: row.email,
    role: row.role,
    status: row.status,
    encryptedOrgKey: row.encrypted_org_key ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ORG_COLUMNS = 'id, name, public_key, encrypted_private_key, created_at, updated_at';
const ORG_USER_COLUMNS = 'id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at';

export async function createOrganizationWithOwner(
  db: D1Database,
  org: Organization,
  owner: OrganizationUser
): Promise<void> {
  await db
    .prepare(`INSERT INTO organizations(${ORG_COLUMNS}) VALUES(?,?,?,?,?,?)`)
    .bind(org.id, org.name, org.publicKey, org.encryptedPrivateKey, org.createdAt, org.updatedAt)
    .run();
  try {
    await db
      .prepare(`INSERT INTO organization_users(${ORG_USER_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(
        owner.id,
        owner.orgId,
        owner.userId,
        owner.email,
        owner.role,
        owner.status,
        owner.encryptedOrgKey,
        owner.createdAt,
        owner.updatedAt
      )
      .run();
  } catch (err) {
    // Membership insert failed (e.g. duplicate (org_id, email)); do not leave an ownerless org.
    await db.prepare('DELETE FROM organizations WHERE id = ?').bind(org.id).run();
    throw err;
  }
}

export async function getOrganization(db: D1Database, orgId: string): Promise<Organization | null> {
  const row = await db.prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`).bind(orgId).first<any>();
  if (!row) return null;
  return mapOrgRow(row);
}

export async function getOrgUserByOrgAndUser(
  db: D1Database,
  orgId: string,
  userId: string
): Promise<OrganizationUser | null> {
  const row = await db
    .prepare(`SELECT ${ORG_USER_COLUMNS} FROM organization_users WHERE org_id = ? AND user_id = ?`)
    .bind(orgId, userId)
    .first<any>();
  if (!row) return null;
  return mapOrgUserRow(row);
}

export async function listMembershipsForUser(db: D1Database, userId: string): Promise<OrgMembership[]> {
  const res = await db
    .prepare(
      `SELECT o.id AS o_id, o.name AS o_name, o.public_key AS o_public_key, o.encrypted_private_key AS o_encrypted_private_key, o.created_at AS o_created_at, o.updated_at AS o_updated_at, ` +
      `ou.id AS ou_id, ou.org_id AS ou_org_id, ou.user_id AS ou_user_id, ou.email AS ou_email, ou.role AS ou_role, ou.status AS ou_status, ou.encrypted_org_key AS ou_encrypted_org_key, ou.created_at AS ou_created_at, ou.updated_at AS ou_updated_at ` +
      `FROM organization_users ou JOIN organizations o ON o.id = ou.org_id WHERE ou.user_id = ? ORDER BY o.created_at ASC`
    )
    .bind(userId)
    .all<any>();
  return (res.results || []).map((row) => ({
    organization: mapOrgRow({
      id: row.o_id,
      name: row.o_name,
      public_key: row.o_public_key,
      encrypted_private_key: row.o_encrypted_private_key,
      created_at: row.o_created_at,
      updated_at: row.o_updated_at,
    }),
    orgUser: mapOrgUserRow({
      id: row.ou_id,
      org_id: row.ou_org_id,
      user_id: row.ou_user_id,
      email: row.ou_email,
      role: row.ou_role,
      status: row.ou_status,
      encrypted_org_key: row.ou_encrypted_org_key,
      created_at: row.ou_created_at,
      updated_at: row.ou_updated_at,
    }),
  }));
}

export async function updateOrganizationName(
  db: D1Database,
  orgId: string,
  name: string,
  updatedAt: string
): Promise<void> {
  await db
    .prepare('UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, updatedAt, orgId)
    .run();
}

export async function deleteOrganization(db: D1Database, orgId: string): Promise<void> {
  await db.prepare('DELETE FROM organizations WHERE id = ?').bind(orgId).run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/storage-org-repo.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/storage-org-repo.ts scripts/storage-org-repo.test.ts
git commit -m "feat: add organizations storage repo"
```

---

### Task 5: StorageService wiring

**Files:**
- Modify: `src/services/storage.ts` (imports + methods, following the exact aliasing pattern used for folders at the top of the file)
- Test: `scripts/storage-org-repo.test.ts` (extend)

**Interfaces:**
- Produces methods on `StorageService`: `createOrganizationWithOwner(org, owner)`, `getOrganization(orgId)`, `getOrgUserByOrgAndUser(orgId, userId)`, `listMembershipsForUser(userId)`, `updateOrganizationName(orgId, name, updatedAt)`, `deleteOrganization(orgId)` — each delegating to the repo with `this.db`.

- [ ] **Step 1: Write the failing test** (append to `scripts/storage-org-repo.test.ts`)

```typescript
import { StorageService } from '../src/services/storage';

test('StorageService exposes org repo methods', async () => {
  const db = createTestDb();
  await seedUser(db, 'u9', 'svc@x.y');
  const storage = new StorageService(db as any);
  await storage.createOrganizationWithOwner(org('o9'), owner('ou9', 'o9', 'u9', 'svc@x.y'));
  const memberships = await storage.listMembershipsForUser('u9');
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].orgUser.role, 'owner');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/storage-org-repo.test.ts`
Expected: FAIL (`storage.createOrganizationWithOwner is not a function`). If instead the import of `StorageService` itself fails under tsx (workers-only transitive import), STOP and report — the wiring test moves to the smoke task and this task keeps only the typecheck gate.

- [ ] **Step 3: Wire the methods** in `src/services/storage.ts`: import the six repo functions with `as` aliases matching the file's convention (e.g. `createOrganizationWithOwner as createStoredOrganizationWithOwner`), then add to the `StorageService` class (place after the folder methods):

```typescript
  async createOrganizationWithOwner(org: Organization, owner: OrganizationUser): Promise<void> {
    return createStoredOrganizationWithOwner(this.db, org, owner);
  }
  async getOrganization(orgId: string): Promise<Organization | null> {
    return getStoredOrganization(this.db, orgId);
  }
  async getOrgUserByOrgAndUser(orgId: string, userId: string): Promise<OrganizationUser | null> {
    return getStoredOrgUserByOrgAndUser(this.db, orgId, userId);
  }
  async listMembershipsForUser(userId: string): Promise<OrgMembership[]> {
    return listStoredMembershipsForUser(this.db, userId);
  }
  async updateOrganizationName(orgId: string, name: string, updatedAt: string): Promise<void> {
    return updateStoredOrganizationName(this.db, orgId, name, updatedAt);
  }
  async deleteOrganization(orgId: string): Promise<void> {
    return deleteStoredOrganization(this.db, orgId);
  }
```

Add `Organization, OrganizationUser, OrgMembership` to the existing type import from `../types`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsx --test scripts/storage-org-repo.test.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: tests PASS; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/storage.ts scripts/storage-org-repo.test.ts
git commit -m "feat: wire organization repo into StorageService"
```

---

### Task 6: Backup export/import contract

Repo rule (header of `storage-schema.ts`): persistent tables must join the backup contract. Follow the existing per-table pattern in both files exactly — this task is pattern-following, so read the `folders` handling in each file first and replicate it for the five new tables.

**Files:**
- Modify: `src/services/backup-archive.ts` — add the five tables to: the `BackupPayload` db shape (around line 71), the export `queryRows` block (~line 498; use explicit column lists in `created_at ASC` order like folders), the manifest `tableCounts` (~line 526), and the payload assembly (~line 549).
- Modify: `src/services/backup-import.ts` — add the five tables to the restore allowlist (the `source.folders as SqlRow[]` block ~line 277) and the row-restore section (mirror how `folderRows` are validated via `ensureRowArray` and inserted).
- Test: `scripts/org-backup.test.ts`

**Interfaces:**
- Consumes: schema (Task 2), repo (Task 4).
- Produces: backups round-trip org data.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/org-backup.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db';

// The real round-trip pair is buildBackupArchive (src/services/backup-archive.ts:477,
// takes an env whose .DB is queried) and importBackupArchiveBytes
// (src/services/backup-import.ts:694). Both use pure-JS zip (@zip.js) so they
// should run under tsx with an env stub like { DB: createTestDb() } — check
// their exact signatures/options at those lines and call them accordingly.
// The assertion below is the contract.

test('org tables round-trip through backup export/import', async () => {
  const source = createTestDb();
  const now = '2026-08-01T00:00:00.000Z';
  await source
    .prepare('INSERT INTO users(id, email, master_password_hash, key, kdf_type, kdf_iterations, security_stamp, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('u1', 'a@b.c', 'h', 'k', 0, 600000, 's', now, now)
    .run();
  await source
    .prepare('INSERT INTO organizations(id, name, public_key, encrypted_private_key, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .bind('o1', '2.n', 'pub', '2.priv', now, now)
    .run();
  await source
    .prepare('INSERT INTO organization_users(id, org_id, user_id, email, role, status, encrypted_org_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('ou1', 'o1', 'u1', 'a@b.c', 'owner', 'confirmed', '4.w', now, now)
    .run();

  // <exported-payload> = await buildBackupPayload-equivalent(source)
  // await restore-equivalent(target, <exported-payload>)
  // Replace the two lines above with the real calls once identified.
  const target = createTestDb();
  // TEMPORARY direct assertion to force the failing state until wired:
  const restored = await target.prepare('SELECT id FROM organizations').all<any>();
  assert.equal((restored.results || []).length, 1, 'org row must survive backup round-trip');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/org-backup.test.ts`
Expected: FAIL (0 !== 1)

- [ ] **Step 3: Implement the contract additions** in both backup files per the pattern; then replace the test's TEMPORARY block with the real export/restore calls (the function names found in Step 3 — update the test to call them; if those modules cannot be imported under tsx due to workers-runtime transitive imports, extract the pure payload-build/restore row logic into `src/services/backup-org-rows.ts` (new file, allowed) and test that module instead; the backup files then call it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test scripts/org-backup.test.ts`
Expected: PASS, with the round-trip actually executed (no TEMPORARY block remaining — grep the test file for `TEMPORARY`, must be zero hits).

- [ ] **Step 5: Commit**

```bash
git add src/services/backup-archive.ts src/services/backup-import.ts scripts/org-backup.test.ts
git commit -m "feat: include organization tables in backup contract"
```

---

### Task 7: Pure shapes + validation module (`org-shapes.ts`)

Pure module — no worker imports — so tsx tests cover the compatibility-critical mappings directly. All Bitwarden enum mapping lives here and only here.

**Files:**
- Create: `src/handlers/org-shapes.ts`
- Test: `scripts/org-shapes.test.ts`

**Interfaces:**
- Consumes: types (Task 3).
- Produces:
  - `ORG_TYPE: { owner: 0; user: 2 }`, `ORG_STATUS: { invited: 0; accepted: 1; confirmed: 2 }`
  - `parseCreateOrgRequest(body: unknown): { name: string; key: string; publicKey: string | null; encryptedPrivateKey: string | null } | { error: string }`
  - `organizationToResponse(org: Organization): Record<string, unknown>` (`object: 'organization'`)
  - `profileOrganizationResponse(m: OrgMembership): Record<string, unknown>` (`object: 'profileOrganization'`)

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/org-shapes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORG_TYPE,
  ORG_STATUS,
  parseCreateOrgRequest,
  organizationToResponse,
  profileOrganizationResponse,
} from '../src/handlers/org-shapes';
import type { OrgMembership } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';
const membership: OrgMembership = {
  organization: { id: 'o1', name: '2.encName|x', publicKey: 'pub', encryptedPrivateKey: '2.priv', createdAt: now, updatedAt: now },
  orgUser: { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.wrapped', createdAt: now, updatedAt: now },
};

test('enum mappings match Bitwarden numerics', () => {
  assert.equal(ORG_TYPE.owner, 0);
  assert.equal(ORG_TYPE.user, 2);
  assert.equal(ORG_STATUS.invited, 0);
  assert.equal(ORG_STATUS.accepted, 1);
  assert.equal(ORG_STATUS.confirmed, 2);
});

test('parseCreateOrgRequest accepts a valid official-client body and rejects garbage', () => {
  const ok = parseCreateOrgRequest({ name: '2.encName|x', key: '4.wrapped', keys: { publicKey: 'pub', encryptedPrivateKey: '2.priv' }, billingEmail: 'a@b.c', collectionName: '2.c' });
  assert.deepEqual(ok, { name: '2.encName|x', key: '4.wrapped', publicKey: 'pub', encryptedPrivateKey: '2.priv' });
  assert.ok('error' in (parseCreateOrgRequest({}) as any));
  assert.ok('error' in (parseCreateOrgRequest({ name: '', key: 'k' }) as any));
  assert.ok('error' in (parseCreateOrgRequest({ name: 'x'.repeat(1001), key: 'k' }) as any));
  assert.ok('error' in (parseCreateOrgRequest(null) as any));
});

test('profileOrganizationResponse has the client-critical fields', () => {
  const p = profileOrganizationResponse(membership) as any;
  assert.equal(p.id, 'o1');
  assert.equal(p.organizationUserId, 'ou1');
  assert.equal(p.key, '4.wrapped');
  assert.equal(p.type, 0);
  assert.equal(p.status, 2);
  assert.equal(p.enabled, true);
  assert.equal(p.hasPublicAndPrivateKeys, true);
  assert.equal(p.object, 'profileOrganization');
});

test('organizationToResponse is the full org object', () => {
  const o = organizationToResponse(membership.organization) as any;
  assert.equal(o.id, 'o1');
  assert.equal(o.name, '2.encName|x');
  assert.equal(o.object, 'organization');
  assert.equal(o.selfHost, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test scripts/org-shapes.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the module**

```typescript
// src/handlers/org-shapes.ts
// Pure request-parsing and response-shaping for organizations.
// ALL Bitwarden org enum mapping lives here (Global Constraint).
// Field set follows Vaultwarden's responses; validated against official
// clients in Phase 3/4 — adjust HERE if a client rejects a shape.
import type { Organization, OrgMembership, OrgRole, OrgUserStatus } from '../types';

export const ORG_TYPE: Record<OrgRole, number> = { owner: 0, user: 2 };
export const ORG_STATUS: Record<OrgUserStatus, number> = { invited: 0, accepted: 1, confirmed: 2 };

const MAX_ENCRYPTED_NAME_LENGTH = 1000;

export function parseCreateOrgRequest(
  body: unknown
): { name: string; key: string; publicKey: string | null; encryptedPrivateKey: string | null } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const key = typeof b.key === 'string' ? b.key.trim() : '';
  if (!name || name.length > MAX_ENCRYPTED_NAME_LENGTH) return { error: 'Organization name is required' };
  if (!key) return { error: 'Organization key is required' };
  const keys = b.keys && typeof b.keys === 'object' ? (b.keys as Record<string, unknown>) : null;
  const publicKey = keys && typeof keys.publicKey === 'string' ? keys.publicKey : null;
  const encryptedPrivateKey = keys && typeof keys.encryptedPrivateKey === 'string' ? keys.encryptedPrivateKey : null;
  return { name, key, publicKey, encryptedPrivateKey };
}

// Feature flags advertised to clients. Family/team subset per the spec:
// totp yes; groups/policies/sso/scim/api/directory/events no.
const ORG_FEATURE_FLAGS = {
  use2fa: false,
  useApi: false,
  useDirectory: false,
  useEvents: false,
  useGroups: false,
  useKeyConnector: false,
  usePolicies: false,
  useResetPassword: false,
  useScim: false,
  useSecretsManager: false,
  useSso: false,
  useTotp: true,
  usePasswordManager: true,
} as const;

export function organizationToResponse(org: Organization): Record<string, unknown> {
  return {
    id: org.id,
    identifier: null,
    name: org.name,
    billingEmail: null,
    businessName: null,
    plan: 'Free',
    planType: 0,
    seats: null,
    maxCollections: null,
    maxStorageGb: null,
    ...ORG_FEATURE_FLAGS,
    selfHost: true,
    usersGetPremium: true,
    hasPublicAndPrivateKeys: !!(org.publicKey && org.encryptedPrivateKey),
    limitCollectionCreation: true,
    limitCollectionDeletion: true,
    limitItemDeletion: false,
    allowAdminAccessToAllCollectionItems: true,
    object: 'organization',
  };
}

export function profileOrganizationResponse(m: OrgMembership): Record<string, unknown> {
  const { organization, orgUser } = m;
  return {
    id: organization.id,
    identifier: null,
    name: organization.name,
    organizationUserId: orgUser.id,
    key: orgUser.encryptedOrgKey,
    status: ORG_STATUS[orgUser.status],
    type: ORG_TYPE[orgUser.role],
    enabled: true,
    seats: null,
    maxCollections: null,
    maxStorageGb: null,
    ...ORG_FEATURE_FLAGS,
    selfHost: true,
    usersGetPremium: true,
    ssoBound: false,
    hasPublicAndPrivateKeys: !!(organization.publicKey && organization.encryptedPrivateKey),
    accessSecretsManager: false,
    limitCollectionCreation: true,
    limitCollectionDeletion: true,
    limitItemDeletion: false,
    allowAdminAccessToAllCollectionItems: true,
    userIsManagedByOrganization: false,
    providerId: null,
    providerName: null,
    familySponsorshipFriendlyName: null,
    permissions: null,
    resetPasswordEnrolled: false,
    userId: orgUser.userId,
    object: 'profileOrganization',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/org-shapes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/handlers/org-shapes.ts scripts/org-shapes.test.ts
git commit -m "feat: add organization request/response shapes"
```

---

### Task 8: Organizations handler + profile integration

**Files:**
- Create: `src/handlers/organizations.ts`
- Modify: `src/utils/profile-response.ts` (add optional `organizations` parameter)
- Modify: `src/handlers/sync.ts:93` and `src/handlers/accounts.ts:497,536` (fetch memberships, pass through)
- Test: `scripts/org-profile.test.ts`

**Interfaces:**
- Consumes: StorageService methods (Task 5), shapes (Task 7), plus existing utilities exactly as `src/handlers/folders.ts` uses them: `jsonResponse`/`errorResponse` from `../utils/response`, `generateUUID` from `../utils/uuid`, `writeAuditEvent`/`auditRequestMetadata` from `../services/audit-events`, `notifyUserVaultSync` from `../durable/notifications-hub`, `readActingDeviceIdentifier` from `../utils/device`.
- Produces handler exports for the router (Task 9): `handleCreateOrganization(request, env, userId)`; `handleGetOrganization`, `handleUpdateOrganization`, `handleDeleteOrganization` each `(request: Request, env: Env, userId: string, orgId: string) => Promise<Response>`.
- Produces changed signature: `buildProfileResponse(user: User, env?: Env, organizations: Record<string, unknown>[] = [])`.

- [ ] **Step 1: Write the failing profile test**

```typescript
// scripts/org-profile.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileResponse } from '../src/utils/profile-response';
import { profileOrganizationResponse } from '../src/handlers/org-shapes';
import type { OrgMembership, User } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';
const user = {
  id: 'u1', email: 'a@b.c', name: 'A', key: 'k', privateKey: 'pk', publicKey: 'pub',
  masterPasswordHash: 'h', masterPasswordHint: null, kdfType: 0, kdfIterations: 600000,
  kdfMemory: null, kdfParallelism: null, securityStamp: 's', role: 'user', status: 'active',
  verifyDevices: false, totpSecret: null, totpRecoveryCode: null, apiKey: null,
  createdAt: now, updatedAt: now,
} as unknown as User;

const membership: OrgMembership = {
  organization: { id: 'o1', name: '2.n', publicKey: 'pub', encryptedPrivateKey: '2.p', createdAt: now, updatedAt: now },
  orgUser: { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.w', createdAt: now, updatedAt: now },
};

test('buildProfileResponse without orgs keeps empty arrays (backward compatible)', () => {
  const p = buildProfileResponse(user) as any;
  assert.deepEqual(p.organizations, []);
  assert.deepEqual(p.organizationsNew, []);
});

test('buildProfileResponse threads organizations into both fields', () => {
  const orgs = [profileOrganizationResponse(membership)];
  const p = buildProfileResponse(user, undefined, orgs) as any;
  assert.equal(p.organizations.length, 1);
  assert.equal(p.organizations[0].id, 'o1');
  assert.equal(p.organizationsNew, p.organizations);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test scripts/org-profile.test.ts`
Expected: FAIL (third argument ignored → `p.organizations.length` is 0)

(If importing `profile-response.ts` under tsx fails on a workers-runtime transitive import, split the org threading into the test differently: assert via a locally constructed expected object — but first try; `profile-response.ts` imports only utils.)

- [ ] **Step 3: Update `buildProfileResponse`**

In `src/utils/profile-response.ts`, change the signature and organizations lines:

```typescript
export function buildProfileResponse(
  user: User,
  env?: Env,
  organizations: Record<string, unknown>[] = []
): ProfileResponse {
  void env;
  const accountKeys = buildAccountKeys(user);
  // ... unchanged ...
    organizations,
    organizationsNew: organizations,
  // ... unchanged ...
```

(Delete the old `const organizations: any[] = [];` line. If `ProfileResponse`'s `organizations` field type in `src/types/index.ts` is `any[]`, leave it; if narrower, widen to `Record<string, unknown>[]`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test scripts/org-profile.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the handler**

```typescript
// src/handlers/organizations.ts
import { Env, Organization, OrganizationUser } from '../types';
import { StorageService } from '../services/storage';
import { jsonResponse, errorResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { readActingDeviceIdentifier } from '../utils/device';
import { notifyUserVaultSync } from '../durable/notifications-hub';
import { auditRequestMetadata, writeAuditEvent } from '../services/audit-events';
import { parseCreateOrgRequest, organizationToResponse } from './org-shapes';

const ORG_NOT_FOUND = 'Organization not found';

async function writeOrgAudit(
  storage: StorageService,
  request: Request,
  userId: string,
  action: string,
  orgId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await writeAuditEvent(storage, {
    actorUserId: userId,
    action,
    category: 'data',
    level: action.includes('delete') ? 'security' : 'info',
    targetType: 'organization',
    targetId: orgId,
    metadata: { ...metadata, ...auditRequestMetadata(request) },
  });
}

// Loads the org ONLY if the requester is a confirmed owner; unauthorized and
// nonexistent are indistinguishable to the caller (Global Constraint).
async function getOwnedOrg(
  storage: StorageService,
  orgId: string,
  userId: string
): Promise<Organization | null> {
  const orgUser = await storage.getOrgUserByOrgAndUser(orgId, userId);
  if (!orgUser || orgUser.role !== 'owner' || orgUser.status !== 'confirmed') return null;
  return storage.getOrganization(orgId);
}

// POST /api/organizations
export async function handleCreateOrganization(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const user = await storage.getUserById(userId);
  if (!user) return errorResponse('User not found', 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const parsed = parseCreateOrgRequest(body);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const now = new Date().toISOString();
  const org: Organization = {
    id: generateUUID(),
    name: parsed.name,
    publicKey: parsed.publicKey,
    encryptedPrivateKey: parsed.encryptedPrivateKey,
    createdAt: now,
    updatedAt: now,
  };
  const owner: OrganizationUser = {
    id: generateUUID(),
    orgId: org.id,
    userId,
    email: user.email,
    role: 'owner',
    status: 'confirmed',
    encryptedOrgKey: parsed.key,
    createdAt: now,
    updatedAt: now,
  };
  await storage.createOrganizationWithOwner(org, owner);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyUserVaultSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
  await writeOrgAudit(storage, request, userId, 'organization.create', org.id, { name: 'encrypted' });

  return jsonResponse(organizationToResponse(org));
}

// GET /api/organizations/:id
export async function handleGetOrganization(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);
  return jsonResponse(organizationToResponse(org));
}

// PUT /api/organizations/:id
export async function handleUpdateOrganization(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const name = body && typeof (body as any).name === 'string' ? (body as any).name.trim() : '';
  if (!name || name.length > 1000) return errorResponse('Organization name is required', 400);

  const now = new Date().toISOString();
  await storage.updateOrganizationName(orgId, name, now);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyUserVaultSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
  await writeOrgAudit(storage, request, userId, 'organization.update', orgId);

  return jsonResponse(organizationToResponse({ ...org, name, updatedAt: now }));
}

// POST /api/organizations/:id/delete  (also wired to DELETE /api/organizations/:id)
export async function handleDeleteOrganization(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  await storage.deleteOrganization(orgId);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyUserVaultSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
  await writeOrgAudit(storage, request, userId, 'organization.delete', orgId);

  return new Response(null, { status: 200 });
}
```

NOTE: `StorageService.updateRevisionDate(userId)` is confirmed to exist (used at `src/services/storage.ts:400`). Phase 1 bumps only the acting owner's revision (sole member). Phase 2+ will bump all confirmed members.

- [ ] **Step 6: Thread organizations into the three profile call sites**

In `src/handlers/sync.ts` (line ~93) and `src/handlers/accounts.ts` (lines ~497, ~536): before each `buildProfileResponse(user, env)` call, fetch and shape memberships, then pass them:

```typescript
import { profileOrganizationResponse } from './org-shapes';
// ...
const memberships = await storage.listMembershipsForUser(userId);
const profileOrgs = memberships
  .filter((m) => m.orgUser.status !== 'invited')
  .map(profileOrganizationResponse);
// ...
buildProfileResponse(user, env, profileOrgs)
```

(In `accounts.ts` the variable holding the user id may be named differently at those sites — use whatever identifier the existing call uses for the user. `invited` memberships are excluded: clients must not render an org the user hasn't accepted. Sync-cache correctness: the sync cache key includes `revisionDate`, and every org mutation bumps the owner's revision (Step 5), so no separate cache invalidation is needed.)

- [ ] **Step 7: Typecheck + run all org tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -10 && npx tsx --test scripts/test-db.test.ts scripts/storage-org-repo.test.ts scripts/org-shapes.test.ts scripts/org-profile.test.ts`
Expected: no new type errors; all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/handlers/organizations.ts src/utils/profile-response.ts src/handlers/sync.ts src/handlers/accounts.ts scripts/org-profile.test.ts
git commit -m "feat: add organization CRUD handlers and profile.organizations"
```

---

### Task 9: Router registration + local smoke test

**Files:**
- Modify: `src/router-authenticated.ts` (imports + route block)
- Create: `scripts/dev-mint-token.mjs`
- Create: `.dev.vars` (NOT committed — verify ignored first)

**Interfaces:**
- Consumes: handler exports (Task 8).

- [ ] **Step 1: Register routes** in `src/router-authenticated.ts`, following the exact style of the folders block at line ~365. Import the four handlers at the top with the existing import-group style, then add (place near the folders block):

```typescript
  if (path === '/api/organizations' && method === 'POST') {
    return handleCreateOrganization(request, env, userId);
  }
  {
    const orgMatch = path.match(/^\/api\/organizations\/([^/]+)$/);
    if (orgMatch) {
      if (method === 'GET') return handleGetOrganization(request, env, userId, orgMatch[1]);
      if (method === 'PUT') return handleUpdateOrganization(request, env, userId, orgMatch[1]);
      if (method === 'DELETE') return handleDeleteOrganization(request, env, userId, orgMatch[1]);
    }
    const orgDeleteMatch = path.match(/^\/api\/organizations\/([^/]+)\/delete$/);
    if (orgDeleteMatch && method === 'POST') {
      return handleDeleteOrganization(request, env, userId, orgDeleteMatch[1]);
    }
  }
```

(If the router uses a different param-extraction idiom — e.g. a helper like `extractIdFromPath` — mirror that idiom instead of raw regex. Check how `/api/folders/:id` is matched at ~line 370 and copy it.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: no new errors.

- [ ] **Step 3: Set up local dev env**

```bash
git check-ignore .dev.vars || echo "STOP: add .dev.vars to .gitignore before proceeding"
cat > .dev.vars <<'EOF'
JWT_SECRET=local-dev-secret-0123456789abcdef0123456789abcdef
EOF
```

- [ ] **Step 4: Start wrangler dev and seed a user**

```bash
npx wrangler dev -c wrangler.toml --port 8788 &   # background; local D1 auto-provisioned
sleep 6
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
npx wrangler d1 execute DB -c wrangler.toml --local --command \
  "INSERT INTO users(id,email,master_password_hash,key,kdf_type,kdf_iterations,security_stamp,created_at,updated_at) VALUES('smoke-u1','smoke@local.test','x','x',0,600000,'smoke-stamp','$NOW','$NOW')"
```

(If the D1 binding name in `wrangler.toml` differs from `DB`, use the name under `[[d1_databases]]`. If `wrangler dev` bootstraps the schema lazily, hit `curl -s http://127.0.0.1:8788/` once before the insert so `ensureStorageSchema` runs.)

- [ ] **Step 5: Mint a token**

```javascript
// scripts/dev-mint-token.mjs — local smoke helper, mints a JWT the same way
// src/utils/jwt.ts createJWT does (HS256), for a directly-seeded user.
// Usage: node scripts/dev-mint-token.mjs <userId> <securityStamp> <secret>
import crypto from 'node:crypto';

const [userId, sstamp, secret] = process.argv.slice(2);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const now = Math.floor(Date.now() / 1000);
const payload = b64url(
  JSON.stringify({ sub: userId, sstamp, iat: now, exp: now + 3600, iss: 'nodewarden', premium: true, email_verified: true })
);
const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
console.log(`${header}.${payload}.${sig}`);
```

Run: `TOKEN=$(node scripts/dev-mint-token.mjs smoke-u1 smoke-stamp local-dev-secret-0123456789abcdef0123456789abcdef)`

NOTE: `iss: 'nodewarden'` and the `premium`/`email_verified` claims are confirmed from `src/utils/jwt.ts:42-53`. The auth service enforces signature, `exp`, `sub`, and `sstamp` (`src/services/auth.ts:223-233`); if `verifyJWT` additionally rejects on other claims, match the script to what it enforces.

- [ ] **Step 6: Smoke the endpoints**

```bash
BASE=http://127.0.0.1:8788
# create
ORG_JSON=$(curl -s -X POST "$BASE/api/organizations" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"2.smokeName|x","key":"4.smokeWrappedKey","keys":{"publicKey":"pub","encryptedPrivateKey":"2.priv"}}')
echo "$ORG_JSON" | grep -o '"object":"organization"'      # expect match
ORG_ID=$(echo "$ORG_JSON" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
# get
curl -s "$BASE/api/organizations/$ORG_ID" -H "Authorization: Bearer $TOKEN" | grep -o '"id":"'"$ORG_ID"'"'   # expect match
# profile shows the org
curl -s "$BASE/api/sync" -H "Authorization: Bearer $TOKEN" | grep -o '"profileOrganization"'                  # expect match
# rename
curl -s -X PUT "$BASE/api/organizations/$ORG_ID" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"2.renamed|y"}' | grep -o '"name":"2.renamed|y"'                                                # expect match
# unauthorized == nonexistent (no token for another user yet; use a bogus id)
curl -s -o /dev/null -w '%{http_code}' "$BASE/api/organizations/does-not-exist" -H "Authorization: Bearer $TOKEN"  # expect 404
# delete, then confirm gone from profile
curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/organizations/$ORG_ID/delete" -H "Authorization: Bearer $TOKEN"  # expect 200
curl -s "$BASE/api/sync" -H "Authorization: Bearer $TOKEN" | grep -c '"profileOrganization"'                   # expect 0
```

Expected: every `# expect` annotation satisfied. Kill the background wrangler process when done.

- [ ] **Step 7: Commit**

```bash
git add src/router-authenticated.ts scripts/dev-mint-token.mjs
git commit -m "feat: register organization routes; add local smoke helper"
```

---

### Task 10: Phase gate

- [ ] **Step 1: Full org test suite green**

Run: `npx tsx --test scripts/test-db.test.ts scripts/storage-org-repo.test.ts scripts/org-shapes.test.ts scripts/org-backup.test.ts scripts/org-profile.test.ts`
Expected: all PASS.

- [ ] **Step 2: Upstream test suite still green**

Run: `npm run test:config-compatibility && npm run test:web-crypto && npm run test:webauthn-connectors`
Expected: PASS (same results as on a clean `main` checkout — verify by running them on `main` first if any fail).

- [ ] **Step 3: Diff audit against the Global Constraints allowlist**

Run: `git diff --name-only main...HEAD`
Expected: every path is in the allowed list from Global Constraints. Any stray file = investigate before proceeding.

- [ ] **Step 4: Push branch and report**

```bash
git push -u origin feat/organizations
```

Report to the user: Phase 1 complete, what was verified, and that Phase 2 (invite → accept → confirm + email) planning is next. Do NOT deploy to any Cloudflare environment in this phase — first deploy happens in Phase 2's test-instance task per the spec's rollout order.
