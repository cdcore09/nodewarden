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
  return type === ORGANIZATION_TYPE_OWNER ? 'Owner' : 'Member';
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
        throw new Error('Your account is missing an encryption key. Sign out and back in, then try again.');
      }

      const keys = await generateOrgKeys(userPublicKey);
      const input: CreateOrganizationInput = {
        name: trimmedName,
        key: keys.wrappedKeyForOwner,
        publicKey: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
      };
      await props.onCreateOrganization(input);

      props.onNotify?.('success', `"${trimmedName}" was created.`);
      setDialogOpen(false);
      setName('');
    } catch (error) {
      const message = error instanceof WebCryptoUnavailableError
        ? t('txt_web_crypto_unavailable')
        : error instanceof Error ? error.message : 'Failed to create organization';
      props.onNotify?.('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-head">
          <h3>Organizations</h3>
          <button type="button" className="btn btn-primary small" onClick={openCreateDialog}>
            <Plus size={14} className="btn-icon" />
            New organization
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id}>
                <td data-label="Name">{organization.name}</td>
                <td data-label="Role">{organizationRoleLabel(organization.type)}</td>
              </tr>
            ))}
            {!organizations.length && (
              <tr>
                <td colSpan={2}>
                  <div className="empty empty-comfortable">No organizations yet</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={dialogOpen}
        title="New organization"
        message="Give your organization a name. You can invite members and add collections after it's created."
        confirmText={submitting ? 'Creating…' : t('txt_create')}
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
            placeholder="Acme Inc."
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
