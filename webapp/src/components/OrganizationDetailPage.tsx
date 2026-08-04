import { useMemo, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Profile } from '@/lib/types';
import type { AuthedFetch } from '@/lib/api/shared';
import { getProfileOrganizations, getUserPublicKey, ORGANIZATION_TYPE_OWNER, type OrgMember } from '@/lib/api/organizations';
import { getFingerprintPhrase } from '@/lib/api/auth-requests';
import { base64ToBytes } from '@/lib/crypto';
import { useOrgMemberActions } from '@/hooks/useOrgMemberActions';
import { useOrgCollectionActions } from '@/hooks/useOrgCollectionActions';
import type { OrgCollectionGrant } from '@/lib/api/organizations';
import ConfirmDialog from '@/components/ConfirmDialog';
import { t } from '@/lib/i18n';

const MEMBER_STATUS_KEYS = ['txt_org_status_invited', 'txt_org_status_accepted', 'txt_org_status_confirmed'] as const;

function memberRoleLabel(type: number): string {
  return type === ORGANIZATION_TYPE_OWNER ? t('txt_org_role_owner') : t('txt_org_role_member');
}

function memberStatusLabel(status: number): string {
  const key = MEMBER_STATUS_KEYS[status] ?? MEMBER_STATUS_KEYS[0];
  return t(key);
}

function parseInviteEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
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
  const [tab, setTab] = useState<'members' | 'collections'>('members');
  const { members, loading, error, invite, resend, remove, confirm } = useOrgMemberActions({
    authedFetch: props.authedFetch,
    orgId: props.orgId,
    orgKeys: props.orgKeys,
    onNotify: props.onNotify,
  });
  const {
    collections,
    loading: collectionsLoading,
    error: collectionsError,
    create: createCollection,
    rename: renameCollection,
    remove: removeCollection,
    loadGrants,
    saveGrants,
  } = useOrgCollectionActions({
    authedFetch: props.authedFetch,
    orgId: props.orgId,
    orgKeys: props.orgKeys,
    onNotify: props.onNotify,
  });
  const orgKeyReady = !!props.orgKeys[props.orgId];
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const inviteEmails = useMemo(() => parseInviteEmails(inviteInput), [inviteInput]);
  const inviteValid = inviteEmails.length > 0 && inviteEmails.every((email) => email.includes('@'));

  const closeInviteDialog = () => {
    if (inviteSubmitting) return;
    setInviteOpen(false);
    setInviteInput('');
  };

  const submitInvite = async () => {
    if (!inviteValid || inviteSubmitting) return;
    setInviteSubmitting(true);
    try {
      await invite(inviteEmails);
      setInviteOpen(false);
      setInviteInput('');
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_invite_failed'));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; email: string } | null>(null);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);

  const handleResend = async (orgUserId: string) => {
    if (busyMemberId) return;
    setBusyMemberId(orgUserId);
    try {
      await resend(orgUserId);
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_resend_failed'));
    } finally {
      setBusyMemberId(null);
    }
  };

  const [confirmTarget, setConfirmTarget] = useState<{ member: OrgMember; publicKey: string; phrase: string } | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  const openConfirmDialog = async (member: OrgMember) => {
    if (busyMemberId || !member.userId) return;
    setBusyMemberId(member.id);
    try {
      const publicKey = await getUserPublicKey(props.authedFetch, member.userId);
      const phrase = await getFingerprintPhrase(member.email, base64ToBytes(publicKey));
      setConfirmTarget({ member, publicKey, phrase });
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_confirm_failed'));
    } finally {
      setBusyMemberId(null);
    }
  };

  const submitConfirm = async () => {
    if (!confirmTarget || confirmSubmitting) return;
    setConfirmSubmitting(true);
    try {
      await confirm(confirmTarget.member, confirmTarget.publicKey);
      setConfirmTarget(null);
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_confirm_failed'));
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const submitRemove = async () => {
    if (!removeTarget || removeSubmitting) return;
    setRemoveSubmitting(true);
    try {
      await remove(removeTarget.id);
      setRemoveTarget(null);
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_remove_failed'));
    } finally {
      setRemoveSubmitting(false);
    }
  };

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

  const [collectionCreateOpen, setCollectionCreateOpen] = useState(false);
  const [collectionNameInput, setCollectionNameInput] = useState('');
  const [collectionRenameTarget, setCollectionRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [collectionDeleteTarget, setCollectionDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [collectionSubmitting, setCollectionSubmitting] = useState(false);
  const [accessTarget, setAccessTarget] = useState<{ id: string; name: string } | null>(null);
  const [accessRows, setAccessRows] = useState<Array<OrgCollectionGrant & { granted: boolean }>>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSubmitting, setAccessSubmitting] = useState(false);

  const nonOwnerMembers = useMemo(() => members.filter((m) => m.type !== ORGANIZATION_TYPE_OWNER), [members]);

  const submitCollectionCreate = async () => {
    const name = collectionNameInput.trim();
    if (!name || collectionSubmitting) return;
    setCollectionSubmitting(true);
    try {
      await createCollection(name);
      setCollectionCreateOpen(false);
      setCollectionNameInput('');
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_collection_action_failed'));
    } finally {
      setCollectionSubmitting(false);
    }
  };

  const submitCollectionRename = async () => {
    const name = collectionNameInput.trim();
    if (!collectionRenameTarget || !name || collectionSubmitting) return;
    setCollectionSubmitting(true);
    try {
      await renameCollection(collectionRenameTarget.id, name);
      setCollectionRenameTarget(null);
      setCollectionNameInput('');
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_collection_action_failed'));
    } finally {
      setCollectionSubmitting(false);
    }
  };

  const submitCollectionDelete = async () => {
    if (!collectionDeleteTarget || collectionSubmitting) return;
    setCollectionSubmitting(true);
    try {
      await removeCollection(collectionDeleteTarget.id);
      setCollectionDeleteTarget(null);
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_collection_action_failed'));
    } finally {
      setCollectionSubmitting(false);
    }
  };

  const openAccessDialog = async (collection: { id: string; name: string }) => {
    if (accessLoading) return;
    setAccessLoading(true);
    try {
      const grants = await loadGrants(collection.id);
      const byId = new Map(grants.map((g) => [g.orgUserId, g]));
      setAccessRows(
        nonOwnerMembers.map((m) => {
          const grant = byId.get(m.id);
          return {
            orgUserId: m.id,
            granted: !!grant,
            readOnly: grant?.readOnly ?? false,
            hidePasswords: grant?.hidePasswords ?? false,
          };
        })
      );
      setAccessTarget(collection);
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_collection_action_failed'));
    } finally {
      setAccessLoading(false);
    }
  };

  const updateAccessRow = (orgUserId: string, patch: Partial<OrgCollectionGrant & { granted: boolean }>) => {
    setAccessRows((prev) => prev.map((row) => (row.orgUserId === orgUserId ? { ...row, ...patch } : row)));
  };

  const submitAccess = async () => {
    if (!accessTarget || accessSubmitting) return;
    setAccessSubmitting(true);
    try {
      await saveGrants(
        accessTarget.id,
        accessRows
          .filter((row) => row.granted)
          .map(({ orgUserId, readOnly, hidePasswords }) => ({ orgUserId, readOnly, hidePasswords }))
      );
      setAccessTarget(null);
    } catch (e) {
      props.onNotify?.('error', e instanceof Error && e.message ? e.message : t('txt_org_collection_action_failed'));
    } finally {
      setAccessSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="section-head">
          <button type="button" className="btn btn-secondary small" onClick={() => navigate('/organizations')}>
            {t('txt_org_back')}
          </button>
          <h3>{org.name}</h3>
          {tab === 'members' ? (
            <button type="button" className="btn btn-primary small" onClick={() => setInviteOpen(true)}>
              {t('txt_org_invite_button')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary small"
              disabled={!orgKeyReady}
              title={orgKeyReady ? undefined : t('txt_org_key_unavailable')}
              onClick={() => {
                setCollectionNameInput('');
                setCollectionCreateOpen(true);
              }}
            >
              {t('txt_org_new_collection_button')}
            </button>
          )}
        </div>
        <div className="settings-category-tabs" role="tablist" aria-label={t('txt_org_members_tab')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'members'}
            className={`settings-category-tab ${tab === 'members' ? 'active' : ''}`}
            onClick={() => setTab('members')}
          >
            {t('txt_org_members_tab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'collections'}
            className={`settings-category-tab ${tab === 'collections' ? 'active' : ''}`}
            onClick={() => setTab('collections')}
          >
            {t('txt_org_collections_tab')}
          </button>
        </div>
        {tab === 'collections' && collectionsLoading && <p>{t('txt_org_collections_loading')}</p>}
        {tab === 'collections' && !collectionsLoading && collectionsError && (
          <div className="empty empty-comfortable">{t('txt_org_collections_error')}</div>
        )}
        {tab === 'collections' && !collectionsLoading && !collectionsError && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('txt_org_col_collection')}</th>
                <th>{t('txt_org_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((collection) => {
                const displayName = collection.name ?? t('txt_org_collection_locked');
                return (
                  <tr key={collection.id}>
                    <td data-label={t('txt_org_col_collection')}>
                      {collection.name ? collection.name : <span className="muted">{displayName}</span>}
                    </td>
                    <td data-label={t('txt_org_col_actions')}>
                      <div className="actions">
                        <button
                          type="button"
                          className="btn btn-secondary small"
                          disabled={accessLoading}
                          onClick={() => void openAccessDialog({ id: collection.id, name: displayName })}
                        >
                          {t('txt_org_access_button')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary small"
                          disabled={!orgKeyReady || !collection.name}
                          title={orgKeyReady ? undefined : t('txt_org_key_unavailable')}
                          onClick={() => {
                            setCollectionNameInput(collection.name || '');
                            setCollectionRenameTarget({ id: collection.id, name: displayName });
                          }}
                        >
                          {t('txt_org_rename_button')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger small"
                          onClick={() => setCollectionDeleteTarget({ id: collection.id, name: displayName })}
                        >
                          {t('txt_org_remove_button')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!collections.length && (
                <tr>
                  <td colSpan={2}>
                    <div className="empty empty-comfortable">{t('txt_org_collections_empty')}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'members' && loading && <p>{t('txt_org_members_loading')}</p>}
        {tab === 'members' && !loading && error && <div className="empty empty-comfortable">{t('txt_org_members_error')}</div>}
        {tab === 'members' && !loading && !error && (
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
                  <td data-label={t('txt_org_col_actions')}>
                    <div className="actions">
                      {member.status === 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary small"
                          disabled={busyMemberId === member.id}
                          onClick={() => void handleResend(member.id)}
                        >
                          {t('txt_org_resend_button')}
                        </button>
                      )}
                      {member.status === 1 && !!member.userId && (
                        <button
                          type="button"
                          className="btn btn-primary small"
                          disabled={!orgKeyReady || busyMemberId === member.id}
                          title={orgKeyReady ? undefined : t('txt_org_key_unavailable')}
                          onClick={() => void openConfirmDialog(member)}
                        >
                          {t('txt_org_confirm_button')}
                        </button>
                      )}
                      {member.type !== ORGANIZATION_TYPE_OWNER && (
                        <button
                          type="button"
                          className="btn btn-danger small"
                          onClick={() => setRemoveTarget({ id: member.id, email: member.email })}
                        >
                          {t('txt_org_remove_button')}
                        </button>
                      )}
                    </div>
                  </td>
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

      <ConfirmDialog
        open={inviteOpen}
        title={t('txt_org_invite_title')}
        message={t('txt_org_invite_message')}
        confirmText={inviteSubmitting ? t('txt_org_inviting') : t('txt_org_invite_button')}
        cancelText={t('txt_cancel')}
        confirmDisabled={inviteSubmitting || !inviteValid}
        cancelDisabled={inviteSubmitting}
        onConfirm={() => void submitInvite()}
        onCancel={closeInviteDialog}
      >
        <label className="field">
          <span>{t('txt_email')}</span>
          <input
            className="input"
            type="text"
            value={inviteInput}
            placeholder={t('txt_org_invite_email_placeholder')}
            onInput={(e) => setInviteInput((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removeTarget}
        variant="warning"
        title={t('txt_org_remove_title')}
        message={removeTarget ? t('txt_org_remove_message', { email: removeTarget.email }) : ''}
        confirmText={t('txt_org_remove_button')}
        cancelText={t('txt_cancel')}
        danger
        confirmDisabled={removeSubmitting}
        cancelDisabled={removeSubmitting}
        onConfirm={() => void submitRemove()}
        onCancel={() => {
          if (!removeSubmitting) setRemoveTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmTarget}
        title={t('txt_org_confirm_title')}
        message={t('txt_org_confirm_fingerprint_help')}
        confirmText={t('txt_org_confirm_button')}
        cancelText={t('txt_cancel')}
        confirmDisabled={confirmSubmitting}
        cancelDisabled={confirmSubmitting}
        onConfirm={() => void submitConfirm()}
        onCancel={() => {
          if (!confirmSubmitting) setConfirmTarget(null);
        }}
      >
        {confirmTarget && (
          <div className="auth-request-fingerprint">
            <span>{t('txt_org_confirm_fingerprint_label')}</span>
            <strong>{confirmTarget.phrase}</strong>
            <span>{confirmTarget.member.email}</span>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={collectionCreateOpen || !!collectionRenameTarget}
        title={collectionRenameTarget ? t('txt_org_collection_rename_title') : t('txt_org_collection_create_title')}
        confirmText={
          collectionSubmitting
            ? t('txt_org_collection_saving')
            : collectionRenameTarget
              ? t('txt_org_rename_button')
              : t('txt_create')
        }
        cancelText={t('txt_cancel')}
        confirmDisabled={collectionSubmitting || !collectionNameInput.trim()}
        cancelDisabled={collectionSubmitting}
        onConfirm={() => void (collectionRenameTarget ? submitCollectionRename() : submitCollectionCreate())}
        onCancel={() => {
          if (collectionSubmitting) return;
          setCollectionCreateOpen(false);
          setCollectionRenameTarget(null);
          setCollectionNameInput('');
        }}
      >
        <label className="field">
          <span>{t('txt_name')}</span>
          <input
            className="input"
            type="text"
            maxLength={128}
            value={collectionNameInput}
            placeholder={t('txt_org_collection_name_placeholder')}
            onInput={(e) => setCollectionNameInput((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!collectionDeleteTarget}
        variant="warning"
        title={t('txt_org_collection_delete_title')}
        message={collectionDeleteTarget ? t('txt_org_collection_delete_message', { name: collectionDeleteTarget.name }) : ''}
        confirmText={t('txt_org_remove_button')}
        cancelText={t('txt_cancel')}
        danger
        confirmDisabled={collectionSubmitting}
        cancelDisabled={collectionSubmitting}
        onConfirm={() => void submitCollectionDelete()}
        onCancel={() => {
          if (!collectionSubmitting) setCollectionDeleteTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!accessTarget}
        title={accessTarget ? t('txt_org_access_title', { name: accessTarget.name }) : ''}
        message={t('txt_org_access_help')}
        confirmText={accessSubmitting ? t('txt_org_collection_saving') : t('txt_save')}
        cancelText={t('txt_cancel')}
        confirmDisabled={accessSubmitting}
        cancelDisabled={accessSubmitting}
        onConfirm={() => void submitAccess()}
        onCancel={() => {
          if (!accessSubmitting) setAccessTarget(null);
        }}
      >
        {!nonOwnerMembers.length && <div className="empty empty-comfortable">{t('txt_org_access_no_members')}</div>}
        {nonOwnerMembers.map((member) => {
          const row = accessRows.find((r) => r.orgUserId === member.id);
          if (!row) return null;
          return (
            <div key={member.id} className="field org-access-row">
              <label className="backup-option-label">
                <input
                  type="checkbox"
                  checked={row.granted}
                  onInput={(e) => updateAccessRow(member.id, { granted: (e.currentTarget as HTMLInputElement).checked })}
                />
                <span>
                  {member.email}{' '}
                  <span className={`risk-badge org-status-${member.status}`}>{memberStatusLabel(member.status)}</span>
                </span>
              </label>
              {row.granted && (
                <div className="org-access-flags">
                  <label className="backup-option-label">
                    <input
                      type="checkbox"
                      checked={row.readOnly}
                      onInput={(e) => updateAccessRow(member.id, { readOnly: (e.currentTarget as HTMLInputElement).checked })}
                    />
                    <span>{t('txt_org_access_read_only')}</span>
                  </label>
                  <label className="backup-option-label">
                    <input
                      type="checkbox"
                      checked={row.hidePasswords}
                      onInput={(e) =>
                        updateAccessRow(member.id, { hidePasswords: (e.currentTarget as HTMLInputElement).checked })
                      }
                    />
                    <span>{t('txt_org_access_hide_passwords')}</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </ConfirmDialog>
    </div>
  );
}
