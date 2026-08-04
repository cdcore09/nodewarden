// Inline as-you-type register validation (journey J6). The stock submit-time
// checks in App.tsx remain the backstop; this only decides what the UI shows
// while typing.

export const MIN_MASTER_PASSWORD_LENGTH = 12;

export function registerPasswordIssue(
  password: string,
  confirm: string
): 'short' | 'mismatch' | null {
  if (!password) return null;
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) return 'short';
  if (confirm && confirm !== password) return 'mismatch';
  return null;
}
