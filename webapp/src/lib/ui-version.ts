// Fork-local feature (issue #16): NodeWarden Next parallel UI behind a
// per-device flag. Mirrors the skin.ts pattern — storage + logic here,
// UI in components/next/UiVersionSelect.tsx — so upstream merges only
// ever see one-line hooks.

export type UiVersion = 'v1' | 'v2';

export const UI_VERSION_STORAGE_KEY = 'nodewarden.ui.v2';

export function parseUiVersion(raw: unknown): UiVersion {
  return typeof raw === 'string' && raw.trim() === 'v2' ? 'v2' : 'v1';
}

export function readUiVersion(): UiVersion {
  try {
    return parseUiVersion(window.localStorage.getItem(UI_VERSION_STORAGE_KEY));
  } catch {
    return 'v1';
  }
}

export function setUiVersion(version: UiVersion): void {
  try {
    if (version === 'v2') {
      window.localStorage.setItem(UI_VERSION_STORAGE_KEY, 'v2');
    } else {
      window.localStorage.removeItem(UI_VERSION_STORAGE_KEY);
    }
  } catch {
    // Preference won't persist; callers still read the in-page value they set.
  }
}
