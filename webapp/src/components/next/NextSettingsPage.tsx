// NodeWarden Next (issue #16, slice 5): settings in the Next shell.
// Quick settings live here natively (appearance, interface, session);
// deep security flows (master password, 2FA, passkeys, API keys, devices)
// open the full classic settings sections — the ONLY place the classic
// interface is reachable from (owner directive: no escape hatches elsewhere).
import { t, AVAILABLE_LOCALES, getLocale, setLocale, type Locale } from '@/lib/i18n';
import { readUiVersion, setUiVersion, type UiVersion } from '@/lib/ui-version';
import { SKINS, readSkin, setSkin, type SkinId } from '@/lib/skin';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  EXPORT_FORMATS, type EncryptedJsonMode, type ExportFormatId, type ExportRequest,
} from '@/lib/export-formats';
import { useDialogFocus } from './useDialogFocus';

const STR = {
  appearance: 'Appearance',
  theme: 'Theme',
  themes: { system: 'System', light: 'Light', dark: 'Dark' } as Record<string, string>,
  skin: 'Classic skin',
  skinHelp: 'Applies to the classic interface only.',
  language: 'Language',
  interface: 'Interface',
  interfaceHelp: 'Switching to Classic swaps the whole app back to the stock interface from the next page load. This is the only place that switch lives.',
  interfaces: { v1: 'Classic', v2: 'NodeWarden Next' } as Record<UiVersion, string>,
  session: 'Session',
  lockTimeout: 'Lock after inactivity',
  timeoutAction: 'When the timeout hits',
  actions: { lock: 'Lock the vault', logout: 'Log out' } as Record<string, string>,
  minutes: (n: number) => (n === 0 ? 'Never' : n === 1 ? '1 minute' : `${n} minutes`),
  security: 'Security & account',
  securityHelp: 'These flows open the full classic settings — they involve master-password and two-factor ceremonies that stay unchanged.',
  masterPassword: 'Master password & hint',
  twoStep: 'Two-step login (TOTP · YubiKey · passkeys)',
  keys: 'API keys & recovery code',
  devices: 'Authorized devices',
  domainRules: 'Domain rules',
  backup: 'Backup center',
  admin: 'Admin panel',
  logs: 'Log center',
  exportSection: 'Export vault',
  exportHelp: 'Download a copy of your vault. Pick a format and confirm with your master password.',
  exportButton: 'Export…',
  exportDialogTitle: 'Export vault',
  exportFormatLabel: 'Format',
  exportModeLabel: 'Verify with',
  exportModes: { account: 'Account password', password: 'A separate file password' } as Record<EncryptedJsonMode, string>,
  exportFilePasswordLabel: 'File password',
  exportZipPasswordLabel: 'Zip password (optional)',
  exportMasterPasswordLabel: 'Master password',
  exportSubmit: 'Export',
  exportSubmitting: 'Exporting…',
  exportCancel: 'Cancel',
  exportSuccess: 'Vault exported',
  exportFilePasswordRequired: 'A file password is required',
  exportMasterPasswordRequired: 'Master password is required',
  exportFailed: 'Export failed',
};

type LockMinutes = 0 | 1 | 5 | 15 | 30;

interface NextSettingsPageProps {
  themePreference: 'system' | 'light' | 'dark';
  onThemePreferenceChange: (preference: 'system' | 'light' | 'dark') => void;
  lockTimeoutMinutes: LockMinutes;
  onLockTimeoutChange: (minutes: LockMinutes) => void;
  sessionTimeoutAction: 'lock' | 'logout';
  onSessionTimeoutActionChange: (action: 'lock' | 'logout') => void;
  navigate: (path: string) => void;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
  onExport: (request: ExportRequest) => Promise<void>;
  exportDialogOpen: boolean;
  onExportDialogOpenChange: (open: boolean) => void;
}

function Row(props: { label: string; help?: string; children: preact.ComponentChildren }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{props.label}</span>
        {props.help && <span className="nx-help">{props.help}</span>}
      </div>
      <div className="set-control">{props.children}</div>
    </div>
  );
}

