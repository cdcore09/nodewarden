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
  const orgInsertStmt = db
    .prepare(`INSERT INTO organizations(${ORG_COLUMNS}) VALUES(?,?,?,?,?,?)`)
    .bind(org.id, org.name, org.publicKey, org.encryptedPrivateKey, org.createdAt, org.updatedAt);

  const ownerInsertStmt = db
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
    );

  await db.batch([orgInsertStmt, ownerInsertStmt]);
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

// Used to block deleting a user who still owns organizations: their
// organization_users row cascades away on user delete (ON DELETE CASCADE),
// which would orphan the organizations row (unreachable by any API, and
// the orphan trips the backup freshness gate for future restores).
export async function countOwnedOrganizations(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM organization_users WHERE user_id = ? AND role = 'owner'`)
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function createOrgUserInvite(db: D1Database, orgUser: OrganizationUser): Promise<void> {
  await db
    .prepare(`INSERT INTO organization_users(${ORG_USER_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(
      orgUser.id,
      orgUser.orgId,
      orgUser.userId,
      orgUser.email,
      orgUser.role,
      orgUser.status,
      orgUser.encryptedOrgKey,
      orgUser.createdAt,
      orgUser.updatedAt
    )
    .run();
}

export async function getOrgUserById(db: D1Database, orgUserId: string): Promise<OrganizationUser | null> {
  const row = await db
    .prepare(`SELECT ${ORG_USER_COLUMNS} FROM organization_users WHERE id = ?`)
    .bind(orgUserId)
    .first<any>();
  if (!row) return null;
  return mapOrgUserRow(row);
}

export async function getOrgUserByOrgAndEmail(db: D1Database, orgId: string, email: string): Promise<OrganizationUser | null> {
  const row = await db
    .prepare(`SELECT ${ORG_USER_COLUMNS} FROM organization_users WHERE org_id = ? AND email = ?`)
    .bind(orgId, email)
    .first<any>();
  if (!row) return null;
  return mapOrgUserRow(row);
}

export async function listOrgUsers(db: D1Database, orgId: string): Promise<OrganizationUser[]> {
  const res = await db
    .prepare(`SELECT ${ORG_USER_COLUMNS} FROM organization_users WHERE org_id = ? ORDER BY created_at ASC`)
    .bind(orgId)
    .all<any>();
  return (res.results || []).map(mapOrgUserRow);
}

// org_id is part of the WHERE clause (not just an id lookup) as defense-in-depth
// against cross-tenant mutation: even if a caller supplies an orgUserId that
// belongs to a different org than the one it's authorized against, the UPDATE
// simply matches zero rows instead of mutating someone else's membership.
export async function acceptOrgUser(db: D1Database, orgUserId: string, orgId: string, userId: string, updatedAt: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE organization_users SET user_id = ?, status = 'accepted', updated_at = ? WHERE id = ? AND org_id = ? AND status = 'invited'")
    .bind(userId, updatedAt, orgUserId, orgId)
    .run();
  return ((res as any).meta?.changes ?? 0) > 0;
}

export async function confirmOrgUser(db: D1Database, orgUserId: string, orgId: string, encryptedOrgKey: string, updatedAt: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE organization_users SET encrypted_org_key = ?, status = 'confirmed', updated_at = ? WHERE id = ? AND org_id = ? AND status = 'accepted'")
    .bind(encryptedOrgKey, updatedAt, orgUserId, orgId)
    .run();
  return ((res as any).meta?.changes ?? 0) > 0;
}

export async function deleteOrgUser(db: D1Database, orgUserId: string): Promise<void> {
  await db.prepare('DELETE FROM organization_users WHERE id = ?').bind(orgUserId).run();
}

export async function listConfirmedMemberUserIds(db: D1Database, orgId: string): Promise<string[]> {
  const res = await db
    .prepare(`SELECT user_id FROM organization_users WHERE org_id = ? AND status = 'confirmed' AND user_id IS NOT NULL`)
    .bind(orgId)
    .all<any>();
  return (res.results || []).map((row) => row.user_id);
}
