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
