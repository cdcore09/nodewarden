import type { Cipher } from '../types';

function normalizeOptionalId(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

type SafeBind = (stmt: D1PreparedStatement, ...values: any[]) => D1PreparedStatement;
type SqlChunkSize = (fixedBindCount: number) => number;
type UpdateRevisionDate = (userId: string) => Promise<string>;

interface CipherRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  type: number | null;
  folder_id: string | null;
  name: string | null;
  notes: string | null;
  favorite: number | null;
  data: string;
  reprompt: number | null;
  key: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

const CIPHER_SCALAR_DATA_KEYS = new Set([
  'id',
  'userId',
  'user_id',
  'organizationId',
  'organization_id',
  'type',
  'folderId',
  'folder_id',
  'name',
  'notes',
  'favorite',
  'reprompt',
  'key',
  'attachments',
  'Attachments',
  'attachments2',
  'Attachments2',
  'createdAt',
  'created_at',
  'creationDate',
  'updatedAt',
  'updated_at',
  'revisionDate',
  'archivedAt',
  'archived_at',
  'archivedDate',
  'deletedAt',
  'deleted_at',
  'deletedDate',
  'collectionIds',
  'CollectionIds',
]);

function buildCipherData(cipher: Cipher, folderId: string | null): string {
  const payload: Record<string, unknown> = {
    ...cipher,
    folderId,
  };
  for (const key of CIPHER_SCALAR_DATA_KEYS) {
    delete payload[key];
  }
  return JSON.stringify(payload);
}

function parseCipherRow(row: CipherRow | null | undefined): Cipher | null {
  if (!row?.data) return null;
  try {
    const parsed = JSON.parse(row.data) as Cipher;
    const folderId = normalizeOptionalId(row.folder_id ?? parsed.folderId ?? null);
    return {
      ...parsed,
      id: row.id,
      userId: row.user_id,
      organizationId: row.organization_id ?? null,
      type: Number(row.type) || Number(parsed.type) || 1,
      folderId,
      name: row.name ?? parsed.name ?? null,
      notes: row.notes ?? parsed.notes ?? null,
      favorite: row.favorite != null ? !!row.favorite : !!parsed.favorite,
      reprompt: row.reprompt ?? parsed.reprompt ?? 0,
      key: row.key ?? parsed.key ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? parsed.archivedAt ?? parsed.archivedDate ?? null,
      deletedAt: row.deleted_at ?? parsed.deletedAt ?? parsed.deletedDate ?? null,
    };
  } catch {
    console.error('Corrupted cipher data, id:', row.id);
    return null;
  }
}

function selectCipherColumns(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return [
    'id', 'user_id', 'organization_id', 'type', 'folder_id', 'name', 'notes',
    'favorite', 'data', 'reprompt', 'key', 'created_at', 'updated_at', 'archived_at', 'deleted_at',
  ].map((col) => `${prefix}${col}`).join(', ');
}

export async function getCipher(db: D1Database, id: string): Promise<Cipher | null> {
  const row = await db
    .prepare(`SELECT ${selectCipherColumns()} FROM ciphers WHERE id = ?`)
    .bind(id)
    .first<CipherRow>();
  return parseCipherRow(row);
}

export async function getCipherForUser(db: D1Database, id: string, userId: string): Promise<Cipher | null> {
  const row = await db
    .prepare(`SELECT ${selectCipherColumns()} FROM ciphers WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<CipherRow>();
  return parseCipherRow(row);
}

export async function saveCipher(db: D1Database, safeBind: SafeBind, cipher: Cipher): Promise<void> {
  const folderId = normalizeOptionalId(cipher.folderId);
  const data = buildCipherData(cipher, folderId);
  const stmt = db.prepare(
    'INSERT INTO ciphers(id, user_id, organization_id, type, folder_id, name, notes, favorite, data, reprompt, key, created_at, updated_at, archived_at, deleted_at) ' +
    'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET ' +
    'organization_id=excluded.organization_id, type=excluded.type, folder_id=excluded.folder_id, name=excluded.name, notes=excluded.notes, favorite=excluded.favorite, data=excluded.data, reprompt=excluded.reprompt, key=excluded.key, updated_at=excluded.updated_at, archived_at=excluded.archived_at, deleted_at=excluded.deleted_at ' +
    'WHERE user_id=excluded.user_id'
  );
  await safeBind(
    stmt,
    cipher.id,
    cipher.userId,
    cipher.organizationId ?? null,
    Number(cipher.type) || 1,
    folderId,
    cipher.name,
    cipher.notes,
    cipher.favorite ? 1 : 0,
    data,
    cipher.reprompt ?? 0,
    cipher.key,
    cipher.createdAt,
    cipher.updatedAt,
    cipher.archivedAt ?? null,
    cipher.deletedAt
  ).run();
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
}

export async function deleteCipher(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM ciphers WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

// ciphers.organization_id has NO foreign key to organizations (by design —
// see the ownership-invariant note at getAllCiphers/getOrgCiphersForOwner
// above: ciphers.user_id must always resolve, so the FK stays on user_id
// only). That means deleting an organizations row does NOT cascade to its
// ciphers — callers (handleDeleteOrganization) MUST call this explicitly
// before/around the org delete, or the org's ciphers are orphaned:
// organization_id pointing at a gone org, invisible to every access path
// (no membership can ever be confirmed for a deleted org) but still
// occupying storage. attachments.cipher_id and cipher_collections.cipher_id
// DO have ON DELETE CASCADE FKs to ciphers(id) (migrations/0001_init.sql,
// migrations/0002_organizations.sql), so deleting these cipher rows also
// removes their attachment + cipher_collections rows automatically.
export async function deleteOrgCiphers(db: D1Database, orgId: string): Promise<void> {
  await db.prepare('DELETE FROM ciphers WHERE organization_id = ?').bind(orgId).run();
}

// Cipher ids for every cipher in an org, regardless of caller identity —
// used by org-delete cleanup to enumerate attachment blob keys (R2/KV)
// before the DB rows are purged. Unlike getOrgCiphersForOwner this returns
// bare ids only (cheaper) and carries no access-control semantics; it must
// only be called from trusted cleanup paths, not exposed to a request actor.
export async function getOrgCipherIds(db: D1Database, orgId: string): Promise<string[]> {
  const res = await db.prepare('SELECT id FROM ciphers WHERE organization_id = ?').bind(orgId).all<{ id: string }>();
  return (res.results || []).map((row) => row.id);
}

export async function bulkSoftDeleteCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  updateRevisionDate: UpdateRevisionDate,
  ids: string[],
  userId: string
): Promise<string | null> {
  if (ids.length === 0) return null;
  const uniqueIds = sanitizeIds(ids);
  if (!uniqueIds.length) return null;

  const now = new Date().toISOString();
  const chunkSize = sqlChunkSize(3);

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE ciphers
         SET deleted_at = ?, updated_at = ?,
             data = json_remove(data, '$.deletedAt', '$.deletedDate', '$.updatedAt', '$.revisionDate')
         WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(now, now, userId, ...chunk)
      .run();
  }

  return updateRevisionDate(userId);
}

export async function bulkRestoreCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  updateRevisionDate: UpdateRevisionDate,
  ids: string[],
  userId: string
): Promise<string | null> {
  if (ids.length === 0) return null;
  const uniqueIds = sanitizeIds(ids);
  if (!uniqueIds.length) return null;

  const now = new Date().toISOString();
  const chunkSize = sqlChunkSize(2);

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE ciphers
         SET deleted_at = NULL, updated_at = ?,
             data = json_remove(data, '$.deletedAt', '$.deletedDate', '$.updatedAt', '$.revisionDate')
         WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(now, userId, ...chunk)
      .run();
  }

  return updateRevisionDate(userId);
}

export async function bulkDeleteCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  updateRevisionDate: UpdateRevisionDate,
  ids: string[],
  userId: string
): Promise<string | null> {
  if (ids.length === 0) return null;
  const uniqueIds = sanitizeIds(ids);
  if (!uniqueIds.length) return null;

  const chunkSize = sqlChunkSize(1);
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db.prepare(`DELETE FROM ciphers WHERE user_id = ? AND id IN (${placeholders})`).bind(userId, ...chunk).run();
  }

  return updateRevisionDate(userId);
}

// Personal-vault filter: only ciphers the user owns directly, never ciphers
// that belong to an organization. Org ciphers are fetched separately via
// getOrgCiphersForOwner / getOrgCiphersForMember (see getAccessibleOrgCiphers
// in storage.ts), which apply org-membership and collection-grant access
// control instead of the simple user_id ownership check used here.
export async function getAllCiphers(db: D1Database, userId: string): Promise<Cipher[]> {
  const res = await db
    .prepare(`SELECT ${selectCipherColumns()} FROM ciphers WHERE user_id = ? AND organization_id IS NULL ORDER BY updated_at DESC`)
    .bind(userId)
    .all<CipherRow>();
  return (res.results || []).flatMap((row) => {
    const cipher = parseCipherRow(row);
    return cipher ? [cipher] : [];
  });
}

// Used to block deleting a user who has created org ciphers: ciphers.user_id
// is ON DELETE CASCADE, so deleting the user would silently destroy any
// shared org ciphers (and their blobs) they created, for every remaining
// org member — not just ciphers they own personally.
export async function countOrgCiphersByCreator(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM ciphers WHERE user_id = ? AND organization_id IS NOT NULL')
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// Every cipher belonging to an org, for an org OWNER — owners implicitly see
// everything regardless of collection grants.
export async function getOrgCiphersForOwner(db: D1Database, orgId: string): Promise<Cipher[]> {
  const res = await db
    .prepare(`SELECT ${selectCipherColumns()} FROM ciphers WHERE organization_id = ? ORDER BY updated_at DESC`)
    .bind(orgId)
    .all<CipherRow>();
  return (res.results || []).flatMap((row) => {
    const cipher = parseCipherRow(row);
    return cipher ? [cipher] : [];
  });
}

// Ciphers a non-owner member may read: only those living in a collection the
// member's org_user_id has been explicitly granted. SECURITY-RELEVANT: this
// join is what enforces collection-scoped access for members — it must go
// through collection_users on the caller-supplied org_user_id, and callers
// must only pass a CONFIRMED membership's org_user_id (an invited/accepted
// row must never reach this query with intent to grant access).
//
// The explicit `c.organization_id = ?` guard is the root-cause fix for a
// cross-org leak: a cipher shared from Org A into Org B (see Task 6's
// handleShareCipher) moves its `organization_id` column but
// storage.addCipherToCollections only INSERTs the new Org-B collection rows
// -- it never deletes the old Org-A `cipher_collections` row. Without this
// guard, that stale row alone would make the cipher keep matching every Org-A
// member's grant here forever, even though the cipher no longer belongs to
// Org A. Requiring the cipher's own organization_id to match the caller's org
// closes the leak at the query, regardless of how a stale/inconsistent
// cipher_collections row came to exist.
export async function getOrgCiphersForMember(db: D1Database, orgUserId: string, orgId: string): Promise<Cipher[]> {
  const res = await db
    .prepare(
      `SELECT DISTINCT ${selectCipherColumns('c')}
       FROM ciphers c
       JOIN cipher_collections cc ON cc.cipher_id = c.id
       JOIN collection_users cu ON cu.collection_id = cc.collection_id
       WHERE cu.org_user_id = ? AND c.organization_id = ?
       ORDER BY c.updated_at DESC`
    )
    .bind(orgUserId, orgId)
    .all<CipherRow>();
  return (res.results || []).flatMap((row) => {
    const cipher = parseCipherRow(row);
    return cipher ? [cipher] : [];
  });
}

// One query, grouping cipher_collections by cipher_id, so callers can attach
// `collectionIds` onto each org cipher before it reaches cipherToResponse()
// (which reads collectionIds off the cipher object).
export async function getCollectionIdsForCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  cipherIds: string[]
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const uniqueIds = sanitizeIds(cipherIds);
  if (!uniqueIds.length) return grouped;

  const chunkSize = sqlChunkSize(0);
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const res = await db
      .prepare(`SELECT cipher_id, collection_id FROM cipher_collections WHERE cipher_id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ cipher_id: string; collection_id: string }>();
    for (const row of res.results || []) {
      const list = grouped.get(row.cipher_id) || [];
      list.push(row.collection_id);
      grouped.set(row.cipher_id, list);
    }
  }
  return grouped;
}

