// Org invitation tokens: stateless HMAC JWTs signed with the server's
// JWT_SECRET, marked with typ:'org-invite' so they can never be used as
// (or forged from) API access tokens.
import { createJWT, verifyJWT } from '../utils/jwt';

const ORG_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
const TYP = 'org-invite';

export interface OrgInviteClaims {
  orgUserId: string;
  orgId: string;
  email: string;
}

export async function createOrgInviteToken(secret: string, claims: OrgInviteClaims): Promise<string> {
  return createJWT(
    { sub: claims.orgUserId, typ: TYP, oid: claims.orgId, iem: claims.email } as any,
    secret,
    ORG_INVITE_TTL_SECONDS
  );
}

export async function verifyOrgInviteToken(secret: string, token: string): Promise<OrgInviteClaims | null> {
  const payload: any = await verifyJWT(token, secret);
  if (!payload || payload.typ !== TYP) return null;
  if (typeof payload.sub !== 'string' || typeof payload.oid !== 'string' || typeof payload.iem !== 'string') return null;
  return { orgUserId: payload.sub, orgId: payload.oid, email: payload.iem };
}
