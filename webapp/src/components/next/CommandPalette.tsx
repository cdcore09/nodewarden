// NodeWarden Next (issue #16, slice 4): the command palette — the retrieval
// surface from slice 2, reshaped into a ⌘K modal that complements the
// dashboard. Retrieval semantics live HERE: Enter copies a login's password;
// the dashboard list underneath is a browsing context where Enter opens.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useDialogFocus } from './useDialogFocus';
import { t } from '@/lib/i18n';
import { searchEntries, type ScopeFilter, type SearchEntry } from '@/lib/next/search';
import { listCommands, filterCommands, type NextCommand, type NextCommandContext } from './commands';
import { TypeIcon } from '@/components/vault/vault-page-helpers';

const RESULT_LIMIT = 50;

const STR = {
  placeholder: 'Search your vault',
  copyPassword: 'copy password',
  open: 'open',
  username: 'username',
  code: 'code',
  edit: 'edit',
  run: 'run',
  commands: 'commands',
  close: 'close',
  noMatches: 'No matches.',
  ofTotal: (shown: number, total: number) => `${shown} of ${total}`,
};

const CREATE_TYPES: Array<{ type: number; label: string }> = [
  { type: 1, label: 'login' },
  { type: 2, label: 'note' },
  { type: 3, label: 'card' },
  { type: 4, label: 'identity' },
  { type: 6, label: 'bank account' },
  { type: 7, label: 'driver license' },
  { type: 8, label: 'passport' },
];

export type PaletteCopyKind = 'password' | 'username' | 'totp';

interface CommandPaletteProps {
  entries: SearchEntry[];
  scope: ScopeFilter;
  copiedId: string | null;
  gateActive: boolean;
  initialQuery?: string;
  commandContext: NextCommandContext;
  onCopy: (entry: SearchEntry, kind: PaletteCopyKind) => void;
  onOpen: (entry: SearchEntry) => void;
  onEdit: (entry: SearchEntry) => void;
  onStartCreate: (type: number, name: string) => void;
  onStartCreateFolder: () => void;
  onStartExport: () => void;
  onClose: () => void;
}

