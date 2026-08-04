// NodeWarden Next (issue #16, slice 1): V2 unlock/login/register surface.
// Accepts the same props as stock AuthViews so App.tsx swaps only the tag.
// Design contract: docs/nodewarden-next/03-design-system.md + mockups/01-unlock.html.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import { getCurrentNetworkStatus, subscribeNetworkStatus, type NetworkStatus } from '@/lib/network-status';
import { MIN_MASTER_PASSWORD_LENGTH, registerPasswordIssue } from './auth-validation';
import '../../styles/next/tokens.css';
import '../../styles/next/auth.css';

interface LoginValues {
  email: string;
  password: string;
}

interface RegisterValues {
  name: string;
  email: string;
  password: string;
  password2: string;
  passwordHint: string;
  inviteCode: string;
}

interface AuthViewsNextProps {
  mode: 'login' | 'register' | 'locked';
  relaxedLoginInput?: boolean;
  authPlaceholder?: string;
  unlockPlaceholder?: string;
  pendingAction: 'login' | 'passkey' | 'register' | 'unlock' | null;
  unlockReady: boolean;
  unlockPreparing: boolean;
  sessionRefreshError?: string;
  loginValues: LoginValues;
  pendingPasskeyPasswordEmail?: string | null;
  passkeyPassword: string;
  registerValues: RegisterValues;
  registrationInviteRequired?: boolean;
  unlockPassword: string;
  emailForLock: string;
  loginHintLoading: boolean;
  inlineError?: string;
  onChangeLogin: (next: LoginValues) => void;
  onChangePasskeyPassword: (password: string) => void;
  onChangeRegister: (next: RegisterValues) => void;
  onChangeUnlock: (password: string) => void;
  onSubmitLogin: () => void;
  onSubmitPasskey: () => void;
  onSubmitPasskeyUnlock: () => void;
  onSubmitPasskeyPassword: () => void;
  onSubmitRegister: () => void;
  onSubmitUnlock: () => void;
  onGotoLogin: () => void;
  onGotoRegister: () => void;
  onLogout: () => void;
  onTogglePasswordHint: () => void;
  onShowLockedPasswordHint: () => void;
  onRetrySessionRefresh: () => void;
}

function Wordmark() {
  return (
    <div className="nx-wordmark">
      <span className="nx-mark" aria-hidden="true">N</span> NodeWarden
    </div>
  );
}

function OfflineNotice() {
  const [status, setStatus] = useState<NetworkStatus>(getCurrentNetworkStatus);
  useEffect(() => subscribeNetworkStatus(setStatus), []);
  if (status !== 'offline') return null;
  return (
    <div className="nx-offline" role="alert" aria-live="assertive">
      {t('txt_offline_mode_notice_title')}
    </div>
  );
}

