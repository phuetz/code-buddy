/**
 * Respond decider — the robot's "should I say something?" judgment, so it behaves like a
 * person in a room instead of a bot that answers every sentence. It listens to everything
 * (the percept is still recorded upstream — observation/memory stay continuous), but it only
 * SPEAKS when it's addressed or when the conversation genuinely warrants a reply.
 *
 * Tiered, cheap-first (mirrors human pre-attentive filtering — we do NOT run an LLM on every
 * utterance):
 *   0. addressed   — the robot's name appears (FUZZY, to survive STT mangling) → respond
 *   1. engaged     — a reply happened within the engagement window → follow-ups respond
 *   2. greeting    — a short direct greeting ("bonjour", "salut", ...) → respond
 *   3. (chime-in off) → silent. No LLM call.
 *   4. cue         — only with chime-in ON: a question/imperative/keyword cue → escalate
 *   5. judge       — a rare fast-LLM yes/no, HIGH bar; any error/uncertainty → silent
 *   else → silent.
 *
 * Conservative by design: butting into a human-human conversation is the failure that kills
 * the illusion; staying silent when it "could have helped" is forgivable. Everything is
 * injectable (now / nameMatch / judge / recentContext) for deterministic tests. Never-throws.
 *
 * @module sensory/respond-decider
 */

import { logger } from '../utils/logger.js';
import { withTimeout } from '../council/with-timeout.js';

export interface ResponseDecision {
  respond: boolean;
  /** Why — for logs ("addressed", "engaged", "ambient", "no-cue", "chime-in", "not-warranted"). */
  reason: string;
}

/** The rare second-stage judgment: given the utterance + recent context, chime in? */
export type JudgeFn = (transcript: string, context: string[]) => Promise<boolean>;

export interface ResponseDeciderOptions {
  /** Name that counts as being addressed. Default explicit option || CODEBUDDY_ROBOT_NAME || active persona robotName || 'Buddy'. */
  robotName?: string;
  /** Post-reply window (ms) where follow-ups are treated as addressed. Default 30000. */
  engageWindowMs?: number;
  /** Keep a live dialogue going by EXTENDING the window on directed follow-ups. Default CODEBUDDY_SENSORY_CONVERSATION_MODE !== 'false' (on). */
  conversationMode?: boolean;
  /** Hard cap (ms) on total dialogue duration before a re-address is required. Default 300000. */
  conversationMaxMs?: number;
  /** Enable spontaneous chime-in (tiers 3-4). Default CODEBUDDY_SENSORY_CHIME_IN === 'true'. */
  chimeIn?: boolean;
  /** Reply to short direct greetings even without the robot name. Default true. */
  respondToGreeting?: boolean;
  now?: () => number;
  /** Injectable fuzzy name matcher. Default: word-level Levenshtein-tolerant. */
  nameMatch?: (text: string, name: string) => boolean;
  /** Injectable chime-in judge. Default: a fast local LLM ($0). */
  judge?: JudgeFn;
  /** Injectable recent-conversation context. Default: the sensory-memory hearing buffer. */
  recentContext?: () => string[] | Promise<string[]>;
  /** Maximum total time for recent context + chime-in judgment. Default 2500ms. */
  judgeTimeoutMs?: number;
}

export interface ResponseDecider {
  decide(transcript: string): Promise<ResponseDecision>;
  /** Open the engagement window as if just addressed. `decide` calls this on a name match;
   *  expose it so a caller can explicitly start a conversation (e.g. a wake-word from another
   *  channel). NOTE: do NOT call this after every reply — that would make the window slide on
   *  ambient cross-talk and the robot would answer the whole room. */
  markEngaged(): void;
}

// ── fuzzy name match ──────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

/** True if word `a` is within a small edit distance of target `b` (tol scales with `b`). */
function fuzzyWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const tol = b.length <= 4 ? 1 : 2;
  return Math.abs(a.length - b.length) <= tol && levenshtein(a, b) <= tol;
}

/** Default fuzzy matcher: any word within a small edit distance of the name counts as
 *  addressed (STT turns "Buddy" into "buddy"/"body"/"buddha"). Errs toward catching the
 *  address — ignoring someone talking straight to you is the worse failure.
 *
 *  Multi-word names ("Code Buddy") are matched too: a per-word tokenizer can never bring a
 *  single word within edit distance of a two-word name, so we also try (a) a run of consecutive
 *  words matching the name phrase word-by-word, and (b) a single collapsed token matching the
 *  spaceless name (STT often merges "Code Buddy" → "codebuddy"). */
