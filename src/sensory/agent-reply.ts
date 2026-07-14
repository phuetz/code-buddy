/**
 * Agent reply — the "voice COMMAND" brain. Turns a spoken instruction into a REAL
 * agent turn that can investigate AND act (edit files, run commands), then returns
 * the result as 1-2 spoken French sentences. The agent is asked to produce that compact
 * result directly; a second summarizing LLM pass remains only as a compatibility fallback.
 * This is the `replyFn` that upgrades the
 * sensory voice loop from a chatty companion into something you can *tell what to do*:
 *
 *   makeVoiceReply({ replyFn: makeAgentReply({ permissionMode }) })
 *
 * Safety is the crux (a misheard transcript could try to run a command), so every agent
 * turn runs under an EXPLICIT, async-scoped permission posture via the SAME
 * `PermissionModeManager` the `ConfirmationService` already consults — no parallel gate
 * and no process-global mode leak into an interactive/Cowork session:
 *
 *   - 'default' (resident default): reads and policy-approved safe shell commands work;
 *                         writes and risky actions keep their normal confirmation gates.
 *   - 'plan'            : explicit read-only command session (for `buddy voice --mode plan`).
 *   - 'dontAsk'/'bypass': edits + shell execute (still behind the static command
 *                         validator + secret/deploy guard + kill switch). Opt-in, loud.
 *
 * Everything is INJECTABLE (agentRunner / summarize / ack) so it's deterministically
 * testable with no model. NEVER-THROWS: a failure becomes a short spoken apology, not a
 * crash. $0 when routed to a local model.
 *
 * @module sensory/agent-reply
 */

import { logger } from '../utils/logger.js';
import type { ReplyFn, VoiceStepOptions } from './voice-loop.js';
import { voiceDeliveryGuidance } from './voice-entrainment.js';
import type { PermissionMode } from '../security/permission-modes.js';
import { conversationFailureReply, prepareConversationTurn } from '../conversation/conversation-orchestrator.js';
import { conversationTokenBudget } from '../conversation/discourse-planner.js';
import {
  classifyLisaIntrospection,
  guardLisaOperationalSelfInspectionReply,
} from '../identity/lisa-introspection.js';

/** Run a full agent turn for the transcript, return the assistant's final text.
 *  `opts.signal` (optional) lets a barge-in abort the turn's LLM calls. */
export interface AgentRunner {
  (transcript: string, opts?: VoiceStepOptions): Promise<string>;
  /** Build or retarget a standby while the human is still speaking. */
  prewarm?: (transcriptHint?: string) => Promise<void>;
  /** Release an unused standby during server teardown. */
  dispose?: () => void;
}
/** Condense a (possibly long, markdown) agent answer into 1-2 spoken FR sentences.
 *  `opts.signal` (optional) lets a barge-in abort the summarizing LLM call. */
export type SummarizeFn = (agentOutput: string, transcript: string, opts?: VoiceStepOptions) => Promise<string>;

export interface AgentReplyOptions {
  /** Voice ACT posture, scoped to each turn. Default 'default' (normal guarded permissions). */
  permissionMode?: PermissionMode;
  /** Working directory for the agent turn. Default process.cwd(). */
  cwd?: string;
  /** Injectable: run the full agent turn. Default builds a headless CodeBuddyAgent. */
  agentRunner?: AgentRunner;
  /** Injectable: condense the agent output for speech. A generative custom
   *  summarizer must call `opts.onProviderResolved` so private review routing
   *  can stay on its exact provider. Default: fast LLM + SPEAK prompt. */
  summarize?: SummarizeFn;
  /** Optional spoken acknowledgement played while the slow turn starts in parallel,
   *  e.g. "d'accord, je regarde…". Default: none (the ReplyFn contract returns one string;
   *  wire this where synth+play exist). */
  ack?: (transcript: string, opts?: VoiceStepOptions) => Promise<void>;
  /** Spoken when the turn fails (never-throws). Default: a short FR apology. */
  apology?: string;
}

/** Reply function plus the predictive lifecycle used by the live VAD hook. */
export interface AgentReplyHandler extends ReplyFn {
  prewarm(transcriptHint?: string): Promise<void>;
  dispose(): void;
}

