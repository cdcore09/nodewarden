// NodeWarden Next (issue #16, slice 3): item detail panel.
// Design contract: mockups/03-detail.html. Credential values are mono kv rows
// with copy/reveal on the row; the admin long tail (attachments, history)
// bridges to classic honestly instead of being half-rebuilt.
import { useEffect, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import { calcTotpNow, type TotpCodeResult } from '@/lib/crypto';
import { checkPasswordLeaked, type PasswordBreachResult } from '@/lib/password-security';
import { estimateStrength } from '@/lib/password-generator';
import { TypeIcon, cipherTypeLabel, parseFieldType, toBooleanFieldValue } from '@/components/vault/vault-page-helpers';
import WebsiteIcon from '@/components/vault/WebsiteIcon';
import { MoreHorizontal } from 'lucide-preact';
import { FIELD_GROUPS } from './editor-fields';
import type { Cipher, CipherAttachment, Folder } from '@/lib/types';

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
  close: 'Close',
  customFields: 'Custom fields',
  attachments: 'Attachments',
  download: 'Download',
  breachCheck: 'check breach',
  breachChecking: 'checking…',
  breachSafe: 'not found in known breaches',
  breachFound: (n: number) => `seen in breaches ${n.toLocaleString()} times — change it`,
  breachError: 'breach check failed',
  history: (n: number) => `Password history (${n})`,
  yes: 'Yes',
  no: 'No',
};

export type DetailCopyKind = 'password' | 'username' | 'totp' | 'field';

interface DetailPanelProps {
  cipher: Cipher;
  folders: Folder[];
  canShare: boolean;
  onCopyValue: (value: string, label: string) => void;
  onDownloadAttachment: (attachment: CipherAttachment) => void;
  downloadingAttachmentKey?: string;
  onEdit: () => void;
  onShare: () => void;
  onMore: (x: number, y: number) => void;
  onClose: () => void;
}

