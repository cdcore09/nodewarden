// NodeWarden Next (issue #16, slice 3): the one editor that serves saving
// (J2), editing (J3), and later audit-fix (J5). Autofocus + full Tab order +
// masked password + inline generator with per-site rules + ⌘Enter save +
// Esc dirty guard. Design contract: mockups/04-editor.html.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import { estimateStrength } from '@/lib/password-generator';
import { DEFAULT_RULES, clampRules, generateCandidate, type GeneratorRules } from './generator-rules';
import { FIELD_GROUPS } from './editor-fields';
import type { Folder, VaultDraft } from '@/lib/types';

const STR = {
  newItem: 'New',
  editItem: 'Edit',
  name: 'Name',
  folder: 'Folder',
  noFolder: 'No folder',
  username: 'Username',
  password: 'Password',
  passwordPlaceholder: 'paste, type, or generate',
  totp: 'One-time code secret',
  totpPlaceholder: 'otpauth:// or base32',
  website: 'Website',
  addWebsite: 'Add website',
  removeWebsite: 'Remove website',
  notes: 'Notes',
  favorite: 'Favorite',
  reprompt: 'Ask for master password',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  discard: 'Discard',
  keepEditing: 'Keep editing',
  discardPrompt: 'Discard unsaved changes?',
  strength: ['very weak', 'weak', 'fair', 'strong', 'very strong'],
  rules: 'Password rules',
  words: 'words',
  chars: 'characters',
  useReroll: 'use / reroll',
  ambiguous: 'no ambiguous',
  reveal: 'Reveal',
  hide: 'Hide',
};

// Session-persisted generator rules (module scope, deliberately not stored).
let sessionRules: GeneratorRules = { ...DEFAULT_RULES };

function GeneratorWell(props: { onUse: (value: string) => void }) {
  const [rules, setRules] = useState<GeneratorRules>(() => ({ ...sessionRules }));
  const [candidate, setCandidate] = useState(() => generateCandidate(sessionRules));
  const [showRules, setShowRules] = useState(false);

  const applyRules = (patch: Partial<GeneratorRules>) => {
    const next = clampRules({ ...rules, ...patch });
    sessionRules = next;
    setRules(next);
    setCandidate(generateCandidate(next));
  };

  const strengthIndex = Math.max(0, Math.min(4, estimateStrength(
    rules.mode === 'words' ? 'passphrase' : 'password',
    candidate,
    rules.mode === 'words' ? rules.length : undefined
  )));

  const use = () => {
    props.onUse(candidate);
    setCandidate(generateCandidate(rules));
  };

  return (
    <>
      <div className="nx-genwell">
        <span className="cand">{candidate}</span>
        <span className="gpush">
          <span className={`nx-badge ${strengthIndex >= 3 ? 'ok' : 'warn'}`}>{STR.strength[strengthIndex]}</span>
          <button type="button" className="nx-btn ghost" style={{ height: 26, padding: '0 10px', fontSize: 'var(--nx-text-sm)' }} onClick={use}>
            <span className="nx-kbd">⌘G</span> {STR.useReroll}
          </button>
          <button
            type="button"
            className="nx-iconbtn"
            title={STR.rules}
            aria-expanded={showRules}
            style={showRules ? { color: 'var(--nx-accent)' } : undefined}
            onClick={() => setShowRules((v) => !v)}
          >
            ⚙
          </button>
        </span>
      </div>
      {showRules && (
        <div className="nx-genparams">
          <span className="nx-seg" role="group" aria-label={STR.rules}>
            <button type="button" className={rules.mode === 'words' ? 'on' : ''} onClick={() => applyRules({ mode: 'words', length: 4 })}>{STR.words}</button>
            <button type="button" className={rules.mode === 'chars' ? 'on' : ''} onClick={() => applyRules({ mode: 'chars', length: 20 })}>{STR.chars}</button>
          </span>
          <span className="nx-step">
            <button type="button" aria-label="-" onClick={() => applyRules({ length: rules.length - 1 })}>−</button>
            <span className="n">{rules.length}</span>
            <button type="button" aria-label="+" onClick={() => applyRules({ length: rules.length + 1 })}>+</button>
          </span>
          {rules.mode === 'chars' && (
            <>
              <button type="button" className={`nx-tog${rules.upper ? ' on' : ''}`} onClick={() => applyRules({ upper: !rules.upper })}>A-Z</button>
              <button type="button" className={`nx-tog${rules.digits ? ' on' : ''}`} onClick={() => applyRules({ digits: !rules.digits })}>0-9</button>
              <button type="button" className={`nx-tog${rules.special ? ' on' : ''}`} onClick={() => applyRules({ special: !rules.special })}>!#$</button>
              <button type="button" className={`nx-tog${rules.ambiguous ? '' : ' on'}`} onClick={() => applyRules({ ambiguous: !rules.ambiguous })}>{STR.ambiguous}</button>
            </>
          )}
          {rules.mode === 'words' && (
            <button type="button" className={`nx-tog${rules.digits ? ' on' : ''}`} onClick={() => applyRules({ digits: !rules.digits })}>0-9</button>
          )}
        </div>
      )}
    </>
  );
}