/** Narrow seam around CodeBuddyAgent, exported so abort propagation is testable
 * without constructing a real provider/MCP stack. */
export interface InterruptibleVoiceAgent {
  processUserMessageStream(
    message: string,
    options?: {
      transientContext?: string;
      relationshipSafety?: boolean;
      surface?: string;
      introspectionText?: string;
    },
  ): AsyncIterable<unknown>;
  getChatHistory(): Array<{ type?: string; content?: unknown }>;
  abortCurrentOperation(): void;
  suspendTranscriptSnapshots?(): void;
}

const DEFAULT_APOLOGY = "Désolé, je n'ai pas réussi à traiter ta demande.";
const DEFAULT_DONE = "C'est fait.";
/** A non-autonomous posture cannot imply success when the agent returned no result. */
const DEFAULT_PLAN_NOANSWER = "Je n'ai pas réussi à vérifier ça, désolée.";

/**
 * Appended to the grounded agent's SYSTEM prompt on every tool round. Keeping the
 * instruction at system level (rather than concatenating it to the transcript) both
 * preserves the user's exact request for the fallback summarizer and makes the final
 * agent response directly usable by TTS in the normal case.
 */
export const GROUNDED_VOICE_SYSTEM_PROMPT_APPEND = `<voice_response_contract>
Cette interaction se déroule à voix haute. Utilise les outils nécessaires, mais n'annonce pas ce que tu vas faire et ne raconte pas les appels d'outils avant ou pendant leur exécution.
Dans ta réponse finale uniquement, réponds en français avec des phrases complètes et un raisonnement cohérent. Adapte la longueur à la profondeur de la demande et suis le conversation_response_plan lorsqu'il est fourni.
Une salutation reste brève. Une réponse factuelle expose le résultat, sa raison et sa source. Une discussion philosophique ou un désaccord peut développer une position, ses raisons, une objection honnête, une concession et une synthèse.
N'utilise ni Markdown, ni bloc de code, ni code en ligne, ni liste.
</voice_response_contract>`;

function summaryMaxTokens(transcript: string, env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_VOICE_MAX_TOKENS);
  const base = Number.isFinite(configured) ? Math.floor(configured) : 48;
  return Math.max(96, Math.min(512, Math.max(base, conversationTokenBudget(transcript))));
}

/** Skip the second LLM call only when the grounded agent respected the voice contract. */
export function isAlreadySpeakableAgentResult(output: string): boolean {
  const text = output.trim();
  if (!text || /[\r\n]/.test(text)) return false;
  const words = text.split(/\s+/u);
  if (words.length > 220) return false;
  if (
    /```|`[^`]+`|^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s|!?(?:\[[^\]]*\])\([^)]+\)/im.test(text)
  ) {
    return false;
  }
  const sentences = text.match(/[.!?…]+(?:\s|$)/g)?.length ?? 0;
  return sentences >= 1 && sentences <= 10;
}

/**
 * Voice introspection must not pass through a second generative model: a
 * summarizer can erase evidence status or manufacture a consciousness claim.
 * Flatten the already-grounded answer deterministically and finish with the
 * non-subjective boundary every time.
 */
export function prepareSelfInspectionVoiceReply(
  output: string,
  request = '',
): string {
  const flattened = output
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  let body = flattened;

  const maxBodyChars = 900;
  if (body.length > maxBodyChars) {
    const candidate = body.slice(0, maxBodyChars + 1);
    const sentenceEnd = Math.max(
      candidate.lastIndexOf('. '),
      candidate.lastIndexOf('! '),
      candidate.lastIndexOf('? '),
      candidate.lastIndexOf('… '),
    );
    body = (sentenceEnd >= 240 ? candidate.slice(0, sentenceEnd + 1) : candidate.slice(0, maxBodyChars))
      .trim();
  }

  return guardLisaOperationalSelfInspectionReply(body, request)
    .replace(/\s+/g, ' ')
    .trim();
}

type SummaryPath = 'skipped' | 'fallback';

