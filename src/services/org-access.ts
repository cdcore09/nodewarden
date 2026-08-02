// Access-control chokepoint for organization ciphers/attachments.
//
// Every cipher read/write in the vault must be gated through canReadCipher /
// canWriteCipher before the data is returned or mutated. Semantics are
// deny-by-default: any ambiguity (no membership row, non-confirmed status,
// no matching collection grant) resolves to false.
//
// These two signatures are FROZEN — Phase 3b imports them verbatim and
// threads them through the live cipher/attachment handlers.
import type { Cipher, OrganizationUser } from '../types';
import type { StorageService } from './storage';

// Loads the caller's membership in the cipher's organization, already
// filtered down to "usable" memberships: only a confirmed status counts.
// Invited/accepted members (and non-members) get nothing — callers just
// check for null.
async function loadConfirmedMembership(
  storage: StorageService,
  orgId: string,
  userId: string
): Promise<OrganizationUser | null> {
  const orgUser = await storage.getOrgUserByOrgAndUser(orgId, userId);
  if (!orgUser || orgUser.status !== 'confirmed') return null;
  return orgUser;
}

export async function canReadCipher(storage: StorageService, userId: string, cipher: Cipher): Promise<boolean> {
  if (!cipher.organizationId) return cipher.userId === userId;

  const orgUser = await loadConfirmedMembership(storage, cipher.organizationId, userId);
  if (!orgUser) return false;

  // Owners have full access to all org ciphers (sole-admin model, matches
  // allowAdminAccessToAllCollectionItems) — no collection check needed.
  if (orgUser.role === 'owner') return true;

  const access = await storage.isCipherInGrantedCollection(cipher.id, orgUser.id);
  return access.granted;
}

export async function canWriteCipher(storage: StorageService, userId: string, cipher: Cipher): Promise<boolean> {
  if (!cipher.organizationId) return cipher.userId === userId;

  const orgUser = await loadConfirmedMembership(storage, cipher.organizationId, userId);
  if (!orgUser) return false;

  if (orgUser.role === 'owner') return true;

  const access = await storage.isCipherInGrantedCollection(cipher.id, orgUser.id);
  return access.granted && !access.readOnly;
}
