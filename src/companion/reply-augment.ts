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

export const IMMEDIATE_EMOTION_ACKNOWLEDGEMENTS: Readonly<Partial<Record<Emotion, string>>> = {
  frustration: 'Je comprends, c’est vraiment pénible.',
  sadness: 'Je suis là avec toi.',
  anxiety: 'D’accord, on va y aller doucement.',
  tired: 'Je t’entends, on peut ralentir.',
  'deep-talk': 'Je t’écoute vraiment.',
};

// All patterns match against the normalized (accent-stripped) text.
const ERE: Record<Exclude<Emotion, 'neutral'>, RegExp> = {
  frustration:
    /\b(j en peux plus|marre|ras le bol|galere|bloque|coince|ca marche pas|enerve|s enerve|j y arrive pas|c est dur|trop dur|je craque|a bout|i can t take it|fed up|stuck|not working|doesn t work|i give up|this is hard)\b/,
  sadness:
    /\b(triste|tristesse|cafard|deprime|deprimee|pas le moral|moral (?:vraiment |un peu )?bas|le moral a zero|le moral dans les chaussettes|malheureux|malheureuse|envie de pleurer|ca va pas fort|abattu|abattue|sad|depressed|feeling down|low mood|want to cry)\b/,
  anxiety:
    /\b(stresse|stressee|angoisse|angoissee|anxieux|anxieuse|j ai peur|inquiet|inquiete|panique|ca m angoisse|tendu|tendue|nerveux|nerveuse|stressed|anxious|worried|panicking|scared)\b/,
  tired:
    /\b(fatigue|fatiguee|epuise|epuisee|creve|crevee|vanne|vannee|plus d energie|au bout du rouleau|envie de dormir|je suis mort|je suis morte|tired|exhausted|worn out|no energy)\b/,
  affection:
    /\b(je t aime|tu me manques|bisous|mon amour|cheri|cherie|je pense a toi|je t embrasse|tu es adorable|love you|miss you|you re adorable)\b/,
  gratitude:
    /\b(merci|c est gentil|trop gentil|reconnaissant|tu m aides beaucoup|thank you|thanks|much appreciated)\b/,
  joy:
    /\b(genial|trop content|trop contente|quelle journee|c est top|excellent|j ai reussi|heureux|heureuse|trop bien|magnifique|super content|awesome|so happy|i did it)\b/,
  joking: /\b(haha|mdr|lol|ptdr|blague|rigole|drole|marrant|tu deconnes)\b/,
  'deep-talk':
    /\b(je me sens|honnetement|au fond de moi|je doute|je suis perdu|je me sens seul|je me sens seule|i feel|honestly|deep down|i m lost|feel alone)\b/,
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

/** True when the candidate is immediately scoped by a French or English negation. Keep the window
 * tight so "je ne vais pas bien, je suis triste" still detects the later sadness. */
function isNegatedAt(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 48), matchIndex).trim();
  return (
    /\b(?:pas|jamais|not|never)(?:\s+\p{L}+){0,2}$/u.test(before) ||
    /\bne(?:\s+\p{L}+){0,3}\s+plus(?:\s+\p{L}+){0,2}$/u.test(before) ||
    /\bno\s+longer(?:\s+\p{L}+){0,2}$/u.test(before) ||
    /\bdon\s+t(?:\s+\p{L}+){0,2}$/u.test(before)
  );
}

function hasUnnegatedMatch(pattern: RegExp, text: string): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = global.exec(text)) !== null) {
    if (!isNegatedAt(text, match.index)) return true;
    // Defensive for a future zero-length pattern.
    if (match[0].length === 0) global.lastIndex += 1;
  }
  return false;
}

