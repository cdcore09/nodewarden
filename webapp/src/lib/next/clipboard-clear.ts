// NodeWarden Next (issue #16, slice 2): sensitive-copy with clipboard
// auto-clear (J1 criterion — stock never clears, lib/clipboard.ts).
// The clipboard and timer are injected so the logic is testable; the surface
// wraps navigator.clipboard and setTimeout.
//
// Safety rule: we only clear when we can *read* the clipboard and confirm it
// still holds exactly what we wrote. If reading is denied we skip clearing
// entirely rather than risk clobbering something the user copied later —
// and we report canClear=false so the UI copy stays honest.

export const CLIPBOARD_CLEAR_SECONDS = 30;

export interface ClipboardPort {
  write(text: string): Promise<void>;
  read(): Promise<string>;
}

export interface SensitiveCopy {
  canClear: boolean;
  cancel(): void;
}

let cancelPrevious: (() => void) | null = null;

export async function copySensitive(
  port: ClipboardPort,
  text: string,
  schedule: (fn: () => void, ms: number) => () => void
): Promise<SensitiveCopy> {
  if (cancelPrevious) {
    cancelPrevious();
    cancelPrevious = null;
  }

  await port.write(text);

  let canClear = true;
  try {
    await port.read();
  } catch {
    canClear = false;
  }

  if (!canClear) {
    return { canClear: false, cancel: () => {} };
  }

  const unschedule = schedule(() => {
    void (async () => {
      try {
        const current = await port.read();
        if (current === text) await port.write('');
      } catch {
        // Clipboard became unreadable (focus lost, permission revoked): skip.
      }
    })();
  }, CLIPBOARD_CLEAR_SECONDS * 1000);

  const cancel = () => {
    unschedule();
    if (cancelPrevious === cancel) cancelPrevious = null;
  };
  cancelPrevious = cancel;
  return { canClear: true, cancel };
}