export function fuzzyNameMatch(text: string, name: string): boolean {
  const n = name.toLowerCase().trim();
  if (!n) return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  const nameWords = n.split(/\s+/).filter(Boolean);

  // Single-word name (the common case): any word close enough.
  if (nameWords.length <= 1) {
    return words.some((w) => fuzzyWordMatch(w, n));
  }

  // Multi-word name: (b) collapsed single token, then (a) a consecutive word run.
  const collapsed = nameWords.join('');
  if (words.some((w) => fuzzyWordMatch(w, collapsed))) return true;
  for (let i = 0; i + nameWords.length <= words.length; i++) {
    let all = true;
    for (let j = 0; j < nameWords.length; j++) {
      if (!fuzzyWordMatch(words[i + j]!, nameWords[j]!)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

// ── vocative address (are we being SPOKEN TO vs merely mentioned?) ────

/** Lowercase + strip diacritics + fold punctuation to spaces (for word-level rules). */
function normWords(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeWords(text: string): string[] {
  return normWords(text).split(' ').filter(Boolean);
}

/** Indices where the (possibly multi-word) name appears (fuzzy). */
function nameMatchIndices(words: string[], name: string): number[] {
  const nameWords = name.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const idxs: number[] = [];
  if (nameWords.length <= 1) {
    words.forEach((w, i) => {
      if (fuzzyWordMatch(w, nameWords[0]!)) idxs.push(i);
    });
    return idxs;
  }
  const collapsed = nameWords.join('');
  words.forEach((w, i) => {
    if (fuzzyWordMatch(w, collapsed)) idxs.push(i);
  });
  for (let i = 0; i + nameWords.length <= words.length; i++) {
    if (nameWords.every((nw, j) => fuzzyWordMatch(words[i + j]!, nw))) idxs.push(i);
  }
  return [...new Set(idxs)].sort((a, b) => a - b);
}

const SECOND_PERSON = /\b(tu|te|toi|vous|ton|ta|tes)\b/;
// Common request/imperative verbs directed at the assistant (broader than the chime-in cue).
const IMPERATIVE =
  /\b(raconte|redis|repete|continue|arrete|attends|chante|joue|ouvre|ferme|mets|met|envoie|note|ajoute|calcule|traduis|rappelle|dis|donne|montre|explique|fais|lance|cherche|trouve|aide|baisse|monte|augmente|repond|reponds)\b/;
// Words that mark the name as the OBJECT/SUBJECT of a 3rd-person statement (a mention, not an address).
const MENTION_PREP = new Set([
  'a',
  'de',
  'du',
  'des',
  'avec',
  'pour',
  'que',
  'chez',
  'vu',
  'vois',
  'croise',
  'rencontre',
  'parle',
]);
const THIRD_PERSON_VERB = new Set([
  'est',
  'etait',
  'sera',
  'a',
  'avait',
  'aura',
  'fait',
  'faisait',
  'va',
  'allait',
  'vient',
  'venait',
  'dit',
  'disait',
  'pense',
  'pensait',
  'aime',
  'adore',
  'deteste',
  'habite',
  'travaille',
  'arrive',
  'part',
  'partait',
  'sait',
  'savait',
  'semble',
  'reste',
]);

/**
 * Is the robot being ADDRESSED (spoken to), not merely MENTIONED? Requires a fuzzy name match,
 * then human-like vocative cues: a question / a 2nd-person or imperative cue / a short call / the
 * name at the very start or end. A name embedded in a 3rd-person statement ("j'ai vu Lisa", "Lisa
 * est partie", or a TV line) is a mention → not addressed. Pure.
 */
export function isVocativeAddress(
  text: string,
  name: string,
  nameMatch: (t: string, n: string) => boolean = fuzzyNameMatch
): boolean {
  if (!nameMatch(text, name)) return false;
  // Strong directed intent anywhere in the utterance → addressed.
  if (text.includes('?')) return true;
  const t = normWords(text);
  if (SECOND_PERSON.test(t)) return true;
  if (IMPERATIVE.test(t) || hasResponseCue(text)) return true;
  const words = t.split(' ').filter(Boolean);
  if (words.length <= 3) return true; // "hey Lisa", "Lisa !"
  // No directed marker: only a name at start/end that isn't a 3rd-person statement is a call.
  for (const i of nameMatchIndices(words, name)) {
    const prev = words[i - 1];
    const next = words[i + 1];
    const mention = (!!prev && MENTION_PREP.has(prev)) || (!!next && THIRD_PERSON_VERB.has(next));
    if (mention) continue;
    if (i === 0 || i === words.length - 1) return true;
  }
  return false;
}

const CONTINUATION =
  /^(et|alors|ok|oui|non|ouais|aussi|puis|donc|d accord|dac|attends|sinon|bon|au fait)\b/;

/**
 * Is a follow-up (inside a live conversation) directed at the robot rather than ambient cross-talk?
 * A question, a 2nd-person/imperative cue, or a continuation opener ("et …", "ok", "attends") counts;
 * a plain 3rd-person statement does not. Pure.
 */
export function isDirectedFollowUp(text: string): boolean {
  if (!(text ?? '').trim()) return false;
  if (text.includes('?')) return true;
  const t = normWords(text);
  if (SECOND_PERSON.test(t)) return true;
  if (IMPERATIVE.test(t) || hasResponseCue(text)) return true;
  return CONTINUATION.test(t);
}

/** Cheap pre-attentive cue: does the utterance look like it invites a response at all? */
function hasResponseCue(text: string): boolean {
  if (text.includes('?')) return true;
  const t = text.toLowerCase();
  return /\b(aide|help|peux[- ]tu|tu peux|comment|pourquoi|qu'est|quel|quelle|quels|où|quand|combien|explique|montre|fais|lance|cherche|trouve|rappelle|dis|donne)\b/.test(
    t
  );
}

function normalizeForCheapSpeechRules(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDirectGreeting(text: string): boolean {
  const t = normalizeForCheapSpeechRules(text);
  if (!t) return false;
  const words = t.split(' ');
  if (words.length > 3) return false;
  return (
    /^(bonjour|bonsoir|salut|coucou|hello|hey|yo)$/.test(t) ||
    /^(bonjour|bonsoir|salut|coucou|hello|hey|yo) (ça|ca) va$/.test(t)
  );
}

// ── default judge (rare, only on a cue with chime-in on) ──────────────

function makeDefaultJudge(timeoutMs: number): JudgeFn {
  return async (transcript: string, context: string[]): Promise<boolean> => {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { resolveVoiceModel } = await import('./voice-loop.js');
    const model = process.env.CODEBUDDY_SENSORY_RESPOND_DECISION_MODEL;
    const route = await resolveVoiceModel(transcript);
    const client = new CodeBuddyClient(route.apiKey, model || route.model, route.baseURL);
    const sys =
      "Tu es un robot compagnon dans une pièce où des humains parlent ENTRE EUX. Tu n'as PAS été " +
      'interpellé par ton nom. Décide si tu devrais intervenir SPONTANÉMENT. Interviens UNIQUEMENT ' +
      "si on pose une question ouverte à laquelle tu peux vraiment aider OU si on demande de l'aide. " +
      "Dans le doute, n'interviens PAS (couper une conversation humaine est pire que de se taire). " +
      "Réponds STRICTEMENT par OUI ou NON, rien d'autre.";
    const ctx = context.slice(-5).join('\n');
    const resp = await client.chat(
      [
        { role: 'system', content: sys },
        {
          role: 'user',
          content: `${ctx ? `Contexte récent:\n${ctx}\n\n` : ''}Dernière phrase: ${transcript}\n\nIntervenir ?`,
        },
      ] as never,
      [],
      { temperature: 0, maxTokens: 8, timeoutMs },
    );
    const out = (resp?.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
    return /\boui\b|\byes\b/.test(out) && !/\bnon\b|\bno\b/.test(out);
  };
}

async function defaultRecentContext(): Promise<string[]> {
  try {
    // Transcripts live in the companion percept store (sensory-memory holds raw
    // speech_end events whose payload is the WAV path, not the text).
    const { readRecentCompanionPercepts } = await import('../companion/percepts.js');
    const recent = await readRecentCompanionPercepts({ modality: 'hearing', limit: 6 });
    return recent
      .map((p) =>
        String((p.payload as { text?: string })?.text ?? p.summary ?? '').replace(/^Heard:\s*/i, '')
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Create the stateful decider. Holds `lastEngagedAt` (the conversation-continuity window).
 */
export function createResponseDecider(opts: ResponseDeciderOptions = {}): ResponseDecider {
  const env = process.env;
  const explicitRobotName = opts.robotName?.trim();
  const engageWindowMs =
    opts.engageWindowMs ?? Number(env.CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS ?? 30000);
  const conversationMode =
    opts.conversationMode ?? env.CODEBUDDY_SENSORY_CONVERSATION_MODE !== 'false';
  const conversationMaxMs =
    opts.conversationMaxMs ?? Number(env.CODEBUDDY_SENSORY_CONVERSATION_MAX_MS ?? 300000);
  const chimeIn = opts.chimeIn ?? env.CODEBUDDY_SENSORY_CHIME_IN === 'true';
  const respondToGreeting =
    opts.respondToGreeting ?? env.CODEBUDDY_SENSORY_RESPOND_TO_GREETING !== 'false';
  const now = opts.now ?? (() => Date.now());
  const nameMatch = opts.nameMatch ?? fuzzyNameMatch;
  const configuredJudgeTimeout =
    opts.judgeTimeoutMs ?? Number(env.CODEBUDDY_SENSORY_RESPOND_JUDGE_TIMEOUT_MS);
  const judgeTimeoutMs =
    Number.isFinite(configuredJudgeTimeout) && configuredJudgeTimeout > 0
      ? configuredJudgeTimeout
      : 2500;
  const judge = opts.judge ?? makeDefaultJudge(judgeTimeoutMs);
  const recentContext = opts.recentContext ?? defaultRecentContext;

  let lastEngagedAt = Number.NEGATIVE_INFINITY;
  let dialogueStartedAt = Number.NEGATIVE_INFINITY;
  const markEngaged = (): void => {
    const t = now();
    // A fresh dialogue when the previous window had lapsed; otherwise keep the original
    // dialogue anchor so the total cap measures from the FIRST address, not each extension.
    if (t - lastEngagedAt >= engageWindowMs) dialogueStartedAt = t;
    lastEngagedAt = t;
  };
  async function resolveRobotNameForTurn(): Promise<string> {
    if (explicitRobotName) return explicitRobotName;
    const envRobotName = env.CODEBUDDY_ROBOT_NAME?.trim();
    if (envRobotName) return envRobotName;
    try {
      const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
      const personaName = (await getActivePersonaVoiceAsync()).robotName?.trim();
      if (personaName) return personaName;
    } catch {
      /* fall back to env/default */
    }
    return 'Buddy';
  }

  async function decide(transcript: string): Promise<ResponseDecision> {
    try {
      const text = (transcript ?? '').trim();
      if (!text) return { respond: false, reason: 'empty' };

      // Tier 0 — addressed by name (fuzzy, no LLM). ONLY an explicit address anchors the
      // engagement window — so it decays from the address, NOT from whatever was said next.
      const robotName = await resolveRobotNameForTurn();
      if (isVocativeAddress(text, robotName, nameMatch)) {
        markEngaged();
        return { respond: true, reason: 'addressed' };
      }

      // Tier 1 — inside the engagement window (continuity, no LLM), checked BEFORE the
      // standalone-greeting tier: a follow-up that happens to sound like a greeting ("salut,
      // ça va ?" after the robot just greeted you) must stay tagged as conversation
      // continuity, not be reclassified as a fresh greeting. Reply to the follow-up but DO NOT
      // slide the window: otherwise, once addressed, ambient cross-talk would keep refreshing
      // it and the robot would answer the whole room forever. The window is a bounded grace
      // period after each address; re-address to extend.
      if (now() - lastEngagedAt < engageWindowMs) {
        if (isDirectedFollowUp(text)) {
          // A follow-up aimed at the robot → respond, and (conversation mode) keep the dialogue
          // alive by extending the window, up to the total cap (re-address required past it).
          if (conversationMode && now() - dialogueStartedAt < conversationMaxMs) markEngaged();
          return { respond: true, reason: 'engaged' };
        }
        // Ambient cross-talk INSIDE the window → stay silent (don't answer the room). The window
        // still expires on its own if no directed follow-up extends it.
        return { respond: false, reason: 'ambient-in-window' };
      }

      // Voice-assistant affordance: a short standalone greeting is directed at the assistant
      // when the mic loop is active. Keep it narrow so human-to-human greetings such as
      // "bonjour Patrice" or a longer sentence do not wake the robot.
      if (respondToGreeting && isDirectGreeting(text)) {
        markEngaged();
        return { respond: true, reason: 'greeting' };
      }

      // Not addressed, not in a conversation.
      if (!chimeIn) return { respond: false, reason: 'ambient' };

      // Tier 2 — cheap cue gate (no LLM unless a cue fires).
      if (!hasResponseCue(text)) return { respond: false, reason: 'no-cue' };

      // Tier 3 — rare LLM judgment, high bar, error → silent. A spontaneous chime-in does NOT
      // open a window (each is judged independently — keeps the risky path conservative).
      let warranted = false;
      try {
        warranted = await withTimeout(
          (async () => judge(text, await recentContext()))(),
          judgeTimeoutMs,
          'respond-judge',
        );
      } catch (err) {
        logger.debug(
          `[respond] judge failed → silent: ${err instanceof Error ? err.message : String(err)}`
        );
        return { respond: false, reason: 'judge-error' };
      }
      if (warranted) {
        return { respond: true, reason: 'chime-in' };
      }
      return { respond: false, reason: 'not-warranted' };
    } catch (err) {
      // Never-throws — and a failure means stay silent (conservative).
      logger.warn(
        `[respond] decision failed → silent: ${err instanceof Error ? err.message : String(err)}`
      );
      return { respond: false, reason: 'error' };
    }
  }

  return { decide, markEngaged };
}
