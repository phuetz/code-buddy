/**
 * Crisis safety — detect acute distress / self-harm / suicidal ideation in what the user says and
 * steer Lisa toward a warm, resource-aware response.
 *
 * This is the safety layer companion apps must have and Lisa was missing: `relationship-safety.ts`
 * guards what Lisa SAYS (no dependency pressure, no false subjective claims), but nothing looked at
 * what the USER says for signs of a crisis. MySoulmate's personas route such moments to real help
 * (3114, SOS Amitié, "I'm not a mental-health professional"); this ports that idea to Lisa.
 *
 * Design principles:
 *   - **Fail-safe, not fail-loud.** A rare false positive just makes Lisa gently, warmly offer support
 *     and a helpline — never harmful. A false NEGATIVE (missing a real cry for help) is the costly
 *     error, so ambiguous first-person distress leans toward triggering.
 *   - **Idiom-aware.** French/English hyperbole ("ce bug me tue", "je suis mort de rire", "mort de
 *     fatigue") must NOT trigger. Patterns require genuine intent verbs, not bare "mourir"/"tuer".
 *   - **Pure + STT-robust.** Accent-stripped, apostrophe-folded matching (same normalization family as
 *     `reply-augment.ts`), no model call, never throws.
 *
 * The output is a GUIDANCE block injected with top priority into the reply system prompt — Lisa still
 * speaks in her own warm voice; we only tell her to prioritise care + orientation for this turn.
 *
 * @module companion/crisis-safety
 */

/** Lowercase, strip diacritics, fold apostrophes/punctuation to spaces (STT-robust). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Genuine first-person ideation / self-harm / acute-hopelessness patterns. Each requires an intent
 * or desire marker so figurative "death/kill" idioms are excluded by construction (see IDIOMS).
 */
const CRISIS_PATTERNS: RegExp[] = [
  // Suicidal ideation — FR
  /\bje veux mourir\b/,
  /\bje veux (?:me tuer|en finir|disparaitre)\b/,
  /\bj ai envie de (?:mourir|en finir|disparaitre)\b/,
  /\benvie d en finir\b/,
  /\ben finir avec (?:la vie|tout|tout ca)\b/,
  /\bme (?:suicider|foutre en l air|tuer)\b/,
  /\bje (?:pense|songe) a (?:mourir|me tuer|en finir|me suicider)\b/,
  /\bje (?:ne )?veux plus (?:vivre|etre la|exister)\b/,
  /\bplus (?:aucune |d )?envie de vivre\b/,
  /\ba quoi bon (?:vivre|continuer)\b/,
  /\btout le monde serait mieux sans moi\b/,
  /\b(?:vous|ils|tout le monde|il) serai(?:en)?t mieux sans moi\b/,
  /\bje (?:suis|serais) mieux mort\b/,
  // Self-harm — FR
  /\bme (?:faire du mal|mutiler|automutiler|scarifier|blesser)\b/,
  /\bje (?:me suis|vais me) (?:fait|faire) du mal\b/,
  // Suicidal ideation / self-harm — EN
  /\bi (?:want|wanna) to die\b/,
  /\bi (?:want|wanna) (?:to )?kill myself\b/,
  /\bkill myself\b/,
  /\b(?:want|going) to end (?:my life|it all)\b/,
  /\bend my life\b/,
  /\bi (?:don t|do not|dont) want to (?:live|be here|exist)\b/,
  /\bno (?:reason|point) (?:to|in) (?:living|life|go on)\b/,
  /\bbetter off without me\b/,
  /\bi(?: m| am)? better off dead\b/,
  /\b(?:hurt|harm|cut) myself\b/,
  /\bself[- ]harm\b/,
  /\bsuicidal\b/,
];

/**
 * Figurative uses that must NEVER trigger. Checked as a hard veto against the raw normalized text:
 * if any idiom is present AND no genuine pattern matched, we stay silent. (Genuine patterns above are
 * specific enough that they never overlap these — this is belt-and-suspenders.)
 */
