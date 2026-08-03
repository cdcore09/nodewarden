import { useState } from 'preact/hooks';
import { SKINS, readSkin, setSkin, type SkinId } from '@/lib/skin';

// Strings stay local (not in i18n) to keep this fork-only feature out of the
// upstream locale files.
const LABEL = 'Skin';
const HELP = 'Changes the look of this app. Saved in this browser only.';

export default function SkinSelect() {
  const [skin, setSkinState] = useState<SkinId>(() => readSkin());

  return (
    <section className="settings-submodule">
      <label className="field">
        <span>{LABEL}</span>
        <select
          className="input"
          value={skin}
          onInput={(e) => {
            const next = (e.currentTarget as HTMLSelectElement).value as SkinId;
            setSkin(next);
            setSkinState(next);
          }}
        >
          {SKINS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="field-help">{HELP}</div>
      </label>
    </section>
  );
}
