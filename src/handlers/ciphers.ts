import {
  Env,
  Cipher,
  CipherCard,
  CipherIdentity,
  CipherLogin,
  CipherResponse,
  CipherSecureNote,
  CipherSshKey,
  CipherBankAccount,
  CipherDriversLicense,
  CipherPassport,
  CipherApiKey,
  Attachment,
  PasswordHistory,
  OrganizationUser,
} from '../types';
import { StorageService } from '../services/storage';
import { canReadCipher, canWriteCipher } from '../services/org-access';
import {
  notifyUserCipherCreate,
  notifyUserCipherDelete,
  notifyUserCipherUpdate,
  notifyUserCiphersSync,
  notifyUserVaultSync,
} from '../durable/notifications-hub';
import { jsonResponse, errorResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { deleteAllAttachmentsForCipher, deleteAllAttachmentsForCiphers } from './attachments';
import { parsePagination, encodeContinuationToken } from '../utils/pagination';
import { readActingDeviceIdentifier } from '../utils/device';
import { auditRequestMetadata, writeAuditEvent } from '../services/audit-events';
import { bumpAndNotifyMembers } from './org-users';

// CONTRACT:
// Cipher JSON is the highest-risk Bitwarden compatibility surface. Preserve
// unknown/future client fields by default, then override only server-owned
// fields. Any change to cipher response shape must be checked against /api/sync,
// attachments, import/export, and current official clients.
export interface CipherResponseOptions {
  preserveRepairableUris?: boolean;
  validFolderIds?: ReadonlySet<string>;
}

export function shouldPreserveRepairableCipherUris(request: Request): boolean {
  return request.headers.get('X-NodeWarden-Web') === '1';
}

function cipherResponseOptionsForRequest(request: Request): CipherResponseOptions {
  return { preserveRepairableUris: shouldPreserveRepairableCipherUris(request) };
}

function normalizeOptionalId(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeResponseFolderId(folderId: unknown, validFolderIds?: ReadonlySet<string>): string | null {
  const normalized = normalizeOptionalId(folderId);
  if (!normalized) return null;
  return validFolderIds && !validFolderIds.has(normalized) ? null : normalized;
}

function readBooleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function buildCipherPermissions(passthrough: Record<string, unknown>): { delete: boolean; restore: boolean } {
  const raw = passthrough.permissions;
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;

  return {
    delete: readBooleanOrFallback(source?.delete, true),
    restore: readBooleanOrFallback(source?.restore, true),
  };
}

function notifyVaultSyncForRequest(
  request: Request,
  env: Env,
  userId: string,
  revisionDate: string
): void {
  notifyUserVaultSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
}

// When an org cipher is created/updated/deleted/restored/archived, every
// CONFIRMED member of that org (not just the acting user) needs their sync
// revision bumped and pushed, or their client keeps showing stale vault
// state after a teammate's edit. Reuses org-users.ts's bumpAndNotifyMembers
// (already used by the collection/member-management handlers for the same
// "notify the whole org" shape). Dedupes orgIds so a bulk op touching many
// ciphers in the same org only bumps that org once. This is IN ADDITION to
// the existing acting-user notify — the acting user may be bumped/notified
// twice (once via their personal notify, once via this org fan-out); that's
// harmless, just two pushes for the one client that's already up to date.
async function notifyOrgCipherChange(
  env: Env,
  storage: StorageService,
  orgIds: Iterable<string | null | undefined>,
  contextId: string | null
): Promise<void> {
  const uniqueOrgIds = new Set<string>();
  for (const orgId of orgIds) {
    if (orgId) uniqueOrgIds.add(orgId);
  }
  for (const orgId of uniqueOrgIds) {
    await bumpAndNotifyMembers(env, storage, orgId, contextId);
  }
}

function notifyCipherCreateForRequest(
  request: Request,
  env: Env,
  cipher: Cipher,
  revisionDate: string
): void {
  notifyUserCipherCreate(env, {
    userId: cipher.userId,
    cipherId: cipher.id,
    revisionDate,
    organizationId: normalizeOptionalId((cipher as any).organizationId ?? null),
    collectionIds: Array.isArray((cipher as any).collectionIds)
      ? (cipher as any).collectionIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : null,
    contextId: readActingDeviceIdentifier(request),
  });
}

function notifyCipherUpdateForRequest(
  request: Request,
  env: Env,
  cipher: Cipher,
  revisionDate: string
): void {
  notifyUserCipherUpdate(env, {
    userId: cipher.userId,
    cipherId: cipher.id,
    revisionDate,
    organizationId: normalizeOptionalId((cipher as any).organizationId ?? null),
    collectionIds: Array.isArray((cipher as any).collectionIds)
      ? (cipher as any).collectionIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : null,
    contextId: readActingDeviceIdentifier(request),
  });
}

function notifyCipherDeleteForRequest(
  request: Request,
  env: Env,
  cipher: Cipher,
  revisionDate: string
): void {
  notifyUserCipherDelete(env, {
    userId: cipher.userId,
    cipherId: cipher.id,
    revisionDate,
    organizationId: normalizeOptionalId((cipher as any).organizationId ?? null),
    collectionIds: Array.isArray((cipher as any).collectionIds)
      ? (cipher as any).collectionIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : null,
    contextId: readActingDeviceIdentifier(request),
  });
}

function getAliasedProp(source: any, aliases: string[]): { present: boolean; value: any } {
  if (!source || typeof source !== 'object') return { present: false, value: undefined };
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return { present: true, value: source[key] };
    }
  }
  return { present: false, value: undefined };
}

function readCipherProp<T = unknown>(source: any, aliases: string[]): { present: boolean; value: T | undefined } {
  return getAliasedProp(source, aliases) as { present: boolean; value: T | undefined };
}

function normalizeCipherTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function readCipherArchivedAt(source: any, fallback: string | null = null): string | null {
  const archived = getAliasedProp(source, ['archivedAt', 'ArchivedAt', 'archivedDate', 'ArchivedDate']);
  return archived.present ? normalizeCipherTimestamp(archived.value) : fallback;
}

function readCipherRevisionDate(source: any): string | null {
  const revision = getAliasedProp(source, ['lastKnownRevisionDate', 'LastKnownRevisionDate']);
  return revision.present ? normalizeCipherTimestamp(revision.value) : null;
}

function isStaleCipherUpdate(existingUpdatedAt: string, clientRevisionDate: string | null): boolean {
  if (!clientRevisionDate) return false;
  const existingTs = Date.parse(existingUpdatedAt);
  const clientTs = Date.parse(clientRevisionDate);
  if (Number.isNaN(existingTs) || Number.isNaN(clientTs)) return false;
  return existingTs - clientTs > 1000;
}

function syncCipherComputedAliases(cipher: Cipher): Cipher {
  cipher.archivedDate = cipher.archivedAt ?? null;
  cipher.deletedDate = cipher.deletedAt ?? null;
  return cipher;
}

async function writeCipherAudit(
  storage: StorageService,
  request: Request,
  userId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await writeAuditEvent(storage, {
    actorUserId: userId,
    action,
    category: 'data',
    level: action.includes('delete') ? 'security' : 'info',
    targetType: 'cipher',
    targetId: typeof metadata.id === 'string' ? metadata.id : null,
    metadata: {
      ...metadata,
      ...auditRequestMetadata(request),
    },
  });
}

function isValidEncString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0) return false;
  const type = Number(trimmed.slice(0, dot));
  if (!Number.isInteger(type) || type < 0) return false;
  const parts = trimmed.slice(dot + 1).split('|');
  if (parts.some((part) => part.length === 0)) return false;

  // Bitwarden's legacy symmetric EncString variants require IV + data,
  // while the authenticated AES-CBC-HMAC variant requires IV + data + MAC.
  if (type === 0 || type === 1 || type === 4) return parts.length >= 2;
  if (type === 2) return parts.length === 3;

  // Keep newer one-part formats, such as COSE Encrypt0, future-compatible.
  return parts.length >= 1;
}

function optionalEncString(value: unknown): string | null {
  if (value == null || value === '') return null;
  return isValidEncString(value) ? value.trim() : null;
}

function optionalEncStringWithin(value: unknown, maxLength: number): string | null {
  const normalized = optionalEncString(value);
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : null;
}

function shouldAcceptCipherKey(value: unknown): boolean {
  return value == null || value === '' || isValidEncString(value);
}

function normalizeCipherKeyForStorage(value: unknown): string | null {
  return optionalEncString(value);
}

function sanitizeEncryptedObject<T extends Record<string, any>>(
  source: T | null | undefined,
  encryptedKeys: readonly string[] | Record<string, number>
): T | null {
  if (!source || typeof source !== 'object') return source ?? null;
  const next: Record<string, any> = { ...source };
  const entries = Array.isArray(encryptedKeys)
    ? encryptedKeys.map((key) => [key, 10000] as const)
    : Object.entries(encryptedKeys);
  for (const [key, maxLength] of entries) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    next[key] = optionalEncStringWithin(next[key], maxLength);
  }
  return next as T;
}

const BANK_ACCOUNT_ENCRYPTED_KEYS = [
  'bankName',
  'nameOnAccount',
  'accountType',
  'accountNumber',
  'routingNumber',
  'branchNumber',
  'pin',
  'swiftCode',
  'iban',
  'bankContactPhone',
] as const;

const DRIVERS_LICENSE_ENCRYPTED_KEYS = [
  'firstName',
  'middleName',
  'lastName',
  'dateOfBirth',
  'licenseNumber',
  'issuingCountry',
  'issuingState',
  'issueDate',
  'expirationDate',
  'issuingAuthority',
  'licenseClass',
] as const;

