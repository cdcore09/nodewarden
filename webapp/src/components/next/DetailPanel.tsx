// NodeWarden Next (issue #16, slice 3): item detail panel.
// Design contract: mockups/03-detail.html. Credential values are mono kv rows
// with copy/reveal on the row; the admin long tail (attachments, history)
// bridges to classic honestly instead of being half-rebuilt.
import { useEffect, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import { calcTotpNow, type TotpCodeResult } from '@/lib/crypto';
import { TypeIcon, cipherTypeLabel } from '@/components/vault/vault-page-helpers';
import { FIELD_GROUPS } from './editor-fields';
import type { Cipher, Folder } from '@/lib/types';

const STR = {
  reveal: 'Reveal',
  hide: 'Hide',
  copy: 'Copy',
  openSite: 'Open',
  username: 'Username',
  password: 'Password',
  oneTimeCode: 'One-time code',
  website: 'Website',
  notes: 'Notes',
  edit: 'Edit',
  share: 'Share',
  openClassic: 'Open in classic',
  close: 'Close',
};

export type DetailCopyKind = 'password' | 'username' | 'totp' | 'field';

interface DetailPanelProps {
  cipher: Cipher;
  folders: Folder[];
  canShare: boolean;
  onCopyValue: (value: string, label: string) => void;
  onEdit: () => void;
  onShare: () => void;
  onOpenClassic: () => void;
  onClose: () => void;
}

function draftValue(cipher: Cipher, key: string): string {
  const dec = 'dec' + key.charAt(0).toUpperCase() + key.slice(1);
  const sections = [cipher.card, cipher.identity, (cipher as Record<string, unknown>).bankAccount, (cipher as Record<string, unknown>).driversLicense, (cipher as Record<string, unknown>).passport];
  for (const section of sections) {
    if (section && typeof section === 'object') {
      const rec = section as Record<string, unknown>;
      if (typeof rec[dec] === 'string' && rec[dec]) return rec[dec] as string;
    }
  }
  return '';
}

// FIELD_GROUPS keys are VaultDraft-flat (e.g. cardNumber, identFirstName);
// map them onto the decrypted cipher sections for display.
const DISPLAY_KEY_MAP: Record<string, string> = {
  cardholderName: 'cardholderName', cardNumber: 'number', cardBrand: 'brand',
  cardExpMonth: 'expMonth', cardExpYear: 'expYear', cardCode: 'code',
};

function displayFieldValue(cipher: Cipher, key: string): string {
  if (key.startsWith('card')) {
    const mapped = DISPLAY_KEY_MAP[key] || key;
    return draftValue(cipher, mapped);
  }
  if (key.startsWith('ident')) {
    const bare = key.slice(5);
    return draftValue(cipher, bare.charAt(0).toLowerCase() + bare.slice(1));
  }
  if (key.startsWith('bank')) {
    const bare = key.slice(4);
    return draftValue(cipher, bare.charAt(0).toLowerCase() + bare.slice(1));
  }
  if (key.startsWith('license')) {
    const bare = key.slice(7);
    return draftValue(cipher, bare.charAt(0).toLowerCase() + bare.slice(1));
  }
  if (key.startsWith('passport')) {
    const bare = key.slice(8);
    return draftValue(cipher, bare.charAt(0).toLowerCase() + bare.slice(1));
  }
  return '';
}

export default function DetailPanel(props: DetailPanelProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [totpLive, setTotpLive] = useState<TotpCodeResult | null>(null);
  const login = props.cipher.type === 1 ? props.cipher.login : null;
  const folderName = props.cipher.folderId
    ? props.folders.find((f) => f.id === props.cipher.folderId)?.decName || ''
    : '';

  useEffect(() => {
    setShowPassword(false);
  }, [props.cipher.id]);

  useEffect(() => {
    setTotpLive(null);
    const secret = login?.decTotp || '';
    if (!secret) return;
    let alive = true;
    const tick = async () => {
      const next = await calcTotpNow(secret);
      if (alive) setTotpLive(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [props.cipher.id, login?.decTotp]);

  const uris = (login?.uris || []).map((u) => u.decUri || u.uri || '').filter(Boolean);
  const fields = FIELD_GROUPS[props.cipher.type] || [];

  return (
    <aside className="nx-panel" aria-label={props.cipher.decName || ''}>
      <div className="phead">
        <span className="ico"><TypeIcon type={props.cipher.type} /></span>
        <div>
          <h2>{props.cipher.decName || ''}</h2>
          <div className="psub">
            <span>{folderName || cipherTypeLabel(props.cipher.type)}</span>
            {props.cipher.organizationId && <span className="nx-badge org">org</span>}
          </div>
        </div>
        <button type="button" className="nx-iconbtn pclose" aria-label={STR.close} onClick={props.onClose}>✕</button>
      </div>

      <div>
        {login && (
          <>
            {login.decUsername && (
              <div className="nx-kv">
                <span className="nx-overline">{STR.username}</span>
                <span className="kval">
                  {login.decUsername}
                  <span className="kacts">
                    <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(login.decUsername || '', STR.username)}>⧉</button>
                  </span>
                </span>
              </div>
            )}
            {login.decPassword && (
              <div className="nx-kv">
                <span className="nx-overline">{STR.password}</span>
                <span className="kval">
                  {showPassword ? login.decPassword : <span className="mask">••••••••••••</span>}
                  <span className="kacts">
                    <button type="button" className="nx-iconbtn" title={showPassword ? STR.hide : STR.reveal} onClick={() => setShowPassword((v) => !v)}>
                      {showPassword ? '◎' : '◉'}
                    </button>
                    <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(login.decPassword || '', STR.password)}>⧉</button>
                  </span>
                </span>
              </div>
            )}
            {totpLive && (
              <div className="nx-kv">
                <span className="nx-overline">{STR.oneTimeCode}</span>
                <span className="kval">
                  {totpLive.code}
                  <span className="nx-totp" style={{ marginLeft: 4 }}>
                    <span className="ring" style={{ '--ring': `${Math.round((totpLive.remain / totpLive.period) * 100)}%` }} />
                    <span>{totpLive.remain}s</span>
                  </span>
                  <span className="kacts">
                    <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(totpLive.code, STR.oneTimeCode)}>⧉</button>
                  </span>
                </span>
              </div>
            )}
            {uris.map((uri) => (
              <div className="nx-kv" key={uri}>
                <span className="nx-overline">{STR.website}</span>
                <span className="kval">
                  {uri}
                  <span className="kacts">
                    <a className="nx-iconbtn" title={STR.openSite} href={/^https?:\/\//i.test(uri) ? uri : `https://${uri}`} target="_blank" rel="noreferrer noopener">↗</a>
                    <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(uri, STR.website)}>⧉</button>
                  </span>
                </span>
              </div>
            ))}
          </>
        )}

        {!login && fields.map((field) => {
          const value = displayFieldValue(props.cipher, field.key as string);
          if (!value) return null;
          return (
            <div className="nx-kv" key={String(field.key)}>
              <span className="nx-overline">{field.label}</span>
              <span className={`kval${field.mono ? '' : ' ui-face'}`}>
                {value}
                <span className="kacts">
                  <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(value, field.label)}>⧉</button>
                </span>
              </span>
            </div>
          );
        })}

        {props.cipher.decNotes && (
          <div className="nx-kv">
            <span className="nx-overline">{STR.notes}</span>
            <span className="kval ui-face" style={{ whiteSpace: 'pre-wrap', color: 'var(--nx-ink-muted)' }}>{props.cipher.decNotes as string}</span>
          </div>
        )}
      </div>

      <div className="pactions">
        <button type="button" className="nx-btn ghost" onClick={props.onEdit}>
          {STR.edit} <span className="nx-kbd">⌘E</span>
        </button>
        {props.canShare && !props.cipher.organizationId && (
          <button type="button" className="nx-btn ghost" onClick={props.onShare}>
            {STR.share} <span className="nx-kbd">⌘S</span>
          </button>
        )}
        <button type="button" className="nx-btn ghost" style={{ marginLeft: 'auto' }} onClick={props.onOpenClassic}>
          {STR.openClassic}
        </button>
      </div>
    </aside>
  );
}