export async function getCiphersPage(
  db: D1Database,
  userId: string,
  includeDeleted: boolean,
  limit: number,
  offset: number
): Promise<Cipher[]> {
  const whereDeleted = includeDeleted
    ? ''
    : "AND deleted_at IS NULL AND json_extract(data, '$.deletedAt') IS NULL AND json_extract(data, '$.deletedDate') IS NULL";
  const res = await db
    .prepare(
      `SELECT ${selectCipherColumns()} FROM ciphers
       WHERE user_id = ? AND organization_id IS NULL
       ${whereDeleted}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all<CipherRow>();
  return (res.results || []).flatMap((row) => {
    const cipher = parseCipherRow(row);
    return cipher ? [cipher] : [];
  });
}

export async function getCiphersByIds(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  ids: string[],
  userId: string
): Promise<Cipher[]> {
  if (ids.length === 0) return [];
  const uniqueIds = sanitizeIds(ids);
  if (!uniqueIds.length) return [];

  const chunkSize = sqlChunkSize(1);
  const out: Cipher[] = [];
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT ${selectCipherColumns()} FROM ciphers WHERE user_id = ? AND id IN (${placeholders})`);
    const res = await stmt.bind(userId, ...chunk).all<CipherRow>();
    out.push(
      ...(res.results || []).flatMap((row) => {
        const cipher = parseCipherRow(row);
        return cipher ? [cipher] : [];
      })
    );
  }
  return out;
}