const PASSPORT_ENCRYPTED_KEYS = [
  'surname',
  'givenName',
  'dateOfBirth',
  'sex',
  'birthPlace',
  'nationality',
  'issuingCountry',
  'passportNumber',
  'passportType',
  'nationalIdentificationNumber',
  'issuingAuthority',
  'issueDate',
  'expirationDate',
] as const;

const API_KEY_ENCRYPTED_KEYS = [
  'provider',
  'keyId',
  'key',
  'expirationDate',
] as const;

function normalizeCipherForStorage(cipher: Cipher): Cipher {
  cipher.login = normalizeCipherLoginForStorage(cipher.login);
  cipher.sshKey = normalizeCipherSshKeyForCompatibility(cipher.sshKey);
  cipher.folderId = normalizeOptionalId(cipher.folderId);
  const hasArchivedAt = Object.prototype.hasOwnProperty.call(cipher as object, 'archivedAt');
  cipher.archivedAt = hasArchivedAt
    ? normalizeCipherTimestamp(cipher.archivedAt) ?? null
    : normalizeCipherTimestamp(cipher.archivedDate) ?? null;
  return syncCipherComputedAliases(cipher);
}

export function normalizeCipherLoginForStorage(login: any): any {
  if (!login || typeof login !== 'object') return login ?? null;
  return {
    ...login,
    fido2Credentials: Array.isArray(login.fido2Credentials) ? login.fido2Credentials : null,
  };
}

export function normalizeCipherLoginForCompatibility(
  login: any,
  requiresUriChecksum: boolean = false,
  preserveRepairableUris: boolean = false
): any {
  const normalized = normalizeCipherLoginForStorage(login);
  if (!normalized || typeof normalized !== 'object') return normalized ?? null;
  const next = sanitizeEncryptedObject(normalized, {
    username: 1000,
    password: 5000,
    totp: 1000,
    uri: 10000,
  });
  if (!next) return null;
  next.uris = normalizeCipherLoginUrisForCompatibility(next.uris, {
    requiresUriChecksum,
    preserveRepairableUris,
  });
  next.fido2Credentials = normalizeFido2CredentialsForCompatibility(next.fido2Credentials);
  return next;
}

function normalizeCipherLoginUrisForCompatibility(
  uris: any,
  options: { requiresUriChecksum?: boolean; preserveRepairableUris?: boolean } = {}
): any[] | null {
  if (!Array.isArray(uris) || uris.length === 0) return null;
  const out: any[] = [];

  for (const uri of uris) {
    if (!uri || typeof uri !== 'object') continue;
    const next = sanitizeEncryptedObject(uri, ['uri', 'uriChecksum']);
    if (!next) continue;

    const hasUri = isValidEncString(next.uri);
    const hasChecksum = isValidEncString(next.uriChecksum);
    const hasMatch = next.match != null;

    if (hasUri && String(next.uri).trim().length > 10000) continue;
    if (hasChecksum && String(next.uriChecksum).trim().length > 10000) {
      next.uriChecksum = null;
    }

    if (hasUri && isValidEncString(next.uriChecksum)) {
      out.push(next);
      continue;
    }

    if (hasUri && !hasChecksum) {
      // Official Bitwarden treats UriChecksum as nullable encrypted metadata.
      // Keep the URI intact and let clients that can repair checksums do so.
      out.push({ ...next, uriChecksum: null });
      continue;
    }

    if (hasChecksum || hasMatch) {
      out.push(next);
    }
  }

  return out.length ? out : null;
}

export function validateCipherEncryptedFieldsForCompatibility(cipher: Cipher): string | null {
  if (cipher.name != null && !optionalEncStringWithin(cipher.name, 1000)) return 'Cipher name must be an encrypted string up to 1000 characters.';
  if (cipher.notes != null && !optionalEncStringWithin(cipher.notes, 10000)) return 'Cipher notes must be an encrypted string up to 10000 characters.';

  const login = cipher.login as any;
  if (login && typeof login === 'object') {
    if (login.username != null && !optionalEncStringWithin(login.username, 1000)) return 'Login username must be an encrypted string up to 1000 characters.';
    if (login.password != null && !optionalEncStringWithin(login.password, 5000)) return 'Login password must be an encrypted string up to 5000 characters.';
    if (login.totp != null && !optionalEncStringWithin(login.totp, 1000)) return 'Login TOTP must be an encrypted string up to 1000 characters.';
    if (login.uri != null && !optionalEncStringWithin(login.uri, 10000)) return 'Login URI must be an encrypted string up to 10000 characters.';

    if (Array.isArray(login.uris)) {
      for (const uri of login.uris) {
        if (!uri || typeof uri !== 'object') continue;
        if (uri.uri != null && !optionalEncStringWithin(uri.uri, 10000)) return 'Login URI must be an encrypted string up to 10000 characters.';
        if (uri.uriChecksum != null && !optionalEncStringWithin(uri.uriChecksum, 10000)) return 'Login URI checksum must be an encrypted string up to 10000 characters.';
      }
    }

    // Validate FIDO2 credentials — all encrypted-string fields, both required and optional, must be valid.
    if (Array.isArray(login.fido2Credentials)) {
      const fido2EncryptedKeys = ['credentialId', 'keyType', 'keyAlgorithm', 'keyCurve', 'keyValue', 'rpId', 'counter', 'discoverable', 'userHandle', 'userName', 'rpName', 'userDisplayName'];
      for (const cred of login.fido2Credentials) {
        if (!cred || typeof cred !== 'object') continue;
        for (const key of fido2EncryptedKeys) {
          if (cred[key] != null && !isValidEncString(cred[key])) return `FIDO2 credential ${key} must be an encrypted string.`;
        }
      }
    }
  }

  // Validate SSH key fields — all three must be encrypted strings.
  const sshKey = cipher.sshKey as any;
  if (sshKey && typeof sshKey === 'object') {
    if (sshKey.privateKey != null && !isValidEncString(sshKey.privateKey)) return 'SSH key private key must be an encrypted string.';
    if (sshKey.publicKey != null && !isValidEncString(sshKey.publicKey)) return 'SSH key public key must be an encrypted string.';
    const fingerprint = sshKey.keyFingerprint ?? sshKey.fingerprint;
    if (fingerprint != null && !isValidEncString(fingerprint)) return 'SSH key fingerprint must be an encrypted string.';
  }

  const typedEncryptedObjects: Array<[string, any, readonly string[]]> = [
    ['Bank account', (cipher as any).bankAccount, BANK_ACCOUNT_ENCRYPTED_KEYS],
    ['Drivers license', (cipher as any).driversLicense, DRIVERS_LICENSE_ENCRYPTED_KEYS],
    ['Passport', (cipher as any).passport, PASSPORT_ENCRYPTED_KEYS],
    ['API key', (cipher as any).apiKey, API_KEY_ENCRYPTED_KEYS],
  ];
  for (const [label, source, keys] of typedEncryptedObjects) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (source[key] != null && !optionalEncStringWithin(source[key], 10000)) {
        return `${label} ${key} must be an encrypted string.`;
      }
    }
  }

  // Validate password history — each password must be an encrypted string.
  if (Array.isArray(cipher.passwordHistory)) {
    for (const entry of cipher.passwordHistory) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.password != null && !isValidEncString(entry.password)) return 'Password history entry must be an encrypted string.';
    }
  }

  return null;
}

function normalizeFido2CredentialsForCompatibility(credentials: any): any[] | null {
  if (!Array.isArray(credentials) || credentials.length === 0) return null;
  const requiredEncryptedKeys = [
    'credentialId',
    'keyType',
    'keyAlgorithm',
    'keyCurve',
    'keyValue',
    'rpId',
    'counter',
    'discoverable',
  ];
  const optionalEncryptedKeys = ['userHandle', 'userName', 'rpName', 'userDisplayName'];
  const out: any[] = [];

  for (const credential of credentials) {
    if (!credential || typeof credential !== 'object') continue;
    const next: Record<string, any> = { ...credential };
    let valid = true;
    for (const key of requiredEncryptedKeys) {
      if (!isValidEncString(next[key])) {
        valid = false;
        break;
      }
      next[key] = String(next[key]).trim();
    }
    if (!valid) continue;
    for (const key of optionalEncryptedKeys) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        next[key] = optionalEncString(next[key]);
      }
    }
    out.push(next);
  }

  return out.length ? out : null;
}

// Android 2026.2.0 requires sshKey.keyFingerprint in sync payloads.
// Keep legacy alias "fingerprint" in parallel for older web payloads.
export function normalizeCipherSshKeyForCompatibility(sshKey: any): any {
  if (!sshKey || typeof sshKey !== 'object') return sshKey ?? null;

  const candidate =
    sshKey.keyFingerprint !== undefined && sshKey.keyFingerprint !== null
      ? sshKey.keyFingerprint
      : sshKey.fingerprint;

  const normalizedFingerprint =
    candidate === undefined || candidate === null
      ? ''
      : String(candidate);

  if (
    !isValidEncString(sshKey.privateKey) ||
    !isValidEncString(sshKey.publicKey) ||
    !isValidEncString(normalizedFingerprint)
  ) {
    return null;
  }

  return {
    ...sshKey,
    privateKey: String(sshKey.privateKey).trim(),
    publicKey: String(sshKey.publicKey).trim(),
    keyFingerprint: normalizedFingerprint,
    fingerprint: normalizedFingerprint,
  };
}

