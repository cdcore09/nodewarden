// NodeWarden Next (issue #16, slice 2): browse panel — the chip picker.
// Browsing collapses into an explicit scope chip (docs/nodewarden-next/02 §4);
// this overlay lists the available scopes with the same list idiom as results.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/lib/i18n';
import type { Folder } from '@/lib/types';
import type { ScopeFilter } from '@/lib/next/search';
import { cipherTypeLabel } from '@/components/vault/vault-page-helpers';

const ITEM_TYPES = [1, 3, 6, 4, 7, 8, 2, 5];

interface BrowsePanelProps {
  folders: Folder[];
  onSelect: (scope: ScopeFilter) => void;
  onClose: () => void;
}

interface PanelRow {
  key: string;
  label: string;
  scope: ScopeFilter;
}

export default function BrowsePanel(props: BrowsePanelProps) {
  const rows: PanelRow[] = [
    { key: 'favorites', label: t('txt_favorites'), scope: { kind: 'favorites' } },
    ...ITEM_TYPES.map((type) => ({
      key: `type-${type}`,
      label: cipherTypeLabel(type),
      scope: { kind: 'type', type } as ScopeFilter,
    })),
    ...props.folders.map((folder) => ({
      key: `folder-${folder.id}`,
      label: folder.decName || folder.name || '',
      scope: { kind: 'folder', folderId: folder.id, label: folder.decName || folder.name || '' } as ScopeFilter,
    })),
    { key: 'archive', label: t('txt_archive'), scope: { kind: 'archive' } },
    { key: 'trash', label: t('txt_trash'), scope: { kind: 'trash' } },
  ];

  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      props.onSelect(rows[active].scope);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    }
  };

  useEffect(() => {
    panelRef.current
      ?.querySelectorAll('.mrow')
      [active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      ref={panelRef}
      className="nx-menu nx-browse"
      style={{ top: 110, left: '50%', transform: 'translateX(-50%)', minWidth: 320 }}
      role="listbox"
      aria-label={t('txt_all_items')}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {rows.map((row, index) => (
        <button
          key={row.key}
          type="button"
          role="option"
          aria-selected={index === active}
          className={`mrow${index === active ? ' is-active' : ''}`}
          onMouseEnter={() => setActive(index)}
          onClick={() => props.onSelect(row.scope)}
        >
          {row.label}
        </button>
      ))}
    </div>
  );
}