export async function bulkMoveCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  updateRevisionDate: UpdateRevisionDate,
  ids: string[],
  folderId: string | null,
  userId: string
): Promise<string | null> {
  if (ids.length === 0) return null;
  const now = new Date().toISOString();
  const normalizedFolderId = normalizeOptionalId(folderId);
  const uniqueIds = sanitizeIds(ids);
  const chunkSize = sqlChunkSize(3);

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE ciphers
         SET folder_id = ?, updated_at = ?,
             data = json_remove(data, '$.folderId', '$.folder_id', '$.updatedAt', '$.revisionDate')
         WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(normalizedFolderId, now, userId, ...chunk)
      .run();
  }

  return updateRevisionDate(userId);
}

export async function bulkArchiveCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  updateRevisionDate: UpdateRevisionDate,
  ids: string[],
  userId: string
): Promise<string | null> {
  if (ids.length === 0) return null;
  const uniqueIds = sanitizeIds(ids);
  if (!uniqueIds.length) return null;

  const now = new Date().toISOString();
  const chunkSize = sqlChunkSize(3);

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE ciphers
         SET archived_at = ?, updated_at = ?,
             data = json_remove(data, '$.archivedAt', '$.archivedDate', '$.updatedAt', '$.revisionDate')
         WHERE user_id = ? AND id IN (${placeholders})
           AND deleted_at IS NULL
           AND json_extract(data, '$.deletedAt') IS NULL
           AND json_extract(data, '$.deletedDate') IS NULL`
      )
      .bind(now, now, userId, ...chunk)
      .run();
  }

  return updateRevisionDate(userId);
}

export async function bulkUnarchiveCiphers(
  db: D1Database,
  sqlChunkSize: SqlChunkSize,
  updateRevisionDate: UpdateRevisionDate,
  ids: string[],
  userId: string
): Promise<string | null> {
  if (ids.length === 0) return null;
  const uniqueIds = sanitizeIds(ids);
  if (!uniqueIds.length) return null;

  const now = new Date().toISOString();
  const chunkSize = sqlChunkSize(2);

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE ciphers
         SET archived_at = NULL, updated_at = ?,
             data = json_remove(data, '$.archivedAt', '$.archivedDate', '$.updatedAt', '$.revisionDate')
         WHERE user_id = ? AND id IN (${placeholders})`
      )
      .bind(now, userId, ...chunk)
      .run();
  }

  return updateRevisionDate(userId);
}