function normalizeCipherSecureNoteForCompatibility(secureNote: any): CipherSecureNote | null {
  if (!secureNote || typeof secureNote !== 'object') return null;
  const type = Number(secureNote?.type ?? secureNote?.Type ?? 0);
  return {
    type: Number.isFinite(type) ? type : 0,
  };
}

// Format attachments for API response
export function formatAttachments(attachments: Attachment[]): any[] | null {
  if (attachments.length === 0) return null;
  const formatted = attachments
    .filter((a) => isValidEncString(a.fileName))
    .map(a => ({
      id: a.id,
      fileName: a.fileName.trim(),
      // Bitwarden clients decode attachment size as string in cipher payloads.
      size: String(Number(a.size) || 0),
      sizeName: a.sizeName,
      key: optionalEncString(a.key),
      url: `/api/ciphers/${a.cipherId}/attachment/${a.id}`,  // Android requires non-null url!
      object: 'attachment',
    }));
  return formatted.length ? formatted : null;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface IncomingAttachmentMetadata {
  id: string;
  fileName?: unknown;
  key?: unknown;
  fileSize?: unknown;
  hasFileName: boolean;
  hasKey: boolean;
  hasFileSize: boolean;
}

function readIncomingAttachmentMetadataMap(
  value: unknown,
  options: { legacyFileNameMap?: boolean } = {}
): IncomingAttachmentMetadata[] {
  if (!value || typeof value !== 'object') return [];
  const out: IncomingAttachmentMetadata[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? row.Id ?? '').trim();
      if (!id) continue;
      const fileName = getAliasedProp(row, ['fileName', 'FileName']);
      const key = getAliasedProp(row, ['key', 'Key']);
      const fileSize = getAliasedProp(row, ['fileSize', 'FileSize', 'size', 'Size']);
      out.push({
        id,
        fileName: fileName.value,
        key: key.value,
        fileSize: fileSize.value,
        hasFileName: fileName.present,
        hasKey: key.present,
        hasFileSize: fileSize.present,
      });
    }
    return out;
  }

  for (const [rawId, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const id = String(rawId || '').trim();
    if (!id) continue;

    if (options.legacyFileNameMap && (typeof rawValue === 'string' || rawValue == null)) {
      out.push({
        id,
        fileName: rawValue,
        key: undefined,
        fileSize: undefined,
        hasFileName: rawValue != null,
        hasKey: false,
        hasFileSize: false,
      });
      continue;
    }

    if (!rawValue || typeof rawValue !== 'object') continue;
    const row = rawValue as Record<string, unknown>;
    const fileName = getAliasedProp(row, ['fileName', 'FileName']);
    const key = getAliasedProp(row, ['key', 'Key']);
    const fileSize = getAliasedProp(row, ['fileSize', 'FileSize', 'size', 'Size']);
    out.push({
      id,
      fileName: fileName.value,
      key: key.value,
      fileSize: fileSize.value,
      hasFileName: fileName.present,
      hasKey: key.present,
      hasFileSize: fileSize.present,
    });
  }

  return out;
}

function readIncomingAttachmentMetadata(source: any): IncomingAttachmentMetadata[] {
  const merged = new Map<string, IncomingAttachmentMetadata>();
  const legacy = getAliasedProp(source, ['attachments', 'Attachments']);
  const current = getAliasedProp(source, ['attachments2', 'Attachments2']);

  if (legacy.present) {
    for (const item of readIncomingAttachmentMetadataMap(legacy.value, { legacyFileNameMap: true })) {
      merged.set(item.id, item);
    }
  }

  if (current.present) {
    for (const item of readIncomingAttachmentMetadataMap(current.value)) {
      const previous = merged.get(item.id);
      merged.set(item.id, {
        id: item.id,
        fileName: item.hasFileName ? item.fileName : previous?.fileName,
        key: item.hasKey ? item.key : previous?.key,
        fileSize: item.hasFileSize ? item.fileSize : previous?.fileSize,
        hasFileName: item.hasFileName || previous?.hasFileName || false,
        hasKey: item.hasKey || previous?.hasKey || false,
        hasFileSize: item.hasFileSize || previous?.hasFileSize || false,
      });
    }
  }

  return [...merged.values()];
}

function hasIncomingAttachmentMetadata(source: any): boolean {
  return readIncomingAttachmentMetadata(source).length > 0;
}

async function syncIncomingAttachmentMetadata(
  storage: StorageService,
  cipherId: string,
  cipherData: any
): Promise<void> {
  const incoming = readIncomingAttachmentMetadata(cipherData);
  if (!incoming.length) return;

  const currentById = new Map((await storage.getAttachmentsByCipher(cipherId)).map((attachment) => [attachment.id, attachment]));
  for (const item of incoming) {
    const attachment = currentById.get(item.id);
    if (!attachment) continue;

    let changed = false;
    if (item.hasFileName) {
      const fileName = String(item.fileName || '').trim();
      if (isValidEncString(fileName) && fileName !== attachment.fileName) {
        attachment.fileName = fileName;
        changed = true;
      }
    }

    if (item.hasKey) {
      const key = optionalEncString(item.key);
      if (key !== attachment.key) {
        attachment.key = key;
        changed = true;
      }
    }

    if (item.hasFileSize) {
      const size = Number(item.fileSize);
      if (Number.isFinite(size) && size >= 0 && size !== Number(attachment.size || 0)) {
        attachment.size = size;
        attachment.sizeName = formatAttachmentSize(size);
        changed = true;
      }
    }

    if (changed) {
      await storage.saveAttachment(attachment);
    }
  }
}

export function applyCipherEmbeddedAttachmentMetadata(cipherData: any, attachments: Attachment[]): Attachment[] {
  const incoming = readIncomingAttachmentMetadata(cipherData);
  if (!incoming.length || !attachments.length) return attachments;

  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  return attachments.map((attachment) => {
    const item = incomingById.get(attachment.id);
    if (!item) return attachment;

    const next: Attachment = { ...attachment };
    if (item.hasFileName) {
      const fileName = String(item.fileName || '').trim();
      if (isValidEncString(fileName)) {
        next.fileName = fileName;
      }
    }
    if (item.hasKey) {
      next.key = optionalEncString(item.key);
    }
    if (item.hasFileSize) {
      const size = Number(item.fileSize);
      if (Number.isFinite(size) && size >= 0) {
        next.size = size;
        next.sizeName = formatAttachmentSize(size);
      }
    }
    return next;
  });
}

function normalizeCipherFieldsForCompatibility(fields: any): any[] | null {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const out = fields
    .map((field: any) => {
      if (!field || typeof field !== 'object') return null;
      return {
        ...field,
        name: optionalEncString(field.name),
        value: optionalEncString(field.value),
        type: Number(field.type) || 0,
        linkedId: field.linkedId ?? null,
      };
    })
    .filter(Boolean);
  return out.length ? out : null;
}

function normalizePasswordHistoryForCompatibility(passwordHistory: any): PasswordHistory[] | null {
  if (!Array.isArray(passwordHistory) || passwordHistory.length === 0) return null;
  const out = passwordHistory
    .filter((entry: any) => entry && typeof entry === 'object' && isValidEncString(entry.password))
    .map((entry: any) => ({
      ...entry,
      password: String(entry.password).trim(),
      lastUsedDate: normalizeCipherTimestamp(entry.lastUsedDate) ?? new Date().toISOString(),
    }));
  return out.length ? out : null;
}

export function isCipherResponseSyncCompatible(cipher: CipherResponse): boolean {
  return isValidEncString(cipher.name);
}

