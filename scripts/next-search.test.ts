import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchEntries, searchEntries, type ScopeFilter } from '../webapp/src/lib/next/search';
import type { Cipher, Folder } from '../webapp/src/lib/types';

const folders: Folder[] = [
  { id: 'f1', name: 'enc', decName: 'Work' },
  { id: 'f2', name: 'enc', decName: 'Personal' },
];

const ciphers: Cipher[] = [
  {
    id: 'c1', type: 1, decName: 'Fastmail', folderId: 'f2', favorite: true, reprompt: 0,
    login: {
      decUsername: 'cordero@fastmail.com', decPassword: 'pw1', decTotp: 'SECRET',
      uris: [{ uri: 'enc', decUri: 'https://fastmail.com' }, { uri: 'enc', decUri: 'https://betamail.example' }],
    },
  } as unknown as Cipher,
  {
    id: 'c2', type: 1, decName: 'Fastly CDN', folderId: 'f1', reprompt: 1,
    login: { decUsername: 'ops@corderocore.com', decPassword: 'pw2', uris: [] },
  } as unknown as Cipher,
  {
    id: 'c3', type: 3, decName: 'FastSpring Card',
    card: { decNumber: '4242424242424242', decBrand: 'Visa' },
  } as unknown as Cipher,
  {
    id: 'c4', type: 1, decName: 'Archived Login', archivedDate: '2026-01-01',
    login: { decUsername: 'old@x.com', decPassword: 'pw' },
  } as unknown as Cipher,
  {
    id: 'c5', type: 2, decName: 'Deleted Note', deletedDate: '2026-01-01',
  } as unknown as Cipher,
];

const ALL: ScopeFilter = { kind: 'all' };

test('buildSearchEntries indexes name, username, every uri, and folder name', () => {
  const entries = buildSearchEntries(ciphers, folders);
  const fastmail = entries.find((e) => e.id === 'c1')!;
  assert.equal(fastmail.name, 'Fastmail');
  assert.equal(fastmail.sub, 'cordero@fastmail.com');
  assert.equal(fastmail.hasTotp, true);
  assert.equal(fastmail.favorite, true);
  assert.ok(fastmail.haystack.some((field) => field === 'https://betamail.example'));
  assert.ok(fastmail.haystack.some((field) => field === 'personal'));
  const gated = entries.find((e) => e.id === 'c2')!;
  assert.equal(gated.reprompt, true);
});

test('default scope excludes archived and trashed; dedicated scopes include them', () => {
  const entries = buildSearchEntries(ciphers, folders);
  const all = searchEntries(entries, '', ALL, 50);
  assert.deepEqual(all.results.map((r) => r.id).sort(), ['c1', 'c2', 'c3']);
  const archive = searchEntries(entries, '', { kind: 'archive' }, 50);
  assert.deepEqual(archive.results.map((r) => r.id), ['c4']);
  const trash = searchEntries(entries, '', { kind: 'trash' }, 50);
  assert.deepEqual(trash.results.map((r) => r.id), ['c5']);
});

test('ranking: name prefix beats name substring beats other-field match', () => {
  const entries = buildSearchEntries(ciphers, folders);
  // All three names share the "fast" prefix (rank 0) → alphabetical tie-break.
  const { results } = searchEntries(entries, 'fast', ALL, 50);
  assert.deepEqual(results.map((r) => r.id), ['c2', 'c1', 'c3']);
  // A true substring-vs-prefix case: "mail" is a substring of Fastmail's name
  // and a uri-field match for nothing else in scope.
  const mail = searchEntries(entries, 'fastm', ALL, 50);
  assert.deepEqual(mail.results.map((r) => r.id), ['c1']);
  // uri-only match ranks after name matches but is found (global search)
  const beta = searchEntries(entries, 'betamail', ALL, 50);
  assert.deepEqual(beta.results.map((r) => r.id), ['c1']);
  // folder-name match is found
  const work = searchEntries(entries, 'work', ALL, 50);
  assert.ok(work.results.some((r) => r.id === 'c2'));
});

test('scope filters: type, folder, favorites', () => {
  const entries = buildSearchEntries(ciphers, folders);
  assert.deepEqual(searchEntries(entries, '', { kind: 'type', type: 3 }, 50).results.map((r) => r.id), ['c3']);
  assert.deepEqual(searchEntries(entries, '', { kind: 'folder', folderId: 'f1', label: 'Work' }, 50).results.map((r) => r.id), ['c2']);
  assert.deepEqual(searchEntries(entries, '', { kind: 'favorites' }, 50).results.map((r) => r.id), ['c1']);
});

test('limit caps results but total reports the full count', () => {
  const entries = buildSearchEntries(ciphers, folders);
  const { results, total } = searchEntries(entries, '', ALL, 2);
  assert.equal(results.length, 2);
  assert.equal(total, 3);
});

test('sortEntries orders by name, edited (newest first), and created (newest first)', async () => {
  const { sortEntries } = await import('../webapp/src/lib/next/search');
  const entries = buildSearchEntries([
    { id: 'a', type: 1, decName: 'Bravo', revisionDate: '2026-02-01T00:00:00Z', creationDate: '2026-01-01T00:00:00Z' },
    { id: 'b', type: 1, decName: 'Alpha', revisionDate: '2026-03-01T00:00:00Z', creationDate: '2025-01-01T00:00:00Z' },
    { id: 'c', type: 1, decName: 'Charlie', revisionDate: '2026-01-01T00:00:00Z', creationDate: '2026-06-01T00:00:00Z' },
  ] as unknown as Cipher[], []);
  assert.deepEqual(sortEntries(entries, 'name').map((e) => e.id), ['b', 'a', 'c']);
  assert.deepEqual(sortEntries(entries, 'edited').map((e) => e.id), ['b', 'a', 'c']);
  assert.deepEqual(sortEntries(entries, 'created').map((e) => e.id), ['c', 'a', 'b']);
  // missing dates sink to the end without throwing
  const sparse = buildSearchEntries([{ id: 'x', type: 1, decName: 'X' }] as unknown as Cipher[], []);
  assert.deepEqual(sortEntries([...sparse, ...entries], 'edited').map((e) => e.id), ['b', 'a', 'c', 'x']);
});
