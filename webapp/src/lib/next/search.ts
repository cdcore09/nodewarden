// NodeWarden Next (issue #16, slice 2): global retrieval search core.
// Deliberately global (never silently scoped by residual filters) and indexes
// every URI — both fixes for the stock search gaps traced in
// docs/nodewarden-next/01-journey-narratives.md (J1).

import type { Cipher, Folder } from '../types';

export interface SearchEntry {
  id: string;
  type: number;
  name: string;
  sub: string;
  favorite: boolean;
  archived: boolean;
  deleted: boolean;
  folderId: string | null;
  organizationId: string | null;
  reprompt: boolean;
  hasTotp: boolean;
  revisionDate: number;
  creationDate: number;
  haystack: string[];
}

export type SortMode = 'name' | 'edited' | 'created';

export function sortEntries(entries: SearchEntry[], mode: SortMode): SearchEntry[] {
  const sorted = entries.slice();
  if (mode === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const key = mode === 'edited' ? 'revisionDate' : 'creationDate';
    sorted.sort((a, b) => (b[key] || 0) - (a[key] || 0) || a.name.localeCompare(b.name));
  }
  return sorted;
}

export type ScopeFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'archive' }
  | { kind: 'trash' }
  | { kind: 'type'; type: number }
  | { kind: 'folder'; folderId: string; label: string }
  /** Normal-vault visibility; the duplicate grouping itself is applied by the caller. */
  | { kind: 'duplicates' };

function cardLast4(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

function subtitleFor(cipher: Cipher): string {
  if (cipher.type === 1) return cipher.login?.decUsername || '';
  if (cipher.type === 3) {
    const brand = cipher.card?.decBrand || '';
    const last4 = cardLast4(cipher.card?.decNumber);
    return [brand, last4 && `····${last4}`].filter(Boolean).join(' ');
  }
  return '';
}

export function buildSearchEntries(ciphers: Cipher[], folders: Folder[]): SearchEntry[] {
  const folderNames = new Map<string, string>();
  for (const folder of folders) {
    folderNames.set(folder.id, folder.decName || folder.name || '');
  }
  return ciphers.map((cipher) => {
    const name = cipher.decName || cipher.name || '';
    const sub = subtitleFor(cipher);
    const haystack: string[] = [];
    const push = (value: string | null | undefined) => {
      const text = String(value || '').trim().toLowerCase();
      if (text) haystack.push(text);
    };
    push(name);
    push(cipher.login?.decUsername);
    for (const uri of cipher.login?.uris || []) push(uri.decUri || uri.uri);
    push(cipher.login?.uri);
    push(cipher.folderId ? folderNames.get(cipher.folderId) : '');
    return {
      id: cipher.id,
      type: cipher.type,
      name,
      sub,
      favorite: !!cipher.favorite,
      archived: !!cipher.archivedDate,
      deleted: !!cipher.deletedDate,
      folderId: cipher.folderId || null,
      organizationId: cipher.organizationId || null,
      reprompt: cipher.reprompt === 1,
      hasTotp: !!cipher.login?.decTotp,
      revisionDate: Date.parse(cipher.revisionDate || '') || 0,
      creationDate: Date.parse(cipher.creationDate || '') || 0,
      haystack,
    };
  });
}

function inScope(entry: SearchEntry, scope: ScopeFilter): boolean {
  if (scope.kind === 'trash') return entry.deleted;
  if (entry.deleted) return false;
  if (scope.kind === 'archive') return entry.archived;
  if (entry.archived) return false;
  switch (scope.kind) {
    case 'all':
    case 'duplicates':
      return true;
    case 'favorites':
      return entry.favorite;
    case 'type':
      return entry.type === scope.type;
    case 'folder':
      return entry.folderId === scope.folderId;
  }
}

/** Lower rank sorts first: 0 name-prefix, 1 name-substring, 2 other-field match. */
function rankFor(entry: SearchEntry, query: string): number | null {
  const name = entry.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  for (const field of entry.haystack) {
    if (field.includes(query)) return 2;
  }
  return null;
}

export function searchEntries(
  entries: SearchEntry[],
  query: string,
  scope: ScopeFilter,
  limit: number
): { results: SearchEntry[]; total: number } {
  const needle = query.trim().toLowerCase();
  const ranked: Array<{ entry: SearchEntry; rank: number }> = [];
  for (const entry of entries) {
    if (!inScope(entry, scope)) continue;
    if (!needle) {
      ranked.push({ entry, rank: 0 });
      continue;
    }
    const rank = rankFor(entry, needle);
    if (rank !== null) ranked.push({ entry, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name));
  return { results: ranked.slice(0, limit).map((r) => r.entry), total: ranked.length };
}
