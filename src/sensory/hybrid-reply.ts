/**
 * Hybrid voice reply — the "les deux" brain. A pure ACT reply (`makeAgentReply`) turns
 * EVERY utterance into a full agent turn, so even "bonjour Lisa" pays a slow, characterless
 * agent round-trip. A pure chat reply (`defaultReply`) is warm and instant but ungrounded —
 * it can only guess at factual/technical questions.
 *
 * This composes the best of both, per utterance:
 *   1. phatic exact match (greeting, "ça va", "merci") → instant canned warm line
 *   2. small-talk / emotional → fast warm companion reply (persona voice, $0 local)
 *   3. an environment/current-data command → a grounded AGENT turn (reads files / searches,
 *      then condenses the verified result), under the configured permission posture
 *
 * Plus a short conversational MEMORY so follow-ups ("et l'autre fichier ?", "non, je
 * voulais dire X") have an antecedent — the #1 reason a stateless voice loop "doesn't
 * understand me".
 *
 * Everything is INJECTABLE (fastReply / chitchat / agentReply / classify) so it is
 * deterministically testable with no model. NEVER-THROWS: an accepted turn gets an
 * honest spoken recovery instead of disappearing into silence.
 *
 * @module sensory/hybrid-reply
 */

import { logger } from '../utils/logger.js';
import type { ReplyFn, StreamReplyFn, VoiceStepOptions } from './voice-loop.js';
import type { PermissionMode } from '../security/permission-modes.js';
import {
  intentKeyForQuery,
  loadPrefetchCache,
  runPrefetchCycle,
} from '../companion/prefetch-engine.js';
import { loadPrefetchItems } from '../companion/prefetch-config.js';
import { isJokeRequest, nextJoke } from '../companion/jokes.js';
import { resolveUserName } from '../companion/user-name.js';
import {
  conversationFailureReply,
  prepareConversationTurn,
} from '../conversation/conversation-orchestrator.js';
import {
  resolvePrefetchedTurnContext,
  resolvePrefetchedTurnContextForConversation,
  semanticReviewEvidenceFromPrefetch,
  shouldUsePrefetchedAnswerDirectly,
} from '../conversation/prefetched-turn-context.js';
import { assessConversationResponse } from '../conversation/conversation-quality.js';
import { guardRelationshipReply } from '../conversation/relationship-safety.js';
import { deriveArgumentObligations } from '../conversation/argument-obligations.js';
import {
  shouldRunSemanticResponseGate,
  type SemanticResponseGateResult,
} from '../conversation/semantic-response-gate.js';
import type { ConversationPlan } from '../conversation/types.js';
import { classifyLisaIntrospection } from '../identity/lisa-introspection.js';

export {
  classifyLisaIntrospection,
  isLisaIntrospectionRequest,
} from '../identity/lisa-introspection.js';
export type { LisaIntrospectionIntent } from '../identity/lisa-introspection.js';

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
 * agenda, date) — no LLM. Enabled by default; set CODEBUDDY_PREFETCH=false to
 * no fresh match. See companion/prefetch-engine.ts.
 */
function defaultPrefetchMatch(heard: string): string | null {
  if (process.env.CODEBUDDY_PREFETCH === 'false') return null;
  try {
    const items = loadPrefetchItems();
    const context = resolvePrefetchedTurnContext(heard, {
      cache: loadPrefetchCache(),
      items,
      allowStale: true,
    });
    // Stale-while-revalidate: answer immediately, refresh evidence in the background.
    if (context?.freshness === 'stale' || (!context && intentKeyForQuery(heard, items))) {
      void runPrefetchCycle().catch(() => undefined);
    }
    return context && shouldUsePrefetchedAnswerDirectly(heard, context)
      ? context.speech
      : null;
  } catch {
    return null;
  }
}

