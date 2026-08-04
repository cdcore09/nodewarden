// NodeWarden Next (issue #16, slice 3.5): share-to-organization dialog.
// Fixes the two perceptual failures traced in J4: the dialog paints before
// the network answers, and an org switch announces the selection reset
// instead of silently wiping it. One visual language — no native popovers.
// Design contract: mockups/05-share.html.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialogFocus } from './useDialogFocus';
import { t } from '@/lib/i18n';

const STR = {
  title: (name: string) => `Share “${name}”`,
  manageTitle: (name: string) => `Sharing of “${name}”`,
  manageConsequence: 'Members see this item if they have access to any checked collection. At least one is required — an item with no collection would be unreachable.',
  save: 'Save',
  oneOrg: 'An item belongs to one organization — its data is encrypted under that organization’s key. To share it with another organization too, duplicate the item and share the copy.',
  makePersonal: 'Move to personal vault…',
  unshareTitle: (org: string) => `Remove from ${org || 'the organization'}?`,
  unshareBody: 'The item moves back to your personal vault, re-encrypted under your key. Organization members lose access immediately. Only the person who originally shared it can do this.',
  unshareConfirm: 'Move to personal vault',
  back: 'Back',
  organization: 'Organization',
  collections: 'Collections',
  loading: 'Loading collections…',
  noCollections: 'No collections in this organization.',
  switched: (org: string) => `Switched to “${org}” — collection choice reset.`,
  consequence: 'The item is re-encrypted for the organization. Ownership moves; this can’t be undone from here.',
  share: 'Share',
  sharing: 'Sharing…',
  lockedCollection: 'Locked collection',
};

interface ShareDialogProps {
  cipherName: string;
  organizations: Array<{ id: string; name: string }>;
  loadCollections: (orgId: string) => Promise<Array<{ id: string; name: string | null }>>;
  onConfirm: (orgId: string, collectionIds: string[]) => void;
  onCancel: () => void;
  submitting: boolean;
  /** manage = the item already lives in an org: org locked, collections editable */
  mode?: 'share' | 'manage';
  initialOrgId?: string;
  initialCollectionIds?: string[];
  /** manage mode: move the item back to the personal vault (creator only) */
  onUnshare?: () => void;
}

export default function ShareDialog(props: ShareDialogProps) {
  const manage = props.mode === 'manage';
  const [unshareStep, setUnshareStep] = useState(false);
  const [orgId, setOrgId] = useState(props.initialOrgId || props.organizations[0]?.id || '');
  const [collections, setCollections] = useState<Array<{ id: string; name: string | null }> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogFocus(dialogRef);

  useEffect(() => {
    let alive = true;
    setCollections(null);
    void props.loadCollections(orgId).then((rows) => {
      if (!alive) return;
      setCollections(rows);
      if (manage && props.initialCollectionIds) {
        setSelected(new Set(props.initialCollectionIds.filter((id) => rows.some((r) => r.id === id))));
      } else {
        // Single collection: pre-check it (stock parity).
        setSelected(rows.length === 1 ? new Set([rows[0].id]) : new Set());
      }
    }).catch(() => {
      if (alive) setCollections([]);
    });
    return () => { alive = false; };
  }, [orgId]);

  const switchOrg = (nextId: string) => {
    if (nextId === orgId) return;
    const org = props.organizations.find((o) => o.id === nextId);
    setOrgId(nextId);
    setNotice(selected.size > 0 ? STR.switched(org?.name || '') : '');
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setNotice('');
  };

  const canConfirm = selected.size > 0 && !props.submitting;

  return (
    <div className="nx-scrim" onClick={(e) => { if (e.target === e.currentTarget && !props.submitting) props.onCancel(); }}>
      <div
        ref={dialogRef}
        className="nx-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={STR.title(props.cipherName)}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !props.submitting) {
            e.preventDefault(); e.stopPropagation();
            if (unshareStep) setUnshareStep(false);
            else props.onCancel();
          }
          if (e.key === 'Enter' && canConfirm && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            props.onConfirm(orgId, [...selected]);
          }
        }}
      >
        {unshareStep ? (
          <>
            <h3>{STR.unshareTitle(props.organizations.find((o) => o.id === orgId)?.name || '')}</h3>
            <div className="nx-help">{STR.unshareBody}</div>
            <div className="dfoot">
              <button type="button" className="nx-btn ghost" disabled={props.submitting} onClick={() => setUnshareStep(false)}>
                {STR.back} <span className="nx-kbd">esc</span>
              </button>
              <button type="button" className="nx-btn danger-fill" disabled={props.submitting} onClick={() => props.onUnshare?.()}>
                {props.submitting ? STR.sharing : STR.unshareConfirm}
              </button>
            </div>
          </>
        ) : (
        <>
        <h3>{manage ? STR.manageTitle(props.cipherName) : STR.title(props.cipherName)}</h3>

        {!manage && props.organizations.length > 1 && (
          <div className="nx-field">
            <span className="nx-overline">{STR.organization}</span>
            <div className="nx-option-list">
              {props.organizations.map((org) => (
                <button type="button" key={org.id} className="nx-option" onClick={() => switchOrg(org.id)}>
                  <span className={`nx-check radio${org.id === orgId ? ' on' : ''}`}>{org.id === orgId ? '●' : ''}</span>
                  {org.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {(manage || props.organizations.length === 1) && (
          <div className="nx-field">
            <span className="nx-overline">{STR.organization}</span>
            <div className="nx-help">{props.organizations.find((o) => o.id === orgId)?.name || props.organizations[0]?.name}</div>
          </div>
        )}

        <div className="nx-field">
          <span className="nx-overline">{STR.collections}</span>
          {notice && <div className="nx-help warn" role="status">{notice}</div>}
          {collections === null && (
            <>
              <div className="nx-working2" aria-hidden="true" />
              <div className="nx-help">{STR.loading}</div>
            </>
          )}
          {collections !== null && collections.length === 0 && (
            <div className="nx-help">{STR.noCollections}</div>
          )}
          {collections !== null && collections.length > 0 && (
            <div className="nx-option-list">
              {collections.map((collection) => (
                <button type="button" key={collection.id} className="nx-option" onClick={() => toggle(collection.id)}>
                  <span className={`nx-check${selected.has(collection.id) ? ' on' : ''}`}>{selected.has(collection.id) ? '✓' : ''}</span>
                  <span className="opt-org">{props.organizations.find((o) => o.id === orgId)?.name}</span>
                  <span className="opt-sep" aria-hidden="true">·</span>
                  {collection.name || STR.lockedCollection}
                </button>
              ))}
            </div>
          )}
          <div className="nx-help">{manage ? STR.manageConsequence : STR.consequence}</div>
          {!manage && <div className="nx-help">{STR.oneOrg}</div>}
        </div>

        <div className="dfoot">
          <button type="button" className="nx-btn ghost" disabled={props.submitting} onClick={props.onCancel}>
            {t('txt_cancel')} <span className="nx-kbd">esc</span>
          </button>
          <button type="button" className="nx-btn" disabled={!canConfirm} onClick={() => props.onConfirm(orgId, [...selected])}>
            {props.submitting ? STR.sharing : manage ? STR.save : STR.share} <span className="nx-kbd on-fill">↵</span>
          </button>
        </div>
        {manage && props.onUnshare && (
          <button type="button" className="nx-help accent-link unshare-link" onClick={() => setUnshareStep(true)}>
            {STR.makePersonal}
          </button>
        )}
        </>
        )}
      </div>
    </div>
  );
}
