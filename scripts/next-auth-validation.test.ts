import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPasswordIssue, MIN_MASTER_PASSWORD_LENGTH } from '../webapp/src/components/next/auth-validation';

test('flags short passwords until the 12-char minimum', () => {
  assert.equal(MIN_MASTER_PASSWORD_LENGTH, 12);
  assert.equal(registerPasswordIssue('short', ''), 'short');
  assert.equal(registerPasswordIssue('elevenchars', 'elevenchars'), 'short');
  assert.equal(registerPasswordIssue('twelve-chars', 'twelve-chars'), null);
});

test('flags mismatch only once confirm is non-empty', () => {
  assert.equal(registerPasswordIssue('twelve-chars', ''), null);
  assert.equal(registerPasswordIssue('twelve-chars', 'twelve-char'), 'mismatch');
  assert.equal(registerPasswordIssue('twelve-chars', 'twelve-chars'), null);
});

test('empty password is not flagged (nothing typed yet)', () => {
  assert.equal(registerPasswordIssue('', ''), null);
});
