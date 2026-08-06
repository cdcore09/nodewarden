import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCommands, filterCommands } from '../webapp/src/components/next/commands';

function ctxRecorder() {
  const calls: string[] = [];
  return {
    calls,
    ctx: {
      navigate: (path: string) => void calls.push(`nav:${path}`),
      lock: () => void calls.push('lock'),
      logout: () => void calls.push('logout'),
      toClassic: () => void calls.push('classic'),
    },
  };
}

test('registry includes the command floor', () => {
  const ids = listCommands().map((c) => c.id);
  for (const required of [
    'settings', 'generator', 'security-audit', 'sends',
    'verification-codes', 'organizations', 'import', 'backup', 'admin',
    'devices', 'domain-rules', 'logs', 'help',
    'lock', 'log-out', 'new-item', 'new-folder',
  ]) {
    assert.ok(ids.includes(required), `missing command: ${required}`);
  }
  // The classic switch lives ONLY in Settings (owner directive).
  assert.ok(!ids.includes('classic-ui'), 'classic-ui must not be a palette command');
});

test('substring filtering matches labels case-insensitively', () => {
  const commands = listCommands();
  const hits = filterCommands(commands, 'SET');
  assert.ok(hits.some((c) => c.id === 'settings'));
});

test('subsequence fallback finds "Security audit" from "audit" and "scrty"', () => {
  const commands = listCommands();
  assert.ok(filterCommands(commands, 'audit').some((c) => c.id === 'security-audit'));
  assert.ok(filterCommands(commands, 'scrty').some((c) => c.id === 'security-audit'));
});

test('substring filtering finds "New folder…" from "folder"', () => {
  const commands = listCommands();
  assert.ok(filterCommands(commands, 'folder').some((c) => c.id === 'new-folder'));
});

test('empty query returns everything', () => {
  assert.equal(filterCommands(listCommands(), '').length, listCommands().length);
});

test('navigation commands target the Next shell pages', () => {
  const commands = listCommands();
  const { calls, ctx } = ctxRecorder();
  commands.find((c) => c.id === 'settings')!.run(ctx);
  commands.find((c) => c.id === 'security-audit')!.run(ctx);
  commands.find((c) => c.id === 'lock')!.run(ctx);
  assert.deepEqual(calls, ['nav:/next/settings', 'nav:/next/audit', 'lock']);
});