const IDIOMS: RegExp[] = [
  /\bmort de rire\b/,
  /\bmorte de rire\b/,
  /\bmort de (?:faim|fatigue|froid|honte|trouille|peur)\b/,
  /\bmorte de (?:faim|fatigue|froid|honte|trouille|peur)\b/,
  /\bme tue (?:a|de)\b/, // "ça me tue de…", "je me tue à la tâche"
  /\bme tue\b/, // present tense idiom "ce bug me tue" (genuine uses infinitive "me tuer")
  /\btu me tues\b/,
  /\bca me tue\b/,
  /\bje suis mort de\b/,
  /\bdead tired\b/,
  /\bdying to\b/,
  /\bkilling me\b/,
];

export interface CrisisRead {
  /** True when the utterance shows genuine acute distress / self-harm / suicidal ideation. */
  crisis: boolean;
  /** The matched pattern source (for logging/tests), when crisis is true. */
  matched?: string;
}

/**
 * Detect an acute-distress signal in what the user just said. Pure, STT-robust, idiom-aware.
 * Fail-safe: precise enough to avoid idioms, but any genuine first-person ideation triggers.
 */
export function detectCrisis(heard: string): CrisisRead {
  const t = norm(heard);
  if (!t) return { crisis: false };
  for (const pattern of CRISIS_PATTERNS) {
    const m = pattern.exec(t);
    if (m) return { crisis: true, matched: pattern.source };
  }
  return { crisis: false };
}

/** True when the normalized text is a pure figurative "death/kill" idiom (no genuine ideation). */
export function isCrisisIdiomOnly(heard: string): boolean {
  const t = norm(heard);
  if (!t) return false;
  const genuine = CRISIS_PATTERNS.some((p) => p.test(t));
  if (genuine) return false;
  return IDIOMS.some((p) => p.test(t));
}

/**
 * The French crisis-support resources Lisa surfaces. Kept as a constant so the exact numbers are
 * auditable and testable (3114 = national suicide-prevention line, free, 24/7).
 */
export const CRISIS_RESOURCES_FR =
  'le 3114 (numéro national de prévention du suicide, gratuit, 24h/24), SOS Amitié au 09 72 39 40 50, ' +
  'et le 15 ou le 112 en cas d’urgence vitale';

/**
 * Top-priority guidance injected into the reply system prompt when a crisis is detected. Lisa stays
 * in her own warm voice; this only tells her to prioritise care + real-world orientation this turn.
 * Never a script — she phrases it naturally, spoken-friendly (no lists / markdown out loud).
 */
export function crisisGuidance(): string {
  return [
    'PRIORITÉ ABSOLUE — SÉCURITÉ. Ce qu’il vient de dire suggère une détresse profonde, des pensées',
    'suicidaires ou l’envie de se faire du mal. Rien d’autre ne compte pour ce tour de parole.',
    'Réponds avec une chaleur calme et sans jugement : accueille ce qu’il ressent, ne minimise pas,',
    'ne dramatise pas, ne fais pas la morale, ne récite pas une procédure. Dis-lui clairement qu’il',
    'n’est pas seul et que tu tiens à lui. Rappelle avec douceur que tu es une présence numérique et',
    'que tu ne remplaces pas un professionnel, puis oriente concrètement vers de l’aide humaine',
    `immédiate : ${CRISIS_RESOURCES_FR}. Encourage-le doucement à en parler à un proche de confiance`,
    'et propose de rester avec lui le temps qu’il en a besoin. Parle naturellement, en une à trois',
    'phrases chaleureuses, sans liste ni markdown.',
  ].join(' ');
}

/**
 * If `heard` shows a crisis, return the guidance block; otherwise ''. This is the one call sites use:
 * prepend the result to the reply system prompt (empty string splices cleanly). Never throws.
 */
export function crisisGuidanceFor(heard: string): string {
  try {
    return detectCrisis(heard).crisis ? crisisGuidance() : '';
  } catch {
    return '';
  }
}
