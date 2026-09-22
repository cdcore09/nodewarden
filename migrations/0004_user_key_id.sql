-- migrations/0004_user_key_id.sql
-- Backing store for official clients' user-key-id backfill (bitwarden/clients
-- cli-v2026.9.0, PM-40814): records the key id of a user's current UserKey so
-- it can be reported back via POST /accounts/key-management/user-key-id and
-- GET /api/sync's UserDecryption.UserKeyId.
-- Keep in sync with src/services/storage-schema.ts (SCHEMA_STATEMENTS).
-- NOT idempotent: fails if the runtime bootstrap (storage-schema.ts) already
-- added this column. Apply migrations before first boot, or rely on the
-- runtime bootstrap alone.
ALTER TABLE users ADD COLUMN user_key_id TEXT;
