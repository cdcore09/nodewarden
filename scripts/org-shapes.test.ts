import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORG_TYPE,
  ORG_STATUS,
  parseCreateOrgRequest,
  organizationToResponse,
  profileOrganizationResponse,
} from '../src/handlers/org-shapes';
import type { OrgMembership } from '../src/types';

const now = '2026-08-01T00:00:00.000Z';
const membership: OrgMembership = {
  organization: { id: 'o1', name: '2.encName|x', publicKey: 'pub', encryptedPrivateKey: '2.priv', createdAt: now, updatedAt: now },
  orgUser: { id: 'ou1', orgId: 'o1', userId: 'u1', email: 'a@b.c', role: 'owner', status: 'confirmed', encryptedOrgKey: '4.wrapped', createdAt: now, updatedAt: now },
};

test('enum mappings match Bitwarden numerics', () => {
  assert.equal(ORG_TYPE.owner, 0);
  assert.equal(ORG_TYPE.user, 2);
  assert.equal(ORG_STATUS.invited, 0);
  assert.equal(ORG_STATUS.accepted, 1);
  assert.equal(ORG_STATUS.confirmed, 2);
});

test('parseCreateOrgRequest accepts a valid official-client body and rejects garbage', () => {
  const ok = parseCreateOrgRequest({ name: '2.encName|x', key: '4.wrapped', keys: { publicKey: 'pub', encryptedPrivateKey: '2.priv' }, billingEmail: 'a@b.c', collectionName: '2.c' });
  assert.deepEqual(ok, { name: '2.encName|x', key: '4.wrapped', publicKey: 'pub', encryptedPrivateKey: '2.priv' });
  assert.ok('error' in (parseCreateOrgRequest({}) as any));
  assert.ok('error' in (parseCreateOrgRequest({ name: '', key: 'k' }) as any));
  assert.ok('error' in (parseCreateOrgRequest({ name: 'x'.repeat(1001), key: 'k' }) as any));
  assert.ok('error' in (parseCreateOrgRequest(null) as any));
});

test('profileOrganizationResponse has the client-critical fields', () => {
  const p = profileOrganizationResponse(membership) as any;
  assert.equal(p.id, 'o1');
  assert.equal(p.organizationUserId, 'ou1');
  assert.equal(p.key, '4.wrapped');
  assert.equal(p.type, 0);
  assert.equal(p.status, 2);
  assert.equal(p.enabled, true);
  assert.equal(p.hasPublicAndPrivateKeys, true);
  assert.equal(p.object, 'profileOrganization');
});

test('organizationToResponse is the full org object', () => {
  const o = organizationToResponse(membership.organization) as any;
  assert.equal(o.id, 'o1');
  assert.equal(o.name, '2.encName|x');
  assert.equal(o.object, 'organization');
  assert.equal(o.selfHost, true);
});

import { parseInviteRequest, orgUserDetailsResponse, orgUserListResponse, userPublicKeyResponse } from '../src/handlers/org-shapes';

test('parseInviteRequest normalizes, dedupes, and validates', () => {
  const ok = parseInviteRequest({ emails: [' A@B.c ', 'a@b.c', 'x@y.z'] });
  assert.deepEqual(ok, { emails: ['a@b.c', 'x@y.z'] });
  assert.ok('error' in (parseInviteRequest({ emails: [] }) as any));
  assert.ok('error' in (parseInviteRequest({ emails: ['nope'] }) as any));
  assert.ok('error' in (parseInviteRequest({}) as any));
  assert.ok('error' in (parseInviteRequest({ emails: Array.from({ length: 21 }, (_, i) => `a${i}@b.c`) }) as any));
});

test('orgUserDetailsResponse maps enums and tolerates a missing user row', () => {
  const detail = orgUserDetailsResponse(membership.orgUser, { name: 'Me', email: 'a@b.c' }) as any;
  assert.equal(detail.object, 'organizationUserUserDetails');
  assert.equal(detail.type, 0);
  assert.equal(detail.status, 2);
  assert.equal(detail.name, 'Me');
  const pending = orgUserDetailsResponse({ ...membership.orgUser, userId: null, status: 'invited', role: 'user' }, null) as any;
  assert.equal(pending.status, 0);
  assert.equal(pending.type, 2);
  assert.equal(pending.email, membership.orgUser.email);
  const list = orgUserListResponse([detail]) as any;
  assert.equal(list.object, 'list');
  assert.equal(list.continuationToken, null);
  const pk = userPublicKeyResponse('u2', 'PUB') as any;
  assert.equal(pk.object, 'userKey');
});