// Convert internal cipher to API response format.
// Uses opaque passthrough: spreads ALL stored fields (including unknown/future ones),
// then overlays server-computed fields. This ensures new Bitwarden client fields
// survive a round-trip without code changes.
export function cipherToResponse(
  cipher: Cipher,
  attachments: Attachment[] = [],
  options: CipherResponseOptions = {}
): CipherResponse {
  // Strip internal-only fields that must not appear in the API response
  const { userId, createdAt, updatedAt, archivedAt, deletedAt, ...passthrough } = cipher;
  const responseCipherKey = optionalEncString(cipher.key);
  const normalizedLogin = normalizeCipherLoginForCompatibility(
    (passthrough as any).login ?? null,
    !!responseCipherKey,
    !!options.preserveRepairableUris
  );
  const normalizedCard = sanitizeEncryptedObject((passthrough as any).card ?? null, {
    cardholderName: 1000,
    brand: 1000,
    number: 1000,
    expMonth: 1000,
    expYear: 1000,
    code: 1000,
  });
  const normalizedIdentity = sanitizeEncryptedObject((passthrough as any).identity ?? null, [
    'title',
    'firstName',
    'middleName',
    'lastName',
    'address1',
    'address2',
    'address3',
    'city',
    'state',
    'postalCode',
    'country',
    'company',
    'email',
    'phone',
    'ssn',
    'username',
    'passportNumber',
    'licenseNumber',
  ]);
  const normalizedSshKey = normalizeCipherSshKeyForCompatibility((passthrough as any).sshKey ?? null);
  const normalizedBankAccount = sanitizeEncryptedObject(
    (passthrough as any).bankAccount ?? null,
    BANK_ACCOUNT_ENCRYPTED_KEYS
  );
  const normalizedDriversLicense = sanitizeEncryptedObject(
    (passthrough as any).driversLicense ?? null,
    DRIVERS_LICENSE_ENCRYPTED_KEYS
  );
  const normalizedPassport = sanitizeEncryptedObject(
    (passthrough as any).passport ?? null,
    PASSPORT_ENCRYPTED_KEYS
  );
  const normalizedApiKey = sanitizeEncryptedObject(
    (passthrough as any).apiKey ?? null,
    API_KEY_ENCRYPTED_KEYS
  );
  const responseType = Number(cipher.type) || 1;
  const normalizedSecureNote = responseType === 2
    ? normalizeCipherSecureNoteForCompatibility((passthrough as any).secureNote ?? null) ?? { type: 0 }
    : null;
  const responseAttachments = applyCipherEmbeddedAttachmentMetadata(cipher, attachments);
  const responsePermissions = buildCipherPermissions(passthrough);

  return {
    // Pass through ALL stored cipher fields (known + unknown)
    ...passthrough,
    // Server-computed / enforced fields (always override)
    folderId: normalizeResponseFolderId(cipher.folderId, options.validFolderIds),
    type: responseType,
    organizationId: normalizeOptionalId((passthrough as any).organizationId ?? null),
    organizationUseTotp: !!((passthrough as any).organizationUseTotp ?? false),
    creationDate: createdAt,
    revisionDate: updatedAt,
    deletedDate: deletedAt,
    archivedDate: archivedAt ?? null,
    edit: readBooleanOrFallback((passthrough as any).edit, true),
    viewPassword: readBooleanOrFallback((passthrough as any).viewPassword, true),
    permissions: responsePermissions,
    object: 'cipherDetails',
    collectionIds: Array.isArray((passthrough as any).collectionIds) ? (passthrough as any).collectionIds : [],
    attachments: formatAttachments(responseAttachments),
    name: isValidEncString(cipher.name) ? cipher.name.trim() : cipher.name,
    notes: optionalEncString(cipher.notes),
    login: normalizedLogin,
    card: normalizedCard,
    identity: normalizedIdentity,
    secureNote: normalizedSecureNote,
    fields: normalizeCipherFieldsForCompatibility((passthrough as any).fields),
    passwordHistory: normalizePasswordHistoryForCompatibility((passthrough as any).passwordHistory),
    sshKey: normalizedSshKey,
    bankAccount: responseType === 6 ? normalizedBankAccount : null,
    driversLicense: responseType === 7 ? normalizedDriversLicense : null,
    passport: responseType === 8 ? normalizedPassport : null,
    apiKey: responseType === 9 ? normalizedApiKey : null,
    key: responseCipherKey,
    data: typeof (passthrough as any).data === 'string' ? (passthrough as any).data : null,
    encryptedFor: (passthrough as any).encryptedFor ?? null,
  };
}

// GET /api/ciphers
export async function handleGetCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('deleted') === 'true';
  const pagination = parsePagination(url);

  let filteredCiphers: Cipher[];
  let continuationToken: string | null = null;
  if (pagination) {
    const pageRows = await storage.getCiphersPage(
      userId,
      includeDeleted,
      pagination.limit + 1,
      pagination.offset
    );
    const hasNext = pageRows.length > pagination.limit;
    filteredCiphers = hasNext ? pageRows.slice(0, pagination.limit) : pageRows;
    continuationToken = hasNext ? encodeContinuationToken(pagination.offset + filteredCiphers.length) : null;
  } else {
    const ciphers = await storage.getAllCiphers(userId);
    filteredCiphers = includeDeleted
      ? ciphers
      : ciphers.filter(c => !c.deletedAt);
  }

  const attachmentsByCipher = await storage.getAttachmentsByCipherIds(
    filteredCiphers.map((cipher) => cipher.id)
  );
  const validFolderIds = new Set((await storage.getAllFolders(userId)).map((folder) => folder.id));

  // Build responses only for the current page to keep pagination cheap.
  const responseOptions = { ...cipherResponseOptionsForRequest(request), validFolderIds };
  const cipherResponses: CipherResponse[] = [];
  for (const cipher of filteredCiphers) {
    const attachments = attachmentsByCipher.get(cipher.id) || [];
    cipherResponses.push(cipherToResponse(cipher, attachments, responseOptions));
  }

  return jsonResponse({
    data: cipherResponses,
    object: 'list',
    continuationToken: continuationToken,
  });
}

// GET /api/ciphers/:id
export async function handleGetCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canReadCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  const responseOptions = cipherResponseOptionsForRequest(request);
  return jsonResponse(
    cipherToResponse(cipher, attachments, responseOptions)
  );
}

async function verifyFolderOwnership(storage: StorageService, folderId: string | null | undefined, userId: string): Promise<boolean> {
  if (!folderId) return true;
  const folder = await storage.getFolderForUser(folderId, userId);
  return !!folder;
}

// SECURITY (Task 1 review finding, reused by Task 6's share endpoint): any
// handler that lets a client attach an org cipher to a set of collections
// must validate, before persisting anything, that (a) the requester is a
// CONFIRMED member of the target org, and (b) for every target collection:
// it actually belongs to that org, and the requester can write to it (org
// owners can write everywhere -- sole-admin model; non-owner members need a
// non-read-only grant on every target collection). A stranger to org Y must
// never be able to make org-Y-owned data, and a member must never be able to
// smuggle a cipher into a collection they can't write (or one from a
// different org entirely). Single-sourced here so handleCreateCipher and
// handleShareCipher can't drift out of sync on this logic.
async function requireOrgCipherWriteAccess(
  storage: StorageService,
  userId: string,
  organizationId: string,
  collectionIds: string[]
): Promise<{ orgUser: OrganizationUser } | { errorResponse: Response }> {
  const orgUser = await storage.getOrgUserByOrgAndUser(organizationId, userId);
  if (!orgUser || orgUser.status !== 'confirmed') {
    return { errorResponse: errorResponse('Cipher not found', 404) };
  }

  if (collectionIds.length > 0) {
    const collections = await Promise.all(
      collectionIds.map((cid) => storage.getCollection(cid))
    );
    for (const collection of collections) {
      if (!collection || collection.orgId !== organizationId) {
        return { errorResponse: errorResponse('Invalid collection', 400) };
      }
    }

    // Owners always have write access to every collection in their org
    // (sole-admin model). Non-owner members need a non-read-only grant on
    // every target collection.
    if (orgUser.role !== 'owner') {
      const memberCollections = await storage.listCollectionsForMember(orgUser.id);
      const writableCollectionIds = new Set(
        memberCollections.filter((entry) => !entry.readOnly).map((entry) => entry.collection.id)
      );
      const canWriteAllTargets = collectionIds.every((cid) => writableCollectionIds.has(cid));
      if (!canWriteAllTargets) {
        return { errorResponse: errorResponse('Insufficient collection permissions', 403) };
      }
    }
  }

  return { orgUser };
}

