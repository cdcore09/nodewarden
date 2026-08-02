// Organization collection-management handlers: list, get, create, update,
// delete, and per-collection member grants. Owner-gated endpoints are
// indistinguishable from a nonexistent org to the caller (Global Constraint)
// — see getOwnedOrg. Mirrors org-users.ts structure.
import { Env, Collection, CollectionGrant } from '../types';
import { StorageService } from '../services/storage';
import { jsonResponse, errorResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { readActingDeviceIdentifier } from '../utils/device';
import { auditRequestMetadata, writeAuditEvent } from '../services/audit-events';
import { getOwnedOrg } from './organizations';
import { bumpAndNotifyMembers } from './org-users';
import {
  parseCollectionRequest,
  parseCollectionGrantsRequest,
  collectionResponse,
  collectionListResponse,
} from './org-shapes';

const ORG_NOT_FOUND = 'Organization not found';
const COLLECTION_NOT_FOUND = 'Collection not found';

async function writeCollectionAudit(
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

// GET /api/organizations/:id/collections
export async function handleListCollections(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const collections = await storage.listCollections(orgId);
  return jsonResponse(collectionListResponse(collections.map((c) => collectionResponse(c))));
}

// GET /api/organizations/:id/collections/:collectionId
export async function handleGetCollection(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  collectionId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const collection = await storage.getCollection(collectionId);
  if (!collection || collection.orgId !== orgId) return errorResponse(COLLECTION_NOT_FOUND, 404);

  return jsonResponse(collectionResponse(collection));
}

// POST /api/organizations/:id/collections
export async function handleCreateCollection(request: Request, env: Env, userId: string, orgId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const parsed = parseCollectionRequest(body);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const now = new Date().toISOString();
  const collection: Collection = {
    id: generateUUID(),
    orgId,
    name: parsed.name,
    createdAt: now,
    updatedAt: now,
  };
  await storage.createCollection(collection);

  const contextId = readActingDeviceIdentifier(request);
  await bumpAndNotifyMembers(env, storage, orgId, contextId);

  await writeCollectionAudit(storage, request, userId, 'organization.collection.create', orgId, 'info', {
    collectionId: collection.id,
  });

  return jsonResponse(collectionResponse(collection));
}

// PUT /api/organizations/:id/collections/:collectionId
export async function handleUpdateCollection(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  collectionId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const collection = await storage.getCollection(collectionId);
  if (!collection || collection.orgId !== orgId) return errorResponse(COLLECTION_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const parsed = parseCollectionRequest(body);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const now = new Date().toISOString();
  await storage.updateCollectionName(collectionId, parsed.name, now);

  const contextId = readActingDeviceIdentifier(request);
  await bumpAndNotifyMembers(env, storage, orgId, contextId);

  await writeCollectionAudit(storage, request, userId, 'organization.collection.update', orgId, 'info', {
    collectionId,
  });

  const updated: Collection = { ...collection, name: parsed.name, updatedAt: now };
  return jsonResponse(collectionResponse(updated));
}

// DELETE /api/organizations/:id/collections/:collectionId
export async function handleDeleteCollection(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  collectionId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const collection = await storage.getCollection(collectionId);
  if (!collection || collection.orgId !== orgId) return errorResponse(COLLECTION_NOT_FOUND, 404);

  await storage.deleteCollection(collectionId);

  const contextId = readActingDeviceIdentifier(request);
  await bumpAndNotifyMembers(env, storage, orgId, contextId);

  await writeCollectionAudit(storage, request, userId, 'organization.collection.delete', orgId, 'security', {
    collectionId,
  });

  return new Response(null, { status: 200 });
}

// GET /api/organizations/:id/collections/:collectionId/users
export async function handleGetCollectionUsers(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  collectionId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const collection = await storage.getCollection(collectionId);
  if (!collection || collection.orgId !== orgId) return errorResponse(COLLECTION_NOT_FOUND, 404);

  const grants = await storage.listGrantsForCollection(collectionId);
  const items = grants.map((g) => ({ id: g.orgUserId, readOnly: g.readOnly, hidePasswords: g.hidePasswords }));
  return jsonResponse(items);
}

// PUT /api/organizations/:id/collections/:collectionId/users
export async function handlePutCollectionUsers(
  request: Request,
  env: Env,
  userId: string,
  orgId: string,
  collectionId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const org = await getOwnedOrg(storage, orgId, userId);
  if (!org) return errorResponse(ORG_NOT_FOUND, 404);

  const collection = await storage.getCollection(collectionId);
  if (!collection || collection.orgId !== orgId) return errorResponse(COLLECTION_NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const parsed = parseCollectionGrantsRequest(body);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const orgUsers = await storage.listOrgUsers(orgId);
  const orgUserIds = new Set(orgUsers.map((u) => u.id));
  for (const grant of parsed.grants) {
    if (!orgUserIds.has(grant.orgUserId)) return errorResponse('Invalid organization member in grant', 400);
  }

  const existing = await storage.listGrantsForCollection(collectionId);
  for (const g of existing) {
    await storage.deleteGrant(collectionId, g.orgUserId);
  }
  for (const grant of parsed.grants) {
    const record: CollectionGrant = {
      collectionId,
      orgUserId: grant.orgUserId,
      readOnly: grant.readOnly,
      hidePasswords: grant.hidePasswords,
    };
    await storage.setGrant(record);
  }

  const contextId = readActingDeviceIdentifier(request);
  await bumpAndNotifyMembers(env, storage, orgId, contextId);

  await writeCollectionAudit(storage, request, userId, 'organization.collection.users.update', orgId, 'info', {
    collectionId,
  });

  return new Response(null, { status: 200 });
}
