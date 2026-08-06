// Selection-model semantics for Next bulk operations.
// Run: npx tsx --test --tsconfig webapp/tsconfig.json scripts/next-selection.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleSelection, rangeSelect, selectAll, pruneSelection } from '../webapp/src/lib/next/selection';

const IDS = ['a', 'b', 'c', 'd', 'e'];

test('toggleSelection adds and removes without mutating input', () => {
  const s0 = new Set<string>();
  const s1 = toggleSelection(s0, 'b');
  assert.deepEqual([...s1], ['b']);
  assert.equal(s0.size, 0);
  const s2 = toggleSelection(s1, 'b');
  assert.equal(s2.size, 0);
  assert.equal(s1.size, 1);
});

test('rangeSelect selects the inclusive visible range between anchor and target', () => {
  const s = rangeSelect(new Set(['a']), IDS, 'b', 'd');
  assert.deepEqual([...s].sort(), ['a', 'b', 'c', 'd']);
});

test('rangeSelect works upward (target before anchor)', () => {
  const s = rangeSelect(new Set(), IDS, 'd', 'b');
  assert.deepEqual([...s].sort(), ['b', 'c', 'd']);
});

test('rangeSelect with no/unknown anchor falls back to toggling the target on', () => {
  assert.deepEqual([...rangeSelect(new Set(), IDS, null, 'c')], ['c']);
  assert.deepEqual([...rangeSelect(new Set(), IDS, 'zz', 'c')], ['c']);
});

test('rangeSelect ignores ids not currently visible', () => {
  const s = rangeSelect(new Set(['zz']), IDS, 'a', 'c');
  assert.deepEqual([...s].sort(), ['a', 'b', 'c', 'zz']);
});

test('selectAll selects exactly the visible ids', () => {
  assert.deepEqual([...selectAll(IDS)].sort(), [...IDS].sort());
});

test('pruneSelection drops ids that left the visible list', () => {
  const s = pruneSelection(new Set(['a', 'zz']), IDS);
  assert.deepEqual([...s], ['a']);
});