// POST /api/ciphers
export async function handleCreateCipher(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  // Handle nested cipher object (from some clients)
  // Android client sends PascalCase "Cipher" for organization ciphers
  const cipherData = body.Cipher || body.cipher || body;
  const createFolderId = readCipherProp<string | null>(cipherData, ['folderId', 'FolderId']);
  const createKey = readCipherProp<string | null>(cipherData, ['key', 'Key']);
  const createLogin = readCipherProp<CipherLogin | null>(cipherData, ['login', 'Login']);
  const createCard = readCipherProp<CipherCard | null>(cipherData, ['card', 'Card']);
  const createIdentity = readCipherProp<CipherIdentity | null>(cipherData, ['identity', 'Identity']);
  const createSecureNote = readCipherProp<CipherSecureNote | null>(cipherData, ['secureNote', 'SecureNote']);
  const createSshKey = readCipherProp<CipherSshKey | null>(cipherData, ['sshKey', 'SshKey']);
  const createBankAccount = readCipherProp<CipherBankAccount | null>(cipherData, ['bankAccount', 'BankAccount']);
  const createDriversLicense = readCipherProp<CipherDriversLicense | null>(cipherData, ['driversLicense', 'DriversLicense']);
  const createPassport = readCipherProp<CipherPassport | null>(cipherData, ['passport', 'Passport']);
  const createApiKey = readCipherProp<CipherApiKey | null>(cipherData, ['apiKey', 'ApiKey']);
  const createPasswordHistory = readCipherProp<PasswordHistory[] | null>(cipherData, ['passwordHistory', 'PasswordHistory']);
  // SECURITY: organizationId/collectionIds are client-supplied input on create.
  // If unvalidated, a user with no membership in org Y could POST
  // {organizationId: "org-Y"} and have it persist as an org-Y cipher (Task 1
  // review finding). Read the intent here; validate below before persisting.
  const createOrganizationId = readCipherProp<string | null>(cipherData, ['organizationId', 'OrganizationId']);
  const requestedOrganizationId = normalizeOptionalId(
    createOrganizationId.present ? createOrganizationId.value : null
  );
  // SECURITY/CORRECTNESS: collectionIds lives at the TOP LEVEL of the request
  // body ({ cipher: {...}, collectionIds: [...] }), never nested inside the
  // cipher object itself -- matching handleShareCipher's already-correct
  // `readCipherProp(body, [...])` read (see ~line 1303). When the client
  // sends the unwrapped shape (no `cipher`/`Cipher` wrapper), cipherData ===
  // body anyway, so reading from `body` is correct in both cases. Reading
  // from `cipherData` here previously silently dropped collectionIds
  // whenever the client used the wrapped shape (the shape official Bitwarden
  // clients actually send), leaving the org cipher created but unassigned to
  // any collection -- unreachable to every non-owner member.
  const createCollectionIds = readCipherProp<string[] | null>(body, ['collectionIds', 'CollectionIds']);
  const requestedCollectionIds = Array.isArray(createCollectionIds.value)
    ? Array.from(new Set(createCollectionIds.value.map((cid) => String(cid || '').trim()).filter(Boolean)))
    : [];

  if (createKey.present && !shouldAcceptCipherKey(createKey.value)) {
    return errorResponse('Cipher key encryption is not supported by this server. Resync the client and try again.', 400);
  }

  const now = new Date().toISOString();
  // Opaque passthrough: spread ALL client fields to preserve unknown/future ones,
  // then override only server-controlled fields.
  const cipher: Cipher = {
    ...cipherData,
    // Server-controlled fields (always override client values)
    id: generateUUID(),
    userId: userId,
    // Validated below, never the raw client value.
    organizationId: requestedOrganizationId,
    type: Number(cipherData.type) || 1,
    favorite: !!cipherData.favorite,
    reprompt: cipherData.reprompt || 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: readCipherArchivedAt(cipherData, null),
    deletedAt: null,
  };
  cipher.folderId = createFolderId.present ? normalizeOptionalId(createFolderId.value) : normalizeOptionalId(cipher.folderId);
  cipher.key = normalizeCipherKeyForStorage(createKey.present ? createKey.value : cipher.key);
  cipher.login = createLogin.present ? (createLogin.value ?? null) : (cipher.login ?? null);
  cipher.card = createCard.present ? (createCard.value ?? null) : (cipher.card ?? null);
  cipher.identity = createIdentity.present ? (createIdentity.value ?? null) : (cipher.identity ?? null);
  cipher.secureNote = createSecureNote.present ? (createSecureNote.value ?? null) : (cipher.secureNote ?? null);
  cipher.sshKey = createSshKey.present ? (createSshKey.value ?? null) : (cipher.sshKey ?? null);
  cipher.bankAccount = createBankAccount.present ? (createBankAccount.value ?? null) : ((cipher as any).bankAccount ?? null);
  cipher.driversLicense = createDriversLicense.present ? (createDriversLicense.value ?? null) : ((cipher as any).driversLicense ?? null);
  cipher.passport = createPassport.present ? (createPassport.value ?? null) : ((cipher as any).passport ?? null);
  cipher.apiKey = createApiKey.present ? (createApiKey.value ?? null) : ((cipher as any).apiKey ?? null);
  cipher.passwordHistory = createPasswordHistory.present ? (createPasswordHistory.value ?? null) : (cipher.passwordHistory ?? null);
  const createFields = getAliasedProp(cipherData, ['fields', 'Fields']);
  cipher.fields = createFields.present ? (createFields.value ?? null) : (cipher.fields ?? null);
  normalizeCipherForStorage(cipher);
  const compatibilityError = validateCipherEncryptedFieldsForCompatibility(cipher);
  if (compatibilityError) return errorResponse(compatibilityError, 400);

  // Prevent referencing a folder owned by another user.
  if (cipher.folderId) {
    const folderOk = await verifyFolderOwnership(storage, cipher.folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  // SECURITY (Task 1 review finding): a non-null organizationId means this is
  // an org cipher — validate membership, collection org-consistency, and
  // write access to every target collection before persisting. A stranger
  // to org Y must never be able to make org-Y-owned data.
  if (requestedOrganizationId) {
    const access = await requireOrgCipherWriteAccess(storage, userId, requestedOrganizationId, requestedCollectionIds);
    if ('errorResponse' in access) return access.errorResponse;

    // A non-owner member with no target collection would create an org
    // cipher it immediately can't read or write itself (canRead/canWriteCipher
    // require a granted collection for non-owners) — only the owner could
    // ever reach it again. Require at least one target collection for
    // non-owner creators; owners may create unassigned (owner-bypass gives
    // them access regardless of collections).
    if (access.orgUser.role !== 'owner' && requestedCollectionIds.length === 0) {
      return errorResponse('An organization member must assign the item to at least one collection', 400);
    }

    cipher.collectionIds = requestedCollectionIds;
  }

  await storage.saveCipher(cipher);
  if (requestedOrganizationId && requestedCollectionIds.length > 0) {
    await storage.addCipherToCollections(cipher.id, requestedCollectionIds);
  }
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherCreateForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }
  const responseOptions = cipherResponseOptionsForRequest(request);

  return jsonResponse(
    cipherToResponse(cipher, [], responseOptions),
    200
  );
}

// PUT /api/ciphers/:id
export async function handleUpdateCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const existingCipher = await storage.getCipher(id);

  if (!existingCipher || !(await canWriteCipher(storage, userId, existingCipher))) {
    return errorResponse('Cipher not found', 404);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  // Handle nested cipher object
  // Android client sends PascalCase "Cipher" for organization ciphers
  const cipherData = body.Cipher || body.cipher || body;
  const incomingFolderId = readCipherProp<string | null>(cipherData, ['folderId', 'FolderId']);
  const incomingKey = readCipherProp<string | null>(cipherData, ['key', 'Key']);
  const incomingLogin = readCipherProp<CipherLogin | null>(cipherData, ['login', 'Login']);
  const incomingCard = readCipherProp<CipherCard | null>(cipherData, ['card', 'Card']);
  const incomingIdentity = readCipherProp<CipherIdentity | null>(cipherData, ['identity', 'Identity']);
  const incomingSecureNote = readCipherProp<CipherSecureNote | null>(cipherData, ['secureNote', 'SecureNote']);
  const incomingSshKey = readCipherProp<CipherSshKey | null>(cipherData, ['sshKey', 'SshKey']);
  const incomingBankAccount = readCipherProp<CipherBankAccount | null>(cipherData, ['bankAccount', 'BankAccount']);
  const incomingDriversLicense = readCipherProp<CipherDriversLicense | null>(cipherData, ['driversLicense', 'DriversLicense']);
  const incomingPassport = readCipherProp<CipherPassport | null>(cipherData, ['passport', 'Passport']);
  const incomingApiKey = readCipherProp<CipherApiKey | null>(cipherData, ['apiKey', 'ApiKey']);
  const incomingPasswordHistory = readCipherProp<PasswordHistory[] | null>(cipherData, ['passwordHistory', 'PasswordHistory']);
  const incomingRevisionDate = readCipherRevisionDate(cipherData);
  const hasAttachmentMigrationMetadata = hasIncomingAttachmentMetadata(cipherData);
  const preserveRevisionDate =
    shouldPreserveRepairableCipherUris(request)
    && (body.preserveRevisionDate === true || cipherData.preserveRevisionDate === true);

  if (incomingKey.present && !shouldAcceptCipherKey(incomingKey.value)) {
    return errorResponse('Cipher key encryption is not supported by this server. Resync the client and try again.', 400);
  }

  if (!hasAttachmentMigrationMetadata && isStaleCipherUpdate(existingCipher.updatedAt, incomingRevisionDate)) {
    return errorResponse('The client copy of this cipher is out of date. Resync the client and try again.', 400);
  }

  const nextType = Number(cipherData.type) || existingCipher.type;

  // Opaque passthrough: merge existing stored data with ALL incoming client fields.
  // Unknown/future fields from the client are preserved; server-controlled fields are protected.
  const { preserveRevisionDate: _preserveRevisionDate, PreserveRevisionDate: _pascalPreserveRevisionDate, ...cipherDataWithoutFlags } = cipherData;
  const cipher: Cipher = {
    ...existingCipher,   // start with all existing stored data (including unknowns)
    ...cipherDataWithoutFlags, // overlay all client data (including new/unknown fields)
    // Server-controlled fields (never from client)
    id: existingCipher.id,
    userId: existingCipher.userId,
    // A plain update must NOT be able to move a cipher into/out of/between
    // orgs — that's the /share endpoint's job. Force it to the existing
    // value so a spoofed body organizationId is ignored.
    organizationId: existingCipher.organizationId,
    type: nextType,
    favorite: cipherData.favorite ?? existingCipher.favorite,
    reprompt: cipherData.reprompt ?? existingCipher.reprompt,
    createdAt: existingCipher.createdAt,
    updatedAt: preserveRevisionDate ? existingCipher.updatedAt : new Date().toISOString(),
    archivedAt: readCipherArchivedAt(cipherData, existingCipher.archivedAt ?? null),
    deletedAt: existingCipher.deletedAt,
  };
  if (cipher.organizationId) {
    // Org ciphers have no personal-folder concept (one folder_id column tied
    // to the creator's user_id can't be shared coherently across members).
    // Never carry the creator's personal folder onto an org cipher -- org
    // ciphers use collections for organization instead.
    cipher.folderId = null;
  } else if (incomingFolderId.present) {
    cipher.folderId = normalizeOptionalId(incomingFolderId.value);
  }
  if (incomingKey.present) {
    const normalizedIncomingKey = normalizeCipherKeyForStorage(incomingKey.value);
    cipher.key = normalizedIncomingKey || normalizeCipherKeyForStorage(existingCipher.key);
  } else {
    cipher.key = normalizeCipherKeyForStorage(existingCipher.key);
  }
  cipher.login = nextType === 1 ? (incomingLogin.present ? (incomingLogin.value ?? null) : (existingCipher.login ?? null)) : null;
  cipher.secureNote = nextType === 2 ? (incomingSecureNote.present ? (incomingSecureNote.value ?? null) : (existingCipher.secureNote ?? null)) : null;
  cipher.card = nextType === 3 ? (incomingCard.present ? (incomingCard.value ?? null) : (existingCipher.card ?? null)) : null;
  cipher.identity = nextType === 4 ? (incomingIdentity.present ? (incomingIdentity.value ?? null) : (existingCipher.identity ?? null)) : null;
  cipher.sshKey = nextType === 5 ? (incomingSshKey.present ? (incomingSshKey.value ?? null) : (existingCipher.sshKey ?? null)) : null;
  cipher.bankAccount = nextType === 6 ? (incomingBankAccount.present ? (incomingBankAccount.value ?? null) : ((existingCipher as any).bankAccount ?? null)) : null;
  cipher.driversLicense = nextType === 7 ? (incomingDriversLicense.present ? (incomingDriversLicense.value ?? null) : ((existingCipher as any).driversLicense ?? null)) : null;
  cipher.passport = nextType === 8 ? (incomingPassport.present ? (incomingPassport.value ?? null) : ((existingCipher as any).passport ?? null)) : null;
  cipher.apiKey = nextType === 9 ? (incomingApiKey.present ? (incomingApiKey.value ?? null) : ((existingCipher as any).apiKey ?? null)) : null;
  if (incomingPasswordHistory.present) {
    cipher.passwordHistory = incomingPasswordHistory.value ?? null;
  }

  // Custom fields deletion compatibility:
  // - Accept both camelCase "fields" and PascalCase "Fields".
  // - For full update (PUT/POST on this endpoint), missing fields means cleared fields.
  //   This prevents stale custom fields from being resurrected by merge fallback.
  const incomingFields = getAliasedProp(cipherData, ['fields', 'Fields']);
  if (incomingFields.present) {
    cipher.fields = incomingFields.value ?? null;
  } else if (request.method === 'PUT' || request.method === 'POST') {
    cipher.fields = null;
  }
  normalizeCipherForStorage(cipher);
  const compatibilityError = validateCipherEncryptedFieldsForCompatibility(cipher);
  if (compatibilityError) return errorResponse(compatibilityError, 400);

  // Prevent referencing a folder owned by another user. Org ciphers never
  // carry a folderId (forced null above) and skip this personal-folder
  // ownership check entirely -- otherwise it would spuriously 404 a
  // non-creator org writer, since verifyFolderOwnership only recognizes the
  // ORIGINAL CREATOR's personal folder, not the acting org member's.
  if (!cipher.organizationId && cipher.folderId) {
    const folderOk = await verifyFolderOwnership(storage, cipher.folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  await syncIncomingAttachmentMetadata(storage, cipher.id, cipherData);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherUpdateForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }
  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  const responseOptions = cipherResponseOptionsForRequest(request);

  return jsonResponse(
    cipherToResponse(cipher, attachments, responseOptions)
  );
}

// POST /api/ciphers/:id/share
// Bitwarden's share payload: { cipher: { ...fields, organizationId }, collectionIds: [...] }.
// Moves a cipher the requester can currently write (typically their own personal
// cipher) into an org, persisting the client's re-encrypted-under-the-org-key
// cipher data and assigning it to the given collections. Ownership (user_id, the
// original creator) is never changed by a share -- only organizationId and
// collection membership move.
export async function handleShareCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const existingCipher = await storage.getCipher(id);

  // The requester must be able to write the cipher AS IT STANDS TODAY. For the
  // common case (a personal cipher, organizationId === null) canWriteCipher
  // reduces to "you are the owner" -- you can only share what you own.
  if (!existingCipher || !(await canWriteCipher(storage, userId, existingCipher))) {
    return errorResponse('Cipher not found', 404);
  }

  // SECURITY: Bitwarden's /share only ever moves a PERSONAL cipher into an
  // org. Reject reshare of a cipher that already belongs to an org (moving
  // Org A -> Org B). Reshare would move `organization_id` to the new org but
  // leave the OLD org's `cipher_collections` row behind (addCipherToCollections
  // only INSERTs the new grant; nothing here deletes the stale one) -- a
  // cross-tenant leak where Org A members keep seeing a cipher that now
  // belongs to Org B. getOrgCiphersForMember is hardened as a second,
  // independent layer against exactly this (see storage-cipher-repo.ts), but
  // this guard stops the stale row from ever being created in the first place.
  if (existingCipher.organizationId) {
    return errorResponse('Cipher already belongs to an organization', 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  // Android sends PascalCase "Cipher"/"CollectionIds" for org payloads, matching
  // the alias convention already used throughout this file.
  const cipherData = body.Cipher || body.cipher || {};
  const shareCollectionIds = readCipherProp<string[] | null>(body, ['collectionIds', 'CollectionIds']);
  const requestedCollectionIds = Array.isArray(shareCollectionIds.value)
    ? Array.from(new Set(shareCollectionIds.value.map((cid) => String(cid || '').trim()).filter(Boolean)))
    : [];

  const shareOrganizationId = readCipherProp<string | null>(cipherData, ['organizationId', 'OrganizationId']);
  const targetOrganizationId = normalizeOptionalId(
    shareOrganizationId.present ? shareOrganizationId.value : null
  );
  // Sharing REQUIRES a target org -- this endpoint's entire purpose is moving
  // a cipher into one.
  if (!targetOrganizationId) {
    return errorResponse('An organization is required to share a cipher.', 400);
  }

  // An org cipher with no collections would be unreachable to anyone but the
  // org owner (same invariant Task 3's create-time validation enforces) --
  // require at least one target collection for every share, regardless of role.
  if (!requestedCollectionIds.length) {
    return errorResponse('Invalid collection', 400);
  }

  // Same chokepoint handleCreateCipher uses for org-cipher validation:
  // confirmed membership + every collection belongs to the target org + the
  // requester can write to each one.
  const access = await requireOrgCipherWriteAccess(storage, userId, targetOrganizationId, requestedCollectionIds);
  if ('errorResponse' in access) return access.errorResponse;

  const incomingKey = readCipherProp<string | null>(cipherData, ['key', 'Key']);
  if (incomingKey.present && !shouldAcceptCipherKey(incomingKey.value)) {
    return errorResponse('Cipher key encryption is not supported by this server. Resync the client and try again.', 400);
  }

  const incomingFolderId = readCipherProp<string | null>(cipherData, ['folderId', 'FolderId']);
  const incomingLogin = readCipherProp<CipherLogin | null>(cipherData, ['login', 'Login']);
  const incomingCard = readCipherProp<CipherCard | null>(cipherData, ['card', 'Card']);
  const incomingIdentity = readCipherProp<CipherIdentity | null>(cipherData, ['identity', 'Identity']);
  const incomingSecureNote = readCipherProp<CipherSecureNote | null>(cipherData, ['secureNote', 'SecureNote']);
  const incomingSshKey = readCipherProp<CipherSshKey | null>(cipherData, ['sshKey', 'SshKey']);
  const incomingBankAccount = readCipherProp<CipherBankAccount | null>(cipherData, ['bankAccount', 'BankAccount']);
  const incomingDriversLicense = readCipherProp<CipherDriversLicense | null>(cipherData, ['driversLicense', 'DriversLicense']);
  const incomingPassport = readCipherProp<CipherPassport | null>(cipherData, ['passport', 'Passport']);
  const incomingPasswordHistory = readCipherProp<PasswordHistory[] | null>(cipherData, ['passwordHistory', 'PasswordHistory']);
  const nextType = Number(cipherData.type) || existingCipher.type;

  // Opaque passthrough merge (same shape as handleUpdateCipher): start from the
  // existing stored cipher, overlay the client's re-encrypted fields, then force
  // the server-controlled fields -- most importantly organizationId (the whole
  // point of this endpoint) and userId (ownership invariant: sharing never
  // changes who created the cipher).
  const cipher: Cipher = {
    ...existingCipher,
    ...cipherData,
    id: existingCipher.id,
    userId: existingCipher.userId,
    organizationId: targetOrganizationId,
    type: nextType,
    favorite: cipherData.favorite ?? existingCipher.favorite,
    reprompt: cipherData.reprompt ?? existingCipher.reprompt,
    createdAt: existingCipher.createdAt,
    updatedAt: new Date().toISOString(),
    archivedAt: existingCipher.archivedAt ?? null,
    deletedAt: existingCipher.deletedAt,
  };
  if (incomingFolderId.present) {
    cipher.folderId = normalizeOptionalId(incomingFolderId.value);
  }
  if (incomingKey.present) {
    const normalizedIncomingKey = normalizeCipherKeyForStorage(incomingKey.value);
    cipher.key = normalizedIncomingKey || normalizeCipherKeyForStorage(existingCipher.key);
  } else {
    cipher.key = normalizeCipherKeyForStorage(existingCipher.key);
  }
  cipher.login = nextType === 1 ? (incomingLogin.present ? (incomingLogin.value ?? null) : (existingCipher.login ?? null)) : null;
  cipher.secureNote = nextType === 2 ? (incomingSecureNote.present ? (incomingSecureNote.value ?? null) : (existingCipher.secureNote ?? null)) : null;
  cipher.card = nextType === 3 ? (incomingCard.present ? (incomingCard.value ?? null) : (existingCipher.card ?? null)) : null;
  cipher.identity = nextType === 4 ? (incomingIdentity.present ? (incomingIdentity.value ?? null) : (existingCipher.identity ?? null)) : null;
  cipher.sshKey = nextType === 5 ? (incomingSshKey.present ? (incomingSshKey.value ?? null) : (existingCipher.sshKey ?? null)) : null;
  cipher.bankAccount = nextType === 6 ? (incomingBankAccount.present ? (incomingBankAccount.value ?? null) : ((existingCipher as any).bankAccount ?? null)) : null;
  cipher.driversLicense = nextType === 7 ? (incomingDriversLicense.present ? (incomingDriversLicense.value ?? null) : ((existingCipher as any).driversLicense ?? null)) : null;
  cipher.passport = nextType === 8 ? (incomingPassport.present ? (incomingPassport.value ?? null) : ((existingCipher as any).passport ?? null)) : null;
  if (incomingPasswordHistory.present) {
    cipher.passwordHistory = incomingPasswordHistory.value ?? null;
  }

  const incomingFields = getAliasedProp(cipherData, ['fields', 'Fields']);
  if (incomingFields.present) {
    cipher.fields = incomingFields.value ?? null;
  }

  cipher.collectionIds = requestedCollectionIds;
  normalizeCipherForStorage(cipher);
  const compatibilityError = validateCipherEncryptedFieldsForCompatibility(cipher);
  if (compatibilityError) return errorResponse(compatibilityError, 400);

  // Prevent referencing a folder owned by another user.
  if (cipher.folderId) {
    const folderOk = await verifyFolderOwnership(storage, cipher.folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  await storage.saveCipher(cipher);
  // Org attachments follow automatically -- they FK to cipher_id, not
  // organization_id, so no attachment-specific migration is needed here.
  await storage.addCipherToCollections(cipher.id, requestedCollectionIds);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherUpdateForRequest(request, env, cipher, revisionDate);
  // Every confirmed member of the target org (not just the acting user) needs
  // their sync revision bumped and pushed, or their client won't see the
  // newly-shared item.
  await notifyOrgCipherChange(env, storage, [targetOrganizationId], readActingDeviceIdentifier(request));

  await writeCipherAudit(storage, request, userId, 'cipher.share', {
    id: cipher.id,
    organizationId: targetOrganizationId,
    collectionIds: requestedCollectionIds,
  });

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  return jsonResponse(
    cipherToResponse(cipher, attachments, cipherResponseOptionsForRequest(request))
  );
}

// PUT /api/ciphers/:id/collections
// Replace the set of collections an EXISTING org cipher belongs to. Unlike
// /share (personal -> org move), the cipher already belongs to an org here and
// its organizationId never changes; only cipher_collections membership is
// rewritten (replace-semantics, so stale rows are removed).
export async function handleUpdateCipherCollections(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const existingCipher = await storage.getCipher(id);

  // Must be able to write the cipher as it stands today (owner or non-read-only grant).
  if (!existingCipher || !(await canWriteCipher(storage, userId, existingCipher))) {
    return errorResponse('Cipher not found', 404);
  }
  // This endpoint only makes sense for org ciphers; a personal cipher has no collections.
  if (!existingCipher.organizationId) {
    return errorResponse('Cipher is not in an organization', 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  const rawCollectionIds = readCipherProp<string[] | null>(body, ['collectionIds', 'CollectionIds']);
  const requestedCollectionIds = Array.isArray(rawCollectionIds.value)
    ? Array.from(new Set(rawCollectionIds.value.map((cid) => String(cid || '').trim()).filter(Boolean)))
    : [];

  // Confirmed membership + every target collection belongs to THIS org + writer can write each.
  const access = await requireOrgCipherWriteAccess(storage, userId, existingCipher.organizationId, requestedCollectionIds);
  if ('errorResponse' in access) return access.errorResponse;

  // Rewrite junction rows (replace-semantics) and keep the cipher's own
  // collectionIds field (stored in its data blob) in sync so getCipher doesn't drift.
  await storage.setCipherCollections(existingCipher.id, requestedCollectionIds);
  const updatedCipher: Cipher = { ...existingCipher, collectionIds: requestedCollectionIds };
  await storage.saveCipher(updatedCipher);

  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  await notifyOrgCipherChange(env, storage, [existingCipher.organizationId], readActingDeviceIdentifier(request));

  await writeCipherAudit(storage, request, userId, 'cipher.collections', {
    id: updatedCipher.id,
    organizationId: existingCipher.organizationId,
    collectionIds: requestedCollectionIds,
  });

  const attachments = await storage.getAttachmentsByCipher(updatedCipher.id);
  return jsonResponse(cipherToResponse(updatedCipher, attachments, cipherResponseOptionsForRequest(request)));
}

// DELETE /api/ciphers/:id
export async function handleDeleteCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  // Soft delete
  cipher.deletedAt = new Date().toISOString();
  cipher.updatedAt = cipher.deletedAt;
  syncCipherComputedAliases(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherDeleteForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }
  await writeCipherAudit(storage, request, userId, 'cipher.delete.soft', {
    id: cipher.id,
    type: cipher.type,
    folderId: cipher.folderId ?? null,
  });

  return jsonResponse(
    cipherToResponse(cipher, [], cipherResponseOptionsForRequest(request))
  );
}

// DELETE /api/ciphers/:id (compat mode)
// Bitwarden clients may call DELETE on a trashed item to purge it permanently.
// For compatibility:
// - If item is active -> soft delete.
// - If item is already soft-deleted -> hard delete.
export async function handleDeleteCipherCompat(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  if (cipher.deletedAt) {
    await deleteAllAttachmentsForCipher(env, id);
    // storage.deleteCipher scopes its DELETE by owning user_id — for an org
    // cipher the actor (userId) may be a confirmed owner/writer who is NOT
    // the cipher's creator, so this must use the cipher's own owner id, not
    // the acting user's id, or the row silently survives (0 rows deleted)
    // while the handler still reports success.
    await storage.deleteCipher(id, cipher.userId);
    const revisionDate = await storage.updateRevisionDate(userId);
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
    notifyCipherDeleteForRequest(request, env, cipher, revisionDate);
    if (cipher.organizationId) {
      await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
    }
    await writeCipherAudit(storage, request, userId, 'cipher.delete.permanent', {
      id,
      type: cipher.type,
      folderId: cipher.folderId ?? null,
      compat: true,
    });
    return new Response(null, { status: 204 });
  }

  return handleDeleteCipher(request, env, userId, id);
}

// DELETE /api/ciphers/:id (permanent)
export async function handlePermanentDeleteCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  // Delete all attachments first
  await deleteAllAttachmentsForCipher(env, id);

  // See handleDeleteCipherCompat: must use the cipher's owner id, not the
  // acting user's id, so a confirmed org owner/writer permanently deleting
  // someone else's org cipher actually removes the row.
  await storage.deleteCipher(id, cipher.userId);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherDeleteForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }
  await writeCipherAudit(storage, request, userId, 'cipher.delete.permanent', {
    id,
    type: cipher.type,
    folderId: cipher.folderId ?? null,
  });

  return new Response(null, { status: 204 });
}

// PUT /api/ciphers/:id/restore
export async function handleRestoreCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  cipher.deletedAt = null;
  cipher.updatedAt = new Date().toISOString();
  syncCipherComputedAliases(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherUpdateForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }

  return jsonResponse(
    cipherToResponse(cipher, [], cipherResponseOptionsForRequest(request))
  );
}

// PUT /api/ciphers/:id/partial - Update only favorite/folderId
export async function handlePartialUpdateCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  let body: { folderId?: string | null; favorite?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (body.folderId !== undefined) {
    const folderId = normalizeOptionalId(body.folderId);
    if (folderId) {
      const folderOk = await verifyFolderOwnership(storage, folderId, userId);
      if (!folderOk) return errorResponse('Folder not found', 404);
    }
    cipher.folderId = folderId;
  }
  if (body.favorite !== undefined) {
    cipher.favorite = body.favorite;
  }
  cipher.updatedAt = new Date().toISOString();
  syncCipherComputedAliases(cipher);

  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherUpdateForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }

  return jsonResponse(
    cipherToResponse(cipher, [], cipherResponseOptionsForRequest(request))
  );
}

// Bulk cipher endpoints take a flat id list from the client, but the
// per-id chokepoint is canWriteCipher(storage, userId, cipher) -- and it
// needs an actual Cipher, not just an id. storage.getCiphersByIds(ids, userId)
// can't be used to load them: it's personal-vault scoped (`WHERE user_id = ?`)
// and will never return an org cipher the caller only has access to via a
// collection grant. Load each id individually via storage.getCipher(id)
// (unscoped by owner) instead, then gate it. Ids that don't exist, or that
// the caller can't write to, are silently dropped from the batch rather than
// failing the whole request -- this matches Bitwarden's bulk endpoint
// semantics of "apply to whatever subset you're allowed to touch."
async function loadAuthorizedCiphersForBulkWrite(
  storage: StorageService,
  userId: string,
  ids: string[]
): Promise<Cipher[]> {
  const loaded = await Promise.all(ids.map((id) => storage.getCipher(id)));
  const authorized: Cipher[] = [];
  for (const cipher of loaded) {
    if (cipher && (await canWriteCipher(storage, userId, cipher))) {
      authorized.push(cipher);
    }
  }
  return authorized;
}

// The underlying bulk storage mutations (bulkSoftDeleteCiphers,
// bulkArchiveCiphers, bulkMoveCiphers, ...) filter `WHERE user_id = ? AND id
// IN (...)`, scoped to whichever userId is passed in -- not to the acting
// caller. For a personal cipher the owner and the acting caller are the same
// person, so this is a no-op distinction. But for an org cipher created by a
// teammate, cipher.userId (the creator) differs from the acting userId (an
// owner/writer acting via a collection grant); calling the bulk mutation
// scoped to the ACTING userId would match zero rows and silently no-op on
// exactly the ciphers this task exists to fix. Group the authorized ciphers
// by their owning user id and issue one bulk call per owner group instead,
// so each group's storage call is scoped to the id that actually owns those
// rows and the mutation lands.
function groupCipherIdsByOwner(ciphers: Cipher[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const cipher of ciphers) {
    const list = grouped.get(cipher.userId);
    if (list) {
      list.push(cipher.id);
    } else {
      grouped.set(cipher.userId, [cipher.id]);
    }
  }
  return grouped;
}

// POST/PUT /api/ciphers/move - Bulk move to folder
export async function handleBulkMoveCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[]; folderId?: string | null };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  const folderId = normalizeOptionalId(body.folderId);
  if (folderId) {
    const folderOk = await verifyFolderOwnership(storage, folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  const ids = Array.from(new Set(body.ids.map((id) => String(id || '').trim()).filter(Boolean)));
  // Folder assignment is inherently personal: a folder belongs to a single
  // user (verified above), and org ciphers accessed via a collection grant
  // can still be filed into the acting user's own folders. Gate on write
  // access (see loadAuthorizedCiphersForBulkWrite for the skip behavior);
  // org/collection assignment itself is out of scope here (see Task 6).
  const authorizedCiphers = await loadAuthorizedCiphersForBulkWrite(storage, userId, ids);
  if (!authorizedCiphers.length) {
    return new Response(null, { status: 204 });
  }

  for (const [ownerId, ownerCipherIds] of groupCipherIdsByOwner(authorizedCiphers)) {
    await storage.bulkMoveCiphers(ownerCipherIds, folderId, ownerId);
  }
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  await notifyOrgCipherChange(
    env,
    storage,
    authorizedCiphers.map((cipher) => cipher.organizationId),
    readActingDeviceIdentifier(request)
  );

  return new Response(null, { status: 204 });
}

async function buildCipherListResponse(
  request: Request,
  storage: StorageService,
  userId: string,
  ids: string[]
): Promise<Response> {
  // storage.getCiphersByIds is personal-scoped (WHERE user_id = ?) and would
  // silently drop org ciphers the caller can only reach via a collection
  // grant/owner-bypass -- exactly the ciphers a bulk archive/unarchive call
  // may have just touched. Resolve each id individually via storage.getCipher
  // and gate through canReadCipher instead, so those ciphers round-trip in
  // the response.
  const loaded = await Promise.all(ids.map((id) => storage.getCipher(id)));
  const ciphers: Cipher[] = [];
  for (const cipher of loaded) {
    if (cipher && (await canReadCipher(storage, userId, cipher))) {
      ciphers.push(cipher);
    }
  }
  const attachmentsByCipher = await storage.getAttachmentsByCipherIds(ciphers.map((cipher) => cipher.id));

  return jsonResponse({
    data: ciphers.map((cipher) =>
      cipherToResponse(cipher, attachmentsByCipher.get(cipher.id) || [], cipherResponseOptionsForRequest(request))
    ),
    object: 'list',
    continuationToken: null,
  });
}

function parseCipherIdList(body: { ids?: unknown }): string[] | null {
  if (!Array.isArray(body.ids)) return null;
  return Array.from(new Set(body.ids.map((id) => String(id || '').trim()).filter(Boolean)));
}

// PUT/POST /api/ciphers/:id/archive
export async function handleArchiveCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }
  if (cipher.deletedAt) {
    return errorResponse('Cannot archive a deleted cipher', 400);
  }

  cipher.archivedAt = new Date().toISOString();
  cipher.updatedAt = cipher.archivedAt;
  normalizeCipherForStorage(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyCipherUpdateForRequest(request, env, cipher, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  return jsonResponse(
    cipherToResponse(cipher, attachments, cipherResponseOptionsForRequest(request))
  );
}

// PUT/POST /api/ciphers/:id/unarchive
export async function handleUnarchiveCipher(request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || !(await canWriteCipher(storage, userId, cipher))) {
    return errorResponse('Cipher not found', 404);
  }

  cipher.archivedAt = null;
  cipher.updatedAt = new Date().toISOString();
  normalizeCipherForStorage(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  if (cipher.organizationId) {
    await notifyOrgCipherChange(env, storage, [cipher.organizationId], readActingDeviceIdentifier(request));
  }

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  return jsonResponse(
    cipherToResponse(cipher, attachments, cipherResponseOptionsForRequest(request))
  );
}

// PUT/POST /api/ciphers/archive
export async function handleBulkArchiveCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const ids = parseCipherIdList(body);
  if (!ids) {
    return errorResponse('ids array is required', 400);
  }

  // See loadAuthorizedCiphersForBulkWrite: ids the caller can't write to are
  // silently skipped rather than failing the whole request.
  const authorizedCiphers = await loadAuthorizedCiphersForBulkWrite(storage, userId, ids);
  if (authorizedCiphers.length) {
    for (const [ownerId, ownerCipherIds] of groupCipherIdsByOwner(authorizedCiphers)) {
      await storage.bulkArchiveCiphers(ownerCipherIds, ownerId);
    }
    const revisionDate = await storage.updateRevisionDate(userId);
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
    notifyUserCiphersSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
    await notifyOrgCipherChange(
      env,
      storage,
      authorizedCiphers.map((cipher) => cipher.organizationId),
      readActingDeviceIdentifier(request)
    );
  }

  return buildCipherListResponse(request, storage, userId, ids);
}

// PUT/POST /api/ciphers/unarchive
export async function handleBulkUnarchiveCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const ids = parseCipherIdList(body);
  if (!ids) {
    return errorResponse('ids array is required', 400);
  }

  // See loadAuthorizedCiphersForBulkWrite: ids the caller can't write to are
  // silently skipped rather than failing the whole request.
  const authorizedCiphers = await loadAuthorizedCiphersForBulkWrite(storage, userId, ids);
  if (authorizedCiphers.length) {
    for (const [ownerId, ownerCipherIds] of groupCipherIdsByOwner(authorizedCiphers)) {
      await storage.bulkUnarchiveCiphers(ownerCipherIds, ownerId);
    }
    const revisionDate = await storage.updateRevisionDate(userId);
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
    notifyUserCiphersSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
    await notifyOrgCipherChange(
      env,
      storage,
      authorizedCiphers.map((cipher) => cipher.organizationId),
      readActingDeviceIdentifier(request)
    );
  }

  return buildCipherListResponse(request, storage, userId, ids);
}

