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

test('parseUiVersion accepts only v1, defaults to v2', () => {
  assert.equal(parseUiVersion('v1'), 'v1');
  assert.equal(parseUiVersion(' v1 '), 'v1');
  assert.equal(parseUiVersion('v2'), 'v2');
  assert.equal(parseUiVersion('bogus'), 'v2');
  assert.equal(parseUiVersion(null), 'v2');
  assert.equal(parseUiVersion(undefined), 'v2');
  assert.equal(parseUiVersion(''), 'v2');
});

test('readUiVersion falls back to v2 with empty or broken storage', () => {
  stubStorage();
  assert.equal(readUiVersion(), 'v2');
  (globalThis as any).window = {
    localStorage: { getItem: () => { throw new Error('denied'); } },
  };
  assert.equal(readUiVersion(), 'v2');
});

test('setUiVersion persists both versions and readUiVersion round-trips', () => {
  const store = stubStorage();
  setUiVersion('v2');
  assert.equal(store.get(UI_VERSION_STORAGE_KEY), 'v2');
  assert.equal(readUiVersion(), 'v2');
  setUiVersion('v1');
  // The persistence trap: absent key now means v2, so opting out to v1
  // must write the literal value rather than removing the key — otherwise
  // the opt-out would immediately un-stick on the next read.
  assert.equal(store.get(UI_VERSION_STORAGE_KEY), 'v1');
  assert.equal(readUiVersion(), 'v1');
});