export default function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = useState(props.initialQuery || '');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDialogFocus(paletteRef, { initialFocus: false });

  const commandMode = query.startsWith('>');
  const itemSearch = useMemo(
    () => searchEntries(props.entries, commandMode ? '' : query, props.scope, RESULT_LIMIT),
    [props.entries, query, props.scope, commandMode]
  );
  const commands = useMemo(
    () => (commandMode ? filterCommands(listCommands(), query.slice(1)) : []),
    [commandMode, query]
  );
  const createMode = !commandMode && !!query.trim() && itemSearch.results.length === 0;
  const rowCount = commandMode ? commands.length : createMode ? CREATE_TYPES.length : itemSearch.results.length;
  const active = Math.min(activeIndex, Math.max(rowCount - 1, 0));
  const activeEntry: SearchEntry | null = !commandMode && !createMode ? itemSearch.results[active] || null : null;
  const activeCommand: NextCommand | null = commandMode ? commands[active] || null : null;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIndex(0); }, [query]);

  // The reprompt gate steals focus while it is up; take it back when it closes.
  const wasGated = useRef(false);
  useEffect(() => {
    if (wasGated.current && !props.gateActive) inputRef.current?.focus();
    wasGated.current = props.gateActive;
  }, [props.gateActive]);

  const runCommand = (command: NextCommand) => {
    props.onClose();
    if (command.id === 'new-item') props.onStartCreate(1, '');
    else if (command.id === 'new-folder') props.onStartCreateFolder();
    else if (command.id === 'export-vault') props.onStartExport();
    else command.run(props.commandContext);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(rowCount - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (commandMode) { if (activeCommand) runCommand(activeCommand); return; }
      if (createMode) { props.onStartCreate(CREATE_TYPES[active].type, query.trim()); return; }
      if (!activeEntry) return;
      if (meta) { props.onOpen(activeEntry); return; }
      if (activeEntry.type === 1) props.onCopy(activeEntry, 'password');
      else props.onOpen(activeEntry);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery('');
      else props.onClose();
    } else if (meta && !commandMode && activeEntry) {
      const key = event.key.toLowerCase();
      if (key === 'u' && activeEntry.type === 1) { event.preventDefault(); props.onCopy(activeEntry, 'username'); }
      else if (key === 'o' && activeEntry.hasTotp) { event.preventDefault(); props.onCopy(activeEntry, 'totp'); }
      else if (key === 'e') { event.preventDefault(); props.onEdit(activeEntry); }
    }
  };

  return (
    <div
      className="nx-palette-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div ref={paletteRef} className="nx-palette" role="dialog" aria-modal="true" aria-label={STR.placeholder}>
        <div className="nx-search">
          {commandMode && <span className="nx-cmd-sigil" aria-hidden="true">&gt;</span>}
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={rowCount > 0}
            aria-controls="nx-palette-results"
            aria-activedescendant={rowCount > 0 ? `nx-prow-${active}` : undefined}
            aria-label={STR.placeholder}
            placeholder={STR.placeholder}
            value={query}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
          />
          <span className="nx-kbd">esc</span>
        </div>

        <div className="nx-results" id="nx-palette-results" role="listbox">
          {commandMode &&
            commands.map((command, index) => (
              <div
                key={command.id}
                id={`nx-prow-${index}`}
                role="option"
                aria-selected={index === active}
                className={`nx-row${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span className="ico">›</span>
                <span className="main">
                  <span className="title">{command.label}</span>
                  {command.hint && <span className="sub ui-face">{command.hint}</span>}
                </span>
                <span className="meta">{index === active && <span className="nx-kbd">↵</span>}</span>
              </div>
            ))}

          {createMode &&
            CREATE_TYPES.map((option, index) => (
              <div
                key={option.type}
                id={`nx-prow-${index}`}
                role="option"
                aria-selected={index === active}
                className={`nx-row${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => props.onStartCreate(option.type, query.trim())}
              >
                <span className="ico">＋</span>
                <span className="main">
                  <span className="title">Create {option.label} “{query.trim()}”</span>
                </span>
                <span className="meta">{index === active && <span className="nx-kbd">↵</span>}</span>
              </div>
            ))}

          {!commandMode && !createMode &&
            itemSearch.results.map((entry, index) => (
              <div
                key={entry.id}
                id={`nx-prow-${index}`}
                role="option"
                aria-selected={index === active}
                className={`nx-row${index === active ? ' is-active' : ''}${entry.id === props.copiedId ? ' is-copied' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  if (entry.type === 1) props.onCopy(entry, 'password');
                  else props.onOpen(entry);
                }}
              >
                <span className="ico"><TypeIcon type={entry.type} /></span>
                <span className="main">
                  <span className="title">{entry.name}</span>
                  <span className={`sub${entry.type === 1 ? '' : ' ui-face'}`}>{entry.sub}</span>
                </span>
                <span className="meta">
                  {entry.id === props.copiedId && <span className="nx-badge ok">✓</span>}
                  {entry.reprompt && <span className="nx-badge warn">locked</span>}
                  {entry.organizationId && <span className="nx-badge org">org</span>}
                </span>
              </div>
            ))}

          {rowCount === 0 && (
            <div className="nx-empty" style={{ margin: 'var(--nx-sp-6) auto' }}>
              {commandMode ? STR.noMatches : t('txt_no_items')}
            </div>
          )}
        </div>

        <div className="nx-hintbar">
          {commandMode ? (
            <>
              <span className="nx-hint"><span className="nx-kbd">↵</span> {STR.run}</span>
              <span className="nx-hint"><span className="nx-kbd">esc</span> {STR.commands}</span>
            </>
          ) : (
            <>
              <span className="nx-hint"><span className="nx-kbd">↵</span> {activeEntry && activeEntry.type !== 1 ? STR.open : STR.copyPassword}</span>
              <span className="nx-hint"><span className="nx-kbd">⌘↵</span> {STR.open}</span>
              <span className="nx-hint"><span className="nx-kbd">⌘U</span> {STR.username}</span>
              <span className="nx-hint"><span className="nx-kbd">⌘O</span> {STR.code}</span>
              <span className="nx-hint"><span className="nx-kbd">⌘E</span> {STR.edit}</span>
            </>
          )}
          <span className="grow" />
          {!commandMode && itemSearch.total > itemSearch.results.length && (
            <span className="nx-hint">{STR.ofTotal(itemSearch.results.length, itemSearch.total)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
