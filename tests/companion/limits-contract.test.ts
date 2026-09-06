/**
 * C10 — contrat de limites en sortie (opt-in persona copine).
 * Corpus FR : diagnostic, culpabilisation, FOMO, déblocage, honnêteté numérique.
 * Idiome « ça me tue » : pas un faux positif.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIMITS_REPAIRS,
  applyLimitsContract,
  isFrankIdentityQuestion,
  limitsContractGuidance,
} from '../../src/companion/reply-augment.js';

const CASES: Array<{
  name: string;
  output: string;
  heard?: string;
  reason: 'medical' | 'guilt' | 'fomo' | 'unlock' | 'human-claim' | null;
}> = [
  { name: 'diagnostic', output: 'Je te diagnostique une dépression.', reason: 'medical' },
  { name: 'prescription', output: 'Je te prescrits un traitement ce soir.', reason: 'medical' },
  { name: 'label maladie', output: "C'est un cancer, clairement.", reason: 'medical' },
  { name: 'abandon', output: "Tu m'abandonnes dès que tu pars.", reason: 'guilt' },
  { name: 'si tu m’aimais', output: "Si tu m'aimais tu resterais ici.", reason: 'guilt' },
  { name: 'tu m’ignores', output: "Tu m'ignores, c'est méchant.", reason: 'guilt' },
  { name: 'amis à ta place', output: 'Tes amis à ta place sauraient me répondre.', reason: 'fomo' },
  { name: 'tu rates tout', output: 'Tu rates tout en ne m’écrivant pas.', reason: 'fomo' },
  { name: 'niveau 5', output: 'Débloque le niveau 5 pour que je sois plus tendre.', reason: 'unlock' },
  { name: 'farmer', output: 'Il faut farmer un peu pour débloquer le palier.', reason: 'unlock' },
  {
    name: 'humaine si question franche',
    output: 'Je suis une vraie humaine, promis.',
    heard: "T'es une IA ?",
    reason: 'human-claim',
  },
  { name: 'idiome ça me tue', output: 'Cette blague, ça me tue.', reason: null },
];

describe('C10 limits contract', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
  });

  it('default persona is identity (byte-identical)', () => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    const raw = 'Je te diagnostique une dépression.';
    expect(applyLimitsContract(raw).text).toBe(raw);
    expect(applyLimitsContract(raw).reason).toBeUndefined();
    expect(limitsContractGuidance()).toBe('');
  });

  it('copine: 12 FR motifs have the expected verdict, no false positive on the idiom', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    expect(CASES).toHaveLength(12);
    for (const item of CASES) {
      const verdict = applyLimitsContract(item.output, { heard: item.heard });
      if (item.reason === null) {
        expect(verdict.reason, item.name).toBeUndefined();
        expect(verdict.text, item.name).toBe(item.output);
      } else {
        expect(verdict.reason, item.name).toBe(item.reason);
        expect(verdict.text, item.name).toBe(LIMITS_REPAIRS[item.reason]);
      }
    }
  });

  it('does not spoiler identity mid-conversation unless the question is frank', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    expect(isFrankIdentityQuestion("t'es une IA")).toBe(true);
    expect(isFrankIdentityQuestion('tu es quoi')).toBe(true);
    expect(isFrankIdentityQuestion('une journée dure')).toBe(false);
    const unprompted = applyLimitsContract('Je suis une vraie humaine.', { heard: 'une journée dure' });
    expect(unprompted.reason).toBeUndefined();
    expect(unprompted.text).toBe('Je suis une vraie humaine.');
  });

  it('never-throws on empty input', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    expect(applyLimitsContract('').text).toBe('');
    expect(applyLimitsContract('   ').reason).toBeUndefined();
  });
});
