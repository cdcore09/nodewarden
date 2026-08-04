import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUiVersion, readUiVersion, setUiVersion, UI_VERSION_STORAGE_KEY } from '../webapp/src/lib/ui-version';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return store;
}

test('parseUiVersion accepts only v2, defaults to v1', () => {
  assert.equal(parseUiVersion('v2'), 'v2');
  assert.equal(parseUiVersion(' v2 '), 'v2');
  assert.equal(parseUiVersion('v1'), 'v1');
  assert.equal(parseUiVersion('bogus'), 'v1');
  assert.equal(parseUiVersion(null), 'v1');
  assert.equal(parseUiVersion(undefined), 'v1');
});

test('readUiVersion falls back to v1 with empty or broken storage', () => {
  stubStorage();
  assert.equal(readUiVersion(), 'v1');
  (globalThis as any).window = {
    localStorage: { getItem: () => { throw new Error('denied'); } },
  };
  assert.equal(readUiVersion(), 'v1');
});

test('setUiVersion persists and readUiVersion round-trips', () => {
  const store = stubStorage();
  setUiVersion('v2');
  assert.equal(store.get(UI_VERSION_STORAGE_KEY), 'v2');
  assert.equal(readUiVersion(), 'v2');
  setUiVersion('v1');
  assert.equal(readUiVersion(), 'v1');
});
