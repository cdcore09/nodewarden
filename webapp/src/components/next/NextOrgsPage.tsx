// NodeWarden Next (issue #16, slice 10): organization management in the
// Next shell. Member/org management was a named pain point of the classic
// UI, so the page leads with the access model and explains every state at
// the point of need (progressive disclosure): a folded "how access works"
// primer, plain-language status sublabels on every member row, and a
// remove dialog that spells out what is NOT revoked. Data flows through
// the same hooks as the classic page — no duplicated crypto.
import { useMemo, useRef, useState } from 'preact/hooks';
import { UserPlus, Users, FolderLock, ShieldQuestion } from 'lucide-preact';
import { useOrgMemberActions } from '@/hooks/useOrgMemberActions';
import { useOrgCollectionActions } from '@/hooks/useOrgCollectionActions';
import { getUserPublicKey, ORGANIZATION_TYPE_OWNER, type OrgMember, type OrgCollectionGrant } from '@/lib/api/organizations';
import { getFingerprintPhrase } from '@/lib/api/auth-requests';
import { base64ToBytes } from '@/lib/crypto';
import { useDialogFocus } from './useDialogFocus';
import type { AuthedFetch } from '@/lib/api/shared';
import { t } from '@/lib/i18n';

const STR = {
  intro: 'Organizations share collections of items with other people on this server. Members only see the collections they’ve been granted.',
  howTitle: 'How access works',
  howLevels: [
    ['Server account', 'an account on this NodeWarden server (the workspace). Created at registration or from an invite; the admin manages accounts in the Admin panel. Removing an account revokes everything — personal vault and all organizations.'],
    ['Organization member', 'a server account invited into this organization. Being removed from the organization only takes away its shared collections — their account and personal vault are untouched.'],
    ['Collection access', 'which of the organization’s collections a confirmed member can see, granted per collection (optionally read-only or with passwords hidden).'],
  ] as Array<[string, string]>,
  members: 'Members',
  collections: 'Collections',
  invite: 'Invite',
  inviteTitle: 'Invite people',
  inviteHelp: 'One or more emails, separated by commas or spaces. If someone has no account on this server yet, their invite email includes a registration code to create one.',
  inviting: 'Inviting…',
  emails: 'Emails',
  roleOwner: 'Owner',
  roleMember: 'Member',
  statusHints: [
    'Invited — hasn’t accepted the email yet',
    'Accepted — waiting for you to confirm them',
    'Confirmed — has the key, sees granted collections',
  ],
  resend: 'Resend invite',
  confirmBtn: 'Confirm',
  confirmTitle: (email: string) => `Confirm ${email}`,
  confirmHelp: 'Confirming hands this person the organization key. Check the fingerprint phrase with them (it’s on their Settings page) — matching phrases prove the key goes to the right account.',
  fingerprint: 'Their fingerprint phrase',
  remove: 'Remove',
  removeTitle: (email: string) => `Remove ${email} from this organization?`,
  removeScope: 'They lose access to this organization’s collections — nothing else.',
  removeKeeps: 'Their account on this server and their personal vault are untouched. To revoke access to the whole server, remove their account from the Admin panel instead.',
  removing: 'Removing…',
  newCollection: 'New collection',
  collectionName: 'Name',
  collectionCreateTitle: 'New collection',
  rename: 'Rename',
  del: 'Delete',
  deleteCollectionTitle: (name: string) => `Delete “${name}”?`,
  deleteCollectionMessage: 'Items in this collection stay in the organization but become unreachable for members whose only access came through it.',
  access: 'Access',
  accessTitle: (name: string) => `Who can see “${name}”`,
  accessHelp: 'Owners always see every collection. Grant other members below.',
  accessFlags: 'per-member options',
  readOnly: 'Read-only',
  hidePasswords: 'Hide passwords',
  noMembersToGrant: 'No non-owner members yet — invite someone first.',
  save: 'Save',
  saving: 'Saving…',
  cancel: t('txt_cancel'),
  membersEmpty: 'Just you so far. Invite someone to start sharing.',
  collectionsEmpty: 'No collections yet. Items are shared into collections — create one to start.',
  locked: 'Locked collection',
  keyMissing: 'The organization key is locked — reopen your session to manage names and confirmations.',
  loadFailed: 'Couldn’t load — check your connection and try again.',
  itemCount: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
  memberCount: (n: number) => `${n} member${n === 1 ? '' : 's'}`,
  collectionCount: (n: number) => `${n} collection${n === 1 ? '' : 's'}`,
};

