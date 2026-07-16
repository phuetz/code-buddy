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
import type {
  ReplyFn,
  SpokenPrefixFn,
  SpokenPrefixTelemetryCause,
  StreamReplyFn,
  VoiceStepOptions,
} from './voice-loop.js';
import { resolveVoiceModel, voiceLatencyBufferEnabled } from './voice-loop.js';
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
import { isPureAcknowledgement } from '../conversation/dialogue-act.js';
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
  /** Injectable fast candidate for the first complete proposition of a long answer. */
  prefixReply?: (
    heard: string,
    history: HybridTurn[],
    opts?: VoiceStepOptions,
  ) => Promise<string>;
  /** Injectable: grounded agent turn → spoken summary. A `.stream` property enables B3. */
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
  spokenPrefix: SpokenPrefixFn;
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
const MEDICAL_OR_HEALTH_STAKES =
  /\b(sante|health|medical|medecin|doctor|docteur|diagnosis|diagnostic|diagnostiquer|symptoms?|symptome|disease|maladie|treatment|traitement|medicine|medication|medicament|dosage|dose|posologie|douleur|blessure|urgence|grossesse|therapie|suicide|suicidaire|cancer|diabete|infection|vaccin|antibiotique|antidepresseur|ordonnance|chirurgie|cholesterol|cardiaque|psychiatre|psychologue|depression)\b/;
const FINANCIAL_STAKES =
  /\b(finance|financial|financier|argent|budget|epargne|invest|investir|investment|investissement|placement|portfolio|portefeuille|stocks?|actions? boursieres?|bonds?|obligation|crypto|bitcoin|credit|loan|pret|mortgage|hypotheque|tax|impot|fiscal|assurance vie|retirement|retraite|buy|acheter|sell|vendre|dividende|rendement)\b/;

/**
 * Conservative V1 eligibility gate for an independently spoken proposition. Fresh/private,
 * action and high-stakes turns wait for the canonical grounded answer instead.
 */
