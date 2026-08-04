// NodeWarden Next (issue #16, slice 5): Sends — list, create/edit text sends,
// copy share links, delete with confirm. File sends can be received/managed
// here; creating them uses the file picker like the editor's attachments.
import { useRef, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import { FileText, Link2, Pencil, Plus, Trash2 } from 'lucide-preact';
import type { Send, SendDraft } from '@/lib/types';

const STR = {
  empty: 'No sends yet. A send is an expiring, shareable link to a text note or file.',
  newText: 'New text send',
  newFile: 'New file send',
  copyLink: 'Copy link',
  edit: 'Edit',
  del: 'Delete',
  delTitle: (name: string) => `Delete send “${name}”?`,
  delMessage: 'Anyone with the link loses access immediately.',
  name: 'Name',
  text: 'Text',
  file: 'File',
  deletionDays: 'Delete after (days)',
  password: 'Password (optional)',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  expires: (d: string) => `expires ${d}`,
  views: (n: number) => `${n} views`,
  disabled: 'disabled',
};

function emptyDraft(type: 'text' | 'file'): SendDraft {
  return {
    type, name: '', notes: '', text: '', file: null,
    deletionDays: '7', expirationDays: '', maxAccessCount: '', password: '',
    disabled: false,
  };
}

function sendUrl(send: Send): string {
  const raw = (send as { shareUrl?: string }).shareUrl || `/send/${send.accessId}`;
  return /^https?:\/\//i.test(raw) ? raw : `${window.location.origin}${raw}`;
}

interface NextSendsPageProps {
  sends: Send[];
  loading: boolean;
  onCreate: (draft: SendDraft, autoCopyLink: boolean) => Promise<void>;
  onUpdate: (send: Send, draft: SendDraft, autoCopyLink: boolean) => Promise<void>;
  onDelete: (send: Send) => Promise<void>;
  onCopyValue: (value: string, label: string) => void;
  onConfirm: (title: string, message: string, confirmLabel: string, run: () => Promise<void>) => void;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
}

export default function NextSendsPage(props: NextSendsPageProps) {
  const [draft, setDraft] = useState<SendDraft | null>(null);
  const [editing, setEditing] = useState<Send | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!draft || saving || !draft.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await props.onUpdate(editing, draft, false);
      else await props.onCreate(draft, true);
      setDraft(null);
      setEditing(null);
    } catch (error) {
      props.onNotify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (send: Send) => {
    setEditing(send);
    setDraft({
      ...emptyDraft(send.type === 2 ? 'file' : 'text'),
      id: send.id,
      name: send.decName || '',
      text: (send.text as { decText?: string } | null)?.decText || '',
      hasPassword: !!send.password,
      disabled: !!send.disabled,
    });
  };

  return (
    <div className="nx-list">
      <div style={{ display: 'flex', gap: 'var(--nx-sp-2)', marginBottom: 'var(--nx-sp-3)' }}>
        <button type="button" className="nx-btn" onClick={() => { setEditing(null); setDraft(emptyDraft('text')); }}>
          <Plus size={14} /> {STR.newText}
        </button>
        <button type="button" className="nx-btn ghost" onClick={() => fileRef.current?.click()}>
          <FileText size={14} /> {STR.newFile}
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = (e.currentTarget as HTMLInputElement).files?.[0] || null;
            if (file) {
              setEditing(null);
              setDraft({ ...emptyDraft('file'), file, name: file.name });
            }
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </div>

      <div className={`sends-grid${draft ? ' has-editor' : ''}`}>
      {draft && (
        <div className="nx-editor sends-editor"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); setEditing(null); }
          }}
        >
          <label className="nx-field">
            <span className="nx-overline">{STR.name}</span>
            <input className="nx-input" type="text" autoFocus value={draft.name}
              onInput={(e) => setDraft({ ...draft, name: (e.currentTarget as HTMLInputElement).value })} />
          </label>
          {draft.type === 'text' ? (
            <label className="nx-field">
              <span className="nx-overline">{STR.text}</span>
              <textarea className="nx-input nx-data" value={draft.text}
                onInput={(e) => setDraft({ ...draft, text: (e.currentTarget as HTMLTextAreaElement).value })} />
            </label>
          ) : (
            <div className="nx-help">{STR.file}: {draft.file?.name || '—'}</div>
          )}
          <details className="nx-details" open={!!draft.password || draft.deletionDays !== '7'}>
            <summary>Options<span style={{ color: 'var(--nx-ink-faint)' }}>expiry · password</span></summary>
            <div className="details-body">
          <div className="erow">
            <label className="nx-field" style={{ flex: 1 }}>
              <span className="nx-overline">{STR.deletionDays}</span>
              <input className="nx-input nx-data" type="number" min="1" max="31" value={draft.deletionDays}
                onInput={(e) => setDraft({ ...draft, deletionDays: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <label className="nx-field" style={{ flex: 1 }}>
              <span className="nx-overline">{STR.password}</span>
              <input className="nx-input nx-data" type="password" value={draft.password}
                onInput={(e) => setDraft({ ...draft, password: (e.currentTarget as HTMLInputElement).value })} />
            </label>
          </div>
            </div>
          </details>
          <div style={{ display: 'flex', gap: 'var(--nx-sp-2)' }}>
            <button type="button" className="nx-btn" disabled={saving || !draft.name.trim()} onClick={() => void save()}>
              {saving ? STR.saving : STR.save} <span className="nx-kbd on-fill">⌘↵</span>
            </button>
            <button type="button" className="nx-btn ghost" disabled={saving} onClick={() => { setDraft(null); setEditing(null); }}>
              {STR.cancel} <span className="nx-kbd">esc</span>
            </button>
          </div>
        </div>
      )}

      <div className="sends-list">
      {!props.loading && props.sends.length === 0 && !draft && <div className="nx-empty">{STR.empty}</div>}

      <div className="sends-cards">
      {props.sends.map((send) => (
        <div key={send.id} className="send-card">
          <div className="card-id">
            <span className="ico">{send.type === 2 ? <FileText size={14} /> : <Link2 size={14} />}</span>
            <span className="who">
              <span className="title">{send.decName || ''}</span>
              <span className="sub nx-data">
                {send.deletionDate ? STR.expires(new Date(send.deletionDate).toLocaleDateString()) : ''}
                {typeof send.accessCount === 'number' ? ` · ${STR.views(send.accessCount)}` : ''}
              </span>
            </span>
            {send.disabled && <span className="nx-badge warn">{STR.disabled}</span>}
          </div>
          <div className="card-acts">
            <button type="button" className="nx-btn ghost sm" onClick={() => props.onCopyValue(sendUrl(send), 'Link')}>
              <Link2 size={12} /> {STR.copyLink}
            </button>
            <span className="spacer" />
            <button type="button" className="nx-iconbtn" title={STR.edit} onClick={() => startEdit(send)}>
              <Pencil size={13} />
            </button>
            <button
              type="button"
              className="nx-iconbtn"
              title={STR.del}
              onClick={() => props.onConfirm(
                STR.delTitle(send.decName || ''),
                STR.delMessage,
                STR.del,
                () => props.onDelete(send)
              )}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
      </div>
      </div>
      </div>
    </div>
  );
}
