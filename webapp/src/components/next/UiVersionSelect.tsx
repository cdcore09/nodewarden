import { useState } from 'preact/hooks';
import { readUiVersion, setUiVersion, type UiVersion } from '@/lib/ui-version';

// Strings stay local (not in i18n) to keep this fork-only feature out of the
// upstream locale files — same policy as SkinSelect.tsx.
const LABEL = 'Interface';
const HELP =
  'NodeWarden Next is the keyboard-first experimental interface. Applies from the next unlock. Saved in this browser only.';
const OPTIONS: ReadonlyArray<{ id: UiVersion; label: string }> = [
  { id: 'v1', label: 'Classic (default)' },
  { id: 'v2', label: 'NodeWarden Next (experimental)' },
];

export default function UiVersionSelect() {
  const [version, setVersionState] = useState<UiVersion>(() => readUiVersion());

  return (
    <section className="settings-submodule">
      <label className="field">
        <span>{LABEL}</span>
        <select
          className="input"
          value={version}
          onInput={(e) => {
            const next = (e.currentTarget as HTMLSelectElement).value as UiVersion;
            setUiVersion(next);
            setVersionState(next);
          }}
        >
          {OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        <div className="field-help">{HELP}</div>
      </label>
    </section>
  );
}
