import type { ListResponse } from '@/lib/types';
import { parseErrorMessage, parseJson, type AuthedFetch } from './shared';

// Profile organization entry shape, as returned in profile.organizations[]
// (see the server's profileOrganizationResponse). The app already holds this
// via the existing profile/sync state, so this module exports the type only
// -- no fetch is added for the orgs list itself.
export interface ProfileOrganization {
  id: string;
  name: string;
  key: string;
  status: number;
  type: number;
}

export interface CreateOrganizationInput {
  name: string;
  key: string;
  publicKey: string;
  encryptedPrivateKey: string;
}

export interface OrganizationCollectionSummary {
  id: string;
  name: string;
}

/** Read `profile.organizations[]` (the orgs this user belongs to, with their wrapped org key). */
export function getProfileOrganizations(
  profile: { organizations?: unknown; [key: string]: unknown } | null | undefined
): ProfileOrganization[] {
  const raw = profile?.organizations;
  return Array.isArray(raw) ? (raw as ProfileOrganization[]) : [];
}

export async function createOrganization(
  authedFetch: AuthedFetch,
  input: CreateOrganizationInput
): Promise<{ id: string }> {
  const resp = await authedFetch('/api/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      key: input.key,
      keys: {
        publicKey: input.publicKey,
        encryptedPrivateKey: input.encryptedPrivateKey,
      },
    }),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Create organization failed'));
  const body = await parseJson<{ id?: string }>(resp);
  if (!body?.id) throw new Error('Create organization failed');
  return { id: body.id };
}

export async function listOrgCollections(
  authedFetch: AuthedFetch,
  orgId: string
): Promise<OrganizationCollectionSummary[]> {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('Organization id is required');
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(id)}/collections`);
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Load organization collections failed'));
  const body = await parseJson<ListResponse<{ id?: string; name?: string }>>(resp);
  const data = Array.isArray(body?.data) ? body!.data : [];
  return data
    .filter((item): item is { id: string; name?: string } => typeof item?.id === 'string' && !!item.id)
    .map((item) => ({ id: item.id, name: String(item.name || '') }));
}
