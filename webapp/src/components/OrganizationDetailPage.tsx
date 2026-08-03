import { useMemo, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Profile } from '@/lib/types';
import type { AuthedFetch } from '@/lib/api/shared';
import { getProfileOrganizations, ORGANIZATION_TYPE_OWNER } from '@/lib/api/organizations';
import { useOrgMemberActions } from '@/hooks/useOrgMemberActions';
import { t } from '@/lib/i18n';

const MEMBER_STATUS_KEYS = ['txt_org_status_invited', 'txt_org_status_accepted', 'txt_org_status_confirmed'] as const;

function memberRoleLabel(type: number): string {
  return type === ORGANIZATION_TYPE_OWNER ? t('txt_org_role_owner') : t('txt_org_role_member');
}

function memberStatusLabel(status: number): string {
  const key = MEMBER_STATUS_KEYS[status] ?? MEMBER_STATUS_KEYS[0];
  return t(key);
}

interface OrganizationDetailPageProps {
  orgId: string;
  profile: Profile;
  authedFetch: AuthedFetch;
  orgKeys: Record<string, Uint8Array>;
  onNotify?: (type: 'success' | 'error' | 'warning', text: string) => void;
}

export default function OrganizationDetailPage(props: OrganizationDetailPageProps) {
  const [, navigate] = useLocation();
  const org = useMemo(
    () => getProfileOrganizations(props.profile).find((o) => o.id === props.orgId) || null,
    [props.profile, props.orgId]
  );
  const [tab] = useState<'members'>('members');
  const { members, loading, error } = useOrgMemberActions({
    authedFetch: props.authedFetch,
    orgId: props.orgId,
    onNotify: props.onNotify,
  });

  if (!org) {
    return (
      <div className="stack">
        <section className="card">
          <button type="button" className="btn btn-secondary small" onClick={() => navigate('/organizations')}>
            {t('txt_org_back')}
          </button>
          <p>{t('txt_org_not_found')}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-head">
          <button type="button" className="btn btn-secondary small" onClick={() => navigate('/organizations')}>
            {t('txt_org_back')}
          </button>
          <h3>{org.name}</h3>
        </div>
        <div className="settings-category-tabs" role="tablist" aria-label={t('txt_org_members_tab')}>
          <button type="button" role="tab" aria-selected={tab === 'members'} className="settings-category-tab active">
            {t('txt_org_members_tab')}
          </button>
        </div>
        {loading && <p>{t('txt_org_members_loading')}</p>}
        {!loading && error && <div className="empty empty-comfortable">{t('txt_org_members_error')}</div>}
        {!loading && !error && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('txt_org_col_member')}</th>
                <th>{t('txt_org_col_role')}</th>
                <th>{t('txt_org_col_status')}</th>
                <th>{t('txt_org_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td data-label={t('txt_org_col_member')}>
                    {member.name ? (
                      <>
                        <div>{member.name}</div>
                        <div className="muted">{member.email}</div>
                      </>
                    ) : (
                      member.email
                    )}
                  </td>
                  <td data-label={t('txt_org_col_role')}>{memberRoleLabel(member.type)}</td>
                  <td data-label={t('txt_org_col_status')}>
                    <span className={`risk-badge org-status-${member.status}`}>{memberStatusLabel(member.status)}</span>
                  </td>
                  <td data-label={t('txt_org_col_actions')} />
                </tr>
              ))}
              {!members.length && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty empty-comfortable">{t('txt_org_members_empty')}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
