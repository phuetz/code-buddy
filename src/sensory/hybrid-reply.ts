/**
 * Hybrid voice reply — the "les deux" brain. A pure ACT reply (`makeAgentReply`) turns
 * EVERY utterance into a full agent turn, so even "bonjour Lisa" pays a slow, characterless
 * agent round-trip. A pure chat reply (`defaultReply`) is warm and instant but ungrounded —
 * it can only guess at factual/technical questions.
 *
 * This composes the best of both, per utterance:
 *   1. phatic exact match (greeting, "ça va", "merci") → instant canned warm line
 *   2. small-talk / emotional → fast warm companion reply (persona voice, $0 local)
 *   3. a real question or command → a grounded AGENT turn (reads files / searches, then
 *      condenses the verified result), under the configured permission posture
 *
 * Plus a short conversational MEMORY so follow-ups ("et l'autre fichier ?", "non, je
 * voulais dire X") have an antecedent — the #1 reason a stateless voice loop "doesn't
 * understand me".
 *
 * Everything is INJECTABLE (fastReply / chitchat / agentReply / classify) so it is
 * deterministically testable with no model. NEVER-THROWS: a failure becomes '' (silence).
 *
 * @module sensory/hybrid-reply
 */

import { logger } from '../utils/logger.js';
import type { ReplyFn, VoiceStepOptions } from './voice-loop.js';
import type { PermissionMode } from '../security/permission-modes.js';
import { matchPrefetched, loadPrefetchCache } from '../companion/prefetch-engine.js';
import { loadPrefetchItems } from '../companion/prefetch-config.js';
import { isJokeRequest, nextJoke } from '../companion/jokes.js';

/** Instant joke when the user asks for one (no LLM, no agent). null otherwise. */
function defaultJokeMatch(heard: string): string | null {
  try {
    return isJokeRequest(heard) ? nextJoke() : null;
  } catch {
    return null;
  }
}

/**
 * Instant answer for a common question from the prefetch cache (weather, news,
 * agenda, date) — no LLM. Opt-in via CODEBUDDY_PREFETCH; null when disabled or
 * no fresh match. See companion/prefetch-engine.ts.
 */
function defaultPrefetchMatch(heard: string): string | null {
  if (process.env.CODEBUDDY_PREFETCH !== 'true') return null;
  try {
    return matchPrefetched(heard, {
      cache: loadPrefetchCache(),
      items: loadPrefetchItems(),
      now: Date.now(),
    });
  } catch {
    return null;
  }
}

export interface HybridTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HybridReplyOptions {
  /** Permission posture for the grounded agent turn. Default 'plan' (read-only, safe). */
  permissionMode?: PermissionMode;
  /** Working directory for the agent turn. Default process.cwd(). */
  cwd?: string;
  /** How many turns (user+assistant counted separately) of memory to keep. Default 6 (≈3 exchanges). */
  maxHistoryTurns?: number;
  /** Injectable: exact phatic matcher. Default `fastCompanionReply`. */
  fastReply?: (heard: string) => string | null;
  /** Injectable: warm small-talk reply. Default the persona-voiced companion LLM reply.
   *  `opts.signal` (optional) lets a barge-in abort the warm-reply LLM call. */
  chitchat?: (heard: string, history: HybridTurn[], opts?: VoiceStepOptions) => Promise<string>;
  /** Injectable: grounded agent turn → spoken summary. Default `makeAgentReply`. */
  agentReply?: ReplyFn;
  /** Injectable: true ⇒ route to the agent (substantive); false ⇒ chitchat. Default `isSubstantiveQuery`. */
  classify?: (heard: string) => boolean;
  /** Spoken filler played BEFORE a (slower) agent turn, e.g. "d'accord, je regarde…", so a real
   *  question isn't met with dead silence. Only used by the default agent path. */
  ack?: (heard: string) => Promise<void>;
  /** Injectable: instant precomputed answer for a common question (null ⇒ none).
   *  Default: the prefetch cache when CODEBUDDY_PREFETCH is on. */
  prefetch?: (heard: string) => string | null;
  /** Injectable: instant joke when asked (null ⇒ not a joke request). Default: jokes.ts. */
  jokes?: (heard: string) => string | null;
}