// POST /api/ciphers/delete - Bulk soft delete
export async function handleBulkDeleteCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  // See loadAuthorizedCiphersForBulkWrite: ids the caller can't write to are
  // silently skipped rather than failing the whole request.
  const authorizedCiphers = await loadAuthorizedCiphersForBulkWrite(storage, userId, body.ids);
  if (authorizedCiphers.length) {
    for (const [ownerId, ownerCipherIds] of groupCipherIdsByOwner(authorizedCiphers)) {
      await storage.bulkSoftDeleteCiphers(ownerCipherIds, ownerId);
    }
    const revisionDate = await storage.updateRevisionDate(userId);
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
    notifyUserCiphersSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
    await notifyOrgCipherChange(
      env,
      storage,
      authorizedCiphers.map((cipher) => cipher.organizationId),
      readActingDeviceIdentifier(request)
    );
    await writeCipherAudit(storage, request, userId, 'cipher.delete.soft.bulk', {
      count: authorizedCiphers.length,
      requestedCount: body.ids.length,
    });
  }

  return new Response(null, { status: 204 });
}

// POST /api/ciphers/restore - Bulk restore
export async function handleBulkRestoreCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  // See loadAuthorizedCiphersForBulkWrite: ids the caller can't write to are
  // silently skipped rather than failing the whole request.
  const authorizedCiphers = await loadAuthorizedCiphersForBulkWrite(storage, userId, body.ids);
  if (authorizedCiphers.length) {
    for (const [ownerId, ownerCipherIds] of groupCipherIdsByOwner(authorizedCiphers)) {
      await storage.bulkRestoreCiphers(ownerCipherIds, ownerId);
    }
    const revisionDate = await storage.updateRevisionDate(userId);
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
    notifyUserCiphersSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
    await notifyOrgCipherChange(
      env,
      storage,
      authorizedCiphers.map((cipher) => cipher.organizationId),
      readActingDeviceIdentifier(request)
    );
  }

  return new Response(null, { status: 204 });
}

