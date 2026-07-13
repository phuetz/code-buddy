/**
 * Agent reply — the "voice COMMAND" brain. Turns a spoken instruction into a REAL
 * agent turn that can investigate AND act (edit files, run commands), then condenses
 * the result into 1-2 spoken French sentences. This is the `replyFn` that upgrades the
 * sensory voice loop from a chatty companion into something you can *tell what to do*:
 *
 *   makeVoiceReply({ replyFn: makeAgentReply({ permissionMode }) })
 *
 * Safety is the crux (a misheard transcript could try to run a command), so the agent
 * turn runs under an EXPLICIT permission posture applied once via the SAME
 * `PermissionModeManager` the `ConfirmationService` already consults — no parallel gate:
 *
 *   - 'plan' (default)  : read-only — reads/search only, every write + non-trivial shell
 *                         is denied. The provably-safe hands-free tier.
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
import type { PermissionMode } from '../security/permission-modes.js';

/** Run a full agent turn for the transcript, return the assistant's final text.
 *  `opts.signal` (optional) lets a barge-in abort the turn's LLM calls. */
export type AgentRunner = (transcript: string, opts?: VoiceStepOptions) => Promise<string>;
/** Condense a (possibly long, markdown) agent answer into 1-2 spoken FR sentences.
 *  `opts.signal` (optional) lets a barge-in abort the summarizing LLM call. */
export type SummarizeFn = (agentOutput: string, transcript: string, opts?: VoiceStepOptions) => Promise<string>;

export interface AgentReplyOptions {
  /** Voice ACT posture, applied ONCE at construction. Default 'plan' (read-only, safe). */
  permissionMode?: PermissionMode;
  /** Working directory for the agent turn. Default process.cwd(). */
  cwd?: string;
  /** Injectable: run the full agent turn. Default builds a headless CodeBuddyAgent. */
  agentRunner?: AgentRunner;
  /** Injectable: condense the agent output for speech. Default: fast LLM + SPEAK prompt. */
  summarize?: SummarizeFn;
  /** Optional spoken acknowledgement played BEFORE the (slow) turn, e.g. "d'accord, je regarde…".
   *  Default: none (the ReplyFn contract returns one string; wire this where synth+play exist). */
  ack?: (transcript: string, opts?: VoiceStepOptions) => Promise<void>;
  /** Spoken when the turn fails (never-throws). Default: a short FR apology. */
  apology?: string;
}

const DEFAULT_APOLOGY = "Désolé, je n'ai pas réussi à traiter ta demande.";
const DEFAULT_DONE = "C'est fait.";
/** Read-only posture can't act, so empty output means "couldn't answer", NOT "did it silently". */
const DEFAULT_PLAN_NOANSWER = "Je n'ai pas réussi à vérifier ça, désolée.";

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

/** Default agent turn: a headless CodeBuddyAgent.
 *  Model: `CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL` if pinned, else the fastest TOOL-CALLING
 *  model. NOTE the trade-off: an agent turn reads/reasons/acts, so it wants CAPABILITY +
 *  context, not raw speed — the fastest tool-caller can be a tiny model whose context gets
 *  truncated and whose answers are wrong. For accurate commands, pin a capable local model
 *  (e.g. devstral-small-2:24b-instruct or qwen3.6:27b) via the env var. */
function makeDefaultAgentRunner(cwd: string): AgentRunner {
  return async (transcript: string): Promise<string> => {
    const { resolveVoiceModel } = await import('./voice-loop.js');
    const pinned = process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL;
    let route: { model: string; apiKey: string; baseURL?: string };
    if (pinned && isChatGptSubscriptionModel(pinned)) {
      // Fast + correct + $0: route the grounded turn to the ChatGPT OAuth / Codex Responses
      // backend (the same brain as the Telegram companion), NOT the slow local Ollama path.
      const { hasCodexCredentials } = await import('../providers/codex-oauth.js');
      const { CHATGPT_RESPONSES_BASE_URL } = await import('../codebuddy/client.js');
      if (hasCodexCredentials()) {
        route = { model: pinned, apiKey: 'oauth-chatgpt', baseURL: CHATGPT_RESPONSES_BASE_URL };
      } else {
        const fallback = await resolveVoiceModel(transcript);
        route = { model: fallback.model, apiKey: fallback.apiKey, baseURL: fallback.baseURL };
        logger.warn(
          `[voice-act] '${pinned}' is a ChatGPT model but no OAuth creds (~/.codebuddy/codex-auth.json) — ` +
            'run `buddy login`; falling back to the local route (likely wrong/slow).',
        );
      }
    } else if (pinned) {
      const fallback = await resolveVoiceModel(transcript);
      route = { model: pinned, apiKey: fallback.apiKey, baseURL: fallback.baseURL };
    } else {
      const { selectFastestModel } = await import('../fleet/model-selector.js');
      // The turn needs reliable tool calls; fall back to the fast reply route if none qualifies.
      const sel = await selectFastestModel(transcript, {
        requireToolCalling: true,
        localOnly: process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY === 'true',
      });
      if (sel) {
        route = { model: sel.model, apiKey: sel.apiKey ?? 'ollama', ...(sel.baseURL ? { baseURL: sel.baseURL } : {}) };
      } else {
        route = await resolveVoiceModel(transcript);
        logger.warn('[voice-act] no tool-calling model available — using the fast reply model (tool use may be unreliable)');
      }
    }
    logger.info(`[voice-act] agent turn on ${route.model}`);
    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(route.apiKey, route.baseURL, route.model, undefined, true, undefined, cwd);
    const entries = await agent.processUserMessage(transcript);
    // Last assistant message's text is the final answer.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e && e.type === 'assistant' && typeof e.content === 'string' && e.content.trim()) {
        return e.content.trim();
      }
    }
    return '';
  };
}