const STRENGTH_LABELS = ['very weak', 'weak', 'fair', 'strong', 'very strong'];

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
  const [breach, setBreach] = useState<'idle' | 'checking' | 'error' | PasswordBreachResult>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hiddenFieldShown, setHiddenFieldShown] = useState<Record<number, boolean>>({});
  const login = props.cipher.type === 1 ? props.cipher.login : null;
  const folderName = props.cipher.folderId
    ? props.folders.find((f) => f.id === props.cipher.folderId)?.decName || ''
    : '';

  useEffect(() => {
    setShowPassword(false);
    setBreach('idle');
    setHistoryOpen(false);
    setHiddenFieldShown({});
  }, [props.cipher.id]);

  const runBreachCheck = async () => {
    const password = login?.decPassword || '';
    if (!password || breach === 'checking') return;
    setBreach('checking');
    try {
      setBreach(await checkPasswordLeaked(password, fetch));
    } catch {
      setBreach('error');
    }
  };

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
        <span className="ico">
          {props.cipher.type === 1
            ? <WebsiteIcon cipher={props.cipher} fallback={<TypeIcon type={props.cipher.type} />} />
            : <TypeIcon type={props.cipher.type} />}
        </span>
        <div>
          <h2>{props.cipher.decName || ''}</h2>
          <div className="psub">
            <span>{folderName || cipherTypeLabel(props.cipher.type)}</span>
            {props.cipher.organizationId && <span className="nx-badge org">org</span>}
          </div>
        </div>
        <button
          type="button"
          className="nx-iconbtn pclose"
          aria-label="More actions"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            props.onMore(rect.left - 220, rect.bottom + 4);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        <button type="button" className="nx-iconbtn" aria-label={STR.close} onClick={props.onClose}>✕</button>
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
                <span className="nx-help">
                  <span className={`nx-badge ${estimateStrength('password', login.decPassword || '') >= 3 ? 'ok' : 'warn'}`} style={{ marginRight: 8 }}>
                    {STRENGTH_LABELS[Math.max(0, Math.min(4, estimateStrength('password', login.decPassword || '')))]}
                  </span>
                  {breach === 'idle' && (
                    <button type="button" className="nx-alt-inline" style={{ color: 'var(--nx-accent)', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={() => void runBreachCheck()}>
                      {STR.breachCheck}
                    </button>
                  )}
                  {breach === 'checking' && STR.breachChecking}
                  {breach === 'error' && <span style={{ color: 'var(--nx-warn)' }}>{STR.breachError}</span>}
                  {typeof breach === 'object' && (
                    breach.count && breach.count > 0
                      ? <span style={{ color: 'var(--nx-danger)' }}>{STR.breachFound(breach.count)}</span>
                      : <span style={{ color: 'var(--nx-ok)' }}>{STR.breachSafe}</span>
                  )}
                </span>
                {(props.cipher.passwordHistory || []).length > 0 && (
                  <span className="nx-help">
                    <button type="button" style={{ color: 'var(--nx-ink-muted)', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                      aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
                      {STR.history((props.cipher.passwordHistory || []).length)}
                    </button>
                  </span>
                )}
                {historyOpen && (props.cipher.passwordHistory || []).map((entry, index) => (
                  <span className="kval" key={index} style={{ fontSize: 'var(--nx-text-sm)', color: 'var(--nx-ink-muted)' }}>
                    {entry.decPassword || '•••'}
                    <span className="kacts">
                      <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(entry.decPassword || '', STR.password)}>⧉</button>
                    </span>
                  </span>
                ))}
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

        {(props.cipher.fields || []).length > 0 && (
          <div className="nx-kv">
            <span className="nx-overline">{STR.customFields}</span>
            {(props.cipher.fields || []).map((field, index) => {
              const fieldType = parseFieldType(field.type);
              const label = field.decName || field.name || '';
              const value = field.decValue || '';
              return (
                <span className="kval" key={index} style={{ fontSize: 'var(--nx-text-sm)' }}>
                  <span className="ui-face" style={{ color: 'var(--nx-ink-muted)', minWidth: 90 }}>{label}</span>
                  {fieldType === 2
                    ? (toBooleanFieldValue(value) ? STR.yes : STR.no)
                    : fieldType === 1 && !hiddenFieldShown[index]
                      ? <span className="mask">••••••</span>
                      : value}
                  <span className="kacts">
                    {fieldType === 1 && (
                      <button type="button" className="nx-iconbtn" title={hiddenFieldShown[index] ? STR.hide : STR.reveal}
                        onClick={() => setHiddenFieldShown((prev) => ({ ...prev, [index]: !prev[index] }))}>
                        {hiddenFieldShown[index] ? '◎' : '◉'}
                      </button>
                    )}
                    {fieldType !== 2 && (
                      <button type="button" className="nx-iconbtn" title={STR.copy} onClick={() => props.onCopyValue(value, label || STR.customFields)}>⧉</button>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {(props.cipher.attachments || []).length > 0 && (
          <div className="nx-kv">
            <span className="nx-overline">{STR.attachments}</span>
            {(props.cipher.attachments || []).map((attachment) => (
              <span className="kval ui-face" key={attachment.id || ''} style={{ fontSize: 'var(--nx-text-sm)' }}>
                {attachment.decFileName || attachment.fileName || attachment.id}
                {attachment.sizeName ? <span style={{ color: 'var(--nx-ink-faint)' }}> · {attachment.sizeName}</span> : null}
                <span className="kacts">
                  <button
                    type="button"
                    className="nx-iconbtn"
                    title={STR.download}
                    disabled={props.downloadingAttachmentKey === `${props.cipher.id}:${attachment.id || ''}`}
                    onClick={() => props.onDownloadAttachment(attachment)}
                  >
                    {props.downloadingAttachmentKey === `${props.cipher.id}:${attachment.id || ''}` ? '…' : '↓'}
                  </button>
                </span>
              </span>
            ))}
          </div>
        )}

        {props.cipher.decNotes && (
          <div className="nx-kv">
            <span className="nx-overline">{STR.notes}</span>
            <span className="kval ui-face" style={{ whiteSpace: 'pre-wrap', color: 'var(--nx-ink-muted)' }}>{props.cipher.decNotes as string}</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 'var(--nx-sp-4)' }}>
        <div className="nx-help" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--nx-sp-3)' }}>
          {props.cipher.revisionDate && (
            <span>Last edited {new Date(props.cipher.revisionDate).toLocaleString()}</span>
          )}
          {props.cipher.creationDate && (
            <span>Added {new Date(props.cipher.creationDate).toLocaleString()}</span>
          )}
        </div>
        <div className="pactions" style={{ marginTop: 0, paddingTop: 0 }}>
          <button type="button" className="nx-btn ghost" onClick={props.onEdit}>
            {STR.edit} <span className="nx-kbd">⌘E</span>
          </button>
          {props.canShare && !props.cipher.organizationId && (
            <button type="button" className="nx-btn ghost" onClick={props.onShare}>
              {STR.share} <span className="nx-kbd">⌘S</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