interface EditorPanelProps {
  draft: VaultDraft;
  isCreating: boolean;
  folders: Folder[];
  saving: boolean;
  dirty: boolean;
  onPatch: (patch: Partial<VaultDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function EditorPanel(props: EditorPanelProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [guard, setGuard] = useState(false);
  const isLogin = props.draft.type === 1;
  const fields = FIELD_GROUPS[props.draft.type] || [];

  useEffect(() => {
    // Create-from-query arrives with the name prefilled: focus username then.
    if (props.isCreating && props.draft.name && isLogin) usernameRef.current?.focus();
    else nameRef.current?.focus();
  }, []);

  const requestCancel = () => {
    if (props.dirty) setGuard(true);
    else props.onCancel();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && (event.key === 'Enter' || event.key.toLowerCase() === 's')) {
      event.preventDefault();
      event.stopPropagation();
      if (!props.saving) props.onSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (guard) setGuard(false);
      else requestCancel();
    } else if (meta && event.key.toLowerCase() === 'g' && isLogin) {
      // handled by the well's button; prevent browser find-next
      event.preventDefault();
      const btn = document.querySelector<HTMLButtonElement>('.nx-genwell .nx-btn');
      btn?.click();
    }
  };

  const uris = props.draft.loginUris || [];

  return (
    <aside className="nx-panel" onKeyDown={handleKeyDown}>
      <div className="phead">
        <span className="ico">{props.isCreating ? '＋' : '✎'}</span>
        <h2>{props.isCreating ? STR.newItem : STR.editItem}</h2>
        <button type="button" className="nx-iconbtn pclose" aria-label={STR.cancel} onClick={requestCancel}>✕</button>
      </div>

      <div className="nx-editor">
        <label className="nx-field">
          <span className="nx-overline">{STR.name}</span>
          <input
            ref={nameRef}
            className="nx-input"
            type="text"
            value={props.draft.name}
            onInput={(e) => props.onPatch({ name: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>

        {isLogin && (
          <>
            <label className="nx-field">
              <span className="nx-overline">{STR.username}</span>
              <input
                ref={usernameRef}
                className="nx-input nx-data"
                type="text"
                autoComplete="off"
                value={props.draft.loginUsername}
                onInput={(e) => props.onPatch({ loginUsername: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <div className="nx-field">
              <span className="nx-overline">{STR.password}</span>
              <div className="erow">
                <input
                  className="nx-input nx-data"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={STR.passwordPlaceholder}
                  value={props.draft.loginPassword}
                  onInput={(e) => props.onPatch({ loginPassword: (e.currentTarget as HTMLInputElement).value })}
                />
                <button type="button" className="nx-iconbtn" title={showPassword ? STR.hide : STR.reveal} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? '◎' : '◉'}
                </button>
              </div>
              <GeneratorWell onUse={(value) => props.onPatch({ loginPassword: value })} />
            </div>
            <label className="nx-field">
              <span className="nx-overline">{STR.totp}</span>
              <input
                className="nx-input nx-data"
                type="text"
                placeholder={STR.totpPlaceholder}
                value={props.draft.loginTotp}
                onInput={(e) => props.onPatch({ loginTotp: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <div className="nx-field">
              <span className="nx-overline">{STR.website}</span>
              {uris.map((uri, index) => (
                <div className="urirow" key={index}>
                  <input
                    className="nx-input nx-data"
                    type="text"
                    placeholder="https://…"
                    value={uri.uri}
                    onInput={(e) => {
                      const next = uris.slice();
                      next[index] = { ...next[index], uri: (e.currentTarget as HTMLInputElement).value };
                      props.onPatch({ loginUris: next });
                    }}
                  />
                  {uris.length > 1 && (
                    <button
                      type="button"
                      className="nx-iconbtn"
                      title={STR.removeWebsite}
                      onClick={() => props.onPatch({ loginUris: uris.filter((_, i) => i !== index) })}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="nx-btn ghost"
                  style={{ height: 28, padding: '0 10px', fontSize: 'var(--nx-text-sm)' }}
                  onClick={() => props.onPatch({ loginUris: [...uris, { uri: '', match: null }] })}
                >
                  {STR.addWebsite}
                </button>
              </div>
            </div>
          </>
        )}

        {!isLogin && fields.map((field) => (
          <label className="nx-field" key={String(field.key)}>
            <span className="nx-overline">{field.label}</span>
            <input
              className={`nx-input${field.mono ? ' nx-data' : ''}`}
              type="text"
              value={(props.draft[field.key] as string) || ''}
              onInput={(e) => props.onPatch({ [field.key]: (e.currentTarget as HTMLInputElement).value } as Partial<VaultDraft>)}
            />
          </label>
        ))}

        <label className="nx-field">
          <span className="nx-overline">{STR.folder}</span>
          <select
            className="nx-input"
            value={props.draft.folderId}
            onInput={(e) => props.onPatch({ folderId: (e.currentTarget as HTMLSelectElement).value })}
          >
            <option value="">{STR.noFolder}</option>
            {props.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.decName || folder.name || ''}</option>
            ))}
          </select>
        </label>

        <label className="nx-field">
          <span className="nx-overline">{STR.notes}</span>
          <textarea
            className="nx-input"
            value={props.draft.notes}
            onInput={(e) => props.onPatch({ notes: (e.currentTarget as HTMLTextAreaElement).value })}
          />
        </label>

        <div className="echecks">
          <label>
            <input
              type="checkbox"
              checked={props.draft.favorite}
              onInput={(e) => props.onPatch({ favorite: (e.currentTarget as HTMLInputElement).checked })}
            />
            {STR.favorite}
          </label>
          <label>
            <input
              type="checkbox"
              checked={props.draft.reprompt}
              onInput={(e) => props.onPatch({ reprompt: (e.currentTarget as HTMLInputElement).checked })}
            />
            {STR.reprompt}
          </label>
        </div>
      </div>

      <div className="pactions">
        {guard ? (
          <div className="nx-guard">
            <span>{STR.discardPrompt}</span>
            <span className="grow" />
            <button type="button" className="nx-btn ghost" style={{ borderColor: 'var(--nx-warn)', color: 'var(--nx-warn)' }} onClick={props.onCancel}>
              {STR.discard}
            </button>
            <button type="button" className="nx-btn ghost" onClick={() => setGuard(false)}>
              {STR.keepEditing} <span className="nx-kbd">esc</span>
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="nx-btn" disabled={props.saving || !props.draft.name.trim()} onClick={props.onSave}>
              {props.saving ? STR.saving : STR.save} <span className="nx-kbd" style={{ borderColor: 'transparent', background: 'rgba(255,255,255,.2)', color: 'inherit' }}>⌘↵</span>
            </button>
            <button type="button" className="nx-btn ghost" disabled={props.saving} onClick={requestCancel}>
              {STR.cancel}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
