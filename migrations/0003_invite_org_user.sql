-- migrations/0003_invite_org_user.sql
-- Links registration-code invites (invites table) to the org membership
-- (organization_users) they were minted for, so resend and removal can find
-- and revoke the code tied to a specific pending invitee.
-- Keep in sync with src/services/storage-schema.ts (SCHEMA_STATEMENTS).
-- NOT idempotent: fails if the runtime bootstrap (storage-schema.ts) already
-- added this column. Apply migrations before first boot, or rely on the
-- runtime bootstrap alone.
ALTER TABLE invites ADD COLUMN org_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_invites_org_user ON invites(org_user_id);