/** Latency-only telemetry: intentionally contains no transcript or model output. */
function logSpeechResultTiming(agentMs: number, summaryMs: number, summary: SummaryPath): void {
  logger.info(
    `[voice-act] result timing: agentMs=${agentMs}ms summaryMs=${summaryMs}ms summary=${summary}`
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Mirrors `isChatGptSubscriptionModel` in commands/llm-provider-resolution.ts (kept local to
 *  avoid sensory→commands coupling). A pinned voice agent model in this set routes to the fast,
 *  $0 ChatGPT OAuth / Codex Responses backend instead of the local Ollama endpoint. */
function isChatGptSubscriptionModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return (
    m === 'gpt-5.2' ||
    m === 'gpt-5.5' ||
    m.startsWith('gpt-5.5-') ||
    m.includes('-codex') ||
    m === 'codex-1' ||
    m.startsWith('codex-mini')
  );
}

type GroundedAgentRoute = { model: string; apiKey: string; baseURL?: string };
type PreparedVoiceAgent = {
  route: GroundedAgentRoute;
  agent: InterruptibleVoiceAgent & {
    systemPromptReady: Promise<void>;
    getMCPReady(): Promise<void>;
    dispose(options?: { skipSessionLearning?: boolean }): void;
  };
};

const VOICE_AGENT_PREWARM_UTTERANCE = "Vérifie l'état du système.";

function routeKey(route: GroundedAgentRoute): string {
  return `${route.model}\n${route.baseURL ?? ''}`;
}

async function resolveGroundedAgentRoute(transcript: string): Promise<GroundedAgentRoute> {
  const { resolveVoiceModel } = await import('./voice-loop.js');
  const pinned = process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL;
  if (pinned && isChatGptSubscriptionModel(pinned)) {
    // Fast + correct + $0: route the grounded turn to the ChatGPT OAuth / Codex Responses
    // backend (the same brain as the Telegram companion), NOT the slow local Ollama path.
    const { hasCodexCredentials } = await import('../providers/codex-oauth.js');
    const { CHATGPT_RESPONSES_BASE_URL } = await import('../codebuddy/client.js');
    if (hasCodexCredentials()) {
      return { model: pinned, apiKey: 'oauth-chatgpt', baseURL: CHATGPT_RESPONSES_BASE_URL };
    }
    const fallback = await resolveVoiceModel(transcript);
    logger.warn(
      `[voice-act] '${pinned}' is a ChatGPT model but no OAuth creds (~/.codebuddy/codex-auth.json) — ` +
        'run `buddy login`; falling back to the local route (likely wrong/slow).',
    );
    return { model: fallback.model, apiKey: fallback.apiKey, baseURL: fallback.baseURL };
  }
  if (pinned) {
    const fallback = await resolveVoiceModel(transcript);
    return { model: pinned, apiKey: fallback.apiKey, baseURL: fallback.baseURL };
  }

  const { selectFastestModel } = await import('../fleet/model-selector.js');
  const selected = await selectFastestModel(transcript, {
    requireToolCalling: true,
    localOnly: process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY === 'true',
  });
  if (selected) {
    return {
      model: selected.model,
      apiKey: selected.apiKey ?? 'ollama',
      ...(selected.baseURL ? { baseURL: selected.baseURL } : {}),
    };
  }
  const fallback = await resolveVoiceModel(transcript);
  logger.warn(
    '[voice-act] no tool-calling model available — using the fast reply model (tool use may be unreliable)'
  );
  return fallback;
}

/** Consume the agent's streaming path even though voice only needs the final
 * history entry. Unlike the sequential collector, this path owns an
 * AbortController, so an explicit barge-in cancels provider I/O for real. */
export async function runInterruptibleVoiceAgentTurn(
  agent: InterruptibleVoiceAgent,
  transcript: string,
  opts?: VoiceStepOptions,
): Promise<string> {
  const signal = opts?.signal;
  const abort = (): void => agent.abortCurrentOperation();
  if (signal?.aborted) return '';
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const transientContext = [
      prepareConversationTurn(transcript).systemGuidance,
      opts?.delivery ? voiceDeliveryGuidance(opts.delivery) : '',
    ].filter(Boolean).join('\n\n');
    for await (const _event of agent.processUserMessageStream(transcript, {
      transientContext,
      relationshipSafety: true,
      surface: 'voice',
      introspectionText: opts?.introspectionText ?? transcript,
    })) {
      if (signal?.aborted) abort();
    }
    if (signal?.aborted) return '';
    const entries = agent.getChatHistory();
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (
        entry?.type === 'assistant' &&
        typeof entry.content === 'string' &&
        entry.content.trim()
      ) {
        return entry.content.trim();
      }
    }
    return '';
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** Default agent turn: a headless CodeBuddyAgent.
 *  Model: `CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL` if pinned, else the fastest TOOL-CALLING
 *  model. NOTE the trade-off: an agent turn reads/reasons/acts, so it wants CAPABILITY +
 *  context, not raw speed — the fastest tool-caller can be a tiny model whose context gets
 *  truncated and whose answers are wrong. For accurate commands, pin a capable local model
 *  (e.g. devstral-small-2:24b-instruct or qwen3.6:27b) via the env var. */
function makeDefaultAgentRunner(cwd: string): AgentRunner {
  let standby: Promise<PreparedVoiceAgent> | null = null;
  let active = false;
  let disposed = false;

  const createPrepared = async (route: GroundedAgentRoute): Promise<PreparedVoiceAgent> => {
    const startedAt = Date.now();
    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(
      route.apiKey,
      route.baseURL,
      route.model,
      undefined,
      true,
      undefined,
      cwd,
      GROUNDED_VOICE_SYSTEM_PROMPT_APPEND
    );
    // This agent is a one-shot private draft producer. The accepted spoken
    // answer is journalled by the voice bridge later; its pre-audit transcript
    // must never reach periodic or session-end learning persistence.
    agent.suspendTranscriptSnapshots?.();
    try {
      await Promise.all([agent.systemPromptReady, agent.getMCPReady()]);
    } catch (error) {
      agent.dispose({ skipSessionLearning: true });
      throw error;
    }
    logger.info(
      `[voice-act] predictive ready: model=${route.model} readyMs=${Date.now() - startedAt}ms`
    );
    return { route, agent };
  };

  const runner: AgentRunner = async (
    transcript: string,
    opts?: VoiceStepOptions
  ): Promise<string> => {
    if (disposed || opts?.signal?.aborted) return '';
    active = true;
    const claimedStandby = standby;
    standby = null;
    let prepared: PreparedVoiceAgent | null = null;
    try {
      const desiredRoute = await resolveGroundedAgentRoute(transcript);
      if (claimedStandby) {
        try {
          prepared = await claimedStandby;
        } catch (error) {
          logger.debug('[voice-act] predictive standby unavailable', { error: msg(error) });
        }
      }
      if (prepared && routeKey(prepared.route) !== routeKey(desiredRoute)) {
        prepared.agent.dispose({ skipSessionLearning: true });
        prepared = null;
      }
      prepared ??= await createPrepared(desiredRoute);
      opts?.onProviderResolved?.(prepared.route);
      logger.info(`[voice-act] agent turn on ${prepared.route.model}`);
      return await runInterruptibleVoiceAgentTurn(prepared.agent, transcript, opts);
    } finally {
      // The MCP manager is process-global and stays warm, but everything owned
      // by this one-shot agent (watchers, listeners, abort controller, memory)
      // must be released even when the turn fails or is interrupted.
      prepared?.agent.dispose({ skipSessionLearning: true });
      active = false;
    }
  };

  runner.prewarm = async (transcriptHint?: string): Promise<void> => {
    if (disposed || active) return;
    const hint = transcriptHint?.trim() || VOICE_AGENT_PREWARM_UTTERANCE;
    const existing = standby;
    const desiredRoute = await resolveGroundedAgentRoute(hint);
    if (disposed || active) return;
    if (existing && standby === existing) {
      try {
        const prepared = await existing;
        if (disposed || active || standby !== existing) return;
        if (routeKey(prepared.route) === routeKey(desiredRoute)) return;
        standby = null;
        prepared.agent.dispose({ skipSessionLearning: true });
      } catch {
        if (standby === existing) standby = null;
      }
    } else if (standby) {
      return;
    }
    if (disposed || active || standby) return;
    const pending = createPrepared(desiredRoute);
    standby = pending;
    try {
      await pending;
    } catch (error) {
      if (standby === pending) standby = null;
      logger.debug('[voice-act] predictive preparation failed', { error: msg(error) });
    }
  };

  runner.dispose = (): void => {
    disposed = true;
    const pending = standby;
    standby = null;
    void pending
      ?.then((prepared) => prepared.agent.dispose({ skipSessionLearning: true }))
      .catch(() => undefined);
  };

  return runner;
}

/** Default summarize: one fast-model pass turning the agent answer into spoken FR. */
function makeDefaultSummarize(): SummarizeFn {
  return async (agentOutput: string, transcript: string, opts?: VoiceStepOptions): Promise<string> => {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { resolveVoiceModel, SPEAK_SYSTEM_PROMPT } = await import('./voice-loop.js');
    const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
    const route = await resolveVoiceModel(transcript, { forceFastLane: true });
    opts?.onProviderResolved?.(route);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    // Inherit the active personality's spoken character (else the default companion prompt).
    const sys =
      ((await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT) +
      " On te donne ce que tu viens de faire ou de trouver en réponse à une demande parlée. " +
      "Restitue le RÉSULTAT à voix haute en suivant ce plan, sans perdre les faits, les sources ni les nuances utiles.\n" +
      prepareConversationTurn(transcript).systemGuidance +
      (opts?.delivery ? `\n\n${voiceDeliveryGuidance(opts.delivery)}` : '');
    const resp = await client.chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: `Demande: ${transcript}\n\nRésultat:\n${agentOutput}` },
      ] as never,
      [],
      {
        temperature: 0.2,
        maxTokens: summaryMaxTokens(transcript),
        // Additive: barge-in aborts the summarizing call too.
        ...(opts?.signal ? { signal: opts.signal } : {}),
      },
    );
    return (resp?.choices?.[0]?.message?.content ?? '').trim();
  };
}