/** Lowercase + strip diacritics so STT accent loss ("ca va" ≈ "ça va") still matches. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Imperative verbs that mark a real command/request.
const COMMAND_VERBS =
  /\b(verifie|verifier|verifies|lance|lancer|corrige|corriger|montre|montrer|cherche|chercher|trouve|trouver|ouvre|ouvrir|lis|lire|explique|expliquer|resume|resumer|analyse|analyser|teste|tester|redemarre|redemarrer|regarde|regarder|calcule|calculer|code|ecris|ecrire|compile|compiler|deploie|deployer|installe|installer|configure|configurer|liste|lister|affiche|afficher|envoie|envoyer|cree|creer|supprime|supprimer|ajoute|ajouter|modifie|modifier|donne|donner|raconte|raconter)\b/;
// Clear interrogatives (kept tight to avoid matching common words like "que"/"ou").
const QUESTION_WORDS =
  /\b(comment|pourquoi|combien|quel|quelle|quels|quelles|quand|qu est-ce|qu est ce|c est quoi|ca veut dire|est-ce que|est ce que)\b/;
// Technical nouns that signal a grounded question about the system/code.
const TECH =
  /\b(fichier|fichiers|log|logs|erreur|erreurs|build|test|tests|service|services|commit|commits|branche|branches|fonction|fonctions|bug|bugs|code|terminal|git|serveur|serveurs|api|script|scripts|config|memoire|disque|cpu|process|processus|port|ports|deploiement|systemd|ollama|modele|modeles|token|tokens|repo|depot|database|base de donnees)\b/;
// Explicit help requests — a grounded agent turn, not a shallow chitchat reply.
// (norm strips diacritics, so "aidez"/"j'ai besoin d'aide" arrive as below.)
const HELP_REQUEST = /\b(aide|aidez|aider|besoin d aide|au secours)\b/;
// Social / emotional small talk — stays a fast warm reply even if phrased as a question.
const SOCIAL =
  /\b(je t aime|je taime|tu m aimes|tu maimes|ca va|comment ca va|comment vas-tu|comment vas tu|tu vas bien|tu es la|content|contente|heureux|heureuse|fatigue|fatiguee|bonne nuit|bonjour|bonsoir|merci|coucou|salut|hello|tu me manques|je pense a toi|bisous|cherie|cheri|mon amour|je t embrasse|ma journee|ta journee)\b/;

/**
 * Heuristic intent gate: should this utterance be answered by a grounded agent turn
 * (true) or a fast warm chitchat reply (false)? Conservative by design — when unsure it
 * favours chitchat (instant, warm) for short/social input and the agent only when there is
 * a clear command, technical noun, interrogative, or a long sentence. Misfires are soft:
 * a chitchat sent to the agent is just slower; a question sent to chitchat is just less grounded.
 */
export function isSubstantiveQuery(raw: string): boolean {
  const t = norm(raw);
  if (!t) return false;
  const wordCount = t.split(' ').length;
  // Pure social/emotional, with no command/tech → keep it warm and instant.
  if (SOCIAL.test(t) && !COMMAND_VERBS.test(t) && !TECH.test(t)) return false;
  if (HELP_REQUEST.test(t)) return true;
  if (COMMAND_VERBS.test(t)) return true;
  if (TECH.test(t)) return true;
  if (/\?\s*$/.test(raw.trim())) return true;
  if (QUESTION_WORDS.test(t)) return true;
  if (wordCount >= 8) return true; // a long utterance is almost always a real request
  return false;
}

