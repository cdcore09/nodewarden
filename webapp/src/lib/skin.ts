import '../styles/skins/vault.css';
import '../styles/skins/hardware.css';
import '../styles/skins/cipher.css';
import '../styles/skins/ledger.css';

// Fork-local feature: user-selectable visual skins layered over the stock
// design tokens. Kept fully self-contained (storage + DOM application here,
// UI in SkinSelect.tsx) so upstream merges only ever see one-line hooks.

export type SkinId = 'stock' | 'vault' | 'hardware' | 'cipher' | 'ledger';

export const SKIN_STORAGE_KEY = 'nodewarden.skin.v1';

export const SKINS: ReadonlyArray<{ id: SkinId; label: string }> = [
  { id: 'stock', label: 'NodeWarden (default)' },
  { id: 'vault', label: 'Private Vault' },
  { id: 'hardware', label: 'Hardware Key' },
  { id: 'cipher', label: 'Night Cipher' },
  { id: 'ledger', label: 'Paper Ledger' },
];

function isSkinId(value: string): value is SkinId {
  return SKINS.some((skin) => skin.id === value);
}

export function readSkin(): SkinId {
  try {
    const stored = String(window.localStorage.getItem(SKIN_STORAGE_KEY) || '').trim();
    if (stored && isSkinId(stored)) return stored;
  } catch {
    // Restricted storage: fall through to stock.
  }
  return 'stock';
}

export function applySkin(skin: SkinId): void {
  if (skin === 'stock') {
    delete document.documentElement.dataset.skin;
  } else {
    document.documentElement.dataset.skin = skin;
  }
}

export function setSkin(skin: SkinId): void {
  try {
    window.localStorage.setItem(SKIN_STORAGE_KEY, skin);
  } catch {
    // Preference won't persist, but still apply for this session.
  }
  applySkin(skin);
}

// Apply at module load so the saved skin is active before first render.
applySkin(readSkin());