export interface HybridTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HybridSemanticReviewInput {
  request: string;
  draft: string;
  plan: ConversationPlan;
  history: readonly HybridTurn[];
  evidence?: string;
  mainProvider?: { apiKey: string; baseURL: string; model: string };
  signal?: AbortSignal;
}

export type HybridSemanticReviewer = (
  input: HybridSemanticReviewInput
) => Promise<SemanticResponseGateResult>;

export interface HybridReplyOptions {
  /** Permission posture for the grounded turn. Default 'default' (normal guarded permissions). */
  permissionMode?: PermissionMode;
  /** Working directory for the agent turn. Default process.cwd(). */
  cwd?: string;
  /** How many turns (user+assistant counted separately) of memory to keep. Default 6 (≈3 exchanges). */
  maxHistoryTurns?: number;
  /** Additional transport-independent turns, for voice ↔ Telegram/channel continuity. */
  sharedHistory?: () => HybridTurn[];
  /** Injectable: exact phatic matcher. Default `fastCompanionReply`. */
  fastReply?: (heard: string) => string | null;
  /** Injectable: warm small-talk reply. Default the persona-voiced companion LLM reply.
   *  `opts.signal` (optional) lets a barge-in abort the warm-reply LLM call. */
  chitchat?: (heard: string, history: HybridTurn[], opts?: VoiceStepOptions) => Promise<string>;
  /** Injectable streaming warm reply. When it yields, speech can start at the first sentence.
   *  Substantive/action turns deliberately stay on the grounded blocking path. */
  chitchatStream?: (
    heard: string,
    history: HybridTurn[],
    opts?: VoiceStepOptions
  ) => AsyncIterable<string>;
  /** Injectable: grounded agent turn → spoken summary. Default `makeAgentReply`. */
  agentReply?: ReplyFn;
  /** Injectable: true ⇒ route to the grounded agent; false ⇒ fast companion model.
   *  Default is latency-first `requiresGroundedAgentQuery`; set
   *  CODEBUDDY_VOICE_ROUTING_MODE=grounded for the older all-questions policy. */
  classify?: (heard: string, history?: HybridTurn[]) => boolean;
  /** Spoken filler played BEFORE a (slower) agent turn, e.g. "d'accord, je regarde…", so a real
   *  question isn't met with dead silence. Only used by the default agent path. */
  ack?: (heard: string, opts?: VoiceStepOptions) => Promise<void>;
  /** Injectable: instant precomputed answer for a common question (null ⇒ none).
   *  Default: the prefetch cache when CODEBUDDY_PREFETCH is on. */
  prefetch?: (heard: string) => string | null;
  /** Injectable: instant joke when asked (null ⇒ not a joke request). Default: jokes.ts. */
  jokes?: (heard: string) => string | null;
  /**
   * Independent semantic audit for developed/deliberative answers. The
   * accepted or revised response is returned before voice memory is updated.
   */
  semanticReview?: HybridSemanticReviewer;
  /** Resident-process cognitive context, acquired only after the actual LLM route is known. */
  acquireCognitiveContext?: VoiceStepOptions['acquireCognitiveContext'];
}

/** A normal ReplyFn with its matching streaming path attached for `makeVoiceReply`. */
export interface HybridReplyHandler extends ReplyFn {
  stream: StreamReplyFn;
  /** Prepare the grounded standby without classifying or answering audio. */
  prewarm(transcriptHint?: string): Promise<void>;
  /** Release any unused predictive standby. */
  dispose(): void;
}

