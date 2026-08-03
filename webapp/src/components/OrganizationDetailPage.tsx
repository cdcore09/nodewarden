import { useMemo, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Profile } from '@/lib/types';
import type { AuthedFetch } from '@/lib/api/shared';
import { getProfileOrganizations } from '@/lib/api/organizations';
import { t } from '@/lib/i18n';

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
        {/* Members tab content added in Task 3 */}
        <p>{t('txt_org_members_loading')}</p>
      </section>
    </div>
  );
}
