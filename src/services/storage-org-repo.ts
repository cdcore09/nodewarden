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
