// NodeWarden Next (issue #16, slice 4): the dashboard — the primary,
// mouse-first surface. Rail navigation + browsable list + detail/editor
// panels, with the command palette (CommandPalette.tsx) one ⌘K away.
// Browsing semantics here: Enter/click OPENS an item; retrieval semantics
// (Enter copies) live in the palette. Design: precision instrument
// (docs/nodewarden-next/03-design-system.md), owner directive 2026-08-04.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import {
  Archive, ArchiveRestore, AtSign, Copy as CopyIcon, CopyPlus, ExternalLink, Folder as FolderIcon, HelpCircle, KeyRound, Layers, Lock, LogOut,
  MoreHorizontal, PanelLeft, Pencil, Plus, RefreshCw, Search, Send as SendIcon, Settings, Share2, ShieldCheck, Star, SquareArrowOutUpRight, Timer, Trash2, Undo2, Wand2,
} from 'lucide-preact';
import WebsiteIcon from '@/components/vault/WebsiteIcon';
import NextAuditPage from './NextAuditPage';
import NextTotpPage from './NextTotpPage';
import NextGeneratorPage from './NextGeneratorPage';
import NextSendsPage from './NextSendsPage';
import NextSettingsPage from './NextSettingsPage';
import ShortcutSheet from './ShortcutSheet';
import { useDialogFocus } from './useDialogFocus';
import type { Send, SendDraft } from '@/lib/types';
import { generateDefaultSshKeyMaterial } from '@/lib/ssh';
import { t } from '@/lib/i18n';
import { calcTotpNow } from '@/lib/crypto';
import {
  buildSearchEntries, searchEntries, sortEntries,
  type ScopeFilter, type SearchEntry, type SortMode,
} from '@/lib/next/search';
import { copySensitive, CLIPBOARD_CLEAR_SECONDS, type ClipboardPort } from '@/lib/next/clipboard-clear';
import { setUiVersion } from '@/lib/ui-version';
import {
  TypeIcon, buildCipherDuplicateSignatures, cipherTypeLabel, createEmptyDraft, draftFromCipher,
  getDuplicateDetectionOptions, type DuplicateDetectionMode,
} from '@/components/vault/vault-page-helpers';
import CommandPalette, { type PaletteCopyKind } from './CommandPalette';
import DetailPanel from './DetailPanel';
import EditorPanel from './EditorPanel';
import ShareDialog from './ShareDialog';
import type { Cipher, Folder, VaultDraft } from '@/lib/types';
import type { NextCommandContext } from './commands';
import '../../styles/next/tokens.css';
import '../../styles/next/vault.css';
import '../../styles/next/detail.css';
import '../../styles/next/dashboard.css';

const LIST_CAP = 200;
const SORT_KEY = 'nodewarden.next.sort.v1';
const ITEM_TYPES = [1, 3, 6, 4, 7, 8, 2, 5];

// Fork-local strings (skin-feature precedent).
const STR = {
  searchTrigger: 'Search vault…',
  newItem: 'New',
  allItems: t('txt_all_items'),
  types: 'Types',
  folders: t('txt_folders'),
  sort: { name: 'Name', edited: 'Last edited', created: 'Created' } as Record<SortMode, string>,
  sortLabel: 'Sort',
  audit: 'Security audit',
  classic: 'Classic UI',
  copied: (label: string) => `${label} copied`,
  clearsIn: (s: number) => `· clears in ${s}s`,
  password: 'Password',
  username: 'Username',
  code: 'Code',
  copyUsername: 'Copy username',
  copyPassword: 'Copy password',
  openSite: 'Open website',
  edit: 'Edit',
  share: 'Share…',
  archive: 'Archive',
  unarchive: 'Unarchive',
  toTrash: 'Move to trash',
  restore: 'Restore',
  deleteForever: 'Delete forever',
  deleteForeverTitle: (name: string) => `Delete “${name}” forever?`,
  deleteForeverMessage: 'This permanently removes the item. There is no undo.',
  emptyVault: 'Your vault is empty.',
  createFirst: 'Create your first login',
  emptyScope: 'Nothing here.',
  overflow: (shown: number, total: number) => `Showing ${shown} of ${total} — search with ⌘K to narrow.`,
  gateHelp: 'This item asks for your master password.',
  gateUnlock: 'Unlock item',
  classicSwitch: 'Switched to the classic interface.',
  edited: 'edited',
};

