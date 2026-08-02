import type { Collection, CollectionGrant, CollectionWithGrant } from '../types';

function mapCollectionRow(row: any): Collection {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGrantRow(row: any): CollectionGrant {
  return {
    collectionId: row.collection_id,
    orgUserId: row.org_user_id,
    readOnly: !!row.read_only,
    hidePasswords: !!row.hide_passwords,
  };
}

const COLLECTION_COLUMNS = 'id, org_id, name, created_at, updated_at';
const GRANT_COLUMNS = 'collection_id, org_user_id, read_only, hide_passwords';

export async function createCollection(db: D1Database, c: Collection): Promise<void> {
  await db
    .prepare(`INSERT INTO collections(${COLLECTION_COLUMNS}) VALUES(?,?,?,?,?)`)
    .bind(c.id, c.orgId, c.name, c.createdAt, c.updatedAt)
    .run();
}

export async function getCollection(db: D1Database, collectionId: string): Promise<Collection | null> {
  const row = await db
    .prepare(`SELECT ${COLLECTION_COLUMNS} FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<any>();
  if (!row) return null;
  return mapCollectionRow(row);
}

export async function listCollections(db: D1Database, orgId: string): Promise<Collection[]> {
  const res = await db
    .prepare(`SELECT ${COLLECTION_COLUMNS} FROM collections WHERE org_id = ? ORDER BY created_at ASC`)
    .bind(orgId)
    .all<any>();
  return (res.results || []).map(mapCollectionRow);
}

export async function updateCollectionName(
  db: D1Database,
  collectionId: string,
  name: string,
  updatedAt: string
): Promise<void> {
  await db
    .prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, updatedAt, collectionId)
    .run();
}

export async function deleteCollection(db: D1Database, collectionId: string): Promise<void> {
  await db.prepare('DELETE FROM collections WHERE id = ?').bind(collectionId).run();
}

export async function setGrant(db: D1Database, g: CollectionGrant): Promise<void> {
  await db
    .prepare(
      `INSERT INTO collection_users(${GRANT_COLUMNS}) VALUES(?,?,?,?) ` +
      'ON CONFLICT(collection_id, org_user_id) DO UPDATE SET read_only = excluded.read_only, hide_passwords = excluded.hide_passwords'
    )
    .bind(g.collectionId, g.orgUserId, g.readOnly ? 1 : 0, g.hidePasswords ? 1 : 0)
    .run();
}

export async function deleteGrant(db: D1Database, collectionId: string, orgUserId: string): Promise<void> {
  await db
    .prepare('DELETE FROM collection_users WHERE collection_id = ? AND org_user_id = ?')
    .bind(collectionId, orgUserId)
    .run();
}

export async function listGrantsForCollection(db: D1Database, collectionId: string): Promise<CollectionGrant[]> {
  const res = await db
    .prepare(`SELECT ${GRANT_COLUMNS} FROM collection_users WHERE collection_id = ?`)
    .bind(collectionId)
    .all<any>();
  return (res.results || []).map(mapGrantRow);
}

export async function listCollectionsForMember(db: D1Database, orgUserId: string): Promise<CollectionWithGrant[]> {
  const res = await db
    .prepare(
      `SELECT c.id AS c_id, c.org_id AS c_org_id, c.name AS c_name, c.created_at AS c_created_at, c.updated_at AS c_updated_at, ` +
      `cu.read_only AS cu_read_only, cu.hide_passwords AS cu_hide_passwords ` +
      `FROM collection_users cu JOIN collections c ON c.id = cu.collection_id WHERE cu.org_user_id = ? ORDER BY c.created_at ASC`
    )
    .bind(orgUserId)
    .all<any>();
  return (res.results || []).map((row) => ({
    collection: mapCollectionRow({
      id: row.c_id,
      org_id: row.c_org_id,
      name: row.c_name,
      created_at: row.c_created_at,
      updated_at: row.c_updated_at,
    }),
    readOnly: !!row.cu_read_only,
    hidePasswords: !!row.cu_hide_passwords,
  }));
}

export async function addCipherToCollections(db: D1Database, cipherId: string, collectionIds: string[]): Promise<void> {
  if (collectionIds.length === 0) return;
  const stmts = collectionIds.map((collectionId) =>
    db
      .prepare('INSERT OR IGNORE INTO cipher_collections(cipher_id, collection_id) VALUES(?,?)')
      .bind(cipherId, collectionId)
  );
  await db.batch(stmts);
}

export async function getCipherCollectionIds(db: D1Database, cipherId: string): Promise<string[]> {
  const res = await db
    .prepare('SELECT collection_id FROM cipher_collections WHERE cipher_id = ?')
    .bind(cipherId)
    .all<any>();
  return (res.results || []).map((row) => row.collection_id);
}

// A cipher may be reachable via multiple collections the member is granted
// access to. Access is least-restrictive: readOnly is true only if ALL
// matching grants are read-only (MIN(read_only) = 0 as soon as any grant is
// writable, so writable wins), and hidePasswords follows the same rule.
export async function isCipherInGrantedCollection(
  db: D1Database,
  cipherId: string,
  orgUserId: string
): Promise<{ granted: boolean; readOnly: boolean; hidePasswords: boolean }> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS cnt, MIN(cu.read_only) AS min_read_only, MIN(cu.hide_passwords) AS min_hide_passwords ' +
      'FROM cipher_collections cc JOIN collection_users cu ON cu.collection_id = cc.collection_id ' +
      'WHERE cc.cipher_id = ? AND cu.org_user_id = ?'
    )
    .bind(cipherId, orgUserId)
    .first<any>();
  const granted = (row?.cnt ?? 0) > 0;
  if (!granted) return { granted: false, readOnly: false, hidePasswords: false };
  return {
    granted: true,
    readOnly: !!row.min_read_only,
    hidePasswords: !!row.min_hide_passwords,
  };
}
