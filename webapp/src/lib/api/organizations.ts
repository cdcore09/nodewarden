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

// Owner/member role, mirroring the server's organization_users.role (0 = owner).
export const ORGANIZATION_TYPE_OWNER = 0;

export interface OrgMember {
  id: string; // orgUserId
  userId: string | null;
  email: string;
  name: string | null;
  type: number; // 0 owner, 2 user
  status: number; // 0 invited, 1 accepted, 2 confirmed
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

export async function listOrgUsers(authedFetch: AuthedFetch, orgId: string): Promise<OrgMember[]> {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('Organization id is required');
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(id)}/users`);
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to load members'));
  const body = await parseJson<ListResponse<{ id?: string; userId?: string; email?: string; name?: string; type?: number; status?: number }>>(resp);
  const rows = Array.isArray(body?.data) ? body!.data : [];
  return rows.map((r) => ({
    id: String(r.id ?? ''),
    userId: r.userId != null ? String(r.userId) : null,
    email: String(r.email || ''),
    name: r.name != null ? String(r.name) : null,
    type: Number(r.type) || 0,
    status: Number(r.status) || 0,
  }));
}

export async function inviteOrgUsers(authedFetch: AuthedFetch, orgId: string, emails: string[]): Promise<void> {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('Organization id is required');
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(id)}/users/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to invite members'));
}

export async function resendOrgInvite(authedFetch: AuthedFetch, orgId: string, orgUserId: string): Promise<void> {
  const id = String(orgId || '').trim();
  const userId = String(orgUserId || '').trim();
  if (!id || !userId) throw new Error('Organization id and member id are required');
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(id)}/users/${encodeURIComponent(userId)}/reinvite`, {
    method: 'POST',
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to resend invite'));
}

export async function confirmOrgUser(
  authedFetch: AuthedFetch,
  orgId: string,
  orgUserId: string,
  wrappedKey: string
): Promise<void> {
  const id = String(orgId || '').trim();
  const userId = String(orgUserId || '').trim();
  if (!id || !userId) throw new Error('Organization id and member id are required');
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(id)}/users/${encodeURIComponent(userId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: wrappedKey }),
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to confirm member'));
}

export async function removeOrgUser(authedFetch: AuthedFetch, orgId: string, orgUserId: string): Promise<void> {
  const id = String(orgId || '').trim();
  const userId = String(orgUserId || '').trim();
  if (!id || !userId) throw new Error('Organization id and member id are required');
  const resp = await authedFetch(`/api/organizations/${encodeURIComponent(id)}/users/${encodeURIComponent(userId)}/remove`, {
    method: 'POST',
  });
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to remove member'));
}

export async function getUserPublicKey(authedFetch: AuthedFetch, userId: string): Promise<string> {
  const id = String(userId || '').trim();
  if (!id) throw new Error('User id is required');
  const resp = await authedFetch(`/api/users/${encodeURIComponent(id)}/public-key`);
  if (!resp.ok) throw new Error(await parseErrorMessage(resp, 'Failed to load member key'));
  const body = await parseJson<{ publicKey?: string }>(resp);
  const publicKey = body?.publicKey;
  if (!publicKey) throw new Error('Member has no public key');
  return publicKey;
}
