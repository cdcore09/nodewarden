// Organization member-management handlers: invite, resend, accept, confirm,
// remove, list, and public-key lookup. Owner-gated endpoints are indistinguishable
// from a nonexistent org to the caller (Global Constraint) — see getOwnedOrg.
import { Env, OrganizationUser } from '../types';
import { StorageService } from '../services/storage';
import { jsonResponse, errorResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { readActingDeviceIdentifier } from '../utils/device';
import { notifyUserVaultSync } from '../durable/notifications-hub';
import { auditRequestMetadata, writeAuditEvent } from '../services/audit-events';
import { getOwnedOrg } from './organizations';
import { parseInviteRequest, orgUserDetailsResponse, orgUserListResponse, userPublicKeyResponse } from './org-shapes';
import { createOrgInviteToken, verifyOrgInviteToken } from '../services/org-invite-token';
import { sendOrgInviteEmail, isOrgEmailConfigured } from '../services/org-mail';

const ORG_NOT_FOUND = 'Organization not found';
const MEMBER_NOT_FOUND = 'Organization member not found';
const INVITE_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function writeMemberAudit(
  storage: StorageService,
  request: Request,
  userId: string,
  action: string,
  orgId: string,
  level: 'info' | 'warn' | 'error' | 'security' = 'info',
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await writeAuditEvent(storage, {
    actorUserId: userId,
    action,
    category: 'data',
    level,
    targetType: 'organization',
    targetId: orgId,
    metadata: { ...metadata, ...auditRequestMetadata(request) },
  });
}

// Bumps the sync revision for every confirmed member of the org and notifies
// each one over the notifications hub. Shared by confirm and remove — both
// actions change what the rest of the org sees in their membership list.
async function bumpAndNotifyMembers(
  env: Env,
  storage: StorageService,
  orgId: string,
  contextId: string | null
): Promise<void> {
  const memberIds = await storage.listConfirmedMemberUserIds(orgId);
  const revisionDate = await storage.updateRevisionDates(memberIds);
  for (const memberId of memberIds) {
    notifyUserVaultSync(env, memberId, revisionDate, contextId);
  }
}

// GET /api/organizations/:id/users
export async function handleListOrgUsers(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const rows = await storage.listOrgUsers(orgId);
  const items = await Promise.all(
    rows.map(async (row) => {
      const info = row.userId ? await storage.getUserById(row.userId) : null;
      return orgUserDetailsResponse(row, info ? { name: info.name, email: info.email } : null);
    })
  );
  return jsonResponse(orgUserListResponse(items));
}

// POST /api/organizations/:id/users/invite
export async function handleInviteOrgUsers(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const parsed = parseInviteRequest(body);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  if (!isOrgEmailConfigured(env)) return errorResponse('Email is not configured on this server', 500);
  if (!env.ORG_INVITE_SITE_URL) return errorResponse('Email is not configured on this server', 500);

  const now = new Date().toISOString();

  for (const email of parsed.emails) {
    const existing = await storage.getOrgUserByOrgAndEmail(orgId, email);
    if (existing) return errorResponse('A member with this email already exists in the organization', 400);
  }

  // A send failure for one email must not roll back or block the others: the
  // membership row + registration code (if any) are already committed per
  // email by the time we attempt delivery, so a failed send just leaves that
  // row in 'invited' with no mail sent yet. Recovery path: the owner calls
  // handleResendOrgInvite for that member, which re-mints a token (and code,
  // if the recipient still has no account) and retries the send — it does not
  // require re-running this whole batch.
  let anyDeliveryFailed = false;

  for (const email of parsed.emails) {
    const orgUserId = generateUUID();
    const orgUser: OrganizationUser = {
      id: orgUserId,
      orgId,
      userId: null,
      email,
      role: 'user',
      status: 'invited',
      encryptedOrgKey: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.createOrgUserInvite(orgUser);

    const existingUser = await storage.getUser(email);
    let code: string | null = null;
    if (!existingUser) {
      code = generateUUID();
      await storage.createInvite({
        code,
        createdBy: userId,
        usedBy: null,
        expiresAt: new Date(Date.now() + INVITE_CODE_TTL_MS).toISOString(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    }

    const token = await createOrgInviteToken(env.JWT_SECRET, { orgUserId, orgId, email });
    let delivered = true;
    try {
      await sendOrgInviteEmail(env, {
        toEmail: email,
        orgName: org.name,
        orgId,
        orgUserId,
        token,
        inviteCode: code,
        siteUrl: env.ORG_INVITE_SITE_URL!,
      });
    } catch {
      delivered = false;
      anyDeliveryFailed = true;
    }

    await writeMemberAudit(storage, request, userId, 'organization.user.invite', orgId, 'info', {
      targetEmail: email,
      ...(delivered ? {} : { emailDelivered: false }),
    });
  }

  if (anyDeliveryFailed) {
    return errorResponse('Some invitations could not be emailed; use resend', 500);
  }
  return new Response(null, { status: 200 });
}

// POST /api/organizations/:id/users/:orgUserId/reinvite
export async function handleResendOrgInvite(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  orgUserId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const orgUser = await storage.getOrgUserById(orgUserId);
  if (!orgUser || orgUser.orgId !== orgId || orgUser.status !== 'invited') {
    return errorResponse(MEMBER_NOT_FOUND, 404);
  }

  if (!isOrgEmailConfigured(env)) return errorResponse('Email is not configured on this server', 500);
  if (!env.ORG_INVITE_SITE_URL) return errorResponse('Email is not configured on this server', 500);

  const now = new Date().toISOString();
  const existingUser = await storage.getUser(orgUser.email);
  let code: string | null = null;
  if (!existingUser) {
    code = generateUUID();
    await storage.createInvite({
      code,
      createdBy: userId,
      usedBy: null,
      expiresAt: new Date(Date.now() + INVITE_CODE_TTL_MS).toISOString(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  const token = await createOrgInviteToken(env.JWT_SECRET, { orgUserId, orgId, email: orgUser.email });
  await sendOrgInviteEmail(env, {
    toEmail: orgUser.email,
    orgName: org.name,
    orgId,
    orgUserId,
    token,
    inviteCode: code,
    siteUrl: env.ORG_INVITE_SITE_URL!,
  });

  await writeMemberAudit(storage, request, userId, 'organization.user.reinvite', orgId, 'info', { targetEmail: orgUser.email });

  return new Response(null, { status: 200 });
}

// POST /api/organizations/:id/users/:orgUserId/accept
export async function handleAcceptOrgUser(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  orgUserId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const token = body && typeof (body as any).token === 'string' ? (body as any).token : '';
  if (!token) return errorResponse('Invalid invitation token', 400);

  const claims = await verifyOrgInviteToken(env.JWT_SECRET, token);
  if (!claims || claims.orgId !== orgId || claims.orgUserId !== orgUserId) {
    return errorResponse('Invalid invitation token', 400);
  }

  const user = await storage.getUserById(userId);
  if (!user || user.email.toLowerCase() !== claims.email.toLowerCase()) {
    return errorResponse('Invalid invitation token', 400);
  }

  const now = new Date().toISOString();
  const accepted = await storage.acceptOrgUser(orgUserId, orgId, userId, now);
  if (!accepted) return errorResponse('Invitation is no longer valid', 400);

  const contextId = readActingDeviceIdentifier(request);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyUserVaultSync(env, userId, revisionDate, contextId);

  await writeMemberAudit(storage, request, userId, 'organization.user.accept', orgId);

  return new Response(null, { status: 200 });
}

// POST /api/organizations/:id/users/:orgUserId/confirm
export async function handleConfirmOrgUser(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  orgUserId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  // Cross-tenant guard: an orgUserId that resolves but belongs to a different
  // org must be indistinguishable from one that doesn't exist at all.
  const targetOrgUser = await storage.getOrgUserById(orgUserId);
  if (!targetOrgUser || targetOrgUser.orgId !== orgId) return errorResponse(MEMBER_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const key = body && typeof (body as any).key === 'string' ? (body as any).key : '';
  if (!key || key.length > 4000) return errorResponse('Invalid request body', 400);

  const now = new Date().toISOString();
  const confirmed = await storage.confirmOrgUser(orgUserId, orgId, key, now);
  if (!confirmed) return errorResponse('Member is not in the accepted state', 400);

  const contextId = readActingDeviceIdentifier(request);
  await bumpAndNotifyMembers(env, storage, orgId, contextId);

  await writeMemberAudit(storage, request, userId, 'organization.user.confirm', orgId);

  return new Response(null, { status: 200 });
}

// DELETE /api/organizations/:id/users/:orgUserId
export async function handleRemoveOrgUser(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  orgUserId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const orgUser = await storage.getOrgUserById(orgUserId);
  if (!orgUser || orgUser.orgId !== orgId) return errorResponse(MEMBER_NOT_FOUND, 404);
  if (orgUser.role === 'owner') return errorResponse('The organization owner cannot be removed', 400);

  const removedUserId = orgUser.userId;
  await storage.deleteOrgUser(orgUserId);

  const contextId = readActingDeviceIdentifier(request);
  await bumpAndNotifyMembers(env, storage, orgId, contextId);
  if (removedUserId) {
    const revisionDate = await storage.updateRevisionDate(removedUserId);
    notifyUserVaultSync(env, removedUserId, revisionDate, contextId);
  }

  await writeMemberAudit(storage, request, userId, 'organization.user.remove', orgId, 'security', {
    targetEmail: orgUser.email,
  });

  return new Response(null, { status: 200 });
}

// GET /api/users/:id/public-key
export async function handleGetUserPublicKey(
  request: Request,
  env: Env,
  userId: string,
  targetUserId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  const [requesterMemberships, targetMemberships] = await Promise.all([
    storage.listMembershipsForUser(userId),
    storage.listMembershipsForUser(targetUserId),
  ]);
  const requesterOrgIds = new Set(requesterMemberships.map((m) => m.organization.id));
  const shared = targetMemberships.some((m) => requesterOrgIds.has(m.organization.id));
  if (!shared) return errorResponse('User not found', 404);

  const target = await storage.getUserById(targetUserId);
  if (!target || !target.publicKey) return errorResponse('User not found', 404);

  return jsonResponse(userPublicKeyResponse(targetUserId, target.publicKey));
}
