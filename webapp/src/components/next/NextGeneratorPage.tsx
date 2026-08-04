// NodeWarden Next (issue #16, slice 5): the generator as a page —
// password / passphrase / PIN with the same rules idiom as the editor well,
// a big mono candidate, and a session history of recent values.
import { useMemo, useState } from 'preact/hooks';
import { generatePassword, generatePassphrase, generatePin, estimateStrength } from '@/lib/password-generator';
import { DEFAULT_RULES, clampRules, generateCandidate, type GeneratorRules } from './generator-rules';

const STR = {
  modes: { password: 'Password', passphrase: 'Passphrase', pin: 'PIN' } as Record<string, string>,
  copy: 'Copy',
  regenerate: 'Regenerate',
  history: 'This session',
  historyEmpty: 'Regenerated values land here so nothing is lost by a reroll.',
  strength: ['very weak', 'weak', 'fair', 'strong', 'very strong'],
  ambiguous: 'no ambiguous',
};

type PageMode = 'password' | 'passphrase' | 'pin';

interface NextGeneratorPageProps {
  onCopyValue: (value: string, label: string) => void;
}

export default function NextGeneratorPage(props: NextGeneratorPageProps) {
  const [mode, setMode] = useState<PageMode>('password');
  const [rules, setRules] = useState<GeneratorRules>({ ...DEFAULT_RULES });
  const [pinLength, setPinLength] = useState(6);
  const [nonce, setNonce] = useState(0);
  const [history, setHistory] = useState<string[]>([]);

  const candidate = useMemo(() => {
    void nonce;
    if (mode === 'pin') return generatePin({ length: pinLength });
    if (mode === 'passphrase') {
      return generatePassphrase({
        words: clampRules({ ...rules, mode: 'words' }).length,
        separator: '-',
        capitalize: false,
        includeNumber: rules.digits,
        wordList: 'eff',
        customWords: '',
      });
    }
    return generateCandidate({ ...rules, mode: 'chars' });
  }, [mode, rules, pinLength, nonce]);

  const strengthIndex = Math.max(0, Math.min(4, estimateStrength(
    mode === 'passphrase' ? 'passphrase' : mode === 'pin' ? 'pin' : 'password',
    candidate,
    mode === 'passphrase' ? clampRules({ ...rules, mode: 'words' }).length : undefined
  )));

  const regenerate = () => {
    setHistory((prev) => [candidate, ...prev].slice(0, 10));
    setNonce((n) => n + 1);
  };

  const applyRules = (patch: Partial<GeneratorRules>) => {
    setRules((prev) => clampRules({ ...prev, ...patch, mode: mode === 'passphrase' ? 'words' : 'chars' }));
  };

  return (
    <div className="nx-list nx-genpage">
      <div className="gen-grid">
      <div className="gen-main">
      <div className="nx-seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {(['password', 'passphrase', 'pin'] as PageMode[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            className={mode === option ? 'on' : ''}
            onClick={() => {
              setMode(option);
              if (option === 'passphrase') setRules((prev) => clampRules({ ...prev, mode: 'words', length: 4 }));
              if (option === 'password') setRules((prev) => clampRules({ ...prev, mode: 'chars', length: 20 }));
            }}
          >
            {STR.modes[option]}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="gen-candidate nx-data"
        aria-live="polite"
        title={STR.copy}
        onClick={() => props.onCopyValue(candidate, STR.modes[mode])}
      >
        {candidate}
      </button>

      <div className="nx-genparams" style={{ alignSelf: 'stretch' }}>
        {mode === 'pin' ? (
          <span className="nx-step">
            <button type="button" aria-label="-" onClick={() => setPinLength((n) => Math.max(4, n - 1))}>−</button>
            <span className="n">{pinLength}</span>
            <button type="button" aria-label="+" onClick={() => setPinLength((n) => Math.min(12, n + 1))}>+</button>
          </span>
        ) : (
          <>
            <span className="nx-step">
              <button type="button" aria-label="-" onClick={() => applyRules({ length: rules.length - 1 })}>−</button>
              <span className="n">{clampRules({ ...rules, mode: mode === 'passphrase' ? 'words' : 'chars' }).length}</span>
              <button type="button" aria-label="+" onClick={() => applyRules({ length: rules.length + 1 })}>+</button>
            </span>
            {mode === 'password' && (
              <>
                <button type="button" className={`nx-tog${rules.upper ? ' on' : ''}`} onClick={() => applyRules({ upper: !rules.upper })}>A-Z</button>
                <button type="button" className={`nx-tog${rules.digits ? ' on' : ''}`} onClick={() => applyRules({ digits: !rules.digits })}>0-9</button>
                <button type="button" className={`nx-tog${rules.special ? ' on' : ''}`} onClick={() => applyRules({ special: !rules.special })}>!#$</button>
                <button type="button" className={`nx-tog${rules.ambiguous ? '' : ' on'}`} onClick={() => applyRules({ ambiguous: !rules.ambiguous })}>{STR.ambiguous}</button>
              </>
            )}
            {mode === 'passphrase' && (
              <button type="button" className={`nx-tog${rules.digits ? ' on' : ''}`} onClick={() => applyRules({ digits: !rules.digits })}>0-9</button>
            )}
          </>
        )}
        <span className={`nx-badge ${strengthIndex >= 3 ? 'ok' : 'warn'}`} style={{ marginLeft: 'auto' }}>
          {STR.strength[strengthIndex]}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--nx-sp-2)' }}>
        <button type="button" className="nx-btn" onClick={() => props.onCopyValue(candidate, STR.modes[mode])}>
          {STR.copy}
        </button>
        <button type="button" className="nx-btn ghost" onClick={regenerate}>
          {STR.regenerate}
        </button>
      </div>
      </div>

      <aside className="gen-side">
        <div className="nx-overline">{STR.history}</div>
        {history.length === 0 && <div className="nx-help">{STR.historyEmpty}</div>}
        {history.map((value, index) => (
          <button
            key={index}
            type="button"
            className="gen-hist nx-data"
            title={STR.copy}
            onClick={() => props.onCopyValue(value, STR.modes[mode])}
          >
            {value}
          </button>
        ))}
      </aside>
      </div>
    </div>
  );
}
