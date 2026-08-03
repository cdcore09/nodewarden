import { useState } from 'preact/hooks';
import { Plus } from 'lucide-preact';
import ConfirmDialog from '@/components/ConfirmDialog';
import { WebCryptoUnavailableError } from '@/lib/crypto';
import { generateOrgKeys } from '@/lib/org-crypto';
import { t } from '@/lib/i18n';
import type { CreateOrganizationInput, ProfileOrganization } from '@/lib/api/organizations';
import type { Profile } from '@/lib/types';

// Owner/member role, mirroring the server's organization_users.role (0 = owner).
const ORGANIZATION_TYPE_OWNER = 0;

interface OrganizationsPageProps {
  profile: Profile;
  onCreateOrganization: (input: CreateOrganizationInput) => Promise<{ id: string }>;
  onNotify?: (type: 'success' | 'error' | 'warning', text: string) => void;
}

function getProfileOrganizations(profile: Profile): ProfileOrganization[] {
  const raw = (profile as { organizations?: unknown }).organizations;
  return Array.isArray(raw) ? (raw as ProfileOrganization[]) : [];
}

function organizationRoleLabel(type: number): string {
  return type === ORGANIZATION_TYPE_OWNER ? t('txt_org_role_owner') : t('txt_org_role_member');
}

export default function OrganizationsPage(props: OrganizationsPageProps) {
  const organizations = getProfileOrganizations(props.profile);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function openCreateDialog(): void {
    setName('');
    setDialogOpen(true);
  }

  function closeCreateDialog(): void {
    if (submitting) return;
    setDialogOpen(false);
    setName('');
  }

  async function submitCreateOrganization(): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;

    setSubmitting(true);
    try {
      const userPublicKey = props.profile.publicKey;
      if (!userPublicKey) {
        throw new Error(t('txt_org_missing_encryption_key'));
      }

      const keys = await generateOrgKeys(userPublicKey);
      const input: CreateOrganizationInput = {
        name: trimmedName,
        key: keys.wrappedKeyForOwner,
        publicKey: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
      };
      await props.onCreateOrganization(input);

      props.onNotify?.('success', t('txt_org_created', { name: trimmedName }));
      setDialogOpen(false);
      setName('');
    } catch (error) {
      const message = error instanceof WebCryptoUnavailableError
        ? t('txt_web_crypto_unavailable')
        : error instanceof Error ? error.message : t('txt_org_create_failed');
      props.onNotify?.('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-head">
          <h3>{t('txt_org_page_title')}</h3>
          <button type="button" className="btn btn-primary small" onClick={openCreateDialog}>
            <Plus size={14} className="btn-icon" />
            {t('txt_org_new_button')}
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t('txt_name')}</th>
              <th>{t('txt_role')}</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id}>
                <td data-label={t('txt_name')}>{organization.name}</td>
                <td data-label={t('txt_role')}>{organizationRoleLabel(organization.type)}</td>
              </tr>
            ))}
            {!organizations.length && (
              <tr>
                <td colSpan={2}>
                  <div className="empty empty-comfortable">{t('txt_org_empty')}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={dialogOpen}
        title={t('txt_org_dialog_title')}
        message={t('txt_org_dialog_message')}
        confirmText={submitting ? t('txt_org_creating') : t('txt_create')}
        cancelText={t('txt_cancel')}
        confirmDisabled={submitting || !name.trim()}
        cancelDisabled={submitting}
        onConfirm={() => void submitCreateOrganization()}
        onCancel={closeCreateDialog}
      >
        <label className="field">
          <span>{t('txt_name')}</span>
          <input
            className="input"
            maxLength={128}
            value={name}
            placeholder={t('txt_org_name_placeholder')}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