interface VaultNextPageProps {
  ciphers: Cipher[];
  folders: Folder[];
  loading: boolean;
  emailForReprompt: string;
  onVerifyMasterPassword: (email: string, password: string) => Promise<void>;
  onCreate: (draft: VaultDraft, attachments?: File[]) => Promise<void>;
  onUpdate: (cipher: Cipher, draft: VaultDraft, options?: { addFiles?: File[]; removeAttachmentIds?: string[] }) => Promise<void>;
  onShare: (cipher: Cipher, orgId: string, collectionIds: string[]) => Promise<void>;
  onLoadShareCollections: (orgId: string) => Promise<Array<{ id: string; name: string | null }>>;
  shareOrganizations: Array<{ id: string; name: string }>;
  onDelete: (cipher: Cipher) => Promise<void>;
  onArchive: (cipher: Cipher) => Promise<void>;
  onUnarchive: (cipher: Cipher) => Promise<void>;
  onRestore: (ids: string[]) => Promise<void>;
  onBulkPermanentDelete: (ids: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onDownloadAttachment: (cipher: Cipher, attachmentId: string) => Promise<void>;
  downloadingAttachmentKey?: string;
  sends: Send[];
  sendsLoading: boolean;
  onCreateSend: (draft: SendDraft, autoCopyLink: boolean) => Promise<void>;
  onUpdateSend: (send: Send, draft: SendDraft, autoCopyLink: boolean) => Promise<void>;
  onDeleteSend: (send: Send) => Promise<void>;
  themePreference: 'system' | 'light' | 'dark';
  onThemePreferenceChange: (preference: 'system' | 'light' | 'dark') => void;
  lockTimeoutMinutes: 0 | 1 | 5 | 15 | 30;
  onLockTimeoutChange: (minutes: 0 | 1 | 5 | 15 | 30) => void;
  sessionTimeoutAction: 'lock' | 'logout';
  onSessionTimeoutActionChange: (action: 'lock' | 'logout') => void;
  onLock: () => void;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
}

type CopyKind = PaletteCopyKind;

interface GateState {
  entryId: string;
  kind: CopyKind | 'open' | 'edit';
  error: string;
  submitting: boolean;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

interface RowMenuState {
  entryId: string;
  x: number;
  y: number;
}

const clipboardPort: ClipboardPort = {
  write: (text) => navigator.clipboard.writeText(text),
  read: () => navigator.clipboard.readText(),
};

const scheduleTimeout = (fn: () => void, ms: number) => {
  const id = window.setTimeout(fn, ms);
  return () => window.clearTimeout(id);
};

function readSort(): SortMode {
  try {
    const raw = window.localStorage.getItem(SORT_KEY);
    if (raw === 'name' || raw === 'edited' || raw === 'created') return raw;
  } catch { /* default below */ }
  return 'name';
}

function relativeTime(ms: number): string {
  if (!ms) return '';
  const delta = Date.now() - ms;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function scopeTitle(scope: ScopeFilter): string {
  switch (scope.kind) {
    case 'all': return t('txt_all_items');
    case 'favorites': return t('txt_favorites');
    case 'archive': return t('txt_archive');
    case 'trash': return t('txt_trash');
    case 'duplicates': return t('txt_duplicates');
    case 'type': return cipherTypeLabel(scope.type);
    case 'folder': return scope.label;
  }
}

type NextPage = 'vault' | 'audit' | 'totp' | 'generator' | 'sends' | 'settings';

const PAGE_TITLES: Record<NextPage, string> = {
  vault: '',
  audit: 'Security audit',
  totp: 'Verification codes',
  generator: 'Generator',
  sends: 'Sends',
  settings: 'Settings',
};

function pageFromLocation(location: string): NextPage {
  if (location === '/next/audit') return 'audit';
  if (location === '/next/totp') return 'totp';
  if (location === '/next/generator') return 'generator';
  if (location === '/next/sends') return 'sends';
  if (location === '/next/settings') return 'settings';
  return 'vault';
}

export default function VaultNextPage(props: VaultNextPageProps) {
  const [location, navigate] = useLocation();
  const page = pageFromLocation(location);
  const [scope, setScope] = useState<ScopeFilter>({ kind: 'all' });
  const [sort, setSortState] = useState<SortMode>(readSort);
  const [duplicateMode, setDuplicateMode] = useState<DuplicateDetectionMode>('exact');
  const [syncing, setSyncing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VaultDraft | null>(null);
  const [draftBase, setDraftBase] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSeed, setPaletteSeed] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; seconds: number | null } | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return window.localStorage.getItem('nodewarden.next.rail.v1') === 'collapsed'; } catch { return false; }
  });
  const toggleRail = () => {
    setRailCollapsed((prev) => {
      try { window.localStorage.setItem('nodewarden.next.rail.v1', prev ? 'open' : 'collapsed'); } catch { /* session only */ }
      return !prev;
    });
  };
  const unlockedIds = useRef<Set<string>>(new Set());
  const gateRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const cipherById = useMemo(() => {
    const map = new Map<string, Cipher>();
    for (const cipher of props.ciphers) map.set(cipher.id, cipher);
    return map;
  }, [props.ciphers]);

  const entries = useMemo(
    () => buildSearchEntries(props.ciphers, props.folders),
    [props.ciphers, props.folders]
  );

  const scoped = useMemo(() => searchEntries(entries, '', scope, Number.MAX_SAFE_INTEGER), [entries, scope]);
  const viewEntries = useMemo(() => {
    if (scope.kind !== 'duplicates') return sortEntries(scoped.results, sort).slice(0, LIST_CAP);
    // Duplicates: keep only entries whose signature collides; cluster groups together.
    const signatureById = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const entry of scoped.results) {
      const cipher = cipherById.get(entry.id);
      if (!cipher) continue;
      const signatures = Array.from(new Set(buildCipherDuplicateSignatures(cipher, duplicateMode)));
      signatureById.set(entry.id, signatures);
      for (const signature of signatures) counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    const duplicated = scoped.results.filter((entry) =>
      (signatureById.get(entry.id) || []).some((signature) => (counts.get(signature) || 0) > 1)
    );
    const groupKey = (entry: SearchEntry) =>
      (signatureById.get(entry.id) || []).find((signature) => (counts.get(signature) || 0) > 1) || '';
    return duplicated
      .sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.name.localeCompare(b.name))
      .slice(0, LIST_CAP);
  }, [scoped.results, sort, scope.kind, duplicateMode, cipherById]);
  const scopedTotal = scope.kind === 'duplicates' ? viewEntries.length : scoped.total;

  const counts = useMemo(() => {
    const byType = new Map<number, number>();
    const byFolder = new Map<string, number>();
    let all = 0, favorites = 0, archived = 0, trashed = 0;
    for (const entry of entries) {
      if (entry.deleted) { trashed += 1; continue; }
      if (entry.archived) { archived += 1; continue; }
      all += 1;
      if (entry.favorite) favorites += 1;
      byType.set(entry.type, (byType.get(entry.type) || 0) + 1);
      if (entry.folderId) byFolder.set(entry.folderId, (byFolder.get(entry.folderId) || 0) + 1);
    }
    return { all, favorites, archived, trashed, byType, byFolder };
  }, [entries]);

  const openCipher = openId ? cipherById.get(openId) || null : null;
  const editorOpen = draft !== null;
  const panelOpen = editorOpen || !!openCipher;
  const selectedEntry = selectedIndex >= 0 ? viewEntries[selectedIndex] || null : null;

  useEffect(() => { setSelectedIndex(-1); }, [scope, sort]);

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

  // Focus handling for the gate lives in GateBox (trap + restore).

  const setSort = (mode: SortMode) => {
    setSortState(mode);
    try { window.localStorage.setItem(SORT_KEY, mode); } catch { /* session-only */ }
  };

  function TrappedDialog(props: { label: string; children: preact.ComponentChildren; onClose?: () => void; alert?: boolean }) {
    const boxRef = useRef<HTMLDivElement>(null);
    useDialogFocus(boxRef);
    return (
      <div className="nx-scrim" style={{ zIndex: 35 }}>
        <div
          ref={boxRef}
          className="nx-dialog mini"
          role={props.alert ? 'alertdialog' : 'dialog'}
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

  const commandContext: NextCommandContext = {
    navigate,
    lock: props.onLock,
    logout: props.onLogout,
    toClassic: () => {
      setUiVersion('v1');
      props.onNotify('success', STR.classicSwitch);
      navigate('/vault');
    },
  };

  const closePanels = () => {
    setDraft(null);
    setCreating(false);
    setOpenId(null);
    setShareOpen(false);
  };

  const gateCheck = (entry: SearchEntry, kind: GateState['kind']): boolean => {
    if (entry.reprompt && !unlockedIds.current.has(entry.id)) {
      setGate({ entryId: entry.id, kind, error: '', submitting: false });
      return false;
    }
    return true;
  };

  const openEntry = (entry: SearchEntry) => {
    if (!gateCheck(entry, 'open')) return;
    setPaletteOpen(false);
    setDraft(null);
    setCreating(false);
    setOpenId(entry.id);
  };

  const startEdit = (cipher: Cipher) => {
    const nextDraft = draftFromCipher(cipher);
    setDraft(nextDraft);
    setDraftBase(JSON.stringify(nextDraft));
    setCreating(false);
    setOpenId(cipher.id);
    setPaletteOpen(false);
  };

  const editEntry = (entry: SearchEntry) => {
    if (!gateCheck(entry, 'edit')) return;
    const cipher = cipherById.get(entry.id);
    if (cipher) startEdit(cipher);
  };

  const startCreate = (type: number, prefillName = '') => {
    const nextDraft = createEmptyDraft(type);
    nextDraft.name = prefillName;
    if (scope.kind === 'folder') nextDraft.folderId = scope.folderId;
    setDraft(nextDraft);
    setDraftBase(JSON.stringify(nextDraft));
    setCreating(true);
    setOpenId(null);
    setPaletteOpen(false);
    if (type === 5) {
      // Seed a fresh Ed25519 key pair like the classic editor does.
      void generateDefaultSshKeyMaterial()
        .then((generated) => {
          setDraft((prev) => {
            if (!prev || prev.type !== 5 || prev.sshPrivateKey.trim() || prev.sshPublicKey.trim()) return prev;
            return { ...prev, sshPrivateKey: generated.privateKey, sshPublicKey: generated.publicKey, sshFingerprint: generated.fingerprint };
          });
        })
        .catch(() => { /* unsupported browser: user pastes keys manually */ });
    }
  };

  const toggleFavorite = async (entry: SearchEntry) => {
    const cipher = cipherById.get(entry.id);
    if (!cipher) return;
    setRowMenu(null);
    try {
      const flipped = draftFromCipher(cipher);
      flipped.favorite = !flipped.favorite;
      await props.onUpdate(cipher, flipped);
    } catch (error) {
      props.onNotify('error', error instanceof Error ? error.message : String(error));
    }
  };

  const syncVault = async () => {
    if (syncing) return;
    setSyncing(true);
    try { await props.onRefresh(); } finally { setSyncing(false); }
  };

  const patchDraft = (patch: Partial<VaultDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const saveDraft = async (addFiles: File[], removeAttachmentIds: string[]) => {
    if (!draft || saving || !draft.name.trim()) return;
    const normalized: VaultDraft = {
      ...draft,
      loginUris: (draft.loginUris || []).filter((u) => u.uri.trim()),
      customFields: (draft.customFields || []).filter((f) => f.label.trim() || f.value.trim() || f.type === 3),
    };
    setSaving(true);
    try {
      if (creating) {
        await props.onCreate(normalized, addFiles);
        setDraft(null);
        setCreating(false);
      } else {
        const cipher = draft.id ? cipherById.get(draft.id) : null;
        if (cipher) await props.onUpdate(cipher, normalized, { addFiles, removeAttachmentIds });
        setDraft(null);
        // Audit fix-loop: a save that came from a finding resolves it in place.
        if (fixingId && draft.id === fixingId) {
          setFixedIds((prev) => new Set(prev).add(fixingId));
          setFixingId(null);
          setOpenId(null);
        } else {
          setOpenId(draft.id || null);
        }
      }
    } catch (error) {
      props.onNotify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const submitShare = async (orgId: string, collectionIds: string[]) => {
    const cipher = openCipher;
    if (!cipher || shareSubmitting) return;
    setShareSubmitting(true);
    try {
      await props.onShare(cipher, orgId, collectionIds);
      setShareOpen(false);
    } catch { /* hook toasts its own error */ } finally {
      setShareSubmitting(false);
    }
  };

  const copyRawValue = async (value: string, label: string, entryId?: string) => {
    if (!value) return;
    try {
      const copy = await copySensitive(clipboardPort, value, scheduleTimeout);
      if (entryId) {
        setCopiedId(entryId);
        window.setTimeout(() => setCopiedId((id) => (id === entryId ? null : id)), 900);
      }
      setToast({ text: STR.copied(label), seconds: copy.canClear ? CLIPBOARD_CLEAR_SECONDS : null });
      if (!copy.canClear) window.setTimeout(() => setToast(null), 2500);
    } catch {
      props.onNotify('error', t('txt_copy_failed'));
    }
  };

  const performCopy = async (entry: SearchEntry, kind: CopyKind) => {
    const cipher = cipherById.get(entry.id);
    if (!cipher) return;
    let value = '';
    let label = STR.password;
    if (kind === 'password') value = cipher.login?.decPassword || '';
    if (kind === 'username') { value = cipher.login?.decUsername || ''; label = STR.username; }
    if (kind === 'totp') { value = (await calcTotpNow(cipher.login?.decTotp || ''))?.code || ''; label = STR.code; }
    await copyRawValue(value, label, entry.id);
  };

  const requestCopy = (entry: SearchEntry, kind: CopyKind) => {
    if (!gateCheck(entry, kind)) return;
    void performCopy(entry, kind);
  };

  const submitGate = async () => {
    if (!gate || gate.submitting) return;
    const password = gateRef.current?.value || '';
    if (!password) return;
    setGate({ ...gate, error: '', submitting: true });
    try {
      await props.onVerifyMasterPassword(props.emailForReprompt, password);
      unlockedIds.current.add(gate.entryId);
      const entry = entries.find((e) => e.id === gate.entryId) || null;
      const kind = gate.kind;
      setGate(null);
      if (!entry) return;
      if (kind === 'open') openEntry(entry);
      else if (kind === 'edit') editEntry(entry);
      else void performCopy(entry, kind);
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

  const runRowAction = async (entry: SearchEntry, action: string) => {
    const cipher = cipherById.get(entry.id);
    if (!cipher) return;
    setRowMenu(null);
    try {
      if (action === 'archive') await props.onArchive(cipher);
      else if (action === 'unarchive') await props.onUnarchive(cipher);
      else if (action === 'trash') await props.onDelete(cipher);
      else if (action === 'restore') await props.onRestore([cipher.id]);
      else if (action === 'delete-forever') {
        setConfirm({
          title: STR.deleteForeverTitle(entry.name),
          message: STR.deleteForeverMessage,
          confirmLabel: STR.deleteForever,
          run: async () => {
            await props.onBulkPermanentDelete([cipher.id]);
            if (openId === cipher.id) closePanels();
          },
        });
        return;
      }
      if (openId === cipher.id && (action === 'trash' || action === 'archive')) closePanels();
    } catch (error) {
      props.onNotify('error', error instanceof Error ? error.message : String(error));
    }
  };

  const duplicateEntry = async (entry: SearchEntry) => {
    const cipher = cipherById.get(entry.id);
    if (!cipher) return;
    setRowMenu(null);
    try {
      const copy = draftFromCipher(cipher);
      delete copy.id;
      copy.name = `${copy.name} copy`;
      await props.onCreate(copy);
    } catch (error) {
      props.onNotify('error', error instanceof Error ? error.message : String(error));
    }
  };

  const startFix = (cipherId: string) => {
    const cipher = cipherById.get(cipherId);
    if (!cipher) return;
    setFixingId(cipherId);
    startEdit(cipher);
  };

  const requestConfirm = (title: string, message: string, confirmLabel: string, run: () => Promise<void>) => {
    setConfirm({ title, message, confirmLabel, run });
  };

  const overlaysOpen = paletteOpen || editorOpen || shareOpen || !!gate || !!confirm || !!rowMenu || sortMenuOpen || newMenuOpen || sheetOpen;

  // Dashboard keyboard model.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const targetIsInput =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT');
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setRowMenu(null); setSortMenuOpen(false); setNewMenuOpen(false);
        if (!editorOpen && !gate && !confirm) { setPaletteSeed(''); setPaletteOpen((open) => !open); }
        return;
      }
      if (overlaysOpen) {
        if (event.key === 'Escape' && (rowMenu || sortMenuOpen || newMenuOpen)) {
          setRowMenu(null); setSortMenuOpen(false); setNewMenuOpen(false);
        }
        return;
      }
      const target = openCipher ? entries.find((e) => e.id === openCipher.id) || null : selectedEntry;
      if (meta) {
        const key = event.key.toLowerCase();
        if (target) {
          if (key === 'u' && target.type === 1) { event.preventDefault(); requestCopy(target, 'username'); return; }
          if (key === 'o' && target.hasTotp) { event.preventDefault(); requestCopy(target, 'totp'); return; }
          if (key === 'e') { event.preventDefault(); editEntry(target); return; }
          if (key === 's' && props.shareOrganizations.length > 0 && !target.organizationId) {
            event.preventDefault(); setOpenId(target.id); setShareOpen(true); return;
          }
        }
        return;
      }
      if (event.key === 'ArrowDown' && !targetIsInput) {
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, viewEntries.length - 1));
      } else if (event.key === 'ArrowUp' && !targetIsInput) {
        event.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter' && !targetIsInput && selectedEntry) {
        event.preventDefault();
        openEntry(selectedEntry);
      } else if (event.key === 'Escape') {
        if (panelOpen) { event.preventDefault(); closePanels(); }
        else if (selectedIndex >= 0) { event.preventDefault(); setSelectedIndex(-1); }
      } else if (!targetIsInput && !meta && !event.altKey && (event.key === '?' || (event.key === '/' && event.shiftKey))) {
        // "?" opens the shortcut cheat sheet — the discoverability layer.
        event.preventDefault();
        setSheetOpen(true);
      } else if (!targetIsInput && !meta && !event.altKey && event.key.length === 1) {
        // Type-anywhere: any printable character opens the palette pre-seeded.
        event.preventDefault();
        setPaletteSeed(event.key);
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlaysOpen, paletteOpen, editorOpen, gate, confirm, rowMenu, sortMenuOpen, newMenuOpen, selectedEntry, selectedIndex, viewEntries, openCipher, entries, panelOpen]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const row = listRef.current?.querySelectorAll<HTMLElement>('.nx-row')[selectedIndex];
    row?.scrollIntoView({ block: 'nearest' });
    // Keep DOM focus on the selection when keyboard users are in the list.
    if (listRef.current?.contains(document.activeElement)) row?.focus();
  }, [selectedIndex]);

  const railLink = (
    key: string, label: string, icon: preact.ComponentChildren, target: ScopeFilter, count?: number
  ) => {
    const on = page === 'vault' && JSON.stringify(scope) === JSON.stringify(target);
    return (
      <button
        key={key}
        type="button"
        className={`rail-link${on ? ' on' : ''}`}
        aria-current={on ? 'page' : undefined}
        onClick={() => { setScope(target); closePanels(); if (page !== 'vault') navigate('/next'); }}
      >
        {icon}{label}
        {typeof count === 'number' && count > 0 && <span className="count">{count}</span>}
      </button>
    );
  };

  const showEmptyVault = !props.loading && props.ciphers.length === 0;
  const gateEntry = gate ? entries.find((e) => e.id === gate.entryId) || null : null;

  const rowMenuEntry = rowMenu ? entries.find((e) => e.id === rowMenu.entryId) || null : null;
  const rowMenuCipher = rowMenuEntry ? cipherById.get(rowMenuEntry.id) : null;
  const rowMenuUri = rowMenuCipher?.login?.uris?.find((u) => u.decUri || u.uri);

  return (
    <div className={`nw-next nx-dash nx-vault${panelOpen ? ' has-panel' : ''}${railCollapsed ? ' rail-collapsed' : ''}`}>
      <nav className="nx-rail" aria-label="Vault">
        <div className="nx-wordmark"><span className="nx-mark" aria-hidden="true">N</span> NodeWarden</div>

        <div className="rail-group">
          {railLink('all', STR.allItems, <Layers size={14} />, { kind: 'all' }, counts.all)}
          {railLink('fav', t('txt_favorites'), <Star size={14} />, { kind: 'favorites' }, counts.favorites)}
        </div>

        <div className="rail-group">
          <div className="rail-head">{STR.types}</div>
          {ITEM_TYPES.filter((type) => (counts.byType.get(type) || 0) > 0).map((type) =>
            railLink(`t${type}`, cipherTypeLabel(type), <TypeIcon type={type} />, { kind: 'type', type }, counts.byType.get(type))
          )}
        </div>

        {props.folders.length > 0 && (
          <div className="rail-group">
            <div className="rail-head">{STR.folders}</div>
            {props.folders.map((folder) =>
              railLink(
                `f${folder.id}`,
                folder.decName || folder.name || '',
                <FolderIcon size={14} />,
                { kind: 'folder', folderId: folder.id, label: folder.decName || folder.name || '' },
                counts.byFolder.get(folder.id)
              )
            )}
          </div>
        )}

        <div className="rail-group">
          {railLink('dups', t('txt_duplicates'), <CopyIcon size={14} />, { kind: 'duplicates' })}
          {railLink('archive', t('txt_archive'), <Archive size={14} />, { kind: 'archive' }, counts.archived)}
          {railLink('trash', t('txt_trash'), <Trash2 size={14} />, { kind: 'trash' }, counts.trashed)}
        </div>

        <div className="rail-group">
          <div className="rail-head">Tools</div>
          <button type="button" className={`rail-link${page === 'sends' ? ' on' : ''}`} onClick={() => navigate('/next/sends')}>
            <SendIcon size={14} />Sends
          </button>
          <button type="button" className={`rail-link${page === 'totp' ? ' on' : ''}`} onClick={() => navigate('/next/totp')}>
            <Timer size={14} />{PAGE_TITLES.totp}
          </button>
          <button type="button" className={`rail-link${page === 'generator' ? ' on' : ''}`} onClick={() => navigate('/next/generator')}>
            <Wand2 size={14} />{PAGE_TITLES.generator}
          </button>
          <button type="button" className={`rail-link${page === 'audit' ? ' on' : ''}`} onClick={() => navigate('/next/audit')}>
            <ShieldCheck size={14} />{STR.audit}
          </button>
          <button type="button" className="rail-link" onClick={() => navigate('/import')}>
            <ExternalLink size={14} />{t('txt_import')}
          </button>
        </div>

        <div className="rail-foot">
          <div className="rail-sep" />
          <button type="button" className={`rail-link${page === 'settings' ? ' on' : ''}`} onClick={() => navigate('/next/settings')}>
            <Settings size={14} />{t('txt_settings')}
          </button>
          <button type="button" className="rail-link" onClick={() => setSheetOpen(true)}>
            <HelpCircle size={14} />Shortcuts<span className="count"><span className="nx-kbd">?</span></span>
          </button>
          <div className="rail-sep" />
          <button type="button" className="rail-link" onClick={props.onLock}>
            <Lock size={14} />{t('txt_lock')}
          </button>
          <button type="button" className="rail-link" onClick={props.onLogout}>
            <LogOut size={14} />{t('txt_log_out')}
          </button>
        </div>
      </nav>

      <main className="nx-main">
        <header className="nx-dashhead">
          <button
            type="button"
            className="nx-iconbtn lg"
            title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!railCollapsed}
            onClick={toggleRail}
          >
            <PanelLeft size={15} />
          </button>
          <h1 className="scope-title">{page === 'vault' ? scopeTitle(scope) : PAGE_TITLES[page]}</h1>
          {page === 'vault' && <span className="scope-count">{scopedTotal}</span>}
          {page === 'vault' && scope.kind === 'duplicates' && (
            <select
              className="nx-input"
              style={{ width: 'auto', height: 34 }}
              value={duplicateMode}
              aria-label={t('txt_duplicates')}
              onInput={(e) => setDuplicateMode((e.currentTarget as HTMLSelectElement).value as DuplicateDetectionMode)}
            >
              {getDuplicateDetectionOptions().map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          {page === 'vault' && (
          <button
            type="button"
            className="nx-iconbtn lg"
            title={t('txt_sync_vault')}
            disabled={syncing}
            onClick={() => void syncVault()}
          >
            <RefreshCw size={14} style={syncing ? { animation: 'nx-spin 1s linear infinite' } : undefined} />
          </button>
          )}
          {page === 'vault' && (
          <select
            className="nx-input scope-select"
            style={{ width: 'auto', height: 34 }}
            value={JSON.stringify(scope)}
            onInput={(e) => { setScope(JSON.parse((e.currentTarget as HTMLSelectElement).value)); closePanels(); }}
            aria-label={STR.allItems}
          >
            <option value={JSON.stringify({ kind: 'all' })}>{STR.allItems}</option>
            <option value={JSON.stringify({ kind: 'favorites' })}>{t('txt_favorites')}</option>
            {ITEM_TYPES.map((type) => (
              <option key={type} value={JSON.stringify({ kind: 'type', type })}>{cipherTypeLabel(type)}</option>
            ))}
            {props.folders.map((folder) => (
              <option key={folder.id} value={JSON.stringify({ kind: 'folder', folderId: folder.id, label: folder.decName || '' })}>
                {folder.decName || folder.name}
              </option>
            ))}
            <option value={JSON.stringify({ kind: 'archive' })}>{t('txt_archive')}</option>
            <option value={JSON.stringify({ kind: 'trash' })}>{t('txt_trash')}</option>
          </select>
          )}
          <span className="grow" />
          <button type="button" className="nx-palette-trigger" onClick={() => { setPaletteSeed(''); setPaletteOpen(true); }}>
            <Search size={14} />
            <span className="grow">{STR.searchTrigger}</span>
            <span className="nx-kbd">⌘K</span>
          </button>
          <button type="button" className="nx-iconbtn lg" title="Keyboard shortcuts — ?" onClick={() => setSheetOpen(true)}>
            <HelpCircle size={15} />
          </button>
          {page === 'vault' && (<>
          <div style={{ position: 'relative' }}>
            <button type="button" className="hbtn" aria-expanded={sortMenuOpen} onClick={() => { setSortMenuOpen((v) => !v); setNewMenuOpen(false); }}>
              {STR.sortLabel}: {STR.sort[sort]}
            </button>
            {sortMenuOpen && (
              <div className="nx-menu" style={{ position: 'absolute', right: 0, top: 40 }} role="menu">
                {(['name', 'edited', 'created'] as SortMode[]).map((mode) => (
                  <button key={mode} type="button" role="menuitem" className={`mrow${mode === sort ? ' is-active' : ''}`}
                    onClick={() => { setSort(mode); setSortMenuOpen(false); }}>
                    {STR.sort[mode]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button type="button" className="hbtn primary" aria-expanded={newMenuOpen}
              onClick={() => { setNewMenuOpen((v) => !v); setSortMenuOpen(false); }}>
              <Plus size={14} /> {STR.newItem}
            </button>
            {newMenuOpen && (
              <div className="nx-menu" style={{ position: 'absolute', right: 0, top: 40 }} role="menu">
                {ITEM_TYPES.map((type) => (
                  <button key={type} type="button" role="menuitem" className="mrow"
                    onClick={() => { setNewMenuOpen(false); startCreate(type); }}>
                    <TypeIcon type={type} />{cipherTypeLabel(type)}
                  </button>
                ))}
              </div>
            )}
          </div>
          </>)}
        </header>

        {page === 'audit' && (
          <NextAuditPage ciphers={props.ciphers} entries={entries} onFix={startFix} fixedIds={fixedIds} />
        )}
        {page === 'totp' && (
          <NextTotpPage entries={entries} cipherById={cipherById} onCopyValue={(v, l, id) => void copyRawValue(v, l, id)} copiedId={copiedId} />
        )}
        {page === 'generator' && (
          <NextGeneratorPage onCopyValue={(v, l) => void copyRawValue(v, l)} />
        )}
        {page === 'sends' && (
          <NextSendsPage
            sends={props.sends}
            loading={props.sendsLoading}
            onCreate={props.onCreateSend}
            onUpdate={props.onUpdateSend}
            onDelete={props.onDeleteSend}
            onCopyValue={(v, l) => void copyRawValue(v, l)}
            onConfirm={requestConfirm}
            onNotify={props.onNotify}
          />
        )}
        {page === 'settings' && (
          <NextSettingsPage
            themePreference={props.themePreference}
            onThemePreferenceChange={props.onThemePreferenceChange}
            lockTimeoutMinutes={props.lockTimeoutMinutes}
            onLockTimeoutChange={props.onLockTimeoutChange}
            sessionTimeoutAction={props.sessionTimeoutAction}
            onSessionTimeoutActionChange={props.onSessionTimeoutActionChange}
            navigate={navigate}
            onNotify={props.onNotify}
          />
        )}
        {page === 'vault' && (
        <div className="nx-list" ref={listRef} role="listbox" aria-label={scopeTitle(scope)}>
          {props.loading && viewEntries.length === 0 && (
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
                <button type="button" className="nx-btn" onClick={() => startCreate(1)}>{STR.createFirst}</button>
                <button type="button" className="nx-btn ghost" onClick={() => navigate('/import')}>{t('txt_import')}</button>
              </div>
            </div>
          )}

          {!props.loading && !showEmptyVault && viewEntries.length === 0 && (
            <div className="nx-empty">{STR.emptyScope}</div>
          )}

          {viewEntries.map((entry, index) => {
            const grouped = sort !== 'name' && scope.kind !== 'duplicates';
            const dateOf = (e: SearchEntry) => (sort === 'created' ? e.creationDate : e.revisionDate);
            const monthOf = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Undated');
            const header = grouped && (index === 0 || monthOf(dateOf(viewEntries[index - 1])) !== monthOf(dateOf(entry)))
              ? monthOf(dateOf(entry))
              : null;
            return (
            <>
            {header && <div className="list-month" key={`h-${header}-${index}`}>{header}</div>}
            <div
              key={entry.id}
              role="option"
              aria-selected={index === selectedIndex || entry.id === openId}
              className={`nx-row${index === selectedIndex || entry.id === openId ? ' is-active' : ''}${entry.id === copiedId ? ' is-copied' : ''}`}
              tabIndex={index === Math.max(selectedIndex, 0) ? 0 : -1}
              onFocus={() => setSelectedIndex(index)}
              onClick={() => { setSelectedIndex(index); openEntry(entry); }}
              onContextMenu={(e) => { e.preventDefault(); setSelectedIndex(index); setRowMenu({ entryId: entry.id, x: e.clientX, y: e.clientY }); }}
            >
              <span className="ico">
                {entry.type === 1
                  ? <WebsiteIcon cipher={cipherById.get(entry.id)!} fallback={<TypeIcon type={entry.type} />} />
                  : <TypeIcon type={entry.type} />}
              </span>
              <span className="main">
                <span className="title">{entry.name}</span>
                <span className={`sub${entry.type === 1 ? '' : ' ui-face'}`}>{entry.sub}</span>
              </span>
              <span className="meta">
                {entry.id === copiedId && <span className="nx-badge ok">✓</span>}
                <span className="rowmeta">
                  {entry.favorite && <Star size={12} />}
                  {entry.reprompt && <span className="nx-badge warn">locked</span>}
                  {entry.organizationId && <span className="nx-badge org">org</span>}
                  {relativeTime(entry.revisionDate)}
                </span>
                <span className="rowacts" onClick={(e) => e.stopPropagation()}>
                  {entry.type === 1 && entry.sub && (
                    <button type="button" className="nx-iconbtn" title={STR.copyUsername} onClick={() => requestCopy(entry, 'username')}>
                      <AtSign size={13} />
                    </button>
                  )}
                  {entry.type === 1 && (
                    <button type="button" className="nx-iconbtn" title={STR.copyPassword} onClick={() => requestCopy(entry, 'password')}>
                      <KeyRound size={13} />
                    </button>
                  )}
                  <button type="button" className="nx-iconbtn" title={STR.edit} onClick={() => editEntry(entry)}>
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="nx-iconbtn"
                    title="More"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setRowMenu({ entryId: entry.id, x: rect.right, y: rect.bottom + 4 });
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </span>
              </span>
            </div>
            </>
            );
          })}

          {scopedTotal > viewEntries.length && (
            <div className="list-overflow">{STR.overflow(viewEntries.length, scopedTotal)}</div>
          )}
        </div>
        )}
      </main>

      {editorOpen && draft ? (
        <EditorPanel
          draft={draft}
          isCreating={creating}
          folders={props.folders}
          attachments={(!creating && draft.id ? cipherById.get(draft.id)?.attachments : null) || []}
          saving={saving}
          dirty={JSON.stringify(draft) !== draftBase}
          onPatch={patchDraft}
          onSave={(addFiles, removeAttachmentIds) => void saveDraft(addFiles, removeAttachmentIds)}
          onCancel={closePanels}
        />
      ) : openCipher ? (
        <DetailPanel
          cipher={openCipher}
          folders={props.folders}
          canShare={props.shareOrganizations.length > 0}
          onCopyValue={(value, label) => void copyRawValue(value, label, openCipher.id)}
          onDownloadAttachment={(attachment) => void props.onDownloadAttachment(openCipher, attachment.id || '')}
          downloadingAttachmentKey={props.downloadingAttachmentKey}
          onEdit={() => startEdit(openCipher)}
          onShare={() => setShareOpen(true)}
          onMore={(x, y) => setRowMenu({ entryId: openCipher.id, x, y })}
          onClose={closePanels}
        />
      ) : null}

      {rowMenu && rowMenuEntry && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 15 }} onClick={() => setRowMenu(null)} />
          <div
            className="nx-menu"
            role="menu"
            ref={(el) => { if (el && !el.dataset.focused) { el.dataset.focused = '1'; el.querySelector<HTMLElement>('.mrow')?.focus(); } }}
            style={{ left: Math.min(rowMenu.x, window.innerWidth - 240), top: Math.min(rowMenu.y, window.innerHeight - 280), zIndex: 20 }}
            onKeyDown={(e) => {
              const items = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.mrow'));
              const current = items.indexOf(document.activeElement as HTMLElement);
              if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(current + 1, items.length - 1)]?.focus(); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(current - 1, 0)]?.focus(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRowMenu(null); }
            }}
          >
            <button type="button" role="menuitem" className="mrow" onClick={() => { setRowMenu(null); openEntry(rowMenuEntry); }}>
              <SquareArrowOutUpRight size={13} />Open <span className="k nx-kbd">↵</span>
            </button>
            {rowMenuEntry.type === 1 && rowMenuUri && (
              <button type="button" role="menuitem" className="mrow" onClick={() => {
                const uri = rowMenuUri.decUri || rowMenuUri.uri || '';
                window.open(/^https?:\/\//i.test(uri) ? uri : `https://${uri}`, '_blank', 'noopener');
                setRowMenu(null);
              }}>
                <ExternalLink size={13} />{STR.openSite}
              </button>
            )}
            <button type="button" role="menuitem" className="mrow" onClick={() => { setRowMenu(null); editEntry(rowMenuEntry); }}>
              <Pencil size={13} />{STR.edit} <span className="k nx-kbd">⌘E</span>
            </button>
            {!rowMenuEntry.deleted && (
              <button type="button" role="menuitem" className="mrow" onClick={() => void toggleFavorite(rowMenuEntry)}>
                <Star size={13} />{rowMenuEntry.favorite ? 'Unfavorite' : 'Favorite'}
              </button>
            )}
            {!rowMenuEntry.deleted && (
              <button type="button" role="menuitem" className="mrow" onClick={() => void duplicateEntry(rowMenuEntry)}>
                <CopyPlus size={13} />Duplicate
              </button>
            )}
            {props.shareOrganizations.length > 0 && !rowMenuEntry.organizationId && !rowMenuEntry.deleted && (
              <button type="button" role="menuitem" className="mrow" onClick={() => { setRowMenu(null); setOpenId(rowMenuEntry.id); setShareOpen(true); }}>
                <Share2 size={13} />{STR.share} <span className="k nx-kbd">⌘S</span>
              </button>
            )}
            <div className="msep" />
            {rowMenuEntry.deleted ? (
              <>
                <button type="button" role="menuitem" className="mrow" onClick={() => void runRowAction(rowMenuEntry, 'restore')}>
                  <Undo2 size={13} />{STR.restore}
                </button>
                <button type="button" role="menuitem" className="mrow danger" onClick={() => void runRowAction(rowMenuEntry, 'delete-forever')}>
                  <Trash2 size={13} />{STR.deleteForever}
                </button>
              </>
            ) : rowMenuEntry.archived ? (
              <>
                <button type="button" role="menuitem" className="mrow" onClick={() => void runRowAction(rowMenuEntry, 'unarchive')}>
                  <ArchiveRestore size={13} />{STR.unarchive}
                </button>
                <button type="button" role="menuitem" className="mrow danger" onClick={() => void runRowAction(rowMenuEntry, 'trash')}>
                  <Trash2 size={13} />{STR.toTrash}
                </button>
              </>
            ) : (
              <>
                <button type="button" role="menuitem" className="mrow" onClick={() => void runRowAction(rowMenuEntry, 'archive')}>
                  <Archive size={13} />{STR.archive}
                </button>
                <button type="button" role="menuitem" className="mrow danger" onClick={() => void runRowAction(rowMenuEntry, 'trash')}>
                  <Trash2 size={13} />{STR.toTrash}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {shareOpen && openCipher && (
        <ShareDialog
          cipherName={openCipher.decName || ''}
          organizations={props.shareOrganizations}
          loadCollections={props.onLoadShareCollections}
          onConfirm={(orgId, collectionIds) => void submitShare(orgId, collectionIds)}
          onCancel={() => setShareOpen(false)}
          submitting={shareSubmitting}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          entries={entries}
          scope={{ kind: 'all' }}
          copiedId={copiedId}
          gateActive={!!gate}
          initialQuery={paletteSeed}
          commandContext={commandContext}
          onCopy={requestCopy}
          onOpen={openEntry}
          onEdit={editEntry}
          onStartCreate={startCreate}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {gate && (
        <TrappedDialog label={STR.gateUnlock} onClose={() => setGate(null)}>
            <h3>{gateEntry?.name || STR.gateUnlock}</h3>
            <div className="nx-field">
              <input
                ref={gateRef}
                className="nx-input nx-data"
                type="password"
                autoComplete="current-password"
                aria-label={t('txt_master_password')}
                disabled={gate.submitting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void submitGate(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setGate(null); }
                }}
              />
              {gate.error
                ? <div className="nx-error" role="alert">{gate.error}</div>
                : <div className="nx-help">{STR.gateHelp}</div>}
            </div>
            <div className="dfoot">
              <button type="button" className="nx-btn ghost" disabled={gate.submitting} onClick={() => setGate(null)}>
                {t('txt_cancel')} <span className="nx-kbd">esc</span>
              </button>
              <button type="button" className="nx-btn" disabled={gate.submitting} onClick={() => void submitGate()}>
                {STR.gateUnlock} <span className="nx-kbd on-fill">↵</span>
              </button>
            </div>
        </TrappedDialog>
      )}

      {confirm && (
        <TrappedDialog label={confirm.title} alert onClose={confirmBusy ? undefined : () => setConfirm(null)}>
            <h3>{confirm.title}</h3>
            <div className="nx-help">{confirm.message}</div>
            <div className="dfoot">
              <button type="button" className="nx-btn ghost" disabled={confirmBusy} onClick={() => setConfirm(null)} autoFocus>
                {t('txt_cancel')} <span className="nx-kbd">esc</span>
              </button>
              <button
                type="button"
                className="nx-btn danger-fill"
                disabled={confirmBusy}
                onClick={() => {
                  setConfirmBusy(true);
                  void confirm.run()
                    .catch((error) => props.onNotify('error', error instanceof Error ? error.message : String(error)))
                    .finally(() => { setConfirmBusy(false); setConfirm(null); });
                }}
              >
                {confirm.confirmLabel}
              </button>
            </div>
        </TrappedDialog>
      )}

      {toast && (
        <div className="nx-toast" style={{ position: 'fixed' }} role="status">
          <span className="dot" />
          {toast.text}
          {toast.seconds !== null && <span className="count">{STR.clearsIn(toast.seconds)}</span>}
        </div>
      )}
      <div aria-live="polite" className="nx-sr-only">
        {toast ? `${toast.text}${toast.seconds !== null ? `, clears in ${toast.seconds} seconds` : ''}` : ''}
      </div>
    </div>
  );
}