interface NextOrgsPageProps {
  organizations: Array<{ id: string; name: string }>;
  authedFetch: AuthedFetch;
  orgKeys: Record<string, Uint8Array>;
  orgItemCounts: Map<string, number>;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
}

function Dialog(props: { label: string; onClose?: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return (
    <div className="nx-scrim" onClick={(e) => { if (e.target === e.currentTarget) props.onClose?.(); }}>
      <div
        ref={ref}
        className="nx-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && props.onClose) { e.preventDefault(); e.stopPropagation(); props.onClose(); }
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export default function NextOrgsPage(props: NextOrgsPageProps) {
  const [orgId, setOrgId] = useState(props.organizations[0]?.id || '');
  const org = props.organizations.find((o) => o.id === orgId) || null;

  if (!org) {
    return (
      <div className="nx-list nx-orgs">
        <div className="nx-empty"><ShieldQuestion size={20} /> {STR.intro}</div>
      </div>
    );
  }

  return (
    <OrgDetail
      key={org.id}
      org={org}
      organizations={props.organizations}
      onSwitchOrg={setOrgId}
      authedFetch={props.authedFetch}
      orgKeys={props.orgKeys}
      itemCount={props.orgItemCounts.get(org.id) || 0}
      onNotify={props.onNotify}
    />
  );
}

function OrgDetail(props: {
  org: { id: string; name: string };
  organizations: Array<{ id: string; name: string }>;
  onSwitchOrg: (id: string) => void;
  authedFetch: AuthedFetch;
  orgKeys: Record<string, Uint8Array>;
  itemCount: number;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
}) {
  const orgId = props.org.id;
  const memberActions = useOrgMemberActions({
    authedFetch: props.authedFetch, orgId, orgKeys: props.orgKeys, onNotify: props.onNotify,
  });
  const collectionActions = useOrgCollectionActions({
    authedFetch: props.authedFetch, orgId, orgKeys: props.orgKeys, onNotify: props.onNotify,
  });
  const orgKeyReady = !!props.orgKeys[orgId];
  const nonOwnerMembers = useMemo(
    () => memberActions.members.filter((m) => m.type !== ORGANIZATION_TYPE_OWNER),
    [memberActions.members]
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ member: OrgMember; publicKey: string; phrase: string } | null>(null);
  const [collectionDialog, setCollectionDialog] = useState<'create' | { rename: { id: string; name: string } } | null>(null);
  const [collectionName, setCollectionName] = useState('');
  const [collectionDeleteTarget, setCollectionDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [accessTarget, setAccessTarget] = useState<{ id: string; name: string } | null>(null);
  const [accessRows, setAccessRows] = useState<Array<OrgCollectionGrant & { granted: boolean }>>([]);

  const inviteEmails = useMemo(
    () => inviteInput.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean),
    [inviteInput]
  );
  const inviteValid = inviteEmails.length > 0 && inviteEmails.every((e) => e.includes('@'));

  const run = async (fn: () => Promise<void>, closeAll = true) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fn();
      if (closeAll) {
        setInviteOpen(false); setInviteInput('');
        setRemoveTarget(null); setConfirmTarget(null);
        setCollectionDialog(null); setCollectionName('');
        setCollectionDeleteTarget(null); setAccessTarget(null);
      }
    } catch (e) {
      props.onNotify('error', e instanceof Error && e.message ? e.message : STR.loadFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const openConfirm = async (member: OrgMember) => {
    if (busyId || !member.userId) return;
    setBusyId(member.id);
    try {
      const publicKey = await getUserPublicKey(props.authedFetch, member.userId);
      const phrase = await getFingerprintPhrase(member.email, base64ToBytes(publicKey));
      setConfirmTarget({ member, publicKey, phrase });
    } catch (e) {
      props.onNotify('error', e instanceof Error && e.message ? e.message : STR.loadFailed);
    } finally {
      setBusyId(null);
    }
  };

  const openAccess = async (collection: { id: string; name: string }) => {
    try {
      const grants = await collectionActions.loadGrants(collection.id);
      const byId = new Map(grants.map((g) => [g.orgUserId, g]));
      setAccessRows(nonOwnerMembers.map((m) => {
        const grant = byId.get(m.id);
        return { orgUserId: m.id, granted: !!grant, readOnly: grant?.readOnly ?? false, hidePasswords: grant?.hidePasswords ?? false };
      }));
      setAccessTarget(collection);
    } catch (e) {
      props.onNotify('error', e instanceof Error && e.message ? e.message : STR.loadFailed);
    }
  };

  return (
    <div className="nx-list nx-orgs">
      <div className="nx-help org-intro">{STR.intro}</div>

      <div className="org-head">
        {props.organizations.length > 1 ? (
          <select
            className="nx-input org-switch"
            value={orgId}
            onInput={(e) => props.onSwitchOrg((e.currentTarget as HTMLSelectElement).value)}
          >
            {props.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <h2 className="org-name">{props.org.name}</h2>
        )}
        <span className="org-meta nx-data">
          {STR.memberCount(memberActions.members.length)} · {STR.collectionCount(collectionActions.collections.length)} · {STR.itemCount(props.itemCount)}
        </span>
      </div>

      <details className="nx-details org-how">
        <summary>{STR.howTitle}</summary>
        <div className="details-body">
          <ol className="org-levels">
            {STR.howLevels.map(([head, rest], index) => (
              <li key={head}>
                <span className="n nx-data">{index + 1}</span>
                <span><strong>{head}</strong> — {rest}</span>
              </li>
            ))}
          </ol>
        </div>
      </details>

      {!orgKeyReady && <div className="nx-help warn">{STR.keyMissing}</div>}

      <div className="org-grid">
        <section className="org-card" aria-label={STR.members}>
          <div className="org-card-head">
            <Users size={15} aria-hidden="true" />
            <span className="head-title">{STR.members}</span>
            <button type="button" className="nx-btn sm" onClick={() => setInviteOpen(true)}>
              <UserPlus size={13} /> {STR.invite}
            </button>
          </div>
          {memberActions.loading && <div className="nx-help">Loading…</div>}
          {!memberActions.loading && memberActions.error && <div className="nx-help warn">{STR.loadFailed}</div>}
          {!memberActions.loading && !memberActions.error && memberActions.members.length === 0 && (
            <div className="nx-help">{STR.membersEmpty}</div>
          )}
          {memberActions.members.map((member) => (
            <div key={member.id} className="org-row">
              <span className="who">
                <span className="title">{member.name || member.email}</span>
                {member.name && <span className="sub nx-data">{member.email}</span>}
                <span className="sub state">{STR.statusHints[member.status] || ''}</span>
              </span>
              <span className="acts">
                <span className={`nx-badge${member.type === ORGANIZATION_TYPE_OWNER ? '' : ' quiet'}`}>
                  {member.type === ORGANIZATION_TYPE_OWNER ? STR.roleOwner : STR.roleMember}
                </span>
                {member.status === 0 && (
                  <button type="button" className="nx-btn ghost sm" disabled={busyId === member.id}
                    onClick={() => { setBusyId(member.id); void memberActions.resend(member.id).catch((e) => props.onNotify('error', String(e?.message || e))).finally(() => setBusyId(null)); }}>
                    {STR.resend}
                  </button>
                )}
                {member.status === 1 && !!member.userId && (
                  <button type="button" className="nx-btn sm" disabled={!orgKeyReady || busyId === member.id}
                    title={orgKeyReady ? undefined : STR.keyMissing}
                    onClick={() => void openConfirm(member)}>
                    {STR.confirmBtn}
                  </button>
                )}
                {member.type !== ORGANIZATION_TYPE_OWNER && (
                  <button type="button" className="nx-btn ghost sm danger-ink" onClick={() => setRemoveTarget(member)}>
                    {STR.remove}
                  </button>
                )}
              </span>
            </div>
          ))}
        </section>

        <section className="org-card" aria-label={STR.collections}>
          <div className="org-card-head">
            <FolderLock size={15} aria-hidden="true" />
            <span className="head-title">{STR.collections}</span>
            <button type="button" className="nx-btn sm" disabled={!orgKeyReady}
              title={orgKeyReady ? undefined : STR.keyMissing}
              onClick={() => { setCollectionName(''); setCollectionDialog('create'); }}>
              {STR.newCollection}
            </button>
          </div>
          {collectionActions.loading && <div className="nx-help">Loading…</div>}
          {!collectionActions.loading && collectionActions.error && <div className="nx-help warn">{STR.loadFailed}</div>}
          {!collectionActions.loading && !collectionActions.error && collectionActions.collections.length === 0 && (
            <div className="nx-help">{STR.collectionsEmpty}</div>
          )}
          {collectionActions.collections.map((collection) => {
            const name = collection.name ?? STR.locked;
            return (
              <div key={collection.id} className="org-row">
                <span className="who"><span className="title">{name}</span></span>
                <span className="acts">
                  <button type="button" className="nx-btn ghost sm" onClick={() => void openAccess({ id: collection.id, name })}>
                    {STR.access}
                  </button>
                  <button type="button" className="nx-btn ghost sm" disabled={!orgKeyReady || !collection.name}
                    onClick={() => { setCollectionName(collection.name || ''); setCollectionDialog({ rename: { id: collection.id, name } }); }}>
                    {STR.rename}
                  </button>
                  <button type="button" className="nx-btn ghost sm danger-ink" onClick={() => setCollectionDeleteTarget({ id: collection.id, name })}>
                    {STR.del}
                  </button>
                </span>
              </div>
            );
          })}
        </section>
      </div>

      {inviteOpen && (
        <Dialog label={STR.inviteTitle} onClose={submitting ? undefined : () => setInviteOpen(false)}>
          <h3>{STR.inviteTitle}</h3>
          <div className="nx-help">{STR.inviteHelp}</div>
          <label className="nx-field">
            <span className="nx-overline">{STR.emails}</span>
            <input className="nx-input nx-data" type="text" value={inviteInput}
              onInput={(e) => setInviteInput((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={submitting} onClick={() => setInviteOpen(false)}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn" disabled={submitting || !inviteValid}
              onClick={() => void run(() => memberActions.invite(inviteEmails))}>
              {submitting ? STR.inviting : STR.invite}
            </button>
          </div>
        </Dialog>
      )}

      {removeTarget && (
        <Dialog label={STR.removeTitle(removeTarget.email)} onClose={submitting ? undefined : () => setRemoveTarget(null)}>
          <h3>{STR.removeTitle(removeTarget.email)}</h3>
          <div className="nx-help">{STR.removeScope}</div>
          <div className="nx-help">{STR.removeKeeps}</div>
          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={submitting} onClick={() => setRemoveTarget(null)}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn danger-fill" disabled={submitting}
              onClick={() => void run(() => memberActions.remove(removeTarget.id))}>
              {submitting ? STR.removing : STR.remove}
            </button>
          </div>
        </Dialog>
      )}

      {confirmTarget && (
        <Dialog label={STR.confirmTitle(confirmTarget.member.email)} onClose={submitting ? undefined : () => setConfirmTarget(null)}>
          <h3>{STR.confirmTitle(confirmTarget.member.email)}</h3>
          <div className="nx-help">{STR.confirmHelp}</div>
          <div className="nx-field">
            <span className="nx-overline">{STR.fingerprint}</span>
            <div className="org-phrase nx-data">{confirmTarget.phrase}</div>
          </div>
          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={submitting} onClick={() => setConfirmTarget(null)}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn" disabled={submitting}
              onClick={() => void run(() => memberActions.confirm(confirmTarget.member, confirmTarget.publicKey))}>
              {submitting ? STR.saving : STR.confirmBtn}
            </button>
          </div>
        </Dialog>
      )}

      {collectionDialog && (
        <Dialog
          label={collectionDialog === 'create' ? STR.collectionCreateTitle : STR.rename}
          onClose={submitting ? undefined : () => { setCollectionDialog(null); setCollectionName(''); }}
        >
          <h3>{collectionDialog === 'create' ? STR.collectionCreateTitle : STR.rename}</h3>
          <label className="nx-field">
            <span className="nx-overline">{STR.collectionName}</span>
            <input className="nx-input" type="text" maxLength={128} value={collectionName}
              onInput={(e) => setCollectionName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={submitting}
              onClick={() => { setCollectionDialog(null); setCollectionName(''); }}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn" disabled={submitting || !collectionName.trim()}
              onClick={() => void run(() => collectionDialog === 'create'
                ? collectionActions.create(collectionName.trim())
                : collectionActions.rename(collectionDialog.rename.id, collectionName.trim()))}>
              {submitting ? STR.saving : STR.save}
            </button>
          </div>
        </Dialog>
      )}

      {collectionDeleteTarget && (
        <Dialog label={STR.deleteCollectionTitle(collectionDeleteTarget.name)} onClose={submitting ? undefined : () => setCollectionDeleteTarget(null)}>
          <h3>{STR.deleteCollectionTitle(collectionDeleteTarget.name)}</h3>
          <div className="nx-help">{STR.deleteCollectionMessage}</div>
          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={submitting} onClick={() => setCollectionDeleteTarget(null)}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn danger-fill" disabled={submitting}
              onClick={() => void run(() => collectionActions.remove(collectionDeleteTarget.id))}>
              {submitting ? STR.removing : STR.del}
            </button>
          </div>
        </Dialog>
      )}

      {accessTarget && (
        <Dialog label={STR.accessTitle(accessTarget.name)} onClose={submitting ? undefined : () => setAccessTarget(null)}>
          <h3>{STR.accessTitle(accessTarget.name)}</h3>
          <div className="nx-help">{STR.accessHelp}</div>
          {nonOwnerMembers.length === 0 && <div className="nx-help">{STR.noMembersToGrant}</div>}
          <div className="org-grant-list">
            {nonOwnerMembers.map((member) => {
              const row = accessRows.find((r) => r.orgUserId === member.id);
              if (!row) return null;
              return (
                <div key={member.id} className="org-grant">
                  <label className="grant-main">
                    <input type="checkbox" checked={row.granted}
                      onInput={(e) => setAccessRows((prev) => prev.map((r) => r.orgUserId === member.id
                        ? { ...r, granted: (e.currentTarget as HTMLInputElement).checked } : r))} />
                    <span>{member.email}</span>
                  </label>
                  {row.granted && (
                    <details className="nx-details grant-flags">
                      <summary>{STR.accessFlags}</summary>
                      <div className="details-body">
                        <label className="grant-flag">
                          <input type="checkbox" checked={row.readOnly}
                            onInput={(e) => setAccessRows((prev) => prev.map((r) => r.orgUserId === member.id
                              ? { ...r, readOnly: (e.currentTarget as HTMLInputElement).checked } : r))} />
                          <span>{STR.readOnly}</span>
                        </label>
                        <label className="grant-flag">
                          <input type="checkbox" checked={row.hidePasswords}
                            onInput={(e) => setAccessRows((prev) => prev.map((r) => r.orgUserId === member.id
                              ? { ...r, hidePasswords: (e.currentTarget as HTMLInputElement).checked } : r))} />
                          <span>{STR.hidePasswords}</span>
                        </label>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={submitting} onClick={() => setAccessTarget(null)}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn" disabled={submitting}
              onClick={() => void run(() => collectionActions.saveGrants(
                accessTarget.id,
                accessRows.filter((r) => r.granted).map(({ orgUserId, readOnly, hidePasswords }) => ({ orgUserId, readOnly, hidePasswords }))
              ))}>
              {submitting ? STR.saving : STR.save}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
