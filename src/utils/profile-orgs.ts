import type { StorageService } from '../services/storage';
import { profileOrganizationResponse } from '../handlers/org-shapes';

// Single source for the profile.organizations payload. Invited memberships
// are excluded: clients must not render an org the user has not accepted.
export async function loadProfileOrgs(
  storage: StorageService,
  userId: string
): Promise<Record<string, unknown>[]> {
  const memberships = await storage.listMembershipsForUser(userId);
  return memberships
    .filter((m) => m.orgUser.status !== 'invited')
    .map(profileOrganizationResponse);
}