/** Default summarize: one fast-model pass turning the agent answer into spoken FR. */
function makeDefaultSummarize(): SummarizeFn {
  return async (agentOutput: string, transcript: string, opts?: VoiceStepOptions): Promise<string> => {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { resolveVoiceModel, SPEAK_SYSTEM_PROMPT } = await import('./voice-loop.js');
    const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
    const route = await resolveVoiceModel(transcript);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    // Inherit the active personality's spoken character (else the default companion prompt).
    const sys =
      ((await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT) +
      " On te donne ce que tu viens de faire ou de trouver en réponse à une demande parlée. " +
      "Résume le RÉSULTAT à voix haute, en une à deux phrases.";
    const resp = await client.chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: `Demande: ${transcript}\n\nRésultat:\n${agentOutput}` },
      ] as never,
      [],
      // Additive: barge-in aborts the summarizing call too. Undefined ⇒ unchanged.
      opts?.signal ? { signal: opts.signal } : undefined,
    );
    return (resp?.choices?.[0]?.message?.content ?? '').trim();
  };
}

/**
 * Build an `onHeard`-compatible `ReplyFn` that drives a full agent turn and returns a
 * spoken-length summary. Applies the permission posture ONCE here. Never-throws.
 */
export function makeAgentReply(options: AgentReplyOptions = {}): ReplyFn {
  const cwd = options.cwd ?? process.cwd();
  const mode: PermissionMode = options.permissionMode ?? 'plan';
  const agentRunner = options.agentRunner ?? makeDefaultAgentRunner(cwd);
  const summarize = options.summarize ?? makeDefaultSummarize();
  const apology = options.apology ?? DEFAULT_APOLOGY;
  let postureApplied = false;

  // Apply the posture before the FIRST turn (awaited, so it's set before any tool runs).
  // This mutates the process-global PermissionModeManager that ConfirmationService consults —
  // run the speaking actor in its own process so the posture can't leak into concurrent
  // interactive/HTTP sessions (see plan risks). Idempotent.
  async function ensurePosture(): Promise<void> {
    if (postureApplied) return;
    try {
      const { getPermissionModeManager } = await import('../security/permission-modes.js');
      getPermissionModeManager().setMode(mode);
      logger.info(`[voice-act] permission posture: ${mode}${mode === 'plan' ? ' (read-only)' : ' — CAN ACT'}`);
    } catch (err) {
      logger.warn(`[voice-act] could not set permission posture: ${msg(err)}`);
    }
    postureApplied = true;
  }

  return async (heard: string, replyOpts?: VoiceStepOptions): Promise<string> => {
    const signal = replyOpts?.signal;
    try {
      await ensurePosture();
      if (options.ack) {
        try {
          await options.ack(heard, replyOpts);
        } catch {
          /* ack is best-effort */
        }
      }
      const output = await agentRunner(heard, signal ? { signal } : undefined);
      // Interrupted (barge-in): abandon — the voice loop drops an aborted reply, so never
      // synthesize a stale answer or a misleading "C'est fait.".
      if (signal?.aborted) return '';
      // Empty output: in an acting posture it means "did it silently" → "C'est fait."; in read-only
      // 'plan' it can't have acted, so claiming success would be a lie → say it honestly.
      if (!output.trim()) return mode === 'plan' ? DEFAULT_PLAN_NOANSWER : DEFAULT_DONE;
      try {
        const spoken = (await summarize(output, heard, signal ? { signal } : undefined)).trim();
        if (spoken) return spoken;
      } catch (err) {
        logger.warn(`[voice-act] summarize failed: ${msg(err)}`);
      }
      // Summarize unavailable → speak a short truncation rather than a wall of markdown.
      const firstLine = output.split('\n').find((l) => l.trim()) ?? output;
      return firstLine.slice(0, 200);
    } catch (err) {
      logger.warn(`[voice-act] agent reply failed: ${msg(err)}`);
      return apology;
    }
  };
}