// POST /api/ciphers/delete-permanent - Bulk permanent delete
export async function handleBulkPermanentDeleteCiphers(request: Request, env: Env, userId: string): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  const ids = Array.from(new Set(body.ids.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    return new Response(null, { status: 204 });
  }

  // See loadAuthorizedCiphersForBulkWrite: ids the caller can't write to are
  // silently skipped rather than failing the whole request.
  const authorizedCiphers = await loadAuthorizedCiphersForBulkWrite(storage, userId, ids);
  const authorizedIds = authorizedCiphers.map((cipher) => cipher.id);
  if (!authorizedIds.length) {
    return new Response(null, { status: 204 });
  }

  await deleteAllAttachmentsForCiphers(env, authorizedIds);

  for (const [ownerId, ownerCipherIds] of groupCipherIdsByOwner(authorizedCiphers)) {
    await storage.bulkDeleteCiphers(ownerCipherIds, ownerId);
  }
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  notifyUserCiphersSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
  await notifyOrgCipherChange(
    env,
    storage,
    authorizedCiphers.map((cipher) => cipher.organizationId),
    readActingDeviceIdentifier(request)
  );
  await writeCipherAudit(storage, request, userId, 'cipher.delete.permanent.bulk', {
    count: authorizedIds.length,
    requestedCount: ids.length,
  });

  return new Response(null, { status: 204 });
}