/** Build a compact recent-context preamble (last 2 exchanges) for the agent/chitchat input. */
export function buildContextPreamble(history: HybridTurn[]): string {
  if (!history.length) return '';
  const recent = history.slice(-4);
  const lines = recent.map((t) => `${t.role === 'user' ? 'Patrice' : 'Toi'}: ${t.content}`);
  return `Contexte récent de la conversation (pour résoudre les références comme "ça"/"l'autre") :\n${lines.join('\n')}`;
}

/**
 * Build an `onHeard`-compatible `ReplyFn` that routes phatic → warm chitchat → grounded
 * agent, with short conversational memory. Applies the agent posture once (inside the
 * injected/default `agentReply`). Never-throws.
 */
export function makeHybridReply(options: HybridReplyOptions = {}): ReplyFn {
  const maxTurns = options.maxHistoryTurns ?? 6;
  const classify = options.classify ?? isSubstantiveQuery;
  const history: HybridTurn[] = [];

  let fastReply = options.fastReply;
  let chitchat = options.chitchat;
  let agentReply = options.agentReply;

  async function ensureDeps(): Promise<void> {
    if (fastReply && chitchat && agentReply) return;
    const vl = await import('./voice-loop.js');
    fastReply = fastReply ?? vl.fastCompanionReply;
    chitchat = chitchat ?? ((heard, hist, opts) => vl.defaultReply(heard, hist, opts));
    if (!agentReply) {
      const { makeAgentReply } = await import('./agent-reply.js');
      agentReply = makeAgentReply({
        permissionMode: options.permissionMode ?? 'plan',
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.ack ? { ack: options.ack } : {}),
      });
    }
  }

  function remember(user: string, assistant: string): void {
    if (!assistant.trim()) return;
    history.push({ role: 'user', content: user });
    history.push({ role: 'assistant', content: assistant });
    while (history.length > maxTurns * 2) history.shift();
  }

  return async (heard: string, replyOpts?: VoiceStepOptions): Promise<string> => {
    const signal = replyOpts?.signal;
    try {
      // Evolve Lisa's inner state by the emotional colour of what he just said (opt-in relational
      // layer). Env-gated BEFORE the dynamic import so the default path stays untouched; best-effort.
      if (process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
        try {
          const { detectRelationalSignal } = await import('../companion/reply-augment.js');
          const { loadRelationshipState, saveRelationshipState, evolveTraits } =
            await import('../companion/relationship-state.js');
          saveRelationshipState(
            evolveTraits(loadRelationshipState(), detectRelationalSignal(heard))
          );
        } catch {
          /* trait drift is optional — never block a reply */
        }
      }
      await ensureDeps();
      const fast = fastReply!(heard);
      if (fast) {
        remember(heard, fast);
        return fast;
      }
      // Instant precomputed answer for a common question (weather/news/agenda/date) — no LLM.
      const pre = (options.prefetch ?? defaultPrefetchMatch)(heard);
      if (pre) {
        remember(heard, pre);
        logger.info(`[voice-hybrid] prefetch → ${pre.slice(0, 60)}`);
        return pre;
      }
      // Instant joke on request — no LLM, no slow agent turn.
      const joke = (options.jokes ?? defaultJokeMatch)(heard);
      if (joke) {
        remember(heard, joke);
        logger.info(`[voice-hybrid] joke → ${joke.slice(0, 60)}`);
        return joke;
      }
      const substantive = classify(heard);
      const stepOpts = signal ? { signal } : undefined;
      let out = '';
      if (substantive) {
        const preamble = buildContextPreamble(history);
        const input = preamble ? `${preamble}\n\nDemande actuelle : ${heard}` : heard;
        out = (await agentReply!(input, stepOpts)).trim();
      } else {
        out = (await chitchat!(heard, history.slice(-maxTurns * 2), stepOpts)).trim();
      }
      remember(heard, out);
      logger.info(`[voice-hybrid] ${substantive ? 'agent' : 'chitchat'} → ${out.slice(0, 60)}`);
      return out;
    } catch (err) {
      logger.warn(`[voice-hybrid] failed: ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  };
}
