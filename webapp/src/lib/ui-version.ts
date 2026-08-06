// Fork-local feature (issue #16): NodeWarden Next parallel UI behind a
// per-device flag. Mirrors the skin.ts pattern — storage + logic here,
// UI in components/next/UiVersionSelect.tsx — so upstream merges only
// ever see one-line hooks.
//
// Default flip: NodeWarden Next ('v2') is now the default UI, so an absent
// or unrecognized storage value reads as 'v2'. Opting out to classic ('v1')
// must therefore PERSIST the literal 'v1' rather than clearing the key —
// removing the key would make the opt-out immediately un-stick, since an
// absent key now means 'v2' again on the very next read.

export type UiVersion = 'v1' | 'v2';

export const UI_VERSION_STORAGE_KEY = 'nodewarden.ui.v2';

export function parseUiVersion(raw: unknown): UiVersion {
  return typeof raw === 'string' && raw.trim() === 'v1' ? 'v1' : 'v2';
}

export function readUiVersion(): UiVersion {
  try {
    return parseUiVersion(window.localStorage.getItem(UI_VERSION_STORAGE_KEY));
  } catch {
    return 'v2';
  }
}

export function setUiVersion(version: UiVersion): void {
  try {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, version);
  } catch {
    // Preference won't persist; callers still read the in-page value they set.
  }
}