/**
 * Build an `onHeard`-compatible `ReplyFn` that drives a full agent turn and returns a
 * spoken-length summary. Applies scoped permission/workspace context per turn. Never-throws.
 */
export function makeAgentReply(options: AgentReplyOptions = {}): AgentReplyHandler {
  const cwd = options.cwd ?? process.cwd();
  const mode: PermissionMode = options.permissionMode ?? 'default';
  const agentRunner = options.agentRunner ?? makeDefaultAgentRunner(cwd);
  const summarize = options.summarize ?? makeDefaultSummarize();
  const apology = options.apology ?? DEFAULT_APOLOGY;

  /**
   * Voice is an embedded actor, not the owner of the process. Keep both the
   * permission posture and operating mode local to this async turn. This means
   * a previously selected `/plan` code session remains plan outside the voice
   * turn, while Lisa receives a normal balanced prompt and can run safe reads.
   */
  async function runInVoiceTurn<T>(fn: () => Promise<T>): Promise<T> {
    const [
      { getPermissionModeManager },
      { getOperatingModeManager },
      { getWorkspaceIsolation },
    ] = await Promise.all([
      import('../security/permission-modes.js'),
      import('../agent/operating-modes.js'),
      import('../workspace/workspace-isolation.js'),
    ]);
    return getWorkspaceIsolation().withWorkspaceRootAsync(cwd, () =>
      getOperatingModeManager().withModeAsync('balanced', () =>
        getPermissionModeManager().withModeAsync(mode, fn)
      )
    );
  }

  const reply = async (heard: string, replyOpts?: VoiceStepOptions): Promise<string> => {
    const signal = replyOpts?.signal;
    let agentMs = 0;
    let agentProvider: Parameters<NonNullable<VoiceStepOptions['onProviderResolved']>>[0] | undefined;
    const publishProvider = (
      route: Parameters<NonNullable<VoiceStepOptions['onProviderResolved']>>[0] | undefined,
    ): void => {
      if (route) replyOpts?.onProviderResolved?.(route);
    };
    try {
      // Start the useful work before playing the acknowledgement. The two promises are
      // observed together immediately: an early agent rejection therefore never becomes an
      // unhandled rejection while audio is still playing, and we still wait for the ack to end
      // before returning text (so the answer/apology cannot overlap it).
      const agentStartedAt = Date.now();
      const turnPromise = (async (): Promise<string> => {
        try {
          const agentOptions: VoiceStepOptions = {
            ...(replyOpts ?? {}),
            ...(replyOpts?.introspectionText !== undefined
              ? { introspectionText: replyOpts.introspectionText }
              : {}),
            onProviderResolved: (route) => {
              agentProvider = route;
            },
          };
          return await runInVoiceTurn(() =>
            agentRunner(heard, agentOptions)
          );
        } finally {
          agentMs = Date.now() - agentStartedAt;
        }
      })();
      const acknowledgementPromise = (async (): Promise<void> => {
        if (!options.ack) return;
        try {
          await options.ack(heard, replyOpts);
        } catch {
          /* ack is best-effort */
        }
      })();
      const [turnResult] = await Promise.allSettled([
        turnPromise,
        acknowledgementPromise,
      ] as const);
      // Interrupted (barge-in): abandon — the voice loop drops an aborted reply, so never
      // synthesize a stale answer or a misleading "C'est fait.".
      if (signal?.aborted) {
        logSpeechResultTiming(agentMs, 0, 'skipped');
        return '';
      }
      // The acknowledgement is deliberately best-effort, but must never hide an agent failure.
      if (turnResult.status === 'rejected') {
        logSpeechResultTiming(agentMs, 0, 'skipped');
        throw turnResult.reason;
      }
      const output = turnResult.value;
      // Empty output only implies success in an explicitly autonomous posture. In
      // default/plan modes it may mean a gate or model failure, so never claim an action.
      if (!output.trim()) {
        logSpeechResultTiming(agentMs, 0, 'skipped');
        publishProvider(agentProvider);
        return mode === 'dontAsk' || mode === 'bypassPermissions' || mode === 'acceptEdits'
          ? DEFAULT_DONE
          : DEFAULT_PLAN_NOANSWER;
      }
      const introspectionIntent = classifyLisaIntrospection(
        replyOpts?.introspectionText ?? heard,
      );
      if (introspectionIntent === 'describe' || introspectionIntent === 'inspect') {
        logSpeechResultTiming(agentMs, 0, 'skipped');
        publishProvider(agentProvider);
        return prepareSelfInspectionVoiceReply(
          output,
          replyOpts?.introspectionText ?? heard,
        );
      }
      if (isAlreadySpeakableAgentResult(output)) {
        logSpeechResultTiming(agentMs, 0, 'skipped');
        publishProvider(agentProvider);
        return output.trim();
      }
      const summaryStartedAt = Date.now();
      try {
        let summaryProvider: typeof agentProvider;
        const spoken = (await summarize(output, heard, {
          ...(replyOpts ?? {}),
          onProviderResolved: (route) => {
            summaryProvider = route;
          },
        })).trim();
        logSpeechResultTiming(agentMs, Date.now() - summaryStartedAt, 'fallback');
        if (spoken) {
          publishProvider(summaryProvider ?? (options.summarize ? undefined : agentProvider));
          return spoken;
        }
      } catch (err) {
        logSpeechResultTiming(agentMs, Date.now() - summaryStartedAt, 'fallback');
        logger.warn(`[voice-act] summarize failed: ${msg(err)}`);
      }
      // Summarize unavailable → speak a short truncation rather than a wall of markdown.
      const firstParagraph = output.split(/\n\s*\n/).find((line) => line.trim()) ?? output;
      publishProvider(agentProvider);
      return firstParagraph.replace(/\s+/g, ' ').slice(0, 1200);
    } catch (err) {
      logger.warn(`[voice-act] agent reply failed: ${msg(err)}`);
      return apology === DEFAULT_APOLOGY ? conversationFailureReply(heard) : apology;
    }
  };

  const handler = reply as AgentReplyHandler;
  handler.prewarm = async (transcriptHint?: string): Promise<void> => {
    if (agentRunner.prewarm) {
      await runInVoiceTurn(() => agentRunner.prewarm!(transcriptHint));
    }
  };
  handler.dispose = (): void => {
    agentRunner.dispose?.();
  };
  return handler;
}
