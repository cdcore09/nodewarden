// Pure request-parsing and response-shaping for organizations.
// ALL Bitwarden org enum mapping lives here (Global Constraint).
// Field set follows Vaultwarden's responses; validated against official
// clients in Phase 3/4 — adjust HERE if a client rejects a shape.
import type { Organization, OrgMembership, OrgRole, OrgUserStatus, OrganizationUser, Collection } from '../types';

export const ORG_TYPE: Record<OrgRole, number> = { owner: 0, user: 2 };
export const ORG_STATUS: Record<OrgUserStatus, number> = { invited: 0, accepted: 1, confirmed: 2 };

const MAX_ENCRYPTED_NAME_LENGTH = 1000;

export function parseCreateOrgRequest(
  body: unknown
): { name: string; key: string; publicKey: string | null; encryptedPrivateKey: string | null } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const key = typeof b.key === 'string' ? b.key.trim() : '';
  if (!name || name.length > MAX_ENCRYPTED_NAME_LENGTH) return { error: 'Organization name is required' };
  if (!key) return { error: 'Organization key is required' };
  const keys = b.keys && typeof b.keys === 'object' ? (b.keys as Record<string, unknown>) : null;
  const publicKey = keys && typeof keys.publicKey === 'string' ? keys.publicKey : null;
  const encryptedPrivateKey = keys && typeof keys.encryptedPrivateKey === 'string' ? keys.encryptedPrivateKey : null;
  return { name, key, publicKey, encryptedPrivateKey };
}

// Feature flags advertised to clients. Family/team subset per the spec:
// totp yes; groups/policies/sso/scim/api/directory/events no.
const ORG_FEATURE_FLAGS = {
  use2fa: false,
  useApi: false,
  useDirectory: false,
  useEvents: false,
  useGroups: false,
  useKeyConnector: false,
  usePolicies: false,
  useResetPassword: false,
  useScim: false,
  useSecretsManager: false,
  useSso: false,
  useTotp: true,
  usePasswordManager: true,
} as const;

export function organizationToResponse(org: Organization): Record<string, unknown> {
  return {
    id: org.id,
    identifier: null,
    name: org.name,
    billingEmail: null,
    businessName: null,
    plan: 'Free',
    planType: 0,
    seats: null,
    maxCollections: null,
    maxStorageGb: null,
    ...ORG_FEATURE_FLAGS,
    selfHost: true,
    usersGetPremium: true,
    hasPublicAndPrivateKeys: !!(org.publicKey && org.encryptedPrivateKey),
    limitCollectionCreation: true,
    limitCollectionDeletion: true,
    limitItemDeletion: false,
    allowAdminAccessToAllCollectionItems: true,
    object: 'organization',
  };
}

export function profileOrganizationResponse(m: OrgMembership): Record<string, unknown> {
  const { organization, orgUser } = m;
  return {
    id: organization.id,
    identifier: null,
    name: organization.name,
    organizationUserId: orgUser.id,
    key: orgUser.encryptedOrgKey,
    status: ORG_STATUS[orgUser.status],
    type: ORG_TYPE[orgUser.role],
    enabled: true,
    seats: null,
    maxCollections: null,
    maxStorageGb: null,
    ...ORG_FEATURE_FLAGS,
    selfHost: true,
    usersGetPremium: true,
    ssoBound: false,
    hasPublicAndPrivateKeys: !!(organization.publicKey && organization.encryptedPrivateKey),
    accessSecretsManager: false,
    limitCollectionCreation: true,
    limitCollectionDeletion: true,
    limitItemDeletion: false,
    allowAdminAccessToAllCollectionItems: true,
    userIsManagedByOrganization: false,
    providerId: null,
    providerName: null,
    familySponsorshipFriendlyName: null,
    permissions: null,
    resetPasswordEnrolled: false,
    userId: orgUser.userId,
    object: 'profileOrganization',
  };
}

export function parseInviteRequest(body: unknown): { emails: string[] } | { error: string } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).emails)) {
    return { error: 'emails is required' };
  }
  const emails = Array.from(
    new Set(
      ((body as any).emails as unknown[])
        .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    )
  ).filter((e) => e.length > 0);
  if (!emails.length) return { error: 'At least one email is required' };
  if (emails.length > 20) return { error: 'Too many invitations in one request (max 20)' };
  for (const e of emails) {
    if (!e.includes('@') || e.length < 3) return { error: `Invalid email address: ${e}` };
    // Reject interior whitespace and control chars (incl. CR/LF) — these are
    // the building blocks of header-injection payloads once the address
    // flows into env.EMAIL.send({ to: ... }).
    if (/[\s\x00-\x1f\x7f]/.test(e)) return { error: `Invalid email address: ${e}` };
  }
  return { emails };
}

export function orgUserDetailsResponse(orgUser: OrganizationUser, user: { name: string | null; email: string } | null): Record<string, unknown> {
  return {
    object: 'organizationUserUserDetails',
    type: ORG_TYPE[orgUser.role],
    status: ORG_STATUS[orgUser.status],
    id: orgUser.id,
    userId: orgUser.userId,
    organizationId: orgUser.orgId,
    name: user?.name ?? null,
    email: orgUser.email,
    avatarColor: null,
    collections: [],
    accessAll: true,
    twoFactorEnabled: false,
    resetPasswordEnrolled: false,
    usesKeyConnector: false,
    hasMasterPassword: true,
    creationDate: orgUser.createdAt,
  };
}

export function orgUserListResponse(items: Record<string, unknown>[]): Record<string, unknown> {
  return {
    data: items,
    object: 'list',
    continuationToken: null,
  };
}

export function userPublicKeyResponse(userId: string, publicKey: string): Record<string, unknown> {
  return {
    userId,
    publicKey,
    object: 'userKey',
  };
}

export function parseCollectionRequest(body: unknown): { name: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > MAX_ENCRYPTED_NAME_LENGTH) return { error: 'Collection name is required' };
  return { name };
}

export function parseCollectionGrantsRequest(
  body: unknown
): { grants: { orgUserId: string; readOnly: boolean; hidePasswords: boolean }[] } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.users)) return { error: 'users is required and must be an array' };

  const grants: { orgUserId: string; readOnly: boolean; hidePasswords: boolean }[] = [];
  for (const user of b.users) {
    if (!user || typeof user !== 'object') return { error: 'Invalid user in users array' };
    const u = user as Record<string, unknown>;
    const orgUserId = typeof u.id === 'string' ? u.id : '';
    if (!orgUserId) return { error: 'user.id is required' };
    const readOnly = u.readOnly === true || u.readOnly === 'true';
    const hidePasswords = u.hidePasswords === true || u.hidePasswords === 'true';
    grants.push({ orgUserId, readOnly, hidePasswords });
  }
  return { grants };
}

export function collectionResponse(c: Collection): Record<string, unknown> {
  return {
    id: c.id,
    organizationId: c.orgId,
    name: c.name,
    externalId: null,
    object: 'collection',
  };
}

export function collectionDetailsResponse(
  c: Collection,
  readOnly: boolean,
  hidePasswords: boolean
): Record<string, unknown> {
  return {
    id: c.id,
    organizationId: c.orgId,
    name: c.name,
    externalId: null,
    readOnly,
    hidePasswords,
    manage: false,
    object: 'collectionDetails',
  };
}

export function collectionListResponse(items: unknown[]): Record<string, unknown> {
  return {
    data: items,
    object: 'list',
    continuationToken: null,
  };
}
