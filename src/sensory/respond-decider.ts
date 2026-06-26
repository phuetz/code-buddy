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
 *   2. (chime-in off) → silent. No LLM call.
 *   3. cue         — only with chime-in ON: a question/imperative/keyword cue → escalate
 *   4. judge       — a rare fast-LLM yes/no, HIGH bar; any error/uncertainty → silent
 *   else → silent.
 *
 * Conservative by design: butting into a human-human conversation is the failure that kills
 * the illusion; staying silent when it "could have helped" is forgivable. Everything is
 * injectable (now / nameMatch / judge / recentContext) for deterministic tests. Never-throws.
 *
 * @module sensory/respond-decider
 */

import { logger } from '../utils/logger.js';

export interface ResponseDecision {
  respond: boolean;
  /** Why — for logs ("addressed", "engaged", "ambient", "no-cue", "chime-in", "not-warranted"). */
  reason: string;
}

/** The rare second-stage judgment: given the utterance + recent context, chime in? */
export type JudgeFn = (transcript: string, context: string[]) => Promise<boolean>;

export interface ResponseDeciderOptions {
  /** Name that counts as being addressed. Default CODEBUDDY_ROBOT_NAME || 'Buddy'. */
  robotName?: string;
  /** Post-reply window (ms) where follow-ups are treated as addressed. Default 30000. */
  engageWindowMs?: number;
  /** Enable spontaneous chime-in (tiers 3-4). Default CODEBUDDY_SENSORY_CHIME_IN === 'true'. */
  chimeIn?: boolean;
  now?: () => number;
  /** Injectable fuzzy name matcher. Default: word-level Levenshtein-tolerant. */
  nameMatch?: (text: string, name: string) => boolean;
  /** Injectable chime-in judge. Default: a fast local LLM ($0). */
  judge?: JudgeFn;
  /** Injectable recent-conversation context. Default: the sensory-memory hearing buffer. */
  recentContext?: () => string[] | Promise<string[]>;
}

export interface ResponseDecider {
  decide(transcript: string): Promise<ResponseDecision>;
  /** (Re)open the engagement window — call after the robot has spoken so a long reply
   *  doesn't let the window lapse before the human's follow-up. */
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

/** Default fuzzy matcher: any word within a small edit distance of the name counts as
 *  addressed (STT turns "Buddy" into "buddy"/"body"/"buddha"). Errs toward catching the
 *  address — ignoring someone talking straight to you is the worse failure. */
export function fuzzyNameMatch(text: string, name: string): boolean {
  const n = name.toLowerCase().trim();
  if (!n) return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const tol = n.length <= 4 ? 1 : 2;
  for (const w of words) {
    if (w === n) return true;
    if (Math.abs(w.length - n.length) <= tol && levenshtein(w, n) <= tol) return true;
  }
  return false;
}

/** Cheap pre-attentive cue: does the utterance look like it invites a response at all? */
function hasResponseCue(text: string): boolean {
  if (text.includes('?')) return true;
  const t = text.toLowerCase();
  return /\b(aide|help|peux[- ]tu|tu peux|comment|pourquoi|qu'est|quel|quelle|quels|où|quand|combien|explique|montre|fais|lance|cherche|trouve|rappelle|dis|donne)\b/.test(
    t,
  );
}

// ── default judge (rare, only on a cue with chime-in on) ──────────────

function makeDefaultJudge(): JudgeFn {
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
      'Réponds STRICTEMENT par OUI ou NON, rien d\'autre.';
    const ctx = context.slice(-5).join('\n');
    const resp = await client.chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: `${ctx ? `Contexte récent:\n${ctx}\n\n` : ''}Dernière phrase: ${transcript}\n\nIntervenir ?` },
      ] as never,
      [],
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
      .map((p) => String((p.payload as { text?: string })?.text ?? p.summary ?? '').replace(/^Heard:\s*/i, ''))
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
  const robotName = opts.robotName ?? env.CODEBUDDY_ROBOT_NAME ?? 'Buddy';
  const engageWindowMs =
    opts.engageWindowMs ?? Number(env.CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS ?? 30000);
  const chimeIn = opts.chimeIn ?? env.CODEBUDDY_SENSORY_CHIME_IN === 'true';
  const now = opts.now ?? (() => Date.now());
  const nameMatch = opts.nameMatch ?? fuzzyNameMatch;
  const judge = opts.judge ?? makeDefaultJudge();
  const recentContext = opts.recentContext ?? defaultRecentContext;

  let lastEngagedAt = Number.NEGATIVE_INFINITY;
  const markEngaged = (): void => {
    lastEngagedAt = now();
  };

  async function decide(transcript: string): Promise<ResponseDecision> {
    try {
      const text = (transcript ?? '').trim();
      if (!text) return { respond: false, reason: 'empty' };

      // Tier 0 — addressed by name (fuzzy, no LLM).
      if (nameMatch(text, robotName)) {
        markEngaged();
        return { respond: true, reason: 'addressed' };
      }

      // Tier 1 — inside the engagement window (continuity, no LLM).
      if (now() - lastEngagedAt < engageWindowMs) {
        markEngaged();
        return { respond: true, reason: 'engaged' };
      }

      // Not addressed, not in a conversation.
      if (!chimeIn) return { respond: false, reason: 'ambient' };

      // Tier 2 — cheap cue gate (no LLM unless a cue fires).
      if (!hasResponseCue(text)) return { respond: false, reason: 'no-cue' };

      // Tier 3 — rare LLM judgment, high bar, error → silent.
      let warranted = false;
      try {
        const ctx = await recentContext();
        warranted = await judge(text, ctx);
      } catch (err) {
        logger.debug(`[respond] judge failed → silent: ${err instanceof Error ? err.message : String(err)}`);
        return { respond: false, reason: 'judge-error' };
      }
      if (warranted) {
        markEngaged();
        return { respond: true, reason: 'chime-in' };
      }
      return { respond: false, reason: 'not-warranted' };
    } catch (err) {
      // Never-throws — and a failure means stay silent (conservative).
      logger.warn(`[respond] decision failed → silent: ${err instanceof Error ? err.message : String(err)}`);
      return { respond: false, reason: 'error' };
    }
  }

  return { decide, markEngaged };
}