export default function AuthViewsNext(props: AuthViewsNextProps) {
  const unlockBusy = props.pendingAction === 'unlock';
  const loginBusy = props.pendingAction === 'login';
  const passkeyBusy = props.pendingAction === 'passkey';
  const registerBusy = props.pendingAction === 'register';
  const passkeyPasswordPending = !!props.pendingPasskeyPasswordEmail;
  const showInviteCodeField =
    props.registrationInviteRequired !== false || !!props.registerValues.inviteCode.trim();

  // Inline error (unlock): clear the field and refocus so retyping is immediate.
  const unlockRef = useRef<HTMLInputElement>(null);
  const lastInlineError = useRef('');
  useEffect(() => {
    const error = props.inlineError || '';
    if (error && error !== lastInlineError.current && props.mode === 'locked') {
      props.onChangeUnlock('');
      unlockRef.current?.focus();
    }
    lastInlineError.current = error;
  }, [props.inlineError, props.mode]);

  if (props.mode === 'locked') {
    const disabled = unlockBusy || !props.unlockReady || props.unlockPreparing;
    return (
      <div className="nw-next nx-auth">
        <form
          className="nx-auth-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) props.onSubmitUnlock();
          }}
        >
          <Wordmark />
          <div>
            <h1>{t('txt_unlock_vault')}</h1>
            <div className="nx-who">{props.emailForLock}</div>
          </div>
          <OfflineNotice />
          {/* Hidden username input so password managers associate the account. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={props.emailForLock}
            readOnly
            style={{ display: 'none' }}
          />
          <div className="nx-field">
            <input
              ref={unlockRef}
              className="nx-input nx-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              aria-label={t('txt_master_password')}
              aria-invalid={props.inlineError ? 'true' : undefined}
              placeholder={props.unlockPlaceholder}
              value={props.unlockPassword}
              disabled={unlockBusy}
              onInput={(e) => props.onChangeUnlock((e.currentTarget as HTMLInputElement).value)}
            />
            {unlockBusy && <div className="nx-working" aria-hidden="true" />}
            <div role="status" aria-live="polite">
              {unlockBusy && <div className="nx-help">{t('txt_unlocking')}</div>}
              {!unlockBusy && props.unlockPreparing && <div className="nx-help">{t('txt_loading')}</div>}
            </div>
            {!unlockBusy && props.inlineError && (
              <div className="nx-error" role="alert">{props.inlineError}</div>
            )}
            {props.sessionRefreshError && (
              <div className="nx-error" role="alert">
                {props.sessionRefreshError}{' '}
                <button type="button" className="nx-alt-inline" onClick={props.onRetrySessionRefresh}>
                  {t('txt_refresh')}
                </button>
              </div>
            )}
          </div>
          {/* Submit button kept for pointer users and as the form's default. */}
          <button className="nx-btn" type="submit" disabled={disabled}>
            {unlockBusy ? t('txt_unlocking') : t('txt_unlock')}
          </button>
          <div className="nx-alt">
            <button
              type="button"
              disabled={passkeyBusy || props.unlockPreparing}
              onClick={props.onSubmitPasskeyUnlock}
            >
              {t('txt_unlock_with_passkey')}
            </button>
            <button type="button" onClick={props.onShowLockedPasswordHint}>
              {t('txt_show_password_hint')}
            </button>
            <button type="button" className="nx-push" onClick={props.onLogout}>
              {t('txt_log_out')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (props.mode === 'register') {
    const issue = registerPasswordIssue(props.registerValues.password, props.registerValues.password2);
    return (
      <div className="nw-next nx-auth">
        <form
          className="nx-auth-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!registerBusy) props.onSubmitRegister();
          }}
        >
          <Wordmark />
          <h1>{t('txt_create_account')}</h1>
          <OfflineNotice />
          <label className="nx-field">
            <span className="nx-overline">{t('txt_name')}</span>
            <input
              className="nx-input"
              type="text"
              autoFocus
              autoComplete="name"
              value={props.registerValues.name}
              onInput={(e) =>
                props.onChangeRegister({
                  ...props.registerValues,
                  name: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <label className="nx-field">
            <span className="nx-overline">{t('txt_email')}</span>
            <input
              className="nx-input"
              type="email"
              autoComplete="email"
              value={props.registerValues.email}
              onInput={(e) =>
                props.onChangeRegister({
                  ...props.registerValues,
                  email: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <label className="nx-field">
            <span className="nx-overline">{t('txt_master_password')}</span>
            <input
              className="nx-input nx-password"
              type="password"
              autoComplete="new-password"
              value={props.registerValues.password}
              onInput={(e) =>
                props.onChangeRegister({
                  ...props.registerValues,
                  password: (e.currentTarget as HTMLInputElement).value,
                })}
            />
            <div aria-live="polite">
              {issue === 'short' && (
                <div className="nx-help">{t('txt_master_password_must_be_at_least_12_chars')}</div>
              )}
            </div>
          </label>
          <label className="nx-field">
            <span className="nx-overline">{t('txt_confirm_master_password')}</span>
            <input
              className="nx-input nx-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={issue === 'mismatch' ? 'true' : undefined}
              value={props.registerValues.password2}
              onInput={(e) =>
                props.onChangeRegister({
                  ...props.registerValues,
                  password2: (e.currentTarget as HTMLInputElement).value,
                })}
            />
            <div aria-live="polite">
              {issue === 'mismatch' && (
                <div className="nx-error">{t('txt_passwords_do_not_match')}</div>
              )}
            </div>
          </label>
          <label className="nx-field">
            <span className="nx-overline">{t('txt_password_hint_optional')}</span>
            <input
              className="nx-input"
              type="text"
              maxLength={120}
              placeholder={t('txt_password_hint_register_placeholder')}
              value={props.registerValues.passwordHint}
              onInput={(e) =>
                props.onChangeRegister({
                  ...props.registerValues,
                  passwordHint: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          {showInviteCodeField && (
            <label className="nx-field">
              <span className="nx-overline">{t('txt_invite_code_required')}</span>
              <input
                className="nx-input"
                type="text"
                value={props.registerValues.inviteCode}
                onInput={(e) =>
                  props.onChangeRegister({
                    ...props.registerValues,
                    inviteCode: (e.currentTarget as HTMLInputElement).value,
                  })}
              />
            </label>
          )}
          {registerBusy && <div className="nx-working" aria-hidden="true" />}
          <button className="nx-btn" type="submit" disabled={registerBusy}>
            {registerBusy ? t('txt_registering') : t('txt_create_account')}
          </button>
          <div className="nx-alt">
            <button type="button" onClick={props.onGotoLogin}>{t('txt_back_to_login')}</button>
          </div>
        </form>
      </div>
    );
  }

  // mode === 'login'
  if (passkeyPasswordPending) {
    return (
      <div className="nw-next nx-auth">
        <form
          className="nx-auth-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!loginBusy) props.onSubmitPasskeyPassword();
          }}
        >
          <Wordmark />
          <div>
            <h1>{t('txt_unlock_vault')}</h1>
            <div className="nx-who">{props.pendingPasskeyPasswordEmail}</div>
          </div>
          <div className="nx-field">
            <input
              className="nx-input nx-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              aria-label={t('txt_master_password')}
              value={props.passkeyPassword}
              onInput={(e) => props.onChangePasskeyPassword((e.currentTarget as HTMLInputElement).value)}
            />
            {loginBusy && <div className="nx-working" aria-hidden="true" />}
          </div>
          <button className="nx-btn" type="submit" disabled={loginBusy}>
            {loginBusy ? t('txt_logging_in') : t('txt_unlock')}
          </button>
          <div className="nx-alt">
            <button type="button" onClick={props.onGotoLogin}>{t('txt_back_to_login')}</button>
          </div>
        </form>
      </div>
    );
  }

  const emailPrefilled = !!props.loginValues.email;
  return (
    <div className="nw-next nx-auth">
      <form
        className="nx-auth-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!loginBusy) props.onSubmitLogin();
        }}
      >
        <Wordmark />
        <h1>{t('txt_log_in')}</h1>
        <OfflineNotice />
        <label className="nx-field">
          <span className="nx-overline">{t('txt_email')}</span>
          <input
            className="nx-input"
            type={props.relaxedLoginInput ? 'text' : 'email'}
            autoFocus={!emailPrefilled}
            autoComplete="username"
            placeholder={props.authPlaceholder}
            value={props.loginValues.email}
            onInput={(e) =>
              props.onChangeLogin({
                ...props.loginValues,
                email: (e.currentTarget as HTMLInputElement).value,
              })}
          />
        </label>
        <label className="nx-field">
          <span className="nx-overline">{t('txt_master_password')}</span>
          <input
            className="nx-input nx-password"
            type="password"
            autoFocus={emailPrefilled}
            autoComplete="current-password"
            value={props.loginValues.password}
            onInput={(e) =>
              props.onChangeLogin({
                ...props.loginValues,
                password: (e.currentTarget as HTMLInputElement).value,
              })}
          />
          {loginBusy && <div className="nx-working" aria-hidden="true" />}
          <div role="status" aria-live="polite">
            {loginBusy && <div className="nx-help">{t('txt_logging_in')}</div>}
          </div>
        </label>
        <button className="nx-btn" type="submit" disabled={loginBusy}>
          {loginBusy ? t('txt_logging_in') : t('txt_log_in')}
        </button>
        <div className="nx-alt">
          <button type="button" disabled={passkeyBusy} onClick={props.onSubmitPasskey}>
            {t('txt_login_with_passkey')}
          </button>
          <button
            type="button"
            disabled={!props.loginValues.email.trim() || props.loginHintLoading}
            onClick={props.onTogglePasswordHint}
          >
            {props.loginHintLoading ? t('txt_loading_password_hint') : t('txt_show_password_hint')}
          </button>
          <button type="button" className="nx-push" onClick={props.onGotoRegister}>
            {t('txt_create_account')}
          </button>
        </div>
      </form>
    </div>
  );
}
