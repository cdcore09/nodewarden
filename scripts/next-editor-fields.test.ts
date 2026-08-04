import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_GROUPS } from '../webapp/src/components/next/editor-fields';

// vault-page-helpers depends on Vite-injected globals; provide them before import.
(globalThis as any).__NODEWARDEN_DEMO__ = false;
const { createEmptyDraft } = await import('../webapp/src/components/vault/vault-page-helpers');

test('every field group key exists on the corresponding empty draft', () => {
  for (const [type, fields] of Object.entries(FIELD_GROUPS)) {
    const draft = createEmptyDraft(Number(type)) as unknown as Record<string, unknown>;
    for (const field of fields) {
      assert.ok(field.key in draft, `type ${type}: draft has no key "${String(field.key)}"`);
      assert.equal(typeof draft[field.key as string], 'string', `type ${type}: "${String(field.key)}" is not a string field`);
      assert.ok(field.label.length > 0, `type ${type}: "${String(field.key)}" has an empty label`);
    }
  }
});

test('covers the non-login types including ssh', () => {
  for (const type of [3, 4, 5, 6, 7, 8]) {
    assert.ok((FIELD_GROUPS[type] || []).length > 0, `missing field group for type ${type}`);
  }
});