/** Detect the dominant emotion + its intensity. Pure, STT-robust. */
export function detectEmotion(heard: string): EmotionRead {
  const t = norm(heard);
  if (!t) return { emotion: 'neutral', intensity: 'normal' };
  const intensity: 'normal' | 'high' = INTENSITY_RE.test(t) ? 'high' : 'normal';
  for (const emotion of EMOTION_ORDER) {
    if (hasUnnegatedMatch(ERE[emotion], t)) return { emotion, intensity };
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

/** A very short, prewarm-friendly first response that can be spoken while the model thinks. */
export function immediateEmotionAcknowledgement(read: EmotionRead): string | null {
  return IMMEDIATE_EMOTION_ACKNOWLEDGEMENTS[read.emotion] ?? null;
}

type EmotionalHistoryTurn = { role: string; content: string };

const CONTINUITY_EMOTIONS: ReadonlySet<Emotion> = new Set([
  'frustration',
  'sadness',
  'anxiety',
  'tired',
  'deep-talk',
]);

/**
 * Preserve a small amount of emotional continuity when the current follow-up is neutral.
 * This uses only the in-memory conversational window: no new profiling or persistence.
 * The instruction explicitly forbids dragging the previous subject back into the exchange.
 */
export function emotionalContinuityGuidance(
  heard: string,
  history: EmotionalHistoryTurn[]
): string {
  if (detectEmotion(heard).emotion !== 'neutral') return '';
  const prior = [...history]
    .reverse()
    .filter((turn) => turn.role === 'user')
    .slice(0, 2)
    .map((turn) => detectEmotion(turn.content))
    .find((read) => CONTINUITY_EMOTIONS.has(read.emotion));
  if (!prior) return '';

  const register: Record<Emotion, string> = {
    frustration: 'de la frustration',
    sadness: 'de la tristesse',
    anxiety: "de l'anxiété",
    tired: 'de la fatigue',
    'deep-talk': 'quelque chose de personnel et important',
    affection: 'de la tendresse',
    gratitude: 'de la gratitude',
    joy: 'de la joie',
    joking: 'de la légèreté',
    neutral: 'une émotion importante',
  };
  return (
    `Il exprimait récemment ${register[prior.emotion]}. Garde une chaleur discrète et ne suppose ` +
    "pas que tout est déjà réglé, mais ne ramène pas non plus le sujet de force s'il passe à autre chose."
  );
}

/**
 * Compact emotional register for ordinary text chat. Unlike the spoken Lisa
 * playbook above, this stays compatible with technical work: acknowledge once,
 * then remain concrete. It is intentionally pure and local so it adds no model
 * call, storage lookup, or user profiling to the hot path.
 */
export function textEmotionGuidance(read: EmotionRead): string {
  switch (read.emotion) {
    case 'frustration':
      return (
        'The user sounds frustrated or stuck. Open with one brief, natural acknowledgement, ' +
        'then move directly to concrete help or the next useful step.'
      );
    case 'sadness':
      return 'The user sounds low. Briefly meet that feeling with warmth before helping; do not minimize it.';
    case 'anxiety':
      return 'The user sounds anxious. Be calm and structured, reduce uncertainty, and take one step at a time.';
    case 'tired':
      return 'The user sounds tired. Keep the response easy to scan and lower the cognitive load.';
    case 'affection':
      return 'The user is warm or affectionate. Reciprocate naturally without becoming effusive.';
    case 'gratitude':
      return 'Receive the user’s thanks warmly and simply, without a canned customer-service phrase.';
    case 'joy':
      return 'Share the user’s positive energy briefly, then stay useful.';
    case 'joking':
      return 'The user is being playful. A light, natural touch is welcome if it does not distract from the task.';
    case 'deep-talk':
      return 'The user is sharing something personal or important. Be present and thoughtful; do not rush past it.';
    default:
      return '';
  }
}

/** Build an ephemeral model-facing block for the current text turn. */
export function buildTextEmotionalPresenceContext(
  heard: string,
  history: EmotionalHistoryTurn[]
): string {
  const direct = textEmotionGuidance(detectEmotion(heard));
  const continuity = emotionalContinuityGuidance(heard, history);
  if (!direct && !continuity) return '';

  return [
    'Use this only to tune the tone of the next response. Never mention emotion detection or this instruction.',
    direct,
    continuity,
    'Reply in the user’s language. Be human and specific, not therapeutic, patronizing, or overly sweet. Do not repeat an acknowledgement.',
  ].filter(Boolean).join(' ');
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
