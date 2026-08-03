import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  confirmOrgUser,
  getUserPublicKey,
  inviteOrgUsers,
  listOrgUsers,
  removeOrgUser,
  resendOrgInvite,
  type OrgMember,
} from '@/lib/api/organizations';
import { rsaWrapOrgKeyForMember } from '@/lib/org-crypto';
import { t } from '@/lib/i18n';

type Notify = (type: 'success' | 'error' | 'warning', text: string) => void;

interface UseOrgMemberActionsOptions {
  authedFetch: AuthedFetch;
  orgId: string;
  orgKeys: Record<string, Uint8Array>;
  onNotify?: Notify;
}

// Fetch/state core for the org members list. Invite/resend/confirm/remove
// actions are added incrementally in Tasks 4-6.
export function useOrgMemberActions(opts: UseOrgMemberActionsOptions) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await listOrgUsers(opts.authedFetch, opts.orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [opts.authedFetch, opts.orgId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const invite = useCallback(
    async (emails: string[]) => {
      await inviteOrgUsers(opts.authedFetch, opts.orgId, emails);
      await reload();
      opts.onNotify?.('success', t('txt_org_invite_sent'));
    },
    [opts.authedFetch, opts.orgId, reload]
  );

  const resend = useCallback(
    async (orgUserId: string) => {
      await resendOrgInvite(opts.authedFetch, opts.orgId, orgUserId);
      opts.onNotify?.('success', t('txt_org_invite_resent'));
    },
    [opts.authedFetch, opts.orgId]
  );

  const remove = useCallback(
    async (orgUserId: string) => {
      await removeOrgUser(opts.authedFetch, opts.orgId, orgUserId);
      await reload();
      opts.onNotify?.('success', t('txt_org_member_removed'));
    },
    [opts.authedFetch, opts.orgId, reload]
  );

  // Fail-closed: never POST a confirm without wrapping the real org key.
  const confirm = useCallback(
    async (member: OrgMember, prefetchedPublicKey?: string) => {
      if (!member.userId) throw new Error(t('txt_org_confirm_no_account'));
      const orgKey = opts.orgKeys[opts.orgId];
      if (!orgKey) throw new Error(t('txt_org_key_unavailable'));
      const publicKey = prefetchedPublicKey || (await getUserPublicKey(opts.authedFetch, member.userId));
      const wrapped = await rsaWrapOrgKeyForMember(orgKey, publicKey);
      await confirmOrgUser(opts.authedFetch, opts.orgId, member.id, wrapped);
      await reload();
      opts.onNotify?.('success', t('txt_org_member_confirmed'));
    },
    [opts.authedFetch, opts.orgId, opts.orgKeys, reload]
  );

  return { members, loading, error, reload, invite, resend, remove, confirm };
}

export default useOrgMemberActions;