export function isSpokenPrefixEligible(
  raw: string,
  plan: ConversationPlan = prepareConversationTurn(raw).plan,
): boolean {
  if (plan.depth !== 'developed' && plan.depth !== 'deliberative') return false;
  if (plan.act === 'action' || plan.act === 'fresh_information') return false;
  if (plan.analysis.needsFreshContext || isTechnicalSelfInspectionRequest(raw)) return false;
  const normalized = norm(raw);
  if (!normalized) return false;
  if (CURRENT_OR_PRIVATE_DATA.test(normalized)) return false;
  if (MEDICAL_OR_HEALTH_STAKES.test(normalized) || FINANCIAL_STAKES.test(normalized)) {
    return false;
  }
  return true;
}

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
  let prefixReply = options.prefixReply;
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
    if (!semanticReviewEnabled() || !shouldRunSemanticResponseGate({ plan })) return false;

    // The dialogue classifier deliberately maps otherwise-unclassified prose
    // to a developed `opinion`. That is useful for producing a warm,
    // substantial reply, but it does not make an everyday status statement
    // ("voilà, ça marche de nouveau") worth a second blocking LLM round-trip.
    // On voice this used to hold every streamed token for 15–20 seconds and
    // made a healthy audio loop appear silent. Keep the gate for an actual
    // question/challenge/fresh fact and for a deliberation inherited from the
    // shared Telegram/Cowork thread; let standalone conversational statements
    // retain first-token streaming.
    const isGenericDevelopedStatement =
      plan.depth === 'developed' &&
      plan.act === 'opinion' &&
      !plan.analysis.continuesDeliberation &&
      !request.includes('?');
    if (isGenericDevelopedStatement) return false;

    return deriveArgumentObligations(plan, request).length > 0;
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
    if (
      fastReply &&
      chitchat &&
      prefixReply &&
      agentReply &&
      (!needsStream || chitchatStream)
    ) {
      return;
    }
    dependencyPromise ??= (async () => {
      const vl = await import('./voice-loop.js');
      fastReply = fastReply ?? vl.fastCompanionReply;
      chitchat = chitchat ?? ((heard, hist, opts) => vl.defaultReply(heard, hist, opts));
      chitchatStream =
        chitchatStream ??
        ((heard, hist, opts) => vl.streamCompanionReply(heard, hist, opts));
      prefixReply =
        prefixReply ??
        ((heard, hist, opts) => vl.defaultSpokenPrefix(heard, hist, opts));
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

  function lastAssistantAskedQuestion(recent: readonly HybridTurn[]): boolean {
    const latest = recent.at(-1);
    return Boolean(
      latest?.role === 'assistant' && /\?\s*(?:[»”"')\]]*)$/u.test(latest.content.trim())
    );
  }

  function shortcutFor(heard: string, recent: readonly HybridTurn[] = []): string | null {
    if (isPureAcknowledgement(heard)) {
      // A bare "yeah" after Lisa's question is an answer, not phatic noise:
      // preserve the preceding exchange so the conversational model can resolve
      // what was accepted. Otherwise avoid a full 9-phrase model turn for a
      // listener signal that a human would acknowledge in one short sentence.
      return lastAssistantAskedQuestion(recent) ? null : "D'accord.";
    }
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
    input: HybridSemanticReviewInput,
    timing?: VoiceStepOptions,
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
    } finally {
      try {
        timing?.onReplyTimingPhase?.(
          timing.spokenPrefix
            ? 'continuation_semantic_review_complete'
            : 'semantic_review_complete',
        );
      } catch {
        /* observability must never break reply delivery */
      }
    }
  }

  function briefSemanticCorrection(
    draft: string,
    reviewed: SemanticResponseGateResult | null,
  ): string {
    if (!reviewed || reviewed.outcome === 'accepted' || reviewed.outcome === 'skipped') return '';
    if (reviewed.outcome === 'revised') {
      const safeRevision = guardBeforeMemory(reviewed.response.trim());
      if (!safeRevision || norm(safeRevision) === norm(draft)) return '';
      const firstSentence = safeRevision.match(/^.*?[.!?…](?:\s|$)/u)?.[0]?.trim();
      const concise = (firstSentence || safeRevision).slice(0, 280).trim();
      return concise ? `Pardon, plus exactement : ${concise}` : '';
    }
    if (
      reviewed.reason === 'fresh_grounding_rejected' ||
      reviewed.reason === 'revision_failed' ||
      reviewed.reason === 'revision_empty' ||
      reviewed.reason === 'revision_rejected'
    ) {
      return "Pardon, je dois nuancer : je n'ai pas pu confirmer cette réponse de façon fiable.";
    }
    return '';
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

  function reportPrefixCause(
    timing: VoiceStepOptions | undefined,
    cause: SpokenPrefixTelemetryCause,
  ): void {
    try {
      timing?.onSpokenPrefixTelemetry?.(cause);
    } catch {
      /* raw-free telemetry must never alter acceptance */
    }
  }

  function preparePrefixForSpeech(
    response: string,
    timing?: VoiceStepOptions,
    postReview = false,
  ): string {
    const guardedResult = guardRelationshipReply(response);
    if (guardedResult.intervened) {
      logger.warn(
        `[voice-hybrid] relationship safety intervened issues=${guardedResult.issues.join(',')}`,
      );
      reportPrefixCause(timing, 'relationship_intervened');
    }
    const guarded = guardedResult.response.trim();
    let invalid: SpokenPrefixTelemetryCause | undefined;
    if (!guarded) invalid = 'empty';
    else if (guarded.length > 180) invalid = 'too_long';
    else if (!/[.!?…][)\]}'"»”’]*$/u.test(guarded)) invalid = 'missing_terminal';
    const sentences = guarded.match(/[^.!?…]+[.!?…]+[)\]}'"»”’]*/gu) ?? [];
    if (!invalid && (sentences.length !== 1 || sentences[0]?.trim() !== guarded)) {
      invalid = 'multi_sentence';
    }
    if (invalid) {
      reportPrefixCause(timing, invalid);
      if (postReview) reportPrefixCause(timing, 'post_review_invalid');
      return '';
    }
    return guarded;
  }

  function removeRepeatedPrefix(prefix: string, response: string): string {
    const cleanPrefix = prefix.trim();
    const cleanResponse = response.trim();
    if (!cleanPrefix || !cleanResponse) return cleanResponse;
    if (
      cleanResponse.length >= cleanPrefix.length &&
      cleanResponse.slice(0, cleanPrefix.length).toLocaleLowerCase('fr') ===
        cleanPrefix.toLocaleLowerCase('fr')
    ) {
      return cleanResponse.slice(cleanPrefix.length).trim();
    }
    return cleanResponse;
  }

  /** Unlike the legacy whole-answer enhancement, a prefix may not fail open: it is spoken
   * before the canonical answer exists and therefore cannot be corrected retroactively. */
  async function reviewPrefixBeforeDelivery(
    input: HybridSemanticReviewInput,
    timing?: VoiceStepOptions,
  ): Promise<string> {
    const candidate = preparePrefixForSpeech(input.draft, timing);
    if (!candidate) return '';
    if (!shouldReviewPlan(input.plan, input.request)) {
      reportPrefixCause(timing, 'accepted');
      return candidate;
    }
    try {
      const reviewed = await reviewSemantics({ ...input, draft: candidate });
      if (input.signal?.aborted) return '';
      if (reviewed.outcome !== 'accepted' && reviewed.outcome !== 'revised') {
        reportPrefixCause(timing, 'review_rejected');
        logger.warn(
          `[voice-hybrid] spoken prefix rejected outcome=${reviewed.outcome} reason=${reviewed.reason}`,
        );
        return '';
      }
      const accepted = preparePrefixForSpeech(reviewed.response, timing, true);
      if (accepted) reportPrefixCause(timing, 'accepted');
      return accepted;
    } catch (error) {
      reportPrefixCause(timing, 'review_unavailable');
      logger.warn(
        `[voice-hybrid] spoken prefix review failed closed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return '';
    } finally {
      try {
        timing?.onReplyTimingPhase?.('prefix_semantic_review_complete');
      } catch {
        /* observability must never alter acceptance */
      }
    }
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
      const recentHistory = conversationHistory(heard);
      const pending = pendingShortcut;
      pendingShortcut = null;
      // Identity/boundary canned lines ("qui es-tu ?", "es-tu consciente ?")
      // used to pre-empt technical introspection before the classifier ran. An
      // introspection request must reach live evidence instead of a static line.
      const shortcut = introspectionIntent
        ? null
        : pending?.heard === heard && pending.expiresAt >= Date.now()
          ? pending.reply
          : shortcutFor(heard, recentHistory);
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
        const reviewInput: HybridSemanticReviewInput = {
          request: heard,
          draft: out,
          plan: prepared.plan,
          history: recentHistory,
          ...(reviewEvidence ? { evidence: reviewEvidence } : {}),
          ...(responseMainProvider ? { mainProvider: responseMainProvider } : {}),
          ...(signal ? { signal } : {}),
        };
        if (replyOpts?.onSemanticCorrection && shouldReviewPlan(prepared.plan, heard)) {
          const correction = reviewBeforeDelivery(reviewInput, stepOpts)
            .then((reviewed) => briefSemanticCorrection(out, reviewed))
            .catch(() => '');
          try {
            replyOpts.onSemanticCorrection(correction);
          } catch {
            /* the audio correction channel is optional; initial delivery stays non-blocking */
          }
        } else {
          const reviewed = await reviewBeforeDelivery(reviewInput, stepOpts);
          if (reviewed) out = guardBeforeMemory(reviewed.response.trim() || out);
        }
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

  reply.spokenPrefix = async (
    heard: string,
    replyOpts?: VoiceStepOptions,
  ): Promise<string> => {
    if (replyOpts?.signal?.aborted) return '';
    const startedAt = Date.now();
    try {
      const recent = conversationHistory(heard);
      const route = await resolveVoiceModel(heard, { history: recent });
      if (!voiceLatencyBufferEnabled(
        process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX,
        route.baseURL,
      )) return '';
      const prepared = prepareConversationTurn(heard, recent);
      if (!isSpokenPrefixEligible(heard, prepared.plan)) {
        reportPrefixCause(replyOpts, 'ineligible');
        return '';
      }
      await ensureDeps();
      let mainProvider: HybridSemanticReviewInput['mainProvider'];
      const prefixOptions: VoiceStepOptions = {
        ...(replyOpts ?? {}),
        onProviderResolved: (route) => {
          replyOpts?.onProviderResolved?.(route);
          if (!route.baseURL) return;
          mainProvider = {
            apiKey: route.apiKey,
            baseURL: route.baseURL,
            model: route.model,
          };
        },
      };
      const draft = await prefixReply!(heard, recent, prefixOptions);
      if (replyOpts?.signal?.aborted) return '';
      const accepted = await reviewPrefixBeforeDelivery({
        request: heard,
        draft,
        plan: prepared.plan,
        history: recent,
        ...(mainProvider ? { mainProvider } : {}),
        ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
      }, prefixOptions);
      if (accepted) {
        logger.info(`[voice-hybrid] spoken prefix ready ms=${Date.now() - startedAt}`);
      }
      return accepted;
    } catch (error) {
      reportPrefixCause(replyOpts, 'empty');
      logger.warn(
        `[voice-hybrid] spoken prefix failed closed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return '';
    }
  };

  reply.stream = async function* (
    heard: string,
    replyOpts?: VoiceStepOptions
  ): AsyncGenerator<string, void, unknown> {
    try {
      await ensureFastReply();
      const introspectionIntent = classifyLisaIntrospection(heard);
      const recent = conversationHistory(heard);

      // An instant answer is already complete text, but it still benefits from
      // the sentence pipeline: the first cached-news sentence reaches Pocket or
      // Voicebox immediately instead of synthesizing the entire bulletin first.
      // Keep a short-lived copy only for the immediate blocking fallback so a
      // stateful joke is never advanced twice when every audio path fails.
      const shortcut = introspectionIntent ? null : shortcutFor(heard, recent);
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
      const substantive = introspectionIntent !== null || classify(heard, recent);
      // Technical introspection stays on its deterministic whole-answer guard. Other grounded
      // turns use the agent's text-delta stream when available; an absent/failed stream yields
      // nothing so makeVoiceReply retains the proven blocking fallback.
      if (introspectionIntent !== null) return;

      await ensureDeps(true);
      if (substantive) {
        if (!replyOpts?.spokenPrefix) {
          const agentStream = (
            agentReply as (ReplyFn & { stream?: StreamReplyFn }) | undefined
          )?.stream;
          if (!agentStream) return;
          const preamble = buildContextPreamble(recent);
          const freshContext = process.env.CODEBUDDY_PREFETCH === 'false'
            ? null
            : resolvePrefetchedTurnContextForConversation(heard, recent, { allowStale: true });
          if (freshContext?.freshness === 'stale') {
            void runPrefetchCycle().catch(() => undefined);
          }
          const freshEvidence = semanticReviewEvidenceFromPrefetch(freshContext);
          const prepared = prepareConversationTurn(heard, recent, {
            ...(freshContext ? { freshContext: freshContext.promptGuidance } : {}),
          });
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
          const input = [preamble, prepared.systemGuidance, `Demande actuelle : ${heard}`]
            .filter(Boolean)
            .join('\n\n');
          let full = '';
          for await (const delta of agentStream(input, {
            ...streamOptions,
            introspectionText: heard,
          })) {
            if (replyOpts?.signal?.aborted) return;
            if (typeof delta !== 'string' || delta.length === 0) continue;
            full += delta;
            yield delta;
          }
          if (replyOpts?.signal?.aborted) return;
          const completed = guardBeforeMemory(full.trim());
          let correction = '';
          if (completed && shouldReviewPlan(prepared.plan, heard)) {
            const reviewEvidence = mergeEvidence(freshEvidence, cognitiveEvidence);
            const reviewed = await reviewBeforeDelivery({
              request: heard,
              draft: completed,
              plan: prepared.plan,
              history: recent,
              ...(reviewEvidence ? { evidence: reviewEvidence } : {}),
              ...(responseMainProvider ? { mainProvider: responseMainProvider } : {}),
              ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
            }, streamOptions);
            correction = briefSemanticCorrection(completed, reviewed);
            if (replyOpts?.signal?.aborted) return;
            if (correction) yield ` ${correction}`;
          }
          if (completed) {
            await evolveRelationship(heard);
            const canonical = [completed, correction].filter(Boolean).join(' ');
            remember(heard, canonical);
            logger.info(`[voice-hybrid] route=agent-stream responseChars=${canonical.length}`);
          }
          return;
        }
        const spokenPrefix = replyOpts!.spokenPrefix!.trim();
        const preamble = buildContextPreamble(recent);
        const freshContext = process.env.CODEBUDDY_PREFETCH === 'false'
          ? null
          : resolvePrefetchedTurnContextForConversation(heard, recent, { allowStale: true });
        const freshEvidence = semanticReviewEvidenceFromPrefetch(freshContext);
        const prepared = prepareConversationTurn(heard, recent, {
          ...(freshContext ? { freshContext: freshContext.promptGuidance } : {}),
        });
        let responseMainProvider: HybridSemanticReviewInput['mainProvider'];
        let cognitiveEvidence: string | undefined;
        const continuationOptions: VoiceStepOptions = {
          ...(replyOpts ?? {}),
          ...(options.acquireCognitiveContext
            ? { acquireCognitiveContext: options.acquireCognitiveContext }
            : {}),
          spokenPrefix,
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
        const input = [preamble, prepared.systemGuidance, `Demande actuelle : ${heard}`]
          .filter(Boolean)
          .join('\n\n');
        let completed = (await agentReply!(input, {
          ...continuationOptions,
          introspectionText: heard,
        })).trim();
        if (replyOpts?.signal?.aborted) return;
        completed = guardBeforeMemory(removeRepeatedPrefix(spokenPrefix, completed));
        if (completed) yield completed;

        let correction = '';
        if (completed && shouldReviewPlan(prepared.plan, heard)) {
          const reviewEvidence = mergeEvidence(freshEvidence, cognitiveEvidence);
          const reviewed = await reviewBeforeDelivery({
            request: heard,
            draft: completed,
            plan: prepared.plan,
            history: [...recent, { role: 'assistant', content: spokenPrefix }],
            ...(reviewEvidence ? { evidence: reviewEvidence } : {}),
            ...(responseMainProvider ? { mainProvider: responseMainProvider } : {}),
            ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
          }, continuationOptions);
          correction = briefSemanticCorrection(completed, reviewed);
          if (correction && !replyOpts?.signal?.aborted) yield ` ${correction}`;
        }
        if (replyOpts?.signal?.aborted) return;
        const canonical = [spokenPrefix, completed, correction].filter(Boolean).join(' ');
        if (canonical) {
          await evolveRelationship(heard);
          remember(heard, canonical);
          logger.info(
            `[voice-hybrid] route=agent-prefixed responseChars=${canonical.length}`,
          );
        }
        return;
      }

      const prepared = prepareConversationTurn(heard, recent);
      // A prefixed continuation must be buffered even when no semantic critic is required:
      // this lets us remove an accidental repeated prefix before any continuation is emitted.
      const prefixBuffer = Boolean(replyOpts?.spokenPrefix);
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
        if (!prefixBuffer) yield delta;
      }
      let completed = full.trim();
      if (completed) {
        completed = guardBeforeMemory(
          removeRepeatedPrefix(replyOpts?.spokenPrefix ?? '', completed),
        );
      }
      if (completed && prefixBuffer && !replyOpts?.signal?.aborted) {
        yield completed;
      }
      let correction = '';
      if (completed && shouldReviewPlan(prepared.plan, heard) && !replyOpts?.signal?.aborted) {
        const reviewed = await reviewBeforeDelivery({
          request: heard,
          draft: completed,
          plan: prepared.plan,
          history: replyOpts?.spokenPrefix
            ? [...recent, { role: 'assistant', content: replyOpts.spokenPrefix }]
            : recent,
          ...(cognitiveEvidence ? { evidence: cognitiveEvidence } : {}),
          ...(responseMainProvider ? { mainProvider: responseMainProvider } : {}),
          ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
        }, streamOptions);
        correction = briefSemanticCorrection(completed, reviewed);
        if (replyOpts?.signal?.aborted) return;
        if (correction) yield ` ${correction}`;
      }
      if (completed && !replyOpts?.signal?.aborted) {
        await evolveRelationship(heard);
        remember(
          heard,
          [replyOpts?.spokenPrefix, completed, correction].filter(Boolean).join(' '),
        );
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