function mergeEvidence(...blocks: Array<string | undefined>): string | undefined {
  const merged = blocks.map((block) => block?.trim()).filter(Boolean).join('\n\n');
  return merged ? merged.slice(0, 3_000) : undefined;
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
// Operations that need the machine, files, tools, or fresh external data rather
// than language-model world knowledge. This intentionally excludes ordinary
// requests such as "explique la photosynthèse" or "pourquoi le ciel est bleu".
const GROUNDED_ACTION =
  /\b(verifie|verifier|verifies|lance|lancer|corrige|corriger|montre|montrer|cherche|chercher|trouve|trouver|ouvre|ouvrir|lis|lire|analyse|analyser|teste|tester|redemarre|redemarrer|regarde|regarder|code|ecris|ecrire|compile|compiler|deploie|deployer|installe|installer|configure|configurer|liste|lister|affiche|afficher|envoie|envoyer|cree|creer|supprime|supprimer|ajoute|ajouter|modifie|modifier)\b/;
const CURRENT_OR_PRIVATE_DATA =
  /\b(aujourd hui|actuellement|en ce moment|dernier|derniere|dernieres|recent|recente|meteo|temperature|actualite|actualites|news|agenda|calendrier|rendez[- ]vous|email|emails|mail|mails|message|messages|prix|cours de|bourse|stock|heure est il|date sommes nous|president|premier ministre)\b/;
// Social / emotional small talk — stays a fast warm reply even if phrased as a question.
const SOCIAL =
  /\b(je t aime|je taime|tu m aimes|tu maimes|ca va|comment ca va|comment vas-tu|comment vas tu|tu vas bien|tu es la|content|contente|heureux|heureuse|fatigue|fatiguee|triste|pas le moral|stresse|anxieux|anxieuse|angoisse|je me sens|seul|seule|a bout|besoin de parler|compagnie|bonne nuit|bonjour|bonsoir|merci|coucou|salut|hello|tu me manques|je pense a toi|bisous|cherie|cheri|mon amour|je t embrasse|ma journee|ta journee)\b/;

/** True when the user asks Lisa to inspect her own code, runtime, or self-model. */
export function isTechnicalSelfInspectionRequest(raw: string): boolean {
  return classifyLisaIntrospection(raw) !== null;
}

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
  if (isTechnicalSelfInspectionRequest(raw)) return true;
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

/**
 * Latency-first gate for the real-time voice mode. Static knowledge and normal
 * conversation stay on the resident 3B streaming model; only work requiring
 * tools, repository state, private data, or current external facts pays for a
 * full grounded agent turn. This removes a multi-second agent round-trip from
 * everyday questions without weakening commands that actually touch the host.
 */
export function requiresGroundedAgentQuery(
  raw: string,
  history: HybridTurn[] = [],
): boolean {
  const t = norm(raw);
  if (!t) return false;
  if (isTechnicalSelfInspectionRequest(raw)) return true;
  if (SOCIAL.test(t) && !TECH.test(t) && !GROUNDED_ACTION.test(t)) return false;
  if (TECH.test(t)) return true;
  if (CURRENT_OR_PRIVATE_DATA.test(t)) return true;
  if (GROUNDED_ACTION.test(t)) return true;
  if (HELP_REQUEST.test(t) && /\b(debug|debog|erreur|probleme|projet|systeme)\b/.test(t)) {
    return true;
  }
  // Philosophical, ethical and identity questions need the same capable brain
  // as Telegram/Cowork, not the resident low-latency small-talk model. The
  // discourse planner also preserves this lane for elliptical follow-ups such
  // as "Continue" while allowing "fais court" and phatic turns to step down.
  return prepareConversationTurn(raw, history).plan.depth === 'deliberative';
}

function defaultVoiceClassifier(raw: string, history: HybridTurn[] = []): boolean {
  return (process.env.CODEBUDDY_VOICE_ROUTING_MODE ?? 'realtime').toLowerCase() === 'grounded'
    ? isSubstantiveQuery(raw)
    : requiresGroundedAgentQuery(raw, history);
}

/** Build a compact recent-context preamble (last 2 exchanges) for the agent/chitchat input. */
export function buildContextPreamble(history: HybridTurn[]): string {
  if (!history.length) return '';
  const recent = history.slice(-4);
  const lines = recent.map((t) => `${t.role === 'user' ? resolveUserName() : 'Toi'}: ${t.content}`);
  return `Contexte récent de la conversation (pour résoudre les références comme "ça"/"l'autre") :\n${lines.join('\n')}`;
}

/**
 * Build an `onHeard`-compatible `ReplyFn` that routes phatic → warm chitchat → grounded
 * agent, with short conversational memory. Applies the agent posture once (inside the
 * injected/default `agentReply`). Never-throws.
 */
export function makeHybridReply(options: HybridReplyOptions = {}): HybridReplyHandler {
  const maxTurns = options.maxHistoryTurns ?? 6;
  const classify = options.classify ?? defaultVoiceClassifier;
  const history: HybridTurn[] = [];

  let fastReply = options.fastReply;
  let chitchat = options.chitchat;
  let chitchatStream = options.chitchatStream;
  let agentReply = options.agentReply;
  let pendingShortcut: { heard: string; reply: string; expiresAt: number } | null = null;
  let dependencyPromise: Promise<void> | null = null;

  const reviewSemantics: HybridSemanticReviewer =
    options.semanticReview ??
    (async (input) => {
      const runtime = await import('../conversation/semantic-response-runtime.js');
      return runtime.reviewSemanticResponse(input);
    });

  function semanticReviewEnabled(): boolean {
    if (options.semanticReview) return true;
    const configured = process.env.CODEBUDDY_SEMANTIC_GATE?.trim().toLowerCase();
    if (configured && ['1', 'true', 'yes', 'on', 'enabled'].includes(configured)) return true;
    if (configured && ['0', 'false', 'no', 'off', 'disabled'].includes(configured)) return false;
    return process.env.NODE_ENV !== 'test';
  }

  function shouldReviewPlan(plan: ConversationPlan, request: string): boolean {
    return (
      semanticReviewEnabled() &&
      shouldRunSemanticResponseGate({ plan }) &&
      deriveArgumentObligations(plan, request).length > 0
    );
  }

  function conversationHistory(currentHeard?: string): HybridTurn[] {
    let shared: HybridTurn[] = [];
    try {
      shared = options.sharedHistory?.() ?? [];
    } catch {
      /* a transport bridge is optional; local memory remains available */
    }
    const sharedKeys = new Set(
      shared.map((turn) => `${turn.role}\u0000${norm(turn.content)}`)
    );
    const merged = [
      ...history.filter((turn) => !sharedKeys.has(`${turn.role}\u0000${norm(turn.content)}`)),
      ...shared,
    ].filter((turn) => turn.content.trim());
    if (currentHeard) {
      const latest = merged.at(-1);
      if (latest?.role === 'user' && norm(latest.content) === norm(currentHeard)) merged.pop();
    }
    return merged.slice(-maxTurns * 2);
  }

  async function ensureFastReply(): Promise<void> {
    if (fastReply) return;
    const vl = await import('./voice-loop.js');
    fastReply = vl.fastCompanionReply;
  }

  async function ensureDeps(needsStream = false): Promise<void> {
    if (fastReply && chitchat && agentReply && (!needsStream || chitchatStream)) return;
    dependencyPromise ??= (async () => {
      const vl = await import('./voice-loop.js');
      fastReply = fastReply ?? vl.fastCompanionReply;
      chitchat = chitchat ?? ((heard, hist, opts) => vl.defaultReply(heard, hist, opts));
      chitchatStream =
        chitchatStream ??
        ((heard, hist, opts) => vl.streamCompanionReply(heard, hist, opts));
      if (!agentReply) {
        const { makeAgentReply } = await import('./agent-reply.js');
        agentReply = makeAgentReply({
          permissionMode: options.permissionMode ?? 'default',
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.ack ? { ack: options.ack } : {}),
        });
      }
    })().finally(() => {
      dependencyPromise = null;
    });
    await dependencyPromise;
  }

  function remember(user: string, assistant: string): void {
    if (!assistant.trim()) return;
    history.push({ role: 'user', content: user });
    history.push({ role: 'assistant', content: assistant });
    while (history.length > maxTurns * 2) history.shift();
  }

  function shortcutFor(heard: string): string | null {
    const fast = fastReply!(heard);
    if (fast) return fast;
    const pre = (options.prefetch ?? defaultPrefetchMatch)(heard);
    if (pre) {
      logger.info(`[voice-hybrid] prefetch hit chars=${pre.length}`);
      return pre;
    }
    const joke = (options.jokes ?? defaultJokeMatch)(heard);
    if (joke) {
      logger.info(`[voice-hybrid] joke hit chars=${joke.length}`);
      return joke;
    }
    return null;
  }

  async function reviewBeforeDelivery(
    input: HybridSemanticReviewInput
  ): Promise<SemanticResponseGateResult | null> {
    if (!shouldReviewPlan(input.plan, input.request)) return null;
    try {
      const reviewed = await reviewSemantics(input);
      logger.info(
        `[voice-hybrid] semantic outcome=${reviewed.outcome} reason=${reviewed.reason} revisions=${reviewed.revisionAttempts}`
      );
      return reviewed;
    } catch (error) {
      // The semantic gate is an enhancement, not a new single point of
      // failure. Its default runtime is fail-open; injected implementations
      // receive the same protection.
      logger.warn(
        `[voice-hybrid] semantic review unavailable (${error instanceof Error ? error.name : 'unknown'})`
      );
      return null;
    }
  }

  function guardBeforeMemory(response: string): string {
    const guarded = guardRelationshipReply(response);
    if (guarded.intervened) {
      logger.warn(
        `[voice-hybrid] relationship safety intervened issues=${guarded.issues.join(',')}`
      );
    }
    return guarded.response.trim();
  }

  async function evolveRelationship(heard: string): Promise<void> {
    if (process.env.CODEBUDDY_COMPANION_RELATIONAL !== 'true') return;
    try {
      const [augmentation, relationship, relationalContext] = await Promise.all([
        import('../companion/reply-augment.js'),
        import('../companion/relationship-state.js'),
        import('../companion/relational-context.js'),
      ]);
      const { detectRelationalSignal } = augmentation;
      const { loadRelationshipState, saveRelationshipState, evolveTraits } = relationship;
      const signal = detectRelationalSignal(heard);
      saveRelationshipState(evolveTraits(loadRelationshipState(), signal));
      relationalContext.invalidateVoiceRelationalContext();
      if (signal !== 'neutral') {
        void relationalContext.prewarmVoiceRelationalContext().catch(() => undefined);
      }
    } catch {
      /* trait drift is optional — never block a reply */
    }
  }

  const reply = async (heard: string, replyOpts?: VoiceStepOptions): Promise<string> => {
    const signal = replyOpts?.signal;
    try {
      // Cache/phatic/joke answers do not need the companion LLM or grounded
      // agent. Resolve this small dependency first so a cold process preserves
      // the same instant route as a warm process.
      await ensureFastReply();
      const introspectionIntent = classifyLisaIntrospection(heard);
      const pending = pendingShortcut;
      pendingShortcut = null;
      // Identity/boundary canned lines ("qui es-tu ?", "es-tu consciente ?")
      // used to pre-empt technical introspection before the classifier ran. An
      // introspection request must reach live evidence instead of a static line.
      const shortcut = introspectionIntent
        ? null
        : pending?.heard === heard && pending.expiresAt >= Date.now()
          ? pending.reply
          : shortcutFor(heard);
      if (shortcut) {
        // Relationship evolution is best-effort and must not delay an answer
        // that was explicitly precomputed for immediate delivery.
        void evolveRelationship(heard);
        const safeShortcut = guardBeforeMemory(shortcut);
        remember(heard, safeShortcut);
        return safeShortcut;
      }
      await evolveRelationship(heard);
      await ensureDeps();
      const recentHistory = conversationHistory(heard);
      const substantive = introspectionIntent !== null || classify(heard, recentHistory);
      let responseMainProvider: HybridSemanticReviewInput['mainProvider'];
      let cognitiveEvidence: string | undefined;
      const stepOpts: VoiceStepOptions = {
        ...(replyOpts ?? {}),
        ...(options.acquireCognitiveContext
          ? { acquireCognitiveContext: options.acquireCognitiveContext }
          : {}),
        onProviderResolved: (route) => {
          replyOpts?.onProviderResolved?.(route);
          if (!route.baseURL) return;
          responseMainProvider = {
            apiKey: route.apiKey,
            baseURL: route.baseURL,
            model: route.model,
          };
        },
        onCognitiveContextResolved: (context) => {
          replyOpts?.onCognitiveContextResolved?.(context);
          cognitiveEvidence = context.evidence || undefined;
        },
      };
      let out = '';
      let freshEvidence: string | undefined;
      let prepared = prepareConversationTurn(heard, recentHistory);
      if (substantive) {
        const preamble = buildContextPreamble(recentHistory);
        const freshContext = process.env.CODEBUDDY_PREFETCH === 'false'
          ? null
          : resolvePrefetchedTurnContextForConversation(heard, recentHistory, {
              allowStale: true,
            });
        if (freshContext?.freshness === 'stale') {
          void runPrefetchCycle().catch(() => undefined);
        }
        freshEvidence = semanticReviewEvidenceFromPrefetch(freshContext);
        prepared = prepareConversationTurn(heard, recentHistory, {
          ...(freshContext ? { freshContext: freshContext.promptGuidance } : {}),
        });
        const input = [preamble, prepared.systemGuidance, `Demande actuelle : ${heard}`]
          .filter(Boolean)
          .join('\n\n');
        out = (await agentReply!(input, {
          ...(stepOpts ?? {}),
          // `input` deliberately carries recent history. Preserve the exact
          // current utterance separately so the agent cannot classify an old
          // introspection question as the intent of this turn.
          introspectionText: heard,
        })).trim();
      } else {
        out = (await chitchat!(heard, recentHistory, stepOpts)).trim();
      }
      if (!out && !signal?.aborted) out = conversationFailureReply(heard, recentHistory);
      if (out && !signal?.aborted) {
        out = guardBeforeMemory(out);
        const reviewEvidence = mergeEvidence(freshEvidence, cognitiveEvidence);
        const reviewed = await reviewBeforeDelivery({
          request: heard,
          draft: out,
          plan: prepared.plan,
          history: recentHistory,
          ...(reviewEvidence ? { evidence: reviewEvidence } : {}),
          ...(responseMainProvider ? { mainProvider: responseMainProvider } : {}),
          ...(signal ? { signal } : {}),
        });
        if (reviewed) out = guardBeforeMemory(reviewed.response.trim() || out);
      }
      if (signal?.aborted) return '';
      remember(heard, out);
      const quality = assessConversationResponse(heard, out, recentHistory);
      logger.info(
        `[voice-hybrid] route=${substantive ? 'agent' : 'chitchat'} responseChars=${out.length}`
      );
      logger.info(
        `[voice-hybrid] quality score=${quality.score.toFixed(2)} sentences=${quality.sentenceCount} reasoningLinks=${quality.reasoningLinkCount} issues=${quality.issues.join(',') || 'none'}`
      );
      return out;
    } catch (err) {
      logger.warn(`[voice-hybrid] failed: ${err instanceof Error ? err.message : String(err)}`);
      return signal?.aborted ? '' : conversationFailureReply(heard, conversationHistory(heard));
    }
  };

  reply.stream = async function* (
    heard: string,
    replyOpts?: VoiceStepOptions
  ): AsyncGenerator<string, void, unknown> {
    try {
      await ensureFastReply();
      const introspectionIntent = classifyLisaIntrospection(heard);

      // An instant answer is already complete text, but it still benefits from
      // the sentence pipeline: the first cached-news sentence reaches Pocket or
      // Voicebox immediately instead of synthesizing the entire bulletin first.
      // Keep a short-lived copy only for the immediate blocking fallback so a
      // stateful joke is never advanced twice when every audio path fails.
      const shortcut = introspectionIntent ? null : shortcutFor(heard);
      if (shortcut) {
        const safeShortcut = guardBeforeMemory(shortcut);
        pendingShortcut = { heard, reply: safeShortcut, expiresAt: Date.now() + 2_000 };
        yield safeShortcut;
        if (!replyOpts?.signal?.aborted) {
          void evolveRelationship(heard);
          remember(heard, safeShortcut);
        }
        return;
      }
      const recent = conversationHistory(heard);
      if (introspectionIntent !== null || classify(heard, recent)) return;

      await ensureDeps(true);
      const prepared = prepareConversationTurn(heard, recent);
      const semanticBuffer = shouldReviewPlan(prepared.plan, heard);
      let full = '';
      let responseMainProvider: HybridSemanticReviewInput['mainProvider'];
      let cognitiveEvidence: string | undefined;
      const streamOptions: VoiceStepOptions = {
        ...(replyOpts ?? {}),
        ...(options.acquireCognitiveContext
          ? { acquireCognitiveContext: options.acquireCognitiveContext }
          : {}),
        onProviderResolved: (route) => {
          replyOpts?.onProviderResolved?.(route);
          if (!route.baseURL) return;
          responseMainProvider = {
            apiKey: route.apiKey,
            baseURL: route.baseURL,
            model: route.model,
          };
        },
        onCognitiveContextResolved: (context) => {
          replyOpts?.onCognitiveContextResolved?.(context);
          cognitiveEvidence = context.evidence || undefined;
        },
      };
      for await (const delta of chitchatStream!(heard, recent, streamOptions)) {
        if (replyOpts?.signal?.aborted) return;
        if (typeof delta !== 'string' || delta.length === 0) continue;
        full += delta;
        // A candidate selected for semantic review must not leak partial text
        // before the accepted/revised answer is known. Brief/standard turns
        // retain their original first-token streaming path.
        if (!semanticBuffer) yield delta;
      }
      let completed = full.trim();
      if (completed) completed = guardBeforeMemory(completed);
      if (completed && semanticBuffer && !replyOpts?.signal?.aborted) {
        const reviewed = await reviewBeforeDelivery({
          request: heard,
          draft: completed,
          plan: prepared.plan,
          history: recent,
          ...(cognitiveEvidence ? { evidence: cognitiveEvidence } : {}),
          ...(responseMainProvider ? { mainProvider: responseMainProvider } : {}),
          ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
        });
        if (reviewed) {
          completed = guardBeforeMemory(reviewed.response.trim() || completed);
        }
        if (replyOpts?.signal?.aborted) return;
        yield completed;
      }
      if (completed && !replyOpts?.signal?.aborted) {
        await evolveRelationship(heard);
        remember(heard, completed);
        logger.info(`[voice-hybrid] route=chitchat-stream responseChars=${completed.length}`);
      }
    } catch (err) {
      logger.warn(
        `[voice-hybrid] stream failed: ${err instanceof Error ? err.message : String(err)}`
      );
      // Yielding nothing lets the voice loop retry through the blocking path.
    }
  };

  reply.prewarm = async (transcriptHint?: string): Promise<void> => {
    await ensureDeps();
    await (
      agentReply as ReplyFn & { prewarm?: (hint?: string) => Promise<void> }
    ).prewarm?.(transcriptHint);
  };
  reply.dispose = (): void => {
    (agentReply as ReplyFn & { dispose?: () => void } | undefined)?.dispose?.();
  };

  return reply;
}
