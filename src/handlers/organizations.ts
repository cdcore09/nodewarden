import { Env, Organization, OrganizationUser } from '../types';
import { StorageService } from '../services/storage';
import { jsonResponse, errorResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { readActingDeviceIdentifier } from '../utils/device';
import { notifyUserVaultSync } from '../durable/notifications-hub';
import { auditRequestMetadata, writeAuditEvent } from '../services/audit-events';
import { parseCreateOrgRequest, organizationToResponse } from './org-shapes';
import { bumpAndNotifyMembers } from './org-users';
import { deleteBlobObject, getAttachmentObjectKey } from '../services/blob-store';

const ORG_NOT_FOUND = 'Organization not found';

async function writeOrgAudit(
  storage: StorageService,
  request: Request,
  userId: string,
  action: string,
  orgId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await writeAuditEvent(storage, {
    actorUserId: userId,
    action,
    category: 'data',
    level: action.includes('delete') ? 'security' : 'info',
    targetType: 'organization',
    targetId: orgId,
    metadata: { ...metadata, ...auditRequestMetadata(request) },
  });
}

// Loads the org ONLY if the requester is a confirmed owner; unauthorized and
// nonexistent are indistinguishable to the caller (Global Constraint).
export async function getOwnedOrg(
  storage: StorageService,
  orgId: string,
  userId: string
): Promise<Organization | null> {
  const orgUser = await storage.getOrgUserByOrgAndUser(orgId, userId);
  if (!orgUser || orgUser.role !== 'owner' || orgUser.status !== 'confirmed') return null;
  return storage.getOrganization(orgId);
}

// POST /api/organizations
export async function handleCreateOrganization(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const user = await storage.getUserById(userId);
  if (!user) return errorResponse('User not found', 404);
  // Sole-administrator model (see spec): only the operator-administrator may
  // create organizations. Message mirrors Vaultwarden's for client familiarity.
  if (user.role !== 'admin') {
    return errorResponse('User not allowed to create organizations', 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const parsed = parseCreateOrgRequest(body);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const now = new Date().toISOString();
  const org: Organization = {
    id: generateUUID(),
    name: parsed.name,
    publicKey: parsed.publicKey,
    encryptedPrivateKey: parsed.encryptedPrivateKey,
    createdAt: now,
    updatedAt: now,
  };
  const owner: OrganizationUser = {
    id: generateUUID(),
    orgId: org.id,
    userId,
    email: user.email,
    role: 'owner',
    status: 'confirmed',
    encryptedOrgKey: parsed.key,
    createdAt: now,
    updatedAt: now,
  };
  await storage.createOrganizationWithOwner(org, owner);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyUserVaultSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
  await writeOrgAudit(storage, request, userId, 'organization.create', org.id, { name: 'encrypted' });

  return jsonResponse(organizationToResponse(org));
}

// GET /api/organizations/:id
export async function handleGetOrganization(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);
  return jsonResponse(organizationToResponse(org));
}

// PUT /api/organizations/:id
export async function handleUpdateOrganization(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const name = body && typeof (body as any).name === 'string' ? (body as any).name.trim() : '';
  if (!name || name.length > 1000) return errorResponse('Organization name is required', 400);

  const now = new Date().toISOString();
  await storage.updateOrganizationName(orgId, name, now);

  await bumpAndNotifyMembers(env, storage, orgId, readActingDeviceIdentifier(request));
  await writeOrgAudit(storage, request, userId, 'organization.update', orgId);

  return jsonResponse(organizationToResponse({ ...org, name, updatedAt: now }));
}

// POST /api/organizations/:id/delete  (also wired to DELETE /api/organizations/:id)
export async function handleDeleteOrganization(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  // Capture member ids BEFORE deleteOrganization cascades the membership rows
  // away — bumpAndNotifyMembers can't be used post-delete since it re-queries
  // membership internally.
  const memberIds = await storage.listConfirmedMemberUserIds(orgId);

  // ciphers.organization_id has NO foreign key to organizations (by design —
  // it would conflict with the ownership invariant that ciphers.user_id must
  // always resolve), so deleteOrganization's cascade never reaches the org's
  // ciphers. Purge them explicitly, along with their R2/KV attachment blobs
  // (deleting the attachment DB rows alone — which cascade automatically via
  // attachments.cipher_id ON DELETE CASCADE once the cipher row is deleted —
  // does NOT delete the underlying blob object). Order: enumerate blob keys
  // -> delete blobs -> delete cipher rows (cascades attachments +
  // cipher_collections) -> delete the org row itself.
  const orgCipherIds = await storage.getOrgCipherIds(orgId);
  if (orgCipherIds.length > 0) {
    const attachmentsByCipher = await storage.getAttachmentsByCipherIds(orgCipherIds);
    for (const [cipherId, attachments] of attachmentsByCipher) {
      for (const attachment of attachments) {
        await deleteBlobObject(env, getAttachmentObjectKey(cipherId, attachment.id));
      }
    }
    await storage.deleteOrgCiphers(orgId);
  }

  await storage.deleteOrganization(orgId);

  const contextId = readActingDeviceIdentifier(request);
  const revisionDate = await storage.updateRevisionDates(memberIds);
  for (const memberId of memberIds) {
    notifyUserVaultSync(env, memberId, revisionDate, contextId);
  }
  await writeOrgAudit(storage, request, userId, 'organization.delete', orgId);

  return new Response(null, { status: 200 });
}
