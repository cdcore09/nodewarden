// NodeWarden Next (issue #16, slice 2): command-mode registry ("​>" prefix).
// Everything that isn't retrieval lives here so the retrieval surface carries
// zero admin chrome (docs/nodewarden-next/02 §6). Labels are fork-local
// strings by the skin-feature precedent.

export interface NextCommandContext {
  navigate(path: string): void;
  lock(): void;
  logout(): void;
  toClassic(): void;
}

export interface NextCommand {
  id: string;
  label: string;
  hint?: string;
  run(ctx: NextCommandContext): void;
}

/**
 * The stock VaultPage listens for this event and opens its create editor
 * (VaultPage.tsx `nodewarden:add-item` listener — previously dead wiring).
 * The stock page mounts asynchronously after navigation, so dispatch on a
 * short retry loop; extra dispatches are harmless no-ops.
 */
function dispatchAddItemWithRetry(): void {
  let elapsed = 0;
  const tick = () => {
    window.dispatchEvent(new CustomEvent('nodewarden:add-item'));
    elapsed += 150;
    if (elapsed < 2000) window.setTimeout(tick, 150);
  };
  window.setTimeout(tick, 150);
}

export function listCommands(): NextCommand[] {
  return [
    {
      id: 'new-item',
      label: 'New item',
      hint: 'create in the classic editor',
      run(ctx) {
        ctx.navigate('/vault?classic=1');
        dispatchAddItemWithRetry();
      },
    },
    { id: 'security-audit', label: 'Security audit', hint: 'weak · reused · breached', run: (ctx) => ctx.navigate('/next/audit') },
    { id: 'generator', label: 'Password generator', run: (ctx) => ctx.navigate('/next/generator') },
    { id: 'verification-codes', label: 'Verification codes', hint: 'all TOTP codes', run: (ctx) => ctx.navigate('/next/totp') },
    { id: 'sends', label: 'Sends', run: (ctx) => ctx.navigate('/next/sends') },
    { id: 'organizations', label: 'Organizations', hint: 'members · collections', run: (ctx) => ctx.navigate('/next/orgs') },
    { id: 'import', label: 'Import', hint: 'from another password manager', run: (ctx) => ctx.navigate('/next/import') },
    { id: 'backup', label: 'Backup center', run: (ctx) => ctx.navigate('/backup') },
    { id: 'settings', label: 'Settings', run: (ctx) => ctx.navigate('/next/settings') },
    { id: 'devices', label: 'Device management', run: (ctx) => ctx.navigate('/settings/security/device-management') },
    { id: 'domain-rules', label: 'Domain rules', run: (ctx) => ctx.navigate('/settings/domain-rules') },
    { id: 'logs', label: 'Log center', run: (ctx) => ctx.navigate('/logs') },
    { id: 'help', label: 'Help', run: (ctx) => ctx.navigate('/help') },
    { id: 'admin', label: 'Admin panel', run: (ctx) => ctx.navigate('/admin') },
    { id: 'lock', label: 'Lock vault', run: (ctx) => ctx.lock() },
    { id: 'log-out', label: 'Log out', run: (ctx) => ctx.logout() },
  ];
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i >= needle.length) return true;
  }
  return needle.length === 0;
}

export function filterCommands(commands: NextCommand[], query: string): NextCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  const substring = commands.filter((c) => c.label.toLowerCase().includes(needle));
  if (substring.length > 0) return substring;
  return commands.filter((c) => isSubsequence(needle, c.label.toLowerCase()));
}
