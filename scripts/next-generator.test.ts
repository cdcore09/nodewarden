import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCandidate, clampRules, DEFAULT_RULES, type GeneratorRules } from '../webapp/src/components/next/generator-rules';

test('chars mode honors length and character classes', () => {
  const rules: GeneratorRules = { mode: 'chars', length: 16, upper: true, digits: true, special: true, ambiguous: false };
  for (let i = 0; i < 20; i++) {
    const value = generateCandidate(rules);
    assert.equal(value.length, 16);
    assert.match(value, /[A-Z]/);
    assert.match(value, /[0-9]/);
    assert.match(value, /[^A-Za-z0-9]/);
  }
});

test('chars mode without classes yields lowercase letters only', () => {
  const rules: GeneratorRules = { mode: 'chars', length: 20, upper: false, digits: false, special: false, ambiguous: true };
  for (let i = 0; i < 10; i++) {
    assert.match(generateCandidate(rules), /^[a-z]{20}$/);
  }
});

test('words mode produces length-many words separated by dashes', () => {
  const rules: GeneratorRules = { mode: 'words', length: 4, upper: false, digits: true, special: false, ambiguous: true };
  const value = generateCandidate(rules);
  assert.equal(value.split('-').length >= 4, true);
});

test('clampRules bounds lengths per mode', () => {
  assert.equal(clampRules({ ...DEFAULT_RULES, mode: 'chars', length: 200 }).length, 64);
  assert.equal(clampRules({ ...DEFAULT_RULES, mode: 'chars', length: 2 }).length, 8);
  assert.equal(clampRules({ ...DEFAULT_RULES, mode: 'words', length: 20 }).length, 8);
  assert.equal(clampRules({ ...DEFAULT_RULES, mode: 'words', length: 1 }).length, 3);
});
