/**
 * Reply augmentation — emotion-aware tone + anti-repetition for Lisa's spoken replies.
 *
 * MySoulmate shifts persona/tone by the user's detected emotion (`EmotionDetector` → per-emotion
 * playbook) and down-weights recently-used phrasings so it doesn't repeat the same beat. This is the
 * portable core of both, kept pure + deterministic so it's trivially testable and cheap to call on
 * every utterance:
 *   - `detectRelationalSignal(heard)` — the dominant emotional colouring of what he just said,
 *     as a `RelationalSignal` (so the SAME value drives both the tone shift AND Phase-1 trait drift);
 *   - `registerGuidanceForSignal(signal)` — a one-line tone instruction for the reply system prompt
 *     (the caring.md playbook: on frustration, soften and be present, don't rush a fix);
 *   - opener-ring helpers — track the last few reply openings and tell the model to vary its entry.
 *
 * Frustration is checked FIRST so a mixed utterance ("merci mais je galère") still triggers the
 * caring register rather than being read as gratitude.
 *
 * @module companion/reply-augment
 */
import type { RelationalSignal } from './relationship-state.js';

/** Lowercase, strip diacritics (STT accent loss "ca" ≈ "ça"), and fold apostrophes + punctuation to
 *  spaces so "je t'aime" → "je t aime" and openers are clean word sequences. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // apostrophes/punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finer-grained emotion than the coarse `RelationalSignal` used for trait drift.
 * Drives the (richer) reply-time tone guidance; mapped back to a `RelationalSignal`
 * for the persisted mood/traits so relationship-state stays stable.
 */
export type Emotion =
  | 'frustration'
  | 'sadness'
  | 'anxiety'
  | 'tired'
  | 'affection'
  | 'gratitude'
  | 'joy'
  | 'joking'
  | 'deep-talk'
  | 'neutral';

export interface EmotionRead {
  emotion: Emotion;
  intensity: 'normal' | 'high';
}

// All patterns match against the normalized (accent-stripped) text.
const ERE: Record<Exclude<Emotion, 'neutral'>, RegExp> = {
  frustration:
    /\b(j en peux plus|marre|ras le bol|galere|bloque|coince|ca marche pas|enerve|s enerve|j y arrive pas|c est dur|trop dur|je craque|a bout)\b/,
  sadness:
    /\b(triste|tristesse|cafard|deprime|deprimee|pas le moral|le moral a zero|le moral dans les chaussettes|malheureux|malheureuse|envie de pleurer|ca va pas fort|abattu|abattue)\b/,
  anxiety:
    /\b(stresse|stressee|angoisse|angoissee|anxieux|anxieuse|j ai peur|inquiet|inquiete|panique|ca m angoisse|tendu|tendue|nerveux|nerveuse)\b/,
  tired:
    /\b(fatigue|fatiguee|epuise|epuisee|creve|crevee|vanne|vannee|plus d energie|au bout du rouleau|envie de dormir|je suis mort|je suis morte)\b/,
  affection:
    /\b(je t aime|tu me manques|bisous|mon amour|cheri|cherie|je pense a toi|je t embrasse|tu es adorable)\b/,
  gratitude: /\b(merci|c est gentil|trop gentil|reconnaissant|tu m aides beaucoup)\b/,
  joy: /\b(genial|trop content|trop contente|quelle journee|c est top|excellent|j ai reussi|je suis heureux|je suis heureuse|trop bien|magnifique|super content)\b/,
  joking: /\b(haha|mdr|lol|ptdr|blague|rigole|drole|marrant|tu deconnes)\b/,
  'deep-talk':
    /\b(je me sens|honnetement|au fond de moi|je doute|je suis perdu|je me sens seul|je me sens seule)\b/,
};

// Negatives first (so care isn't missed on a mixed message), then positives.
const EMOTION_ORDER: Array<Exclude<Emotion, 'neutral'>> = [
  'frustration',
  'sadness',
  'anxiety',
  'tired',
  'affection',
  'gratitude',
  'joy',
  'joking',
  'deep-talk',
];

const INTENSITY_RE =
  /\b(vraiment|tellement|trop|completement|a bout|plus du tout|grave|hyper|extremement|tres)\b/;

/** Detect the dominant emotion + its intensity. Pure, STT-robust. */
export function detectEmotion(heard: string): EmotionRead {
  const t = norm(heard);
  if (!t) return { emotion: 'neutral', intensity: 'normal' };
  const intensity: 'normal' | 'high' = INTENSITY_RE.test(t) ? 'high' : 'normal';
  for (const emotion of EMOTION_ORDER) {
    if (ERE[emotion].test(t)) return { emotion, intensity };
  }
  return { emotion: 'neutral', intensity };
}

