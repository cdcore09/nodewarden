// NodeWarden Next (issue #16, slice 8): the generator as a precision
// instrument — one centered surface: mode tabs, a large per-character
// colored candidate (digits accent, symbols warn — the glanceable "what
// am I about to use" read), a segmented strength meter, the rules row,
// and this session's history inline below a hairline. No side rails, no
// filler: the page is exactly as big as the job.
import { useMemo, useState } from 'preact/hooks';
import { generatePassphrase, generatePin, estimateStrength } from '@/lib/password-generator';
import { DEFAULT_RULES, clampRules, generateCandidate, type GeneratorRules } from './generator-rules';

const STR = {
  modes: { password: 'Password', passphrase: 'Passphrase', pin: 'PIN' } as Record<string, string>,
  copy: 'Copy',
  regenerate: 'Regenerate',
  history: 'This session',
  strength: ['very weak', 'weak', 'fair', 'strong', 'very strong'],
  ambiguous: 'no ambiguous',
  clickToCopy: 'Click to copy',
};

type PageMode = 'password' | 'passphrase' | 'pin';

function ColoredValue(props: { value: string }) {
  const parts = useMemo(() => {
    const out: Array<{ text: string; cls: string }> = [];
    for (const ch of props.value) {
      const cls = /\d/.test(ch) ? 'digit' : /[a-zA-Z]/.test(ch) ? '' : 'symbol';
      const last = out[out.length - 1];
      if (last && last.cls === cls) last.text += ch;
      else out.push({ text: ch, cls });
    }
    return out;
  }, [props.value]);
  return (
    <>
      {parts.map((part, i) => (part.cls ? <span key={i} className={part.cls}>{part.text}</span> : part.text))}
    </>
  );
}

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
    setHistory((prev) => [candidate, ...prev].slice(0, 8));
    setNonce((n) => n + 1);
  };

  const applyRules = (patch: Partial<GeneratorRules>) => {
    setRules((prev) => clampRules({ ...prev, ...patch, mode: mode === 'passphrase' ? 'words' : 'chars' }));
  };

  return (
    <div className="nx-list nx-genpage">
      <div className="gen-card">
        <div className="gen-head">
          <div className="nx-seg" role="tablist">
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
        </div>

        <button
          type="button"
          className="gen-candidate nx-data"
          aria-live="polite"
          title={STR.clickToCopy}
          onClick={() => props.onCopyValue(candidate, STR.modes[mode])}
        >
          <ColoredValue value={candidate} />
        </button>

        <div className="gen-meter" role="img" aria-label={STR.strength[strengthIndex]}>
          {[0, 1, 2, 3].map((seg) => (
            <span key={seg} className={`seg${strengthIndex > seg ? ` fill s${strengthIndex}` : ''}`} />
          ))}
          <span className="lbl">{STR.strength[strengthIndex]}</span>
        </div>

        <div className="nx-genparams">
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
        </div>

        <div className="gen-actions">
          <button type="button" className="nx-btn" onClick={() => props.onCopyValue(candidate, STR.modes[mode])}>
            {STR.copy}
          </button>
          <button type="button" className="nx-btn ghost" onClick={regenerate}>
            {STR.regenerate}
          </button>
        </div>

        {history.length > 0 && (
          <div className="gen-history">
            <div className="nx-overline">{STR.history}</div>
            {history.map((value, index) => (
              <button
                key={index}
                type="button"
                className="gen-hist nx-data"
                title={STR.copy}
                onClick={() => props.onCopyValue(value, STR.modes[mode])}
              >
                <ColoredValue value={value} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
