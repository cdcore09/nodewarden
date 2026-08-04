// NodeWarden Next (issue #16, slice 2): the retrieval surface.
// Search-as-shell: the query owns the screen, browsing is an explicit chip,
// admin lives behind command mode. Design contract:
// docs/nodewarden-next/02-ia-interaction-model.md §3-5 + mockups/02-retrieval.html.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import { t } from '@/lib/i18n';
import { calcTotpNow, type TotpCodeResult } from '@/lib/crypto';
import { buildSearchEntries, searchEntries, type ScopeFilter, type SearchEntry } from '@/lib/next/search';
import { copySensitive, CLIPBOARD_CLEAR_SECONDS, type ClipboardPort } from '@/lib/next/clipboard-clear';
import { listCommands, filterCommands, type NextCommand } from './commands';
import { setUiVersion } from '@/lib/ui-version';
import { TypeIcon } from '@/components/vault/vault-page-helpers';
import BrowsePanel from './BrowsePanel';
import type { Cipher, Folder } from '@/lib/types';
import '../../styles/next/tokens.css';
import '../../styles/next/vault.css';

const RESULT_LIMIT = 50;
const HINT_SEEN_KEY = 'nodewarden.next.hint.v1';

// Fork-local strings (skin-feature precedent): V2-only chrome not covered by
// existing i18n keys.
const STR = {
  searchPlaceholder: 'Search your vault',
  copyPassword: 'copy password',
  open: 'open',
  username: 'username',
  code: 'code',
  edit: 'edit',
  browse: 'browse',
  commands: 'commands',
  run: 'run',
  clearScope: 'remove scope',
  passwordCopied: 'Password copied',
  usernameCopied: 'Username copied',
  codeCopied: 'Code copied',
  clearsIn: (s: number) => `· clears in ${s}s`,
  gateHelp: 'This item asks for your master password before copy or reveal.',
  gateUnlock: 'Unlock item',
  emptyVault: 'Your vault is empty.',
  createFirst: 'Create your first login',
  importCta: t('txt_import'),
  hintLine: 'gets you back to search from anywhere here',
  ofTotal: (shown: number, total: number) => `${shown} of ${total}`,
  inScope: (n: number, label: string) => `${n} in ${label}`,
  classicSwitch: 'Switched to the classic interface.',
  noMatches: 'No matches.',
};

interface VaultNextPageProps {
  ciphers: Cipher[];
  folders: Folder[];
  loading: boolean;
  emailForReprompt: string;
  onVerifyMasterPassword: (email: string, password: string) => Promise<void>;
  onLock: () => void;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
}

type CopyKind = 'password' | 'username' | 'totp';

interface GateState {
  entryId: string;
  kind: CopyKind;
  error: string;
  submitting: boolean;
}

const clipboardPort: ClipboardPort = {
  write: (text) => navigator.clipboard.writeText(text),
  read: () => navigator.clipboard.readText(),
};

const scheduleTimeout = (fn: () => void, ms: number) => {
  const id = window.setTimeout(fn, ms);
  return () => window.clearTimeout(id);
};

function scopeLabel(scope: ScopeFilter): string {
  switch (scope.kind) {
    case 'favorites': return t('txt_favorites');
    case 'archive': return t('txt_archive');
    case 'trash': return t('txt_trash');
    case 'folder': return scope.label;
    case 'type': return String(scope.type);
    default: return '';
  }
}

