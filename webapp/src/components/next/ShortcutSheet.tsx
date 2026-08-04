// NodeWarden Next (issue #16, slice 5): keyboard shortcut cheat sheet.
// Opened with "?" anywhere in the Next shell, or the header help button —
// the discoverability answer to "how was I supposed to know ⌘K?".
import { useRef } from 'preact/hooks';
import { useDialogFocus } from './useDialogFocus';
import { t } from '@/lib/i18n';

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Anywhere',
    rows: [
      ['⌘K', 'Open the command palette'],
      ['any letter', 'Open the palette pre-filled'],
      ['?', 'This cheat sheet'],
      ['esc', 'Close panel / dialog / clear'],
    ],
  },
  {
    title: 'Item list',
    rows: [
      ['↑ ↓', 'Move selection'],
      ['↵', 'Open item'],
      ['⌘U', 'Copy username'],
      ['⌘O', 'Copy one-time code'],
      ['⌘E', 'Edit item'],
      ['⌘S', 'Share to organization'],
      ['right-click', 'All item actions'],
    ],
  },
  {
    title: 'Command palette',
    rows: [
      ['↵', 'Copy password (logins) / open'],
      ['⌘↵', 'Open item'],
      ['⌘U / ⌘O / ⌘E', 'Copy username / code · edit'],
      ['>', 'Command mode (pages, actions)'],
      ['no matches', 'Create an item from your query'],
    ],
  },
  {
    title: 'Editor',
    rows: [
      ['⌘↵ or ⌘S', 'Save'],
      ['⌘G', 'Use / reroll generated password'],
      ['esc', 'Cancel (asks if unsaved)'],
    ],
  },
];

export default function ShortcutSheet(props: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);

  return (
    <div className="nx-scrim" style={{ zIndex: 34 }} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div
        ref={ref}
        className="nx-dialog nx-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); props.onClose(); }
        }}
      >
        <h3>Keyboard shortcuts</h3>
        <div className="sheet-grid">
          {GROUPS.map((group) => (
            <div key={group.title} className="sheet-group">
              <div className="nx-overline">{group.title}</div>
              {group.rows.map(([keys, label]) => (
                <div className="sheet-row" key={keys + label}>
                  <span className="keys">
                    {keys.split(' ').map((key, i) => (
                      key === '/' || key === '·'
                        ? <span key={i} className="sep">{key}</span>
                        : <span key={i} className="nx-kbd">{key}</span>
                    ))}
                  </span>
                  <span className="lbl">{label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="dfoot">
          <button type="button" className="nx-btn ghost" onClick={props.onClose}>
            {t('txt_cancel')} <span className="nx-kbd">esc</span>
          </button>
        </div>
      </div>
    </div>
  );
}