// Mirrors VaultNextPage's TrappedDialog (issue #16 a11y bar): trap Tab,
// restore focus to the opener, close on Escape.
function Dialog(props: { label: string; children: preact.ComponentChildren; onClose?: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(boxRef);
  return (
    <div className="nx-scrim" style={{ zIndex: 35 }}>
      <div
        ref={boxRef}
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

const EXPORT_ENCRYPTED_FORMATS = new Set<ExportFormatId>(['bitwarden_encrypted_json', 'bitwarden_encrypted_json_zip', 'nodewarden_encrypted_json']);
const EXPORT_ZIP_FORMATS = new Set<ExportFormatId>(['bitwarden_json_zip', 'bitwarden_encrypted_json_zip']);

// .nx-field is only styled under .nx-auth/.nx-editor elsewhere in Next; this
// dialog renders outside both, so pin the intended layout locally.
const FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: '6px' } as const;

export default function NextSettingsPage(props: NextSettingsPageProps) {
  const [uiVersion, setUiVersionState] = useState<UiVersion>(() => readUiVersion());
  const [skin, setSkinState] = useState<SkinId>(() => readSkin());
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  const [exportFormat, setExportFormat] = useState<ExportFormatId>('bitwarden_json');
  const [encryptedJsonMode, setEncryptedJsonMode] = useState<EncryptedJsonMode>('account');
  const [filePassword, setFilePassword] = useState('');
  const [zipPassword, setZipPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportNeedsMode = EXPORT_ENCRYPTED_FORMATS.has(exportFormat);
  const exportNeedsFilePassword = exportNeedsMode && encryptedJsonMode === 'password';
  const exportIsZip = EXPORT_ZIP_FORMATS.has(exportFormat);

  // Sensitive values only — cleared on open AND on every path that leaves
  // the dialog (cancel/Escape/success), so a typed master password never
  // lingers in plaintext component state after the dialog is gone.
  const resetExportSecrets = () => {
    setFilePassword('');
    setZipPassword('');
    setMasterPassword('');
    setExportError('');
  };

  // Reset the form fresh every time the dialog opens (covers both the
  // in-page "Export…" button and the palette command reaching in from
  // outside — see VaultNextPage's exportDialogOpen/onExportDialogOpenChange).
  useEffect(() => {
    if (!props.exportDialogOpen) return;
    setExportFormat('bitwarden_json');
    setEncryptedJsonMode('account');
    resetExportSecrets();
  }, [props.exportDialogOpen]);

  const closeExportDialog = () => {
    if (exportSubmitting) return;
    resetExportSecrets();
    props.onExportDialogOpenChange(false);
  };

  async function submitExport() {
    if (exportSubmitting) return;
    if (exportNeedsFilePassword && !filePassword.trim()) {
      setExportError(STR.exportFilePasswordRequired);
      return;
    }
    if (!masterPassword.trim()) {
      setExportError(STR.exportMasterPasswordRequired);
      return;
    }
    setExportSubmitting(true);
    setExportError('');
    try {
      await props.onExport({
        format: exportFormat,
        encryptedJsonMode: exportNeedsMode ? encryptedJsonMode : undefined,
        filePassword: exportNeedsFilePassword ? filePassword.trim() : undefined,
        zipPassword: exportIsZip ? zipPassword.trim() : undefined,
        masterPassword: masterPassword.trim(),
      });
      resetExportSecrets();
      props.onExportDialogOpenChange(false);
      props.onNotify('success', STR.exportSuccess);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : STR.exportFailed);
    } finally {
      setExportSubmitting(false);
    }
  }

  return (
    <div className="nx-list nx-settings">
      <div className="set-grid">
      <div className="set-col">
      <div className="set-section set-card">
        <div className="nx-overline">{STR.appearance}</div>
        <Row label={STR.theme}>
          <select
            className="nx-input"
            value={props.themePreference}
            onInput={(e) => props.onThemePreferenceChange((e.currentTarget as HTMLSelectElement).value as 'system' | 'light' | 'dark')}
          >
            {(['system', 'light', 'dark'] as const).map((option) => (
              <option key={option} value={option}>{STR.themes[option]}</option>
            ))}
          </select>
        </Row>
        <Row label={STR.language}>
          <select
            className="nx-input"
            value={locale}
            onInput={(e) => {
              const next = (e.currentTarget as HTMLSelectElement).value as Locale;
              setLocale(next);
              setLocaleState(next);
              window.location.reload();
            }}
          >
            {AVAILABLE_LOCALES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Row>
        <Row label={STR.interface} help={STR.interfaceHelp}>
          <select
            className="nx-input"
            value={uiVersion}
            onInput={(e) => {
              const next = (e.currentTarget as HTMLSelectElement).value as UiVersion;
              setUiVersion(next);
              setUiVersionState(next);
              if (next === 'v1') {
                props.navigate('/vault');
                window.location.reload();
              }
            }}
          >
            {(['v2', 'v1'] as UiVersion[]).map((option) => (
              <option key={option} value={option}>{STR.interfaces[option]}</option>
            ))}
          </select>
        </Row>
        <Row label={STR.skin} help={STR.skinHelp}>
          <select
            className="nx-input"
            value={skin}
            onInput={(e) => {
              const next = (e.currentTarget as HTMLSelectElement).value as SkinId;
              setSkin(next);
              setSkinState(next);
            }}
          >
            {SKINS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </Row>
      </div>

      </div>

      <div className="set-col">
      <div className="set-section set-card">
        <div className="nx-overline">{STR.session}</div>
        <Row label={STR.lockTimeout}>
          <select
            className="nx-input"
            value={String(props.lockTimeoutMinutes)}
            onInput={(e) => props.onLockTimeoutChange(Number((e.currentTarget as HTMLSelectElement).value) as LockMinutes)}
          >
            {([1, 5, 15, 30, 0] as LockMinutes[]).map((minutes) => (
              <option key={minutes} value={String(minutes)}>{STR.minutes(minutes)}</option>
            ))}
          </select>
        </Row>
        <Row label={STR.timeoutAction}>
          <select
            className="nx-input"
            value={props.sessionTimeoutAction}
            onInput={(e) => props.onSessionTimeoutActionChange((e.currentTarget as HTMLSelectElement).value as 'lock' | 'logout')}
          >
            {(['lock', 'logout'] as const).map((action) => (
              <option key={action} value={action}>{STR.actions[action]}</option>
            ))}
          </select>
        </Row>
      </div>

      <div className="set-section set-card">
        <div className="nx-overline">{STR.security}</div>
        <div className="nx-help" style={{ marginBottom: 'var(--nx-sp-2)' }}>{STR.securityHelp}</div>
        <div className="set-links">
          {([
            [STR.masterPassword, '/settings/account'],
            [STR.twoStep, '/settings/account'],
            [STR.keys, '/settings/account'],
            [STR.devices, '/settings/security/device-management'],
            [STR.domainRules, '/settings/domain-rules'],
            [STR.backup, '/backup'],
            [STR.admin, '/admin'],
            [STR.logs, '/logs'],
          ] as Array<[string, string]>).map(([label, path]) => (
            <button key={label} type="button" className="set-link" onClick={() => props.navigate(path)}>
              {label} <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </div>

      <div className="set-section set-card">
        <div className="nx-overline">{STR.exportSection}</div>
        <div className="nx-help" style={{ marginBottom: 'var(--nx-sp-2)' }}>{STR.exportHelp}</div>
        <div>
          <button type="button" className="nx-btn" onClick={() => props.onExportDialogOpenChange(true)}>
            {STR.exportButton}
          </button>
        </div>
      </div>
      </div>
      </div>

      {props.exportDialogOpen && (
        <Dialog label={STR.exportDialogTitle} onClose={exportSubmitting ? undefined : closeExportDialog}>
          <h3>{STR.exportDialogTitle}</h3>

          <label className="nx-field" style={FIELD_STYLE}>
            <span>{STR.exportFormatLabel}</span>
            <select
              className="nx-input"
              value={exportFormat}
              disabled={exportSubmitting}
              onInput={(e) => setExportFormat((e.currentTarget as HTMLSelectElement).value as ExportFormatId)}
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format.id} value={format.id}>{format.label}</option>
              ))}
            </select>
          </label>

          {exportNeedsMode && (
            <div className="nx-field" style={FIELD_STYLE}>
              <span>{STR.exportModeLabel}</span>
              <div role="radiogroup" aria-label={STR.exportModeLabel} style={{ display: 'flex', gap: 'var(--nx-sp-2)' }}>
                {(['account', 'password'] as EncryptedJsonMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={encryptedJsonMode === mode}
                    className={`nx-tog${encryptedJsonMode === mode ? ' on' : ''}`}
                    disabled={exportSubmitting}
                    onClick={() => setEncryptedJsonMode(mode)}
                  >
                    {STR.exportModes[mode]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {exportNeedsFilePassword && (
            <label className="nx-field" style={FIELD_STYLE}>
              <span>{STR.exportFilePasswordLabel}</span>
              <input
                className="nx-input nx-data"
                type="password"
                autoComplete="new-password"
                disabled={exportSubmitting}
                value={filePassword}
                onInput={(e) => setFilePassword((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          )}

          {exportIsZip && (
            <label className="nx-field" style={FIELD_STYLE}>
              <span>{STR.exportZipPasswordLabel}</span>
              <input
                className="nx-input nx-data"
                type="password"
                autoComplete="new-password"
                disabled={exportSubmitting}
                value={zipPassword}
                onInput={(e) => setZipPassword((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          )}

          <label className="nx-field" style={FIELD_STYLE}>
            <span>{STR.exportMasterPasswordLabel}</span>
            <input
              className="nx-input nx-data"
              type="password"
              autoComplete="current-password"
              disabled={exportSubmitting}
              value={masterPassword}
              onInput={(e) => setMasterPassword((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void submitExport(); }
              }}
            />
          </label>

          {exportError && <div className="nx-error" role="alert">{exportError}</div>}

          <div className="dfoot">
            <button type="button" className="nx-btn ghost" disabled={exportSubmitting} onClick={closeExportDialog}>
              {STR.exportCancel} <span className="nx-kbd">esc</span>
            </button>
            <button type="button" className="nx-btn" disabled={exportSubmitting} onClick={() => void submitExport()}>
              {exportSubmitting ? STR.exportSubmitting : STR.exportSubmit} <span className="nx-kbd on-fill">↵</span>
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
