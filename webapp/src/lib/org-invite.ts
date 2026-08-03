// Org invitation deep-link handling. The invite email links to
// `${site}/#/accept-organization?organizationId=..&organizationUserId=..&email=..&token=..[&inviteCode=..]`
// (see src/services/org-mail.ts). The pure parser is separated from the
// window-reading wrapper so tsx tests cover it.

export interface OrgInviteLink {
  orgId: string;
  orgUserId: string;
  email: string;
  token: string;
  /** Registration invite code; null when the recipient already had an account. */
  inviteCode: string | null;
}

export function parseOrgInviteFromHash(rawHash: string): OrgInviteLink | null {
  const hash = String(rawHash || '');
  const match = hash.match(/^#\/?accept-organization\?(.*)$/);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const orgId = (params.get('organizationId') || '').trim();
  const orgUserId = (params.get('organizationUserId') || '').trim();
  const email = (params.get('email') || '').trim();
  const token = (params.get('token') || '').trim();
  if (!orgId || !orgUserId || !email || !token) return null;
  const inviteCode = (params.get('inviteCode') || '').trim();
  return { orgId, orgUserId, email, token, inviteCode: inviteCode || null };
}

export function readOrgInviteFromUrl(): OrgInviteLink | null {
  if (typeof window === 'undefined') return null;
  return parseOrgInviteFromHash(window.location.hash || '');
}

export function clearOrgInviteFromUrl(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.hash.includes('accept-organization')) return;
  if (typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
