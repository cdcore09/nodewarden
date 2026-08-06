// NodeWarden Next (issue #16, slice 5): Sends — list, create/edit text sends,
// copy share links, delete with confirm. File sends can be received/managed
// here; creating them uses the file picker like the editor's attachments.
import { useRef, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import { FileText, Link2, Pencil, Plus, Send as SendIcon, Trash2 } from 'lucide-preact';
import type { Send, SendDraft } from '@/lib/types';

const STR = {
  intro: 'Share a secret note or file as an expiring link — the recipient needs no account, and you can kill the link at any time.',
  emptyTitle: 'Share secrets that expire',
  emptyBody: 'Passwords pasted into chat or email live forever in someone’s inbox. A send is a link that doesn’t: it self-destructs on schedule, can require a password, and shows you how often it was opened.',
  steps: [
    ['Create', 'a text note or pick a file — the link is copied for you on save'],
    ['Share the link', 'anyone can open it, no account needed'],
    ['It expires', 'on the schedule you set — or disable it instantly'],
  ] as Array<[string, string]>,
  saveHint: 'Saving copies the share link to your clipboard.',
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
  expirationDays: 'Expire after (days)',
  maxAccessCount: 'Max views',
  never: 'Never',
  unlimited: 'Unlimited',
  notes: 'Notes',
  disabledField: 'Disabled',
  password: 'Password (optional)',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  deletes: (d: string) => `deletes ${d}`,
  expiresAt: (d: string) => `expires ${d}`,
  views: (n: number, max?: number | null) => (max != null ? `${n}/${max} views` : `${n} views`),
  disabled: 'disabled',
};

function daysFromNow(iso: string | null | undefined, fallback: number): string {
  if (!iso) return String(fallback);
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return String(fallback);
  const days = Math.ceil((time - Date.now()) / (24 * 60 * 60 * 1000));
  return String(Math.max(days, 0));
}

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
      notes: send.decNotes || '',
      text: (send.text as { decText?: string } | null)?.decText || '',
      deletionDays: daysFromNow(send.deletionDate, 7),
      expirationDays: send.expirationDate ? daysFromNow(send.expirationDate, 0) : '',
      maxAccessCount: send.maxAccessCount !== null && send.maxAccessCount !== undefined ? String(send.maxAccessCount) : '',
      hasPassword: !!send.password,
      disabled: !!send.disabled,
    });
  };

  return (
    <div className="nx-list">
      <div className="nx-help sends-intro">{STR.intro}</div>
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
          <details className="nx-details" open={
            !!draft.password || draft.deletionDays !== '7' || !!draft.expirationDays ||
            !!draft.maxAccessCount || !!draft.notes || draft.disabled
          }>
            <summary>Options<span style={{ color: 'var(--nx-ink-faint)' }}>expiry · views · notes · password</span></summary>
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
          <div className="erow">
            <label className="nx-field" style={{ flex: 1 }}>
              <span className="nx-overline">{STR.expirationDays}</span>
              <input className="nx-input nx-data" type="number" min="0" placeholder={STR.never} value={draft.expirationDays}
                onInput={(e) => setDraft({ ...draft, expirationDays: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <label className="nx-field" style={{ flex: 1 }}>
              <span className="nx-overline">{STR.maxAccessCount}</span>
              <input className="nx-input nx-data" type="number" min="0" placeholder={STR.unlimited} value={draft.maxAccessCount}
                onInput={(e) => setDraft({ ...draft, maxAccessCount: (e.currentTarget as HTMLInputElement).value })} />
            </label>
          </div>
          <label className="nx-field">
            <span className="nx-overline">{STR.notes}</span>
            <textarea className="nx-input" value={draft.notes}
              onInput={(e) => setDraft({ ...draft, notes: (e.currentTarget as HTMLTextAreaElement).value })} />
          </label>
          <div className="echecks">
            <label>
              <input type="checkbox" checked={draft.disabled}
                onInput={(e) => setDraft({ ...draft, disabled: (e.currentTarget as HTMLInputElement).checked })} />
              {STR.disabledField}
            </label>
          </div>
            </div>
          </details>
          {!editing && <div className="nx-help">{STR.saveHint}</div>}
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
      {!props.loading && props.sends.length === 0 && !draft && (
        <div className="sends-hero">
          <div className="hero-ico"><SendIcon size={22} /></div>
          <div className="hero-title">{STR.emptyTitle}</div>
          <div className="hero-body">{STR.emptyBody}</div>
          <ol className="hero-steps">
            {STR.steps.map(([head, rest], index) => (
              <li key={head}>
                <span className="n nx-data">{index + 1}</span>
                <span><strong>{head}</strong> — {rest}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="sends-cards">
      {props.sends.map((send) => {
        const sub: string[] = [];
        if (send.expirationDate) sub.push(STR.expiresAt(new Date(send.expirationDate).toLocaleDateString()));
        if (send.deletionDate) sub.push(STR.deletes(new Date(send.deletionDate).toLocaleDateString()));
        if (typeof send.accessCount === 'number') sub.push(STR.views(send.accessCount, send.maxAccessCount ?? null));
        return (
        <div key={send.id} className="send-card">
          <div className="card-id">
            <span className="ico">{send.type === 2 ? <FileText size={14} /> : <Link2 size={14} />}</span>
            <span className="who">
              <span className="title">{send.decName || ''}</span>
              <span className="sub nx-data">{sub.join(' · ')}</span>
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
        );
      })}
      </div>
      </div>
      </div>
    </div>
  );
}
