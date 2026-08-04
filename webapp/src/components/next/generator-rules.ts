// NodeWarden Next (issue #16, slice 3): inline generator rules.
// "Every site doesn't accept the same parameters" (owner directive) — the
// rules row exposes the knobs sites force: mode, length, character classes.
// Wraps the stock generator logic (lib/password-generator.ts) unchanged.

import { generatePassword, generatePassphrase } from '../../lib/password-generator';

export interface GeneratorRules {
  mode: 'words' | 'chars';
  length: number;
  upper: boolean;
  digits: boolean;
  special: boolean;
  ambiguous: boolean;
}

export const DEFAULT_RULES: GeneratorRules = {
  mode: 'chars',
  length: 20,
  upper: true,
  digits: true,
  special: true,
  ambiguous: false,
};

export function clampRules(rules: GeneratorRules): GeneratorRules {
  const bounds = rules.mode === 'words' ? { min: 3, max: 8 } : { min: 8, max: 64 };
  return {
    ...rules,
    length: Math.min(bounds.max, Math.max(bounds.min, Math.round(rules.length) || bounds.min)),
  };
}

export function generateCandidate(rules: GeneratorRules): string {
  const clamped = clampRules(rules);
  if (clamped.mode === 'words') {
    return generatePassphrase({
      words: clamped.length,
      separator: '-',
      capitalize: false,
      includeNumber: clamped.digits,
      wordList: 'eff',
      customWords: '',
    });
  }
  return generatePassword({
    length: clamped.length,
    uppercase: clamped.upper,
    lowercase: true,
    numbers: clamped.digits,
    special: clamped.special,
    minUppercase: clamped.upper ? 1 : 0,
    minLowercase: 1,
    minNumbers: clamped.digits ? 1 : 0,
    minSpecial: clamped.special ? 1 : 0,
    avoidAmbiguous: !clamped.ambiguous,
  });
}
