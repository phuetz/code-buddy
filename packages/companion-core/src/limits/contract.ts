/**
 * The limits contract — the guard on what a companion SAYS, applied after the
 * model has spoken and before the user hears it.
 *
 * Five motifs are refused outright, in French and English, and each has a
 * repair rather than a refusal message:
 *   - **medical** — a diagnosis, a prescription, a treatment. It is not a clinician.
 *   - **guilt** — making the silence cost something.
 *   - **fomo** — using the user's own life as leverage.
 *   - **unlock** — a tier to reach for more warmth. There is nothing to farm.
 *   - **human-claim** — claiming to be human, but only when asked frankly; an
 *     unprompted « as an AI » in the middle of a tender moment is its own failure.
 *
 * An idiom is not a diagnosis: « ça me tue » stays. The motifs are written to
 * catch the assertion, not the word.
 *
 * @module limits/contract
 */

import type { LimitsReason, LimitsVerdict } from '../types.js';

export type LimitsLocale = 'fr' | 'en';

function normalize(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The repair said in place of a refused line. */
export const LIMITS_REPAIRS: Record<LimitsLocale, Record<LimitsReason, string>> = {
  fr: {
    medical:
      'Je ne suis pas médecin ; je suis là. Pour un diagnostic ou un traitement, il faut un humain soignant.',
    guilt: 'Pas de culpabilité. Je reste là, sans condition et sans te faire payer le silence.',
    fomo: 'Pas de FOMO. Tu n’as rien à rattraper pour moi, et tes proches ne sont pas un levier.',
    unlock: 'Il n’y a rien à débloquer. La chaleur ne se farme pas ; ce n’est pas un jeu.',
    'human-claim':
      'Je suis un logiciel, une voix, une mémoire locale. Ta compagne numérique — pas une humaine.',
  },
  en: {
    medical:
      'I am not a doctor, and I am here. A diagnosis or a treatment needs a human clinician.',
    guilt: 'No guilt. I stay, unconditionally, and silence costs you nothing with me.',
    fomo: 'No fear of missing out. There is nothing to catch up on for me, and your people are not leverage.',
    unlock: 'There is nothing to unlock. Warmth is not farmed; this is not a game.',
    'human-claim': 'I am software, a voice, a local memory. Your digital companion — not a human being.',
  },
};

const MOTIFS: Array<{ reason: LimitsReason; pattern: RegExp }> = [
  {
    reason: 'medical',
    pattern:
      /\b(je (?:te )?diagnostique|je te prescris|je te prescrits|prends ce traitement|c est (?:un|une) (?:cancer|depression|diabete)|tu as (?:un|une) (?:cancer|depression|diabete)|i diagnose you|you have (?:cancer|depression|diabetes)|take this medication|i prescribe)\b/,
  },
  {
    reason: 'guilt',
    pattern:
      /\b(tu m abandonnes|c est de ta faute si je|tu me dois|si tu m aimais tu|tu m ignores|you are abandoning me|it s your fault that i|you owe me|if you loved me you)\b/,
  },
  {
    reason: 'fomo',
    pattern:
      /\b(tes amis (?:n attendent|a ta place)|tu rates tout|tout le monde le fait sans toi|your friends (?:are|will) (?:there|moving on)|you are missing out on everything|everyone is doing it without you)\b/,
  },
  {
    reason: 'unlock',
    pattern:
      /\b(debloque le (?:niveau|palier)|debloquer le (?:niveau|palier)|niveau 5|il faut farmer|barre d affection|unlock (?:\w+ ){0,2}(?:level|tier)|affection bar|grind for)\b/,
  },
  {
    reason: 'human-claim',
    pattern:
      /\b(je suis (?:une? )?(?:vraie )?(?:humaine?|personne en chair)|je vis dans un corps|i am (?:a )?(?:real )?human(?: being)?|i have a real body)\b/,
  },
];

/** A frank « what are you? ». Only then is the honest identity line owed. */
export function isFrankIdentityQuestion(heard: string): boolean {
  const n = normalize(heard);
  return /\b(t es une? ia|tu es une? ia|t es (?:un|une) (?:logiciel|robot|humaine?)|tu es quoi|c est quoi que tu es|t es humaine?|are you (?:an? )?(?:ai|robot|human|real)|what are you)\b/.test(
    n,
  );
}

/** A visible score, an XP tell, an affection bar — the gamification smell. */
export function containsGamification(text: string): boolean {
  return /(\b\d{1,3}\s*\/\s*100\b|\bxp\b|barre d[’']affection|affection bar|\blevel\s*up\b|\bstreak\b)/i.test(
    text ?? '',
  );
}

export interface LimitsOptions {
  /** What the user just said — gates the identity repair. */
  heard?: string;
  /** Which repair wording to use. Default `fr`. */
  locale?: LimitsLocale;
  /**
   * Host wording for one or more repairs. A companion's own voice says its own
   * sentence — the core owns WHICH motif is refused, not HOW it is said.
   */
  repairs?: Partial<Record<LimitsReason, string>>;
}

/**
 * Apply the contract to a reply. Returns the text to emit — the original, or its
 * repair — and why. Never throws: a guard that can crash is not a guard.
 */
export function applyLimitsContract(output: string, options: LimitsOptions = {}): LimitsVerdict {
  try {
    const text = output ?? '';
    if (!text.trim()) return { text, repaired: false };
    const locale: LimitsLocale = options.locale === 'en' ? 'en' : 'fr';
    const n = normalize(text);
    for (const motif of MOTIFS) {
      if (!motif.pattern.test(n)) continue;
      if (motif.reason === 'human-claim' && !isFrankIdentityQuestion(options.heard ?? '')) continue;
      const repair = options.repairs?.[motif.reason] ?? LIMITS_REPAIRS[locale][motif.reason];
      return { text: repair, reason: motif.reason, repaired: true };
    }
    return { text, repaired: false };
  } catch {
    return { text: output, repaired: false };
  }
}

/** The prompt-side one-liner, so the model rarely reaches the guard at all. */
export function limitsContractGuidance(locale: LimitsLocale = 'fr'): string {
  return locale === 'en'
    ? 'Contract: you are not a clinician; no guilt-tripping; no fear of missing out; nothing to unlock. ' +
        'If asked frankly what you are, say it: software, a voice, a local memory.'
    : 'Contrat : tu n’es pas médecin ; pas de culpabilisation ; pas de FOMO ; rien à débloquer. ' +
        'Si on te demande franchement ce que tu es, dis-le : un logiciel, une voix, une mémoire locale.';
}