export default function VaultNextPage(props: VaultNextPageProps) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>({ kind: 'all' });
  const [activeIndex, setActiveIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; seconds: number | null } | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [totpLive, setTotpLive] = useState<TotpCodeResult | null>(null);
  const [hintSeen, setHintSeen] = useState(() => {
    try { return !!window.localStorage.getItem(HINT_SEEN_KEY); } catch { return true; }
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const gateRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const cipherById = useMemo(() => {
    const map = new Map<string, Cipher>();
    for (const cipher of props.ciphers) map.set(cipher.id, cipher);
    return map;
  }, [props.ciphers]);

  const entries = useMemo(
    () => buildSearchEntries(props.ciphers, props.folders),
    [props.ciphers, props.folders]
  );

  const commandMode = query.startsWith('>');
  const itemSearch = useMemo(
    () => searchEntries(entries, commandMode ? '' : query, scope, RESULT_LIMIT),
    [entries, query, scope, commandMode]
  );
  const commands = useMemo(
    () => (commandMode ? filterCommands(listCommands(), query.slice(1)) : []),
    [commandMode, query]
  );

  const rowCount = commandMode ? commands.length : itemSearch.results.length;
  const active = Math.min(activeIndex, Math.max(rowCount - 1, 0));
  const activeEntry: SearchEntry | null = !commandMode ? itemSearch.results[active] || null : null;
  const activeCommand: NextCommand | null = commandMode ? commands[active] || null : null;

  const focusSearch = () => inputRef.current?.focus();

  useEffect(() => { focusSearch(); }, []);
  useEffect(() => { setActiveIndex(0); }, [query, scope]);

  // TOTP ring for the highlighted row only.
  useEffect(() => {
    setTotpLive(null);
    if (!activeEntry?.hasTotp) return;
    const secret = cipherById.get(activeEntry.id)?.login?.decTotp || '';
    if (!secret) return;
    let alive = true;
    const tick = async () => {
      const next = await calcTotpNow(secret);
      if (alive) setTotpLive(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [activeEntry?.id, activeEntry?.hasTotp, cipherById]);

  // Toast countdown.
  useEffect(() => {
    if (!toast || toast.seconds === null) return;
    if (toast.seconds <= 0) { setToast(null); return; }
    const id = window.setTimeout(
      () => setToast((current) => (current ? { ...current, seconds: (current.seconds ?? 1) - 1 } : null)),
      1000
    );
    return () => window.clearTimeout(id);
  }, [toast]);

  const commandContext = {
    navigate,
    lock: props.onLock,
    logout: props.onLogout,
    toClassic: () => {
      setUiVersion('v1');
      props.onNotify('success', STR.classicSwitch);
      navigate('/vault');
    },
  };

  const openEntry = (entry: SearchEntry) => {
    navigate(`/vault?cipher=${encodeURIComponent(entry.id)}`);
  };

  const performCopy = async (entry: SearchEntry, kind: CopyKind) => {
    const cipher = cipherById.get(entry.id);
    if (!cipher) return;
    let value = '';
    if (kind === 'password') value = cipher.login?.decPassword || '';
    if (kind === 'username') value = cipher.login?.decUsername || '';
    if (kind === 'totp') value = (await calcTotpNow(cipher.login?.decTotp || ''))?.code || '';
    if (!value) return;
    try {
      const copy = await copySensitive(clipboardPort, value, scheduleTimeout);
      const label =
        kind === 'password' ? STR.passwordCopied : kind === 'username' ? STR.usernameCopied : STR.codeCopied;
      setCopiedId(entry.id);
      setToast({ text: label, seconds: copy.canClear ? CLIPBOARD_CLEAR_SECONDS : null });
      if (!copy.canClear) window.setTimeout(() => setToast(null), 2500);
      window.setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 900);
    } catch {
      props.onNotify('error', t('txt_copy_failed'));
    }
    focusSearch();
  };

  const requestCopy = (entry: SearchEntry, kind: CopyKind) => {
    if (entry.reprompt) {
      setGate({ entryId: entry.id, kind, error: '', submitting: false });
      return;
    }
    void performCopy(entry, kind);
  };

  // Focus the gate input after it exists in the DOM (a setTimeout can fire
  // before Preact commits the conditional render).
  useEffect(() => {
    if (gate) gateRef.current?.focus();
  }, [gate?.entryId, gate?.kind]);

  const submitGate = async () => {
    if (!gate || gate.submitting) return;
    const password = gateRef.current?.value || '';
    if (!password) return;
    setGate({ ...gate, error: '', submitting: true });
    try {
      await props.onVerifyMasterPassword(props.emailForReprompt, password);
      const entry = itemSearch.results.find((e) => e.id === gate.entryId) || null;
      setGate(null);
      focusSearch();
      if (entry) void performCopy(entry, gate.kind);
    } catch (error) {
      setGate({
        ...gate,
        submitting: false,
        error: error instanceof Error && error.message
          ? error.message
          : t('txt_unlock_failed_master_password_is_incorrect'),
      });
      if (gateRef.current) gateRef.current.value = '';
      gateRef.current?.focus();
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(rowCount - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (commandMode) {
        if (activeCommand) { setQuery(''); activeCommand.run(commandContext); }
        return;
      }
      if (!activeEntry) return;
      if (meta) { openEntry(activeEntry); return; }
      if (activeEntry.type === 1) requestCopy(activeEntry, 'password');
      else openEntry(activeEntry);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (menuOpen) setMenuOpen(false);
      else if (browseOpen) setBrowseOpen(false);
      else if (query) setQuery('');
    } else if (event.key === 'Backspace' && !query && scope.kind !== 'all') {
      event.preventDefault();
      setScope({ kind: 'all' });
    }
  };

  // Global chords + type-anywhere routing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const targetIsInput =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT');
      if (meta) {
        const key = event.key.toLowerCase();
        if (key === 'k') { event.preventDefault(); setBrowseOpen(false); setMenuOpen(false); setQuery(''); focusSearch(); return; }
        if (key === 'b') { event.preventDefault(); setMenuOpen(false); setBrowseOpen((open) => !open); return; }
        if (!commandMode && activeEntry) {
          if (key === 'u' && activeEntry.type === 1) { event.preventDefault(); requestCopy(activeEntry, 'username'); return; }
          if (key === 'o' && activeEntry.hasTotp) { event.preventDefault(); requestCopy(activeEntry, 'totp'); return; }
          if (key === 'e') { event.preventDefault(); openEntry(activeEntry); return; }
          if (key === 'enter') { event.preventDefault(); openEntry(activeEntry); return; }
        }
        return;
      }
      if (!targetIsInput && !browseOpen && !gate && event.key.length === 1 && !event.altKey) {
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandMode, activeEntry, browseOpen, gate]);

  const markHintSeen = () => {
    setHintSeen(true);
    try { window.localStorage.setItem(HINT_SEEN_KEY, '1'); } catch { /* non-fatal */ }
  };

  const showEmptyVault = !props.loading && props.ciphers.length === 0;
  const gateEntryName = gate ? itemSearch.results.find((e) => e.id === gate.entryId)?.name || '' : '';

  const chip = scope.kind !== 'all' ? scopeLabel(scope) : '';

  return (
    <div ref={surfaceRef} className="nw-next nx-vault">
      <button
        type="button"
        className="nx-appmenu-btn"
        aria-label={t('txt_settings')}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div className="nx-menu" style={{ top: 48, right: 16 }} role="menu">
          <button type="button" className="mrow" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/settings/account'); }}>
            {t('txt_settings')}
          </button>
          <button type="button" className="mrow" role="menuitem" onClick={() => { setMenuOpen(false); commandContext.toClassic(); }}>
            Classic UI
          </button>
          <div className="msep" />
          <button type="button" className="mrow" role="menuitem" onClick={() => { setMenuOpen(false); props.onLock(); }}>
            {t('txt_lock')}
          </button>
          <button type="button" className="mrow" role="menuitem" onClick={() => { setMenuOpen(false); props.onLogout(); }}>
            {t('txt_log_out')}
          </button>
        </div>
      )}

      <div className="nx-col">
        <div className="nx-search">
          {commandMode && <span className="nx-cmd-sigil" aria-hidden="true">&gt;</span>}
          {chip && !commandMode && (
            <span className="nx-chip">
              {chip}
              <button type="button" aria-label={STR.clearScope} onClick={() => { setScope({ kind: 'all' }); focusSearch(); }}>
                ✕
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={rowCount > 0}
            aria-controls="nx-results"
            aria-activedescendant={rowCount > 0 ? `nx-row-${active}` : undefined}
            aria-label={STR.searchPlaceholder}
            placeholder={STR.searchPlaceholder}
            value={query}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>

        <div className="nx-results" id="nx-results" role="listbox">
          {props.loading && itemSearch.results.length === 0 && (
            <>
              <div className="nx-skeleton-row" />
              <div className="nx-skeleton-row" />
              <div className="nx-skeleton-row" />
            </>
          )}

          {showEmptyVault && (
            <div className="nx-empty">
              <div>{STR.emptyVault}</div>
              <div className="ctas">
                <button type="button" className="nx-btn" onClick={() => listCommands().find((c) => c.id === 'new-item')!.run(commandContext)}>
                  {STR.createFirst}
                </button>
                <button type="button" className="nx-btn ghost" onClick={() => navigate('/import')}>
                  {STR.importCta}
                </button>
              </div>
            </div>
          )}

          {commandMode
            ? commands.map((command, index) => (
                <div
                  key={command.id}
                  id={`nx-row-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`nx-row${index === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => { setQuery(''); command.run(commandContext); }}
                >
                  <span className="ico">›</span>
                  <span className="main">
                    <span className="title">{command.label}</span>
                    {command.hint && <span className="sub ui-face">{command.hint}</span>}
                  </span>
                  <span className="meta">{index === active && <span className="nx-kbd">↵</span>}</span>
                </div>
              ))
            : itemSearch.results.map((entry, index) => (
                <div
                  key={entry.id}
                  id={`nx-row-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`nx-row${index === active ? ' is-active' : ''}${entry.id === copiedId ? ' is-copied' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    if (entry.type === 1) requestCopy(entry, 'password');
                    else openEntry(entry);
                  }}
                >
                  <span className="ico"><TypeIcon type={entry.type} /></span>
                  <span className="main">
                    <span className="title">{entry.name}</span>
                    <span className={`sub${entry.type === 1 ? '' : ' ui-face'}`}>{entry.sub}</span>
                  </span>
                  <span className="meta">
                    {entry.id === copiedId && <span className="nx-badge ok">✓</span>}
                    {entry.reprompt && <span className="nx-badge warn">locked</span>}
                    {index === active && entry.hasTotp && totpLive && (
                      <span className="nx-totp">
                        <span
                          className="ring"
                          style={{ '--ring': `${Math.round((totpLive.remain / totpLive.period) * 100)}%` }}
                        />
                        <span>{totpLive.remain}s</span>
                      </span>
                    )}
                    {entry.organizationId && <span className="nx-badge org">org</span>}
                  </span>
                </div>
              ))}

          {!props.loading && !showEmptyVault && rowCount === 0 && (
            <div className="nx-empty">{commandMode ? STR.noMatches : t('txt_no_items')}</div>
          )}
        </div>

        {gate && (
          <div className="nx-gate">
            <div className="gate-row">
              <input
                ref={gateRef}
                type="password"
                autoComplete="current-password"
                aria-label={t('txt_master_password')}
                disabled={gate.submitting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void submitGate(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setGate(null); focusSearch(); }
                }}
              />
              <button type="button" className="nx-btn ghost" disabled={gate.submitting} onClick={() => void submitGate()}>
                {STR.gateUnlock}
              </button>
            </div>
            {gate.error
              ? <div className="nx-error" role="alert">{gate.error}</div>
              : <div className="nx-help">{gateEntryName ? `${gateEntryName} — ` : ''}{STR.gateHelp}</div>}
          </div>
        )}

        {!gate && (
          <div className="nx-hintbar">
            {commandMode ? (
              <>
                <span className="nx-hint"><span className="nx-kbd">↵</span> {STR.run}</span>
                <span className="nx-hint"><span className="nx-kbd">esc</span> {STR.commands}</span>
              </>
            ) : copiedId && activeEntry?.type === 1 ? (
              <>
                {activeEntry.sub && <span className="nx-hint"><span className="nx-kbd">⌘U</span> {STR.username}</span>}
                {activeEntry.hasTotp && <span className="nx-hint"><span className="nx-kbd">⌘O</span> {STR.code}</span>}
                <span className="nx-hint"><span className="nx-kbd">⌘↵</span> {STR.open}</span>
              </>
            ) : (
              <>
                <span className="nx-hint"><span className="nx-kbd">↵</span> {activeEntry && activeEntry.type !== 1 ? STR.open : STR.copyPassword}</span>
                <span className="nx-hint"><span className="nx-kbd">⌘↵</span> {STR.open}</span>
                <span className="nx-hint"><span className="nx-kbd">⌘U</span> {STR.username}</span>
                <span className="nx-hint"><span className="nx-kbd">⌘O</span> {STR.code}</span>
                <span className="nx-hint"><span className="nx-kbd">⌘B</span> {STR.browse}</span>
              </>
            )}
            <span className="grow" />
            {!hintSeen && !commandMode && (
              <span className="nx-hint" onClick={markHintSeen}>
                <span className="nx-kbd">⌘K</span> {STR.hintLine}
              </span>
            )}
            {chip && !query && (
              <span className="nx-hint">{STR.inScope(itemSearch.total, chip)}</span>
            )}
            {!commandMode && itemSearch.total > itemSearch.results.length && (
              <span className="nx-hint">{STR.ofTotal(itemSearch.results.length, itemSearch.total)}</span>
            )}
          </div>
        )}
      </div>

      {browseOpen && (
        <BrowsePanel
          folders={props.folders}
          onSelect={(nextScope) => { setScope(nextScope); setBrowseOpen(false); setQuery(''); focusSearch(); }}
          onClose={() => { setBrowseOpen(false); focusSearch(); }}
        />
      )}

      {toast && (
        <div className="nx-toast" role="status">
          <span className="dot" />
          {toast.text}
          {toast.seconds !== null && <span className="count">{STR.clearsIn(toast.seconds)}</span>}
        </div>
      )}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        {toast ? `${toast.text}${toast.seconds !== null ? `, clears in ${toast.seconds} seconds` : ''}` : ''}
      </div>
    </div>
  );
}