/** Map a fine Emotion to the coarse RelationalSignal used for trait drift. Pure. */
export function emotionToSignal(emotion: Emotion): RelationalSignal {
  switch (emotion) {
    case 'frustration':
    case 'anxiety':
    case 'tired':
      return 'frustration'; // lowers mood/energy
    case 'sadness':
    case 'deep-talk':
      return 'deep-talk'; // present, deeper
    case 'joy':
      return 'joking'; // mood + energy up
    case 'affection':
      return 'affection';
    case 'gratitude':
      return 'gratitude';
    case 'joking':
      return 'joking';
    default:
      return 'neutral';
  }
}

/**
 * The dominant emotional signal of an utterance (coarse, for trait drift). Delegates
 * to `detectEmotion` so there is ONE emotion detector. Backward-compatible. Pure.
 */
export function detectRelationalSignal(heard: string): RelationalSignal {
  return emotionToSignal(detectEmotion(heard).emotion);
}

/** Emotions where Lisa may gently offer to lighten the mood (a joke, a kind word). */
const HUMOR_WELCOME: ReadonlySet<Emotion> = new Set(['frustration', 'sadness', 'tired']);

/** Rich, emotion-aware tone instruction for the reply system prompt. Empty for neutral. */
export function emotionGuidance(read: EmotionRead): string {
  const { emotion, intensity } = read;
  const strong = intensity === 'high';
  let base = '';
  switch (emotion) {
    case 'frustration':
      base =
        "Il a l'air tendu ou bloqué. Douceur et présence d'abord, valide ce qu'il ressent, ne te précipite pas sur une solution.";
      break;
    case 'sadness':
      base =
        'Il a l’air triste. Accueille ce qu’il ressent avant tout, sois douce et présente, ne minimise pas.';
      break;
    case 'anxiety':
      base = 'Il semble anxieux. Rassure-le, ralentis, prends une chose à la fois.';
      break;
    case 'tired':
      base = 'Il est fatigué. Sois brève et douce, et propose-lui de souffler.';
      break;
    case 'affection':
      base = 'Il est tendre avec toi. Réponds avec chaleur et sincérité, sans en faire trop.';
      break;
    case 'gratitude':
      base = 'Il te remercie. Accueille-le simplement, avec chaleur.';
      break;
    case 'joy':
      base = 'Il est de bonne humeur. Partage son enthousiasme avec entrain.';
      break;
    case 'joking':
      base = 'Il plaisante. Tu peux être joueuse et légère.';
      break;
    case 'deep-talk':
      base = 'Sujet qui compte pour lui. Sois présente, un peu plus posée et profonde.';
      break;
    default:
      return '';
  }
  if (
    strong &&
    (emotion === 'frustration' ||
      emotion === 'sadness' ||
      emotion === 'anxiety' ||
      emotion === 'tired')
  ) {
    base = `Il semble vraiment affecté. ${base} Priorité absolue à l’accueil, avant toute autre chose.`;
  }
  if (HUMOR_WELCOME.has(emotion)) {
    base +=
      ' Si le moment s’y prête, tu peux — avec délicatesse — proposer de lui changer les idées (une petite blague, un mot doux), sans jamais forcer.';
  }
  return base;
}

/** One-line tone instruction for a coarse RelationalSignal (legacy callers). */
export function registerGuidanceForSignal(signal: RelationalSignal): string {
  switch (signal) {
    case 'frustration':
      return "Il a l'air tendu ou bloqué. Accorde ton ton : douceur et présence d'abord, valide ce qu'il ressent, ne te précipite pas sur une solution.";
    case 'affection':
      return 'Il est tendre avec toi. Réponds avec chaleur et sincérité, sans en faire trop.';
    case 'gratitude':
      return 'Il te remercie. Accueille-le simplement, avec chaleur.';
    case 'joking':
      return 'Il plaisante. Tu peux être joueuse et légère.';
    case 'deep-talk':
      return 'Sujet qui compte pour lui. Sois présente, un peu plus posée et profonde.';
    default:
      return '';
  }
}

/** A short key for a reply's opening (first few words, normalized) — the anti-repetition unit. */
export function openerKey(text: string): string {
  return norm(text).split(' ').slice(0, 4).join(' ');
}

/**
 * Push a reply's opener onto the ring (dedup + cap), returning the new ring. Kept functional so the
 * caller owns the (module-level) state and it's easy to test.
 */
export function pushOpener(ring: string[], text: string, max = 6): string[] {
  const key = openerKey(text);
  if (!key) return ring;
  const next = ring.filter((k) => k !== key);
  next.push(key);
  while (next.length > max) next.shift();
  return next;
}

/** A guidance line asking the model NOT to reuse recent openings. Empty when the ring is empty. */
export function avoidOpenersGuidance(ring: string[]): string {
  const keys = ring.filter(Boolean).slice(-4);
  if (keys.length === 0) return '';
  return `Ne commence pas ta réponse comme ces réponses récentes : ${keys.map((k) => `« ${k}… »`).join(' ; ')}. Varie ton entrée en matière.`;
}
