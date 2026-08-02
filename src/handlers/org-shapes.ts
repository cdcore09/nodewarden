// Pure request-parsing and response-shaping for organizations.
// ALL Bitwarden org enum mapping lives here (Global Constraint).
// Field set follows Vaultwarden's responses; validated against official
// clients in Phase 3/4 — adjust HERE if a client rejects a shape.
import type { Organization, OrgMembership, OrgRole, OrgUserStatus } from '../types';

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
