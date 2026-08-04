// NodeWarden Next (issue #16, slice 5): settings in the Next shell.
// Quick settings live here natively (appearance, interface, session);
// deep security flows (master password, 2FA, passkeys, API keys, devices)
// open the full classic settings sections — the ONLY place the classic
// interface is reachable from (owner directive: no escape hatches elsewhere).
import { t, AVAILABLE_LOCALES, getLocale, setLocale, type Locale } from '@/lib/i18n';
import { readUiVersion, setUiVersion, type UiVersion } from '@/lib/ui-version';
import { SKINS, readSkin, setSkin, type SkinId } from '@/lib/skin';
import { useState } from 'preact/hooks';

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

export default function NextSettingsPage(props: NextSettingsPageProps) {
  const [uiVersion, setUiVersionState] = useState<UiVersion>(() => readUiVersion());
  const [skin, setSkinState] = useState<SkinId>(() => readSkin());
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  return (
    <div className="nx-list nx-settings">
      <div className="set-grid">
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

      <div className="set-section set-card set-card-wide">
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
      </div>
    </div>
  );
}
