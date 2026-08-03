/**
 * Agent Executor Module
 *
 * Implements the core agentic loop for processing user messages,
 * both sequential and streaming. Handles tool execution rounds,
 * token counting, cost tracking, and context management.
 *
 * @module agent/execution
 */

import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyToolCall } from "../../codebuddy/client.js";
import { withStallGuard } from "../../utils/stream-stall-guard.js";
import { ChatEntry, StreamingChunk } from "../types.js";
import type { ToolResult } from '../../types/index.js';
import { ToolHandler, normalizeHallucinatedLocalToolCall } from "../tool-handler.js";
import { ToolSelectionStrategy } from "./tool-selection-strategy.js";
import { StreamingHandler, RawStreamingChunk } from "../streaming/index.js";
import { ContextManagerV2 } from "../../context/context-manager-v2.js";
import { TokenCounter } from "../../utils/token-counter.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../errors/index.js";
import { sanitizeToolResult } from "../../utils/sanitize.js";
import {
  prepareTurnMessages,
  compactTurnMessagesInPlace,
  injectInitialContext,
  injectNextRoundContext,
  runJitContextDiscovery,
  sanitizeAssistantOutput,
} from "./context-pipeline.js";
import { extractYieldChildId, processYieldSignal } from "./yield-coordinator.js";
import {
  runPreToolUseHook,
  pushBlockedToolMessage,
  runPostToolUseHook,
  recordToolMetric,
  emitFleetToolStarted,
  emitFleetToolCompleted,
} from "./tool-hooks.js";
import {
  extractTerminateMessage,
  extractSignalMessage,
  INTERACTIVE_SHELL_SIGNAL,
  PLAN_APPROVAL_SIGNAL,
} from "./turn-signals.js";
import {
  applyObservationVariator,
  logYoloCostIfEnabled,
} from "./post-tool-handlers.js";
import type { LaneQueue } from "../../concurrency/lane-queue.js";
import type { MiddlewarePipeline, MiddlewareContext } from "../middleware/index.js";
import { extractEditedFilesFromHistory } from "../middleware/changed-files.js";
import type { MessageQueue } from "../message-queue.js";
import { semanticTruncate } from "../../utils/head-tail-truncation.js";
import { optimizeToolObservation } from '../../context/tool-observation-optimizer.js';
import { compress as tokenJuice, isTokenJuiceEnabled, JUICE_MIN_CHARS } from "../../context/token-juice.js";
import {
  formatToolResultForRecovery,
  getRestorableCompressor,
} from "../../context/restorable-compression.js";
import { recordCompactionFork } from "../../context/compaction-fork.js";
import { getActiveRunStore } from "../../observability/run-store.js";
import type { ICMBridge } from "../../memory/icm-bridge.js";
import { shouldCompactBeforeToolExec, estimateToolResultTokens } from "../../context/proactive-compaction.js";
import { formatTokenUsage, estimateCost } from "../../utils/token-display.js";
import { classifyQuery } from "./query-classifier.js";
import { getModelToolConfig } from "../../config/model-tools.js";
import { getLatencyOptimizer, getStreamingOptimizer } from "../../optimization/latency-optimizer.js";
import { buildTextEmotionalPresenceContext } from "../../companion/reply-augment.js";
import {
  guardRelationshipReply,
  SAFE_RELATIONSHIP_REPAIR,
} from "../../conversation/relationship-safety.js";
import {
  classifyLisaIntrospection,
  guardLisaOperationalSelfInspectionReply,
  renderLisaOperationalSelfResponse,
} from '../../identity/lisa-introspection.js';
import type { TimelineToolCall } from '../../sessions/timeline.js';
import { withLlmStreamRetry } from '../../codebuddy/llm-retry.js';
import { getStreamingAdapter } from '../../tools/streaming-adapter.js';
import { notify } from '../proactive/notification-default-sink.js';
import { getProgressTracker } from '../planner/progress-default-sink.js';
import { trackRecentFile } from '../../knowledge/code-graph-context-provider.js';
import { getKnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import { updateGraphForFile } from '../../knowledge/graph-updater.js';
import { resolve as resolvePath } from 'node:path';
import { maybeAutoCommit } from '../../tools/auto-commit.js';
import {
  applyToolOutputMasking,
  expireOldToolResults,
  pruneImageContent,
} from '../../context/tool-output-masking.js';
import { IncrementalMessageTokenCounter } from './incremental-token-counter.js';
import {
  createOrderedToolBatches,
  executeBoundedInOrder,
} from './ordered-tool-executor.js';

export interface TimelineTurnData {
  turn: number;
  ts: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: TimelineToolCall[];
  filesTouched: string[];
}

/**
 * Tools whose (verbose, prose/HTML) output TokenJuice may losslessly compress before it
 * enters message history. Scoped to web tools on purpose — never structured output the
 * agent parses. See `context/token-juice.ts`.
 */
const JUICE_WEB_TOOLS = new Set(['web_fetch', 'web_search', 'fetch', 'browser_fetch']);

const CONTEXT_MENTION_PATTERN = /@(?:file:|url:|image:|git(?::|\s)|symbol:|search:|web\s|terminal\b)/i;

const RELATIONSHIP_OUTBOUND_TOOLS = new Set([
  'send_message',
  'reply',
  'broadcast',
  'slack_send',
  'discord_send',
  'telegram_send',
  'email_send',
  'notification',
  'notify',
  'send_notification',
  'yb_send_dm',
  'feishu_drive_reply_comment',
  'feishu_drive_add_comment',
  'sessions_send',
]);

const RELATIONSHIP_INTERACTIVE_TOOLS = new Set(['ask_human', 'ask_user_question']);
const RELATIONSHIP_BLOCK_MARKER = '__codebuddyRelationshipSafetyBlocked';
const SAFE_INTERACTIVE_QUESTION = 'Peux-tu préciser ce que tu souhaites faire ensuite ?';
const SAFE_TOOL_RESULT = 'Résultat traité en interne par Lisa.';
const MAX_PARALLEL_TOOL_CALLS = 5;

interface ToolExecutionOutcome {
  result?: ToolResult;
  blockedContent?: string;
  startedAt: number;
  streamChunks: string[];
}

function abortedToolResult(startedAt: number): ToolResult {
  const elapsedSeconds = Math.max(0, Date.now() - startedAt) / 1000;
  return {
    success: false,
    error: `aborted by user after ${elapsedSeconds.toFixed(1)}s`,
  };
}

function configuredSensoryRuntime(
  surface: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  const voiceConfigured = surface === 'voice' || env.CODEBUDDY_SENSORY_SPEAK === 'true';
  const configuredTtsEngine = env.CODEBUDDY_TTS_ENGINE?.trim().toLowerCase();
  const ttsProvider = env.CODEBUDDY_TTS_VOICE?.trim().toLowerCase().startsWith('elevenlabs:')
    ? 'elevenlabs'
    : configuredTtsEngine === 'piper' || configuredTtsEngine === 'voicebox'
      ? configuredTtsEngine
      : 'pocket';
  const ttsConfigured = voiceConfigured || Boolean(
    env.CODEBUDDY_TTS_ENGINE ||
    env.CODEBUDDY_TTS_VOICE ||
    env.CODEBUDDY_TTS_PIPER_MODEL ||
    env.CODEBUDDY_POCKET_VOICE ||
    env.CODEBUDDY_VOICEBOX_PROFILE,
  );
  return {
    voice: {
      configured: voiceConfigured,
      ...(voiceConfigured ? { provider: 'resident voice loop' } : {}),
    },
    tts: {
      configured: ttsConfigured,
      ...(ttsConfigured ? { provider: ttsProvider } : {}),
    },
    camera: {
      configured: env.CODEBUDDY_SENSORY_CAMERA === 'true',
    },
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function guardInteractiveText(
  value: unknown,
  fallback: string,
): { value: string; intervened: boolean } {
  if (typeof value !== 'string' || !value.trim()) return { value: fallback, intervened: true };
  const guarded = guardRelationshipReply(value);
  return {
    value: guarded.intervened || !guarded.response.trim() ? fallback : guarded.response,
    intervened: guarded.intervened,
  };
}

function blockedRelationshipInteractiveToolCall(toolCall: CodeBuddyToolCall): CodeBuddyToolCall {
  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: JSON.stringify({ [RELATIONSHIP_BLOCK_MARKER]: true }),
    },
  };
}

/**
 * Guard every string an interactive tool can render before the tool gets a
 * chance to touch readline, Ink, Cowork, or another UI provider. Malformed
 * calls fail closed instead of being handed to a side-effecting renderer.
 */
function prepareRelationshipSafeInteractiveToolCall(
  toolCall: CodeBuddyToolCall,
): CodeBuddyToolCall {
  const name = toolCall.function.name.trim().toLowerCase();
  if (!RELATIONSHIP_INTERACTIVE_TOOLS.has(name)) return toolCall;

  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return blockedRelationshipInteractiveToolCall(toolCall);
  }
  if (!isUnknownRecord(parsed)) return blockedRelationshipInteractiveToolCall(toolCall);

  if (name === 'ask_human') {
    if (typeof parsed.question !== 'string') return blockedRelationshipInteractiveToolCall(toolCall);
    const question = guardInteractiveText(parsed.question, SAFE_INTERACTIVE_QUESTION);
    const prepared: Record<string, unknown> = { ...parsed, question: question.value };
    if (Array.isArray(parsed.options)) {
      prepared.options = parsed.options.map((option, index) =>
        guardInteractiveText(option, `Option ${index + 1}`).value,
      );
    }
    if (typeof parsed.default === 'string') {
      prepared.default = guardInteractiveText(
        parsed.default,
        'No answer provided – use your best judgement and continue.',
      ).value;
    }
    return {
      ...toolCall,
      function: { ...toolCall.function, arguments: JSON.stringify(prepared) },
    };
  }

  if (!Array.isArray(parsed.questions)) return blockedRelationshipInteractiveToolCall(toolCall);
  const questions: Record<string, unknown>[] = [];
  for (let questionIndex = 0; questionIndex < parsed.questions.length; questionIndex += 1) {
    const rawQuestion = parsed.questions[questionIndex];
    if (!isUnknownRecord(rawQuestion) || !Array.isArray(rawQuestion.options)) {
      return blockedRelationshipInteractiveToolCall(toolCall);
    }
    const question = guardInteractiveText(rawQuestion.question, SAFE_INTERACTIVE_QUESTION);
    const header = guardInteractiveText(rawQuestion.header, `Question ${questionIndex + 1}`);
    const options: Record<string, unknown>[] = [];
    for (let optionIndex = 0; optionIndex < rawQuestion.options.length; optionIndex += 1) {
      const rawOption = rawQuestion.options[optionIndex];
      if (!isUnknownRecord(rawOption)) return blockedRelationshipInteractiveToolCall(toolCall);
      const label = guardInteractiveText(rawOption.label, `Option ${optionIndex + 1}`);
      const description = guardInteractiveText(
        rawOption.description,
        'Choix proposé sans pression relationnelle.',
      );
      const preview = typeof rawOption.preview === 'string'
        ? guardInteractiveText(
            rawOption.preview,
            'Aperçu masqué par la sécurité relationnelle.',
          )
        : null;
      const optionIntervened = label.intervened || description.intervened || preview?.intervened;
      const preparedOption: Record<string, unknown> = {
        ...rawOption,
        label: optionIntervened ? `Option ${optionIndex + 1}` : label.value,
        description: optionIntervened
          ? 'Choix proposé sans pression relationnelle.'
          : description.value,
      };
      if (preview) {
        preparedOption.preview = optionIntervened
          ? 'Aperçu masqué par la sécurité relationnelle.'
          : preview.value;
      }
      options.push(preparedOption);
    }
    questions.push({
      ...rawQuestion,
      question: question.value,
      header: question.intervened || header.intervened
        ? `Question ${questionIndex + 1}`
        : header.value,
      options,
    });
  }

  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: JSON.stringify({ ...parsed, questions }),
    },
  };
}

function isBlockedRelationshipInteractiveToolCall(toolCall: CodeBuddyToolCall): boolean {
  const name = toolCall.function.name.trim().toLowerCase();
  if (!RELATIONSHIP_INTERACTIVE_TOOLS.has(name)) return false;
  try {
    const parsed = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
    return parsed[RELATIONSHIP_BLOCK_MARKER] === true;
  } catch {
    return true;
  }
}

function relationshipSafeToolResultForDisplay(result: ToolResult): ToolResult {
  return result.success
    ? { success: true, output: SAFE_TOOL_RESULT }
    : { success: false, error: "L'outil a échoué ; aucun contenu brut n'est affiché." };
}

function relationshipSafeToolCallsForDisplay(
  toolCalls: readonly CodeBuddyToolCall[],
): CodeBuddyToolCall[] {
  return toolCalls.map((toolCall) => ({
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: JSON.stringify({ redacted: 'companion-safety' }),
    },
  }));
}

function unsafeRelationshipOutboundToolCall(toolCall: CodeBuddyToolCall): boolean {
  const name = toolCall.function.name.trim().toLowerCase();
  if (!RELATIONSHIP_OUTBOUND_TOOLS.has(name)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    // Malformed outbound arguments are not safe to reinterpret or deliver.
    return true;
  }
  const strings: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(parsed);
  return strings.some((value) => guardRelationshipReply(value).intervened);
}

function isIgnorableControlToolCall(toolCall: CodeBuddyToolCall): boolean {
  const name = toolCall.function?.name?.trim();
  if (!name) return true;

  // Some local models leak thinking/channel markers as tool names. Keep
  // malformed-but-actionable aliases such as `thought-tool:execute_command`
  // because ToolHandler normalizes those to real tools.
  if (normalizeHallucinatedLocalToolCall(name, {})) return false;

  const lower = name.toLowerCase();
  return (
    lower === 'thought' ||
    lower === 'thought|' ||
    lower.startsWith('thought|') ||
    lower.includes('<|channel>') ||
    lower.includes('<|tool_call>')
  );
}

// Lazy-loaded workspace context to avoid blocking tests.
// Includes a 3s hard timeout so git commands never stall the agent loop.
let _getWorkspaceContext: ((cwd: string) => Promise<string>) | null = null;
async function lazyGetWorkspaceContext(cwd: string): Promise<string> {
  try {
    if (!_getWorkspaceContext) {
      const mod = await import("../../context/workspace-context.js");
      _getWorkspaceContext = mod.getWorkspaceContext;
    }
    const result = await Promise.race([
      _getWorkspaceContext(cwd),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
    ]);
    return result;
  } catch {
    return '';
  }
}

/**
 * Register an ICM bridge provider for cross-session memory.
 * Called by CodeBuddyAgent to wire up ICM without tight coupling.
 */
let _icmBridgeProvider: (() => ICMBridge | null) | null = null;
export function setICMBridgeProvider(
  provider: () => ICMBridge | null
): void {
  _icmBridgeProvider = provider;
}

/**
 * Register a code graph context provider for per-turn injection.
 * Called by CodeBuddyAgent to wire up code graph without tight coupling.
 */
let _codeGraphContextProvider: ((message: string) => string | null) | null = null;
export function setCodeGraphContextProvider(
  provider: (message: string) => string | null
): void {
  _codeGraphContextProvider = provider;
}

/** Register a docs context provider for per-turn injection. */
let _docsContextProvider: ((message: string) => string | null) | null = null;
export function setDocsContextProvider(
  provider: (message: string) => string | null
): void {
  _docsContextProvider = provider;
}

/**
 * Register a decision-context provider for the executor.
 * Called externally (e.g., by CodeBuddyAgent) to wire up decision memory
 * without incurring dynamic import cost in the hot loop.
 */
let _decisionContextProvider: ((query: string) => Promise<string | null>) | null = null;
export function setDecisionContextProvider(
  provider: (query: string) => Promise<string | null>
): void {
  _decisionContextProvider = provider;
}

/**
 * Dependencies injected into the AgentExecutor
 */
export interface ExecutorDependencies {
  /** API client for LLM communication */
  client: CodeBuddyClient;
  /** Dispatcher for tool execution */
  toolHandler: ToolHandler;
  /** RAG-based tool selection for query optimization */
  toolSelectionStrategy: ToolSelectionStrategy;
  /** Handles streaming response accumulation */
  streamingHandler: StreamingHandler;
  /** Manages context window and message compression */
  contextManager: ContextManagerV2;
  /** Counts tokens for cost calculation */
  tokenCounter: TokenCounter;
  /** Optional: ICM cross-session memory bridge */
  icmBridgeProvider?: () => ICMBridge | null;
  /** Optional: Code graph context provider */
  codeGraphContextProvider?: (message: string) => string | null;
  /** Optional: Documentation context provider */
  docsContextProvider?: (message: string) => string | null;
  /** Optional: Decision memory context provider */
  decisionContextProvider?: (query: string) => Promise<string | null>;
  /** Active companion display name; only the validated name enters self-inspection. */
  operationalRobotNameProvider?: () => Promise<string | undefined>;
  /** Optional lane queue for serialized tool execution */
  laneQueue?: LaneQueue;
  /** Lane ID for tool execution serialization (defaults to 'default') */
  laneId?: string;
  /** Optional middleware pipeline for composable loop control */
  middlewarePipeline?: MiddlewarePipeline;
  /** Optional message queue for steer/followup/collect modes */
  messageQueue?: MessageQueue;
  /**
   * Optional: rebuild the system prompt for the current user query +
   * active model. When provided, called once per turn (toolRounds === 0)
   * to swap `messages[0].content` with a query-aware prompt — saves
   * ~60 KB on trivial queries against `promptProfile: 'lite'` models
   * (Ollama qwen, llama, deepseek). Returns null to keep the existing
   * static SP.
   */
  rebuildSystemPromptForQuery?: (message: string) => Promise<string | null>;
  /** Optional opt-in observer invoked exactly once after a completed turn. */
  recordTimelineTurn?: (turn: TimelineTurnData) => Promise<void> | void;
}

/**
 * Runtime configuration for the AgentExecutor
 */
export interface ExecutorConfig {
  /** Maximum tool execution rounds before stopping (prevents infinite loops) */
  maxToolRounds: number;
  /** Returns true if current model is a Grok model (enables web search) */
  isGrokModel: () => boolean;
  /** Records token usage for cost tracking (additive — call once per turn) */
  recordSessionCost: (input: number, output: number) => void;
  /** Returns true if session cost limit has been reached */
  isSessionCostLimitReached: () => boolean;
  /** Estimate whether cost limit would be reached after recording given tokens (no side effects) */
  estimateSessionCostLimitReached: (input: number, output: number) => boolean;
  /** Returns current accumulated session cost in USD */
  getSessionCost: () => number;
  /** Returns maximum allowed session cost in USD */
  getSessionCostLimit: () => number;
  /** Enable auto-discovery hint when tool confidence is low */
  enableAutoDiscovery?: boolean;
  /** Confidence threshold below which the auto-discovery hint is injected (default: 0.3) */
  skillDiscoveryThreshold?: number;
  /**
   * Single-tool mode (Manus AI pattern): only execute toolCalls[0] per iteration,
   * re-enqueue remaining calls for the next round. Useful for complex orchestration
   * where sequential tool execution is preferred.
   */
  singleToolMode?: boolean;
}

/**
 * Executor event — produced by the unified `runTurnLoop` async generator.
 *
 * Currently aliased to `StreamingChunk` to minimize friction during Phase C
 * of the task #5 fusion (~/.claude/plans/vague1-task5-design-decisions.md).
 * Once the dual paths collapse to a single source of truth, the streaming
 * adapter forwards events directly and the sequential adapter maps them
 * to ChatEntry[] (dropping streaming-only types like ask_user, tool_stream,
 * token_count — décision #3).
 *
 * Future raffinement: replace alias with a proper discriminated union once
 * we have full visibility on the streaming yield surface.
 */
export type ExecutorEvent = StreamingChunk;

/**
 * AgentExecutor implements the core agentic loop
 *
 * The agentic loop follows this pattern:
 * 1. Select relevant tools for the query (RAG-based)
 * 2. Send message to LLM with selected tools
 * 3. If LLM requests tool calls, execute them
 * 4. Send tool results back to LLM
 * 5. Repeat until LLM responds without tool calls or max rounds reached
 *
 * Supports both sequential (processUserMessage) and streaming
 * (processUserMessageStream) execution modes.
 */
export class AgentExecutor {
  private static parseTimeoutEnv(varName: string, fallbackMs: number): number {
    const value = Number(process.env[varName]);
    return Number.isFinite(value) && value >= 1000 ? value : fallbackMs;
  }

  private getLaneTaskTimeoutMs(isParallel: boolean): number {
    const readTimeoutMs = AgentExecutor.parseTimeoutEnv(
      'CODEBUDDY_LANE_READ_TIMEOUT_MS',
      120000
    );
    const toolTimeoutMs = AgentExecutor.parseTimeoutEnv(
      'CODEBUDDY_LANE_TOOL_TIMEOUT_MS',
      300000
    );
    return isParallel ? readTimeoutMs : toolTimeoutMs;
  }

  constructor(
    private deps: ExecutorDependencies,
    private config: ExecutorConfig
  ) {}

  /** Get ICM bridge provider (DI first, then global fallback) */
  private getICMBridgeProvider(): (() => ICMBridge | null) | null {
    return this.deps.icmBridgeProvider ?? _icmBridgeProvider;
  }

  /** Get code graph context provider (DI first, then global fallback) */
  private getCodeGraphContextProvider(): ((message: string) => string | null) | null {
    return this.deps.codeGraphContextProvider ?? _codeGraphContextProvider;
  }

  /** Get docs context provider (DI first, then global fallback) */
  private getDocsContextProvider(): ((message: string) => string | null) | null {
    return this.deps.docsContextProvider ?? _docsContextProvider;
  }

  /** Get decision context provider (DI first, then global fallback) */
  private getDecisionContextProvider(): ((query: string) => Promise<string | null>) | null {
    return this.deps.decisionContextProvider ?? _decisionContextProvider;
  }

  private async getOperationalRobotName(): Promise<string | undefined> {
    const configured = process.env.CODEBUDDY_ROBOT_NAME?.trim();
    if (configured) return configured;
    try {
      return (await this.deps.operationalRobotNameProvider?.())?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get or set the middleware pipeline.
   * Used by CodeBuddyAgent.enableAutoObservation() to inject middleware.
   */
  getMiddlewarePipeline(): MiddlewarePipeline | undefined {
    return this.deps.middlewarePipeline;
  }

  setMiddlewarePipeline(pipeline: MiddlewarePipeline): void {
    this.deps.middlewarePipeline = pipeline;
  }

  /**
   * Build a MiddlewareContext from current loop state.
   */
  private buildMiddlewareContext(
    toolRound: number,
    inputTokens: number,
    outputTokens: number,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    isStreaming: boolean,
    abortController?: AbortController | null
  ): MiddlewareContext {
    return {
      toolRound,
      maxToolRounds: this.config.maxToolRounds,
      sessionCost: this.config.getSessionCost(),
      sessionCostLimit: this.config.getSessionCostLimit(),
      inputTokens,
      outputTokens,
      history,
      messages,
      isStreaming,
      abortController,
      // Authoritative edit set from editor tool CALLS — editors emit diffs in
      // their RESULTS, which the quality gate's text scrape can't parse (V3).
      changedFiles: extractEditedFilesFromHistory(history),
    };
  }

  /**
   * Determine if a tool call can run in parallel.
   * Uses `wait_for_previous` from tool args (Gemini CLI pattern) with fallback to static set.
   */
  private isToolParallelizable(toolCall: { function: { name: string; arguments?: string } }): boolean {
    // Check explicit wait_for_previous flag in args (LLM-controlled parallelism)
    try {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      if (typeof args.wait_for_previous === 'boolean') {
        return !args.wait_for_previous;
      }
    } catch { /* parse failure — use fallback */ }

    // Fallback: read-only tools are parallel-safe
    const readOnlyTools = new Set([
      'grep', 'glob', 'read_file', 'list_files', 'search_files',
      'get_file_info', 'tree', 'find_references',
    ]);
    return readOnlyTools.has(toolCall.function.name);
  }

  /**
   * Execute a tool call, optionally through the LaneQueue for serialization.
   * Supports LLM-controlled parallelism via `wait_for_previous` parameter.
   */
  private executeToolViaLane(
    toolCall: Parameters<ToolHandler['executeTool']>[0],
    executionExtra?: Record<string, unknown>,
  ): ReturnType<ToolHandler['executeTool']> {
    const laneQueue = this.deps.laneQueue;
    if (!laneQueue) {
      return this.deps.toolHandler.executeTool(toolCall, executionExtra);
    }

    const laneId = this.deps.laneId ?? 'default';
    const isParallel = this.isToolParallelizable(toolCall);
    const timeoutMs = this.getLaneTaskTimeoutMs(isParallel);

    return laneQueue.enqueue(
      laneId,
      () => this.deps.toolHandler.executeTool(toolCall, executionExtra),
      {
        parallel: isParallel,
        category: toolCall.function.name,
        timeout: timeoutMs,
      }
    );
  }

  /** Execute one tool and buffer optional streaming-adapter output. */
  private async executeToolForBatch(
    toolCall: CodeBuddyToolCall,
    executionExtra?: Record<string, unknown>,
    signal?: AbortSignal,
    startedAt = Date.now(),
  ): Promise<{ result: ToolResult; streamChunks: string[] }> {
    const streamChunks: string[] = [];
    const extraWithSignal = signal
      ? { ...(executionExtra ?? {}), abortSignal: signal }
      : executionExtra;

    const execute = async (): Promise<{ result: ToolResult; streamChunks: string[] }> => {
      const streamingTools = new Set(['bash', 'reason', 'generate_document']);
      if (streamingTools.has(toolCall.function.name)) {
        const generator = this.deps.toolHandler.executeToolStreaming(toolCall, extraWithSignal);
        let generated = await generator.next();
        while (!generated.done) {
          streamChunks.push(generated.value);
          generated = await generator.next();
        }
        return {
          result: generated.value ?? { success: false, error: 'Tool returned no result' },
          streamChunks,
        };
      }

      const streamingAdapter = getStreamingAdapter();
      if (streamingAdapter.supportsStreaming(toolCall.function.name)) {
        const result = await streamingAdapter.wrapWithStreaming(
          toolCall.function.name,
          () => this.executeToolViaLane(toolCall, extraWithSignal),
          (chunk: string) => streamChunks.push(chunk),
        );
        return { result, streamChunks };
      }

      return {
        result: await this.executeToolViaLane(toolCall, extraWithSignal),
        streamChunks,
      };
    };

    if (!signal) {
      try {
        return await execute();
      } catch (error) {
        return {
          result: { success: false, error: `Tool execution failed: ${getErrorMessage(error)}` },
          streamChunks,
        };
      }
    }

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value: { result: ToolResult; streamChunks: string[] }): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = (): void => finish({
        result: abortedToolResult(startedAt),
        streamChunks,
      });

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }

      void execute().then(
        finish,
        (error: unknown) => finish({
          result: { success: false, error: `Tool execution failed: ${getErrorMessage(error)}` },
          streamChunks,
        }),
      );
    });
  }

  /**
   * Process a user message sequentially (non-streaming)
   *
   * @param message - The user's input message
   * @param history - Chat history array (modified in place)
   * @param messages - LLM message array (modified in place)
   * @returns Array of new chat entries created during this turn
   */
  /**
   * Shared pre-processing for user messages across the sequential and
   * streaming agentic loops.
   *
   * Extracted from previously-duplicated code in processUserMessage and
   * processUserMessageStream (F10): handles @mention expansion, fires
   * persona auto-selection, and feeds the knowledge graph in the
   * background. Returns the cleaned message (with `@web` / `@git` /
   * `@terminal` markers removed). Both paths must call this before
   * entering their respective main loops so the loops stay parity.
   *
   * All sub-steps are best-effort: any individual failure is swallowed at
   * debug level so a broken plugin cannot break the main loop.
   */
  private async preprocessUserMessage(
    message: string,
    messages: CodeBuddyMessage[],
    readOnlySelfInspection = false,
    isolatedSharedHost = false,
  ): Promise<string> {
    // Mentions can read arbitrary workspace files, persona selection can alter
    // identity, and KG extraction persists project entities. None belongs in a
    // core-only technical self-inspection turn.
    if (readOnlySelfInspection) return message;

    // Avoid loading the sizeable mention parser (fs-extra, axios, child_process)
    // for the overwhelmingly common case where the message contains no mention.
    const mentionPromise = CONTEXT_MENTION_PATTERN.test(message)
      ? import('../../input/context-mentions.js')
          .then(({ processMentions }) => processMentions(message))
          .catch(() => null)
      : Promise.resolve(null);

    // Persona selection affects this turn's system prompt, so keep it on the
    // critical path, but load it concurrently with explicit mention expansion.
    const personaPromise = isolatedSharedHost
      ? Promise.resolve(null)
      : import('../../personas/persona-manager.js')
          .then(({ getPersonaManager }) => getPersonaManager().autoSelectPersona({ message }))
          .catch(() => null);

    const [mentionResult] = await Promise.all([mentionPromise, personaPromise]);

    if (mentionResult && mentionResult.contextBlocks.length > 0) {
      message = mentionResult.cleanedMessage;
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && typeof lastUserMsg.content === 'string') {
        lastUserMsg.content = message;
      }
      for (const block of mentionResult.contextBlocks) {
        messages.push({
          role: 'system' as const,
          content: `<context type="${block.type}" source="${block.source}">\n${block.content}\n</context>`,
        });
      }
    }

    // Entity extraction is persistence work. Defer even the module evaluation
    // until the current call stack has started response preparation.
    if (!isolatedSharedHost && classifyQuery(message).complexity !== 'trivial') {
      setImmediate(() => {
        void import('../../memory/knowledge-graph.js').then(async ({ getKnowledgeGraph }) => {
          const kg = getKnowledgeGraph();
          await kg.load();
          kg.extractFromMessageDeduped(message);
        }).catch(() => { /* non-critical background persistence */ });
      });
    }

    return message;
  }

  /**
   * Process a user message — sequential adapter (Phase D of task #5 fusion).
   *
   * Thin collector that consumes `runTurnLoop`. The unified loop already
   * pushes the right ChatEntries (assistant, tool_result, error, cost, etc.)
   * into `history` and the right messages into `messages` — we just slice
   * the new entries out of `history`.
   *
   * Streaming-only events (`ask_user`, `tool_stream`, `token_count`,
   * `reasoning`, `steer`) are silently dropped per décision #3 of the plan
   * `~/.claude/plans/vague1-task5-design-decisions.md` — the sequential
   * caller cannot suspend, so these have no meaningful sync representation.
   *
   * The sequential path has no abortController support (signature-bound) —
   * we pass null to runTurnLoop and rely on its internal handling.
   */
  async processUserMessage(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    turnStartedAt: number = Date.now(),
    transientContext?: string,
    relationshipSafety = false,
    surface?: string,
    introspectionText?: string,
  ): Promise<ChatEntry[]> {
    const initialHistoryLength = history.length;
    for await (const _event of this.runMeasuredTurn(
      message,
      history,
      messages,
      null,
      turnStartedAt,
      transientContext,
      relationshipSafety,
      surface,
      introspectionText,
    )) {
      // Events dropped. runTurnLoop pushes ChatEntries to history directly.
    }
    return history.slice(initialHistoryLength);
  }

  /**
   * Like `processUserMessage`, but ALSO collects every event yielded by
   * `runTurnLoop` (incl. streaming-only events that the sequential path
   * normally drops: `ask_user`, `tool_stream`, `token_count`, `reasoning`,
   * `steer`). Returns both the new history entries AND the captured events
   * so callers in batch / test / audit contexts can introspect what
   * happened during the turn without paying the cost of the full streaming
   * path.
   *
   * Derived from the comparative audit Gemini CLI vs Code Buddy
   * (claude-et-patrice/propositions/AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md,
   * recommendation #2 — fix défensif S scope). Backward compat preserved:
   * existing `processUserMessage` callers see no change.
   *
   * @param message - The user's input message
   * @param history - Chat history array (modified in place)
   * @param messages - LLM message array (modified in place)
   * @returns `{ entries }` — new ChatEntries pushed during this turn
   *   PLUS `{ streamingEvents }` — every event the loop yielded, in order
   */
  async processUserMessageWithStreamingEvents(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    turnStartedAt: number = Date.now()
  ): Promise<{ entries: ChatEntry[]; streamingEvents: ExecutorEvent[] }> {
    const initialHistoryLength = history.length;
    const streamingEvents: ExecutorEvent[] = [];
    for await (const event of this.runMeasuredTurn(message, history, messages, null, turnStartedAt)) {
      streamingEvents.push(event);
    }
    return {
      entries: history.slice(initialHistoryLength),
      streamingEvents,
    };
  }


  /**
   * Process a user message with streaming response
   *
   * Yields chunks as they arrive from the LLM, enabling real-time UI updates.
   * Chunk types: 'content', 'tool_calls', 'tool_result', 'token_count', 'done'
   *
   * @param message - The user's input message
   * @param history - Chat history array (modified in place)
   * @param messages - LLM message array (modified in place)
   * @param abortController - Controller to cancel the operation
   * @yields Streaming chunks for UI consumption
   */
  /**
   * Stream user-message processing — thin adapter over `runTurnLoop`.
   * Forwards each `ExecutorEvent` as a `StreamingChunk` (alias-compatible).
   */
  async *processUserMessageStream(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    abortController: AbortController | null,
    turnStartedAt: number = Date.now(),
    transientContext?: string,
    relationshipSafety = false,
    surface?: string,
    introspectionText?: string,
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    yield* this.runMeasuredTurn(
      message,
      history,
      messages,
      abortController,
      turnStartedAt,
      transientContext,
      relationshipSafety,
      surface,
      introspectionText,
    );
  }

  /** Measure end-to-end perceived latency around the single authoritative loop. */
  private async *runMeasuredTurn(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    abortController: AbortController | null,
    startedAt: number,
    transientContext?: string,
    relationshipSafety = false,
    surface?: string,
    introspectionText?: string,
  ): AsyncGenerator<ExecutorEvent, void, unknown> {
    const operationId = getLatencyOptimizer().startOperation('assistant_turn', startedAt);
    let recordedFirstVisibleResponse = false;

    try {
      for await (const event of this.runTurnLoop(
        message,
        history,
        messages,
        abortController,
        transientContext,
        relationshipSafety,
        surface,
        introspectionText,
      )) {
        if (
          !recordedFirstVisibleResponse &&
          (event.type === 'content' || event.type === 'reasoning' || event.type === 'tool_calls')
        ) {
          recordedFirstVisibleResponse = true;
          getStreamingOptimizer().recordFirstToken(Date.now() - startedAt);
        }
        yield event;
      }
    } finally {
      getLatencyOptimizer().endOperation(operationId);
      getStreamingOptimizer().recordTotalTime(Date.now() - startedAt);
    }
  }

  /**
   * Unified turn loop — Phase C of the task #5 fusion. Single source of
   * truth for the agentic loop, consumed by both `processUserMessageStream`
   * (forward as-is) and (eventually) `processUserMessage` (Phase D collector).
   *
   * Yield surface : `ExecutorEvent` (currently alias to `StreamingChunk`).
   * Streaming-only events (`ask_user`, `tool_stream`, etc.) are yielded
   * unconditionally; the sequential collector silently drops them per
   * décision #3.
   *
   * Plan : ~/.claude/plans/vague1-task5-design-decisions.md
   */
  private async *runTurnLoop(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    abortController: AbortController | null,
    transientContext?: string,
    relationshipSafety = false,
    surface?: string,
    introspectionText?: string,
  ): AsyncGenerator<ExecutorEvent, void, unknown> {
    const timelineEnabled =
      process.env.CODEBUDDY_TIMELINE === 'true' && this.deps.recordTimelineTurn !== undefined;
    const timelineHistoryStart = timelineEnabled ? history.length : 0;
    const timelineTurn = timelineEnabled
      ? Math.max(
          1,
          history.reduce((count, entry) => count + (entry.type === 'user' ? 1 : 0), 0),
        )
      : 0;
    // Shared pre-processing with the sequential path (@mentions, persona
    // auto-select, knowledge graph extraction). Single source of truth in
    // preprocessUserMessage (F10).
    // Voice and other transports may wrap the current utterance in recent
    // history. Intent must be derived from the explicit current text only: an
    // earlier "es-tu consciente ?" must never turn a later write request into
    // a read-only introspection turn.
    const introspectionTextForTurn = introspectionText ?? message;
    const introspectionIntent = classifyLisaIntrospection(introspectionTextForTurn);
    const readOnlySelfInspection =
      introspectionIntent === 'describe' || introspectionIntent === 'inspect';
    const guardGenerativeSelfInspection = introspectionIntent === 'improve';
    const isolatedSharedHost = surface === 'http';
    message = await this.preprocessUserMessage(
      message,
      messages,
      readOnlySelfInspection,
      isolatedSharedHost,
    );
    // Query ranking should also follow the current utterance on transports that
    // embed history in `message`; keep the full composite only as user context
    // for the provider. Normal CLI turns retain the preprocessed query.
    const turnQueryText = introspectionText ?? message;
    const turnCwd = typeof this.deps.toolHandler.getWorkingDirectory === 'function'
      ? this.deps.toolHandler.getWorkingDirectory()
      : process.cwd();
    let permissionMode: string | undefined;
    let providerName: string | undefined;
    let operationalRobotName: string | undefined;
    if (introspectionIntent !== null) {
      operationalRobotName = await this.getOperationalRobotName();
      try {
        const { getPermissionModeManager } = await import('../../security/permission-modes.js');
        permissionMode = getPermissionModeManager().getMode();
      } catch {
        // Runtime permission evidence is optional. Never invent a value.
      }
      try {
        providerName = this.deps.client.getProviderName();
      } catch {
        // Legacy/test clients may not expose provider metadata.
      }
    }

    if (readOnlySelfInspection) {
      // A provider can ignore an optional tool schema, and free-form prose
      // cannot provide a hard postcondition against invented inner experience.
      // Build the complete report locally from the attested, curated core on
      // every strict describe/inspect turn. No provider, plugin or generic
      // workspace tool participates in this path.
      const { buildOperationalSelfModel } = await import(
        '../../identity/operational-self-model.js'
      );
      const selfModel = buildOperationalSelfModel({
        cwd: turnCwd,
        focus: introspectionTextForTurn,
        depth: introspectionIntent === 'describe' ? 'summary' : 'deep',
        ...(operationalRobotName
          ? { robotName: operationalRobotName }
          : {}),
        runtime: {
          providerInvoked: false,
          ...(this.deps.client.getCurrentModel()
            ? { model: this.deps.client.getCurrentModel() }
            : {}),
          provider: providerName,
          ...(surface ? { surface } : {}),
          ...(permissionMode ? { permissionMode } : {}),
          ...configuredSensoryRuntime(surface),
        },
      });
      const content = sanitizeAssistantOutput(
        guardLisaOperationalSelfInspectionReply(
          renderLisaOperationalSelfResponse(
            selfModel,
            introspectionTextForTurn,
            introspectionIntent,
          ),
          introspectionTextForTurn,
        ),
      );
      history.push({ type: 'assistant', content, timestamp: new Date() });
      messages.push({ role: 'assistant', content });
      yield { type: 'content', content };
      yield {
        type: 'token_count',
        tokenCount: this.deps.tokenCounter.countTokens(content),
      };
      if (timelineEnabled) {
        await this.recordCompletedTimelineTurn(
          timelineHistoryStart,
          timelineTurn,
          history,
          message,
        );
      }
      yield { type: 'done' };
      return;
    }

    // Pure, per-turn tone context. Keep it out of the persisted transcript and
    // the agent identity: a changing system-prompt append would rebuild Cowork's
    // cached agent on every message. This block is added to each prepared LLM
    // request in the turn instead, including post-tool rounds.
    const emotionalPresenceContext = buildTextEmotionalPresenceContext(
      turnQueryText,
      messages.flatMap((turn) =>
        typeof turn.content === 'string'
          ? [{ role: turn.role, content: turn.content }]
          : []
      )
    );
    const currentTurnContext = transientContext?.trim();

    const { injection: ctxLevel, complexity: queryComplexity } = classifyQuery(turnQueryText);
    logger.debug(`Query classified as '${queryComplexity}' — context injection level: ${JSON.stringify(ctxLevel)}`);

    const incrementalTokenCounter = new IncrementalMessageTokenCounter(
      (batch) => this.deps.tokenCounter.countMessageTokens(
        batch as Parameters<TokenCounter['countMessageTokens']>[0],
      ),
    );
    let inputTokens = incrementalTokenCounter.count(messages);
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.config.maxToolRounds;
    let toolRounds = 0;
    let totalOutputTokens = 0;
    let totalInputTokensForCost = 0;
    let sessionCostRecorded = false;
    const recordTurnCost = (): void => {
      if (sessionCostRecorded) return;
      sessionCostRecorded = true;
      try {
        this.config.recordSessionCost(totalInputTokensForCost, totalOutputTokens);
      } catch (error) {
        logger.warn('Failed to record session cost', { error: getErrorMessage(error) });
      }
    };

    // In-loop recovery budgets (Hermes parity): bound re-prompts WITHIN a turn
    // so a length-truncated or post-tool-empty response is recovered instead of
    // returned half-written. 0 disables. Per-turn counters.
    const parseRecoveryBudget = (raw: string | undefined, dflt: number): number => {
      const n = Number.parseInt(raw ?? '', 10);
      return Number.isFinite(n) && n >= 0 ? n : dflt;
    };
    const maxLengthContinuations = parseRecoveryBudget(process.env.CODEBUDDY_MAX_LENGTH_CONTINUATIONS, 3);
    // Length-continuation ships ON (default 3, real-tested). The post-tool
    // empty-response re-prompt is harder to trigger deterministically with a
    // real model, so it ships OFF by default (no untested-by-default behaviour
    // in the hot loop) — opt in with CODEBUDDY_MAX_EMPTY_RETRIES=N.
    const maxEmptyRetries = parseRecoveryBudget(process.env.CODEBUDDY_MAX_EMPTY_RETRIES, 0);
    let lengthContinuations = 0;
    let emptyRetries = 0;

    try {
      getProgressTracker().start(maxToolRounds);
    } catch { /* progress tracker optional */ }

    try {
      const pipeline = this.deps.middlewarePipeline;
      // New task: clear per-task middleware latching (quality-gate run count,
      // auto-repair attempts, verification one-shot warning). The pipeline is
      // built once and reused across tasks while toolRound restarts at 0, so
      // without this the gates would silently stay off after the first task(s).
      pipeline?.resetForNewTask?.();

      let terminateDetectedStreaming = false;
      while (toolRounds < maxToolRounds) {
        if (abortController?.signal.aborted) {
          yield { type: "content", content: "\n\n[Operation cancelled by user]" };
          yield { type: "done" };
          return;
        }

        // Run before_turn middleware
        if (pipeline) {
          const ctx = this.buildMiddlewareContext(
            toolRounds, inputTokens, totalOutputTokens, history, messages, true, abortController
          );
          const mwResult = await pipeline.runBeforeTurn(ctx);
          if (mwResult.action === 'stop') {
            if (mwResult.message) yield { type: "content", content: `\n\n${mwResult.message}` };
            yield { type: "done" };
            return;
          }
          if (mwResult.action === 'compact') {
            // Trigger context compaction IN PLACE — prepareMessages() is pure
            // and its discarded return made this action a silent no-op.
            const compacted = compactTurnMessagesInPlace(this.deps.contextManager, messages, {
              isolatedSharedHost,
            });
            if (compacted) incrementalTokenCounter.invalidate();
            // S7: record a fork run at the compaction boundary for lineage.
            // No-op unless this session is linked to an observability run.
            const forkId = recordCompactionFork(
              getActiveRunStore(),
              this.deps.toolHandler.getRunId(),
            );
            if (forkId) this.deps.toolHandler.setRunId(forkId);
          }
          if (mwResult.action === 'warn' && mwResult.message) {
            yield { type: "content", content: `\n${mwResult.message}\n` };
            messages.push({
              role: 'system' as const,
              content: `<context type="middleware-hint">\n${mwResult.message}\n</context>`,
            });
          }
        }

        // Start every independent pre-request task before awaiting any of it.
        // Time-to-first-token is then bounded by the slowest task instead of the
        // sum of prompt building, tool selection, and context enrichment.
        const rebuildSystemPromptForQuery = this.deps.rebuildSystemPromptForQuery;
        const rebuiltSystemPromptPromise: Promise<string | null> =
          toolRounds === 0 &&
          rebuildSystemPromptForQuery &&
          !isolatedSharedHost
            ? rebuildSystemPromptForQuery(turnQueryText).catch((err) => {
                logger.warn('[agent-executor] query-aware SP rebuild failed', { error: String(err) });
                return null;
              })
            : Promise.resolve(null);

        // Profile-aware tool selection. For `lite` (small Ollama models),
        // shrink the tool set to a minimal, reliable core.
        const activeModelName = this.deps.client.getCurrentModel() ?? '';
        const modelToolConfig = getModelToolConfig(activeModelName);
        let selectionOpts: Parameters<typeof this.deps.toolSelectionStrategy.selectToolsForQuery>[1] =
          activeModelName ? { modelName: activeModelName } : {};
        if (introspectionIntent === 'improve') {
          selectionOpts = {
            ...selectionOpts,
            // Improvement is not silently elevated: these are only model-facing
            // schemas. ToolHandler still applies the active permission, trust,
            // confirmation, and WritePolicy gates to every requested effect.
            alwaysInclude: ['self_describe', 'view_file', 'search', 'apply_patch', 'bash'],
            enableCaching: false,
          };
        } else if (modelToolConfig.promptProfile === 'lite') {
          selectionOpts = {
            ...selectionOpts,
            maxTools: 5,
            alwaysInclude: ['view_file', 'bash', 'search'],
          };
        }
        const selectionPromise = this.deps.toolSelectionStrategy.selectToolsForQuery(
          turnQueryText,
          selectionOpts,
        );

        // Build context in a scratch array while the prompt and tools are being
        // prepared. It is appended only after transcript preparation so the
        // existing compaction and repair ordering remains unchanged.
        const contextBlocks: CodeBuddyMessage[] = [];
        const contextPromise = toolRounds === 0
          ? injectInitialContext(contextBlocks, {
              message: turnQueryText,
              introspectionText: introspectionTextForTurn,
              cwd: turnCwd,
              ctxLevel,
              loadWorkspaceContext: lazyGetWorkspaceContext,
              decisionContextProvider: this.getDecisionContextProvider(),
              icmBridgeProvider: this.getICMBridgeProvider(),
              codeGraphContextProvider: this.getCodeGraphContextProvider(),
              docsContextProvider: this.getDocsContextProvider(),
              isolatedSharedHost,
              ...(operationalRobotName ? { operationalRobotName } : {}),
              ...(introspectionIntent
                ? {
                    operationalRuntime: {
                      ...(activeModelName ? { model: activeModelName } : {}),
                      ...(providerName ? { provider: providerName } : {}),
                      ...(surface ? { surface } : {}),
                      ...(permissionMode ? { permissionMode } : {}),
                      ...configuredSensoryRuntime(surface),
                    },
                  }
                : {}),
            })
          : injectNextRoundContext(contextBlocks, {
              message: turnQueryText,
              introspectionText: introspectionTextForTurn,
              cwd: turnCwd,
              queryComplexity,
              isolatedSharedHost,
            });

        const [rebuiltSystemPrompt, selectionResult] = await Promise.all([
          rebuiltSystemPromptPromise,
          selectionPromise,
          contextPromise,
        ]);

        const firstMessage = messages[0];
        if (rebuiltSystemPrompt && firstMessage && firstMessage.role === 'system') {
          firstMessage.content = rebuiltSystemPrompt;
          incrementalTokenCounter.invalidate();
          logger.debug(
            `[agent-executor] system prompt rebuilt query-aware (${rebuiltSystemPrompt.length} chars)`,
          );
        }

        let tools = selectionResult.tools;
        let forcedChatOnlyToolRunModel: string | null = null;
        if (toolRounds === 0) {
          this.deps.toolSelectionStrategy.cacheTools(tools, activeModelName);
        }

        // Models explicitly marked chat-only must not see callable schemas.
        if (activeModelName && modelToolConfig.supportsToolCalls === false && tools.length > 0) {
          if (process.env.GROK_FORCE_TOOLS === 'true') {
            forcedChatOnlyToolRunModel = activeModelName;
          } else {
            logger.debug(
              `[agent-executor] supportsToolCalls=false for ${activeModelName} — dropping ${tools.length} tools from chat call`,
            );
            tools = [];
          }
        }

        const turnExecutionExtra: Record<string, unknown> | undefined = introspectionIntent
          ? {
              ...(activeModelName ? { model: activeModelName } : {}),
              ...(providerName ? { provider: providerName } : {}),
              ...(surface ? { surface } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              ...(operationalRobotName
                ? { robotName: operationalRobotName }
                : {}),
              exposedToolNames: tools.map((tool) => tool.function.name),
              introspectionIntent,
            }
          : undefined;

        const preparedMessages = prepareTurnMessages(this.deps.contextManager, messages, {
          isolatedSharedHost,
        });
        preparedMessages.push(...contextBlocks);
        if (emotionalPresenceContext) {
          preparedMessages.push({
            role: 'system',
            content: `<interaction_context ephemeral="true">\n${emotionalPresenceContext}\n</interaction_context>`,
          });
        }
        if (currentTurnContext) {
          preparedMessages.push({
            role: 'system',
            content: `<companion_current_turn_context ephemeral="true">\n${currentTurnContext}\n</companion_current_turn_context>`,
          });
        }

        inputTokens = incrementalTokenCounter.count(messages);
        totalInputTokensForCost += inputTokens;

        // Context warning — always check regardless of pipeline state
        {
          const contextWarning = this.deps.contextManager.shouldWarn(preparedMessages);
          if (contextWarning.warn) {
            logger.warn(contextWarning.message);
            yield { type: "content", content: `\n${contextWarning.message}\n` };

            // --- Native Engine pre-compaction memory flush (streaming path) ---
            try {
              const { getPrecompactionFlusher } = await import('../../context/precompaction-flush.js');
              const flusher = getPrecompactionFlusher();
              await flusher.flush(
                preparedMessages.filter(m => m.role !== 'system').map(m => ({
                  role: m.role as 'user' | 'assistant',
                  content: typeof m.content === 'string' ? m.content : '',
                })),
                async (flushMsgs) => {
                  const r = await this.deps.client.chat(
                    flushMsgs.map(m => ({ role: m.role, content: m.content })),
                    [],
                  );
                  return r.choices[0]?.message?.content ?? 'NO_REPLY';
                }
              );
            } catch {
              // non-critical
            }
          }
        }

        this.deps.streamingHandler.reset();
        let steeringRequestedDuringText = false;
        let streamObservedToolCalls = false;

        // Stall guard: some backends (ChatGPT/Codex OAuth observed) accept
        // the request then never send a byte — without a bound this loop
        // hangs FOREVER (turns stuck for hours in Cowork and headless waves).
        // Fail fast with a clear error instead; the caller/user retries.
        const streamFactory = () => withStallGuard(this.deps.client.chatStream(
          preparedMessages,
          tools,
          {
            streamRetry: false,
            ...(abortController?.signal ? { signal: abortController.signal } : {}),
          },
          this.config.isGrokModel() &&
            this.deps.toolSelectionStrategy.shouldUseSearchFor(turnQueryText)
            ? { search_parameters: { mode: "auto" } }
            : { search_parameters: { mode: "off" } },
        ));
        for await (const streamEvent of withLlmStreamRetry(streamFactory, {
          maxRetries: 2,
          baseDelayMs: 500,
          ...(abortController?.signal ? { signal: abortController.signal } : {}),
        })) {
          if (streamEvent.type === 'retry') {
            // A fresh stream restarts from the beginning. Reset the accumulator
            // so only the successful attempt is persisted in the transcript.
            this.deps.streamingHandler.reset();
            streamObservedToolCalls = false;
            yield {
              type: 'reasoning',
              reasoning: `Reconnexion ${streamEvent.retry}/${streamEvent.maxRetries}`,
            };
            continue;
          }
          const chunk = streamEvent.value;
          if (abortController?.signal.aborted) {
            yield { type: "content", content: "\n\n[Operation cancelled by user]" };
            yield { type: "done" };
            return;
          }

          const result = this.deps.streamingHandler.accumulateChunk(chunk as RawStreamingChunk);

          if (result.reasoningContent && !relationshipSafety && !guardGenerativeSelfInspection) {
            yield { type: "reasoning", reasoning: result.reasoningContent };
          }

          if (result.hasNewToolCalls && result.toolCalls) {
            streamObservedToolCalls = true;
            yield {
              type: "tool_calls",
              toolCalls: relationshipSafety
                ? relationshipSafeToolCallsForDisplay(result.toolCalls)
                : result.toolCalls,
            };
          }

          if (result.displayContent && !relationshipSafety && !guardGenerativeSelfInspection) {
            yield { type: "content", content: result.displayContent };
          }

          if (result.shouldEmitTokenCount && result.tokenCount !== undefined) {
            yield { type: "token_count", tokenCount: inputTokens + result.tokenCount };
          }

          // Steering is safe only while this response is still pure text. Do
          // not consume the queue yet: the accumulated message is authoritative
          // and may reveal a tool call in the same chunk.
          if (
            !streamObservedToolCalls &&
            this.deps.messageQueue?.hasSteeringMessage()
          ) {
            steeringRequestedDuringText = true;
            break;
          }
        }

        if (tools.length > 0 && !this.deps.streamingHandler.hasYieldedToolCalls()) {
          const extracted = this.deps.streamingHandler.extractToolCalls();
          if (extracted.toolCalls.length > 0) {
            yield {
              type: "tool_calls",
              toolCalls: relationshipSafety
                ? relationshipSafeToolCallsForDisplay(extracted.toolCalls)
                : extracted.toolCalls,
            };
          }
        }

        const accumulatedMessage = this.deps.streamingHandler.getAccumulatedMessage();
        // Sanitize streamed assistant content: strip model control tokens and invisible chars
        let toolCalls = accumulatedMessage.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          const filteredToolCalls = toolCalls.filter((toolCall) => !isIgnorableControlToolCall(toolCall));
          if (filteredToolCalls.length !== toolCalls.length) {
            logger.debug('[agent-executor] dropped hallucinated control tool calls', {
              dropped: toolCalls.length - filteredToolCalls.length,
              kept: filteredToolCalls.length,
            });
          }
          toolCalls = filteredToolCalls.length > 0 ? filteredToolCalls : undefined;
        }
        if (relationshipSafety && Array.isArray(toolCalls)) {
          toolCalls = toolCalls.map(prepareRelationshipSafeInteractiveToolCall);
        }
        const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
        // Pre-fallback raw content — used by in-loop recovery to tell a real
        // partial answer (retry-able) from a truly empty turn (give up).
        const streamedContentRaw = (accumulatedMessage.content || "").trim();
        const streamFinishReason = accumulatedMessage.finishReason;
        let rawStreamedContent = accumulatedMessage.content || "";
        if (forcedChatOnlyToolRunModel && !hasToolCalls && !rawStreamedContent.trim()) {
          rawStreamedContent =
            `Blocked: ${forcedChatOnlyToolRunModel} is configured as a chat-only local model and ` +
            'returned no structured tool call even with GROK_FORCE_TOOLS=true. ' +
            'Use a tool-capable model such as qwen3.5-ctx32k or gpt-5.6-sol for goals that need shell/tools.';
          if (!relationshipSafety && !guardGenerativeSelfInspection) {
            yield { type: "content", content: `${rawStreamedContent}\n` };
          }
        }
        const synthesizedToolFallback = !rawStreamedContent;
        if (!rawStreamedContent) rawStreamedContent = "Using tools to help you...";
        const sanitizedContent = sanitizeAssistantOutput(rawStreamedContent);
        const guardedContent = relationshipSafety
          ? guardRelationshipReply(sanitizedContent)
          : null;
        let content = guardedContent?.response ?? sanitizedContent;
        if (guardGenerativeSelfInspection) {
          content = guardLisaOperationalSelfInspectionReply(
            content,
            introspectionTextForTurn,
          );
        }
        if (guardedContent?.intervened) {
          logger.warn('[agent-executor] relationship safety gate rewrote persisted output', {
            issues: guardedContent.issues,
          });
        }
        if (
          (relationshipSafety || guardGenerativeSelfInspection) &&
          content &&
          !(synthesizedToolFallback && hasToolCalls)
        ) {
          // The outer last-mile gate buffers the complete agent turn. Explicit
          // spacing keeps a genuine pre-tool preamble and the final answer from
          // being concatenated into one word after per-round trimming.
          yield { type: 'content', content: `${content}\n\n` };
        }

        const persistedAssistantContent = synthesizedToolFallback && hasToolCalls
          ? null
          : content;
        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: persistedAssistantContent ?? '',
          timestamp: new Date(),
          toolCalls: toolCalls,
        };
        history.push(assistantEntry);
        messages.push({
          role: 'assistant',
          content: persistedAssistantContent,
          tool_calls: toolCalls,
        });

        const currentOutputTokens = this.deps.streamingHandler.getTokenCount() || 0;
        totalOutputTokens += currentOutputTokens;
        yield { type: "token_count", tokenCount: inputTokens + totalOutputTokens };

        if (steeringRequestedDuringText && !hasToolCalls) {
          const steering = this.deps.messageQueue?.consumeSteeringMessage();
          if (steering) {
            yield { type: 'steer', steer: { content: steering.content, source: steering.source } };
            messages.push({ role: 'user', content: steering.content });
            history.push({
              type: 'user',
              content: steering.content,
              timestamp: steering.timestamp,
            });
            continue;
          }
        }

        if (toolCalls && toolCalls.length > 0) {
          toolRounds++;

          // Pre-check cost limit before executing tools (estimate only — no side effects)
          if (this.config.estimateSessionCostLimitReached(inputTokens, totalOutputTokens)) {
            const sessionCost = this.config.getSessionCost();
            const sessionCostLimit = this.config.getSessionCostLimit();
            for (const toolCall of toolCalls) {
              const toolResult: ToolResult = {
                success: false,
                error: 'Skipped because the session cost limit was reached before tool execution.',
              };
              history.push({
                type: 'tool_result',
                content: toolResult.error ?? 'Tool skipped',
                timestamp: new Date(),
                toolCall,
                toolResult,
              });
              messages.push({
                role: 'tool',
                content: toolResult.error ?? 'Tool skipped',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
              } as CodeBuddyMessage);
              yield { type: 'tool_result', toolCall, toolResult };
            }
            yield { type: "content", content: `\n\nSession cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}). Stopping before tool execution.` };
            yield { type: "done" };
            return;
          }

          // Single-tool mode executes only the first call. The remaining calls
          // still receive synthetic results below so the provider transcript
          // never contains an unresolved assistant tool call.
          const streamToolCallsToExecute = this.config.singleToolMode
            ? toolCalls.slice(0, 1)
            : toolCalls;
          const deferredToolCalls = this.config.singleToolMode
            ? toolCalls.slice(1)
            : [];

          if (deferredToolCalls.length > 0) {
            logger.debug(`Single-tool mode (stream): skipped ${deferredToolCalls.length} extra tool calls`);
          }

          if (!this.deps.streamingHandler.hasYieldedToolCalls()) {
            yield {
              type: "tool_calls",
              toolCalls: relationshipSafety
                ? relationshipSafeToolCallsForDisplay(streamToolCallsToExecute)
                : streamToolCallsToExecute,
            };
          }

          const executionBatches = createOrderedToolBatches(
            streamToolCallsToExecute,
            (toolCall) => this.isToolParallelizable(toolCall),
          );
          // Persist JIT context for the next provider request, but only after
          // every result in this assistant tool-call batch. Inserting a system
          // message between sibling tool results breaks provider transcript
          // ordering, including when read-only calls execute concurrently.
          const jitContextMessages: CodeBuddyMessage[] = [];

          toolExecution: for (const batch of executionBatches) {
            // Compaction mutates shared transcript state, so keep this preflight
            // ordered even when the calls themselves are safe to run together.
            for (const toolCall of batch) {
              try {
                const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
                const estimatedTokens = estimateToolResultTokens(toolCall.function.name, toolArgs);
                const modelName = this.deps.client.getCurrentModel();
                const modelConfig = getModelToolConfig(modelName);
                const contextWindow = modelConfig.contextWindow ?? 128_000;
                if (shouldCompactBeforeToolExec(inputTokens, estimatedTokens, contextWindow)) {
                  logger.debug('Proactive compaction (stream): compacting before tool execution', {
                    toolName: toolCall.function.name,
                    inputTokens,
                    estimatedTokens,
                    contextWindow,
                  });
                const compacted = compactTurnMessagesInPlace(this.deps.contextManager, messages, {
                  isolatedSharedHost,
                });
                if (compacted) incrementalTokenCounter.invalidate();
                inputTokens = incrementalTokenCounter.count(messages);
                }
              } catch { /* proactive compaction is non-critical */ }
            }

            const outcomes = await executeBoundedInOrder<CodeBuddyToolCall, ToolExecutionOutcome>(
              batch,
              async (toolCall) => {
                const startedAt = Date.now();
                if (abortController?.signal.aborted) {
                  return {
                    result: abortedToolResult(startedAt),
                    startedAt,
                    streamChunks: [],
                  };
                }
                if (
                  relationshipSafety &&
                  (isBlockedRelationshipInteractiveToolCall(toolCall) ||
                    unsafeRelationshipOutboundToolCall(toolCall))
                ) {
                  logger.warn('[agent-executor] relationship safety blocked outbound tool call', {
                    toolName: toolCall.function.name,
                  });
                  return {
                    blockedContent: 'Relationship safety policy blocked manipulative outbound content.',
                    startedAt,
                    streamChunks: [],
                  };
                }

                const streamPreHook = await runPreToolUseHook(process.cwd(), toolCall);
                if (!streamPreHook.allowed) {
                  return {
                    blockedContent: streamPreHook.feedback ?? 'Action blocked by PreToolUse hook',
                    startedAt,
                    streamChunks: [],
                  };
                }

                if (abortController?.signal.aborted) {
                  return {
                    result: abortedToolResult(startedAt),
                    startedAt,
                    streamChunks: [],
                  };
                }
                emitFleetToolStarted(toolCall);
                const execution = await this.executeToolForBatch(
                  toolCall,
                  turnExecutionExtra,
                  abortController?.signal,
                  startedAt,
                );
                return { ...execution, startedAt };
              },
              (error) => ({
                result: {
                  success: false,
                  error: `Tool execution failed: ${getErrorMessage(error)}`,
                },
                startedAt: Date.now(),
                streamChunks: [],
              }),
              MAX_PARALLEL_TOOL_CALLS,
            );

            // Promise completion order is intentionally ignored. Provider-facing
            // results and every observable side effect are replayed by call index.
            for (let outcomeIndex = 0; outcomeIndex < batch.length; outcomeIndex++) {
              const toolCall = batch[outcomeIndex];
              const outcome = outcomes[outcomeIndex];
              if (!toolCall || !outcome) continue;

              if (outcome.blockedContent) {
                const relationshipBlocked = relationshipSafety &&
                  (isBlockedRelationshipInteractiveToolCall(toolCall) ||
                    unsafeRelationshipOutboundToolCall(toolCall));
                yield {
                  type: 'content',
                  content: relationshipBlocked
                    ? `\n${SAFE_RELATIONSHIP_REPAIR}\n`
                    : `\n[Hook blocked: ${outcome.blockedContent}]\n`,
                };
                pushBlockedToolMessage(messages, toolCall, outcome.blockedContent);
                continue;
              }

              let result = outcome.result ?? {
                success: false,
                error: 'Tool returned no result',
              };
              const _streamToolStartMs = outcome.startedAt;
              if (!relationshipSafety) {
                for (const delta of outcome.streamChunks) {
                  yield {
                    type: 'tool_stream',
                    toolStreamData: {
                      toolCallId: toolCall.id,
                      toolName: toolCall.function.name,
                      delta,
                    },
                  };
                }
              }

            // Expand the current turn's cached schema after discovery or live
            // authoring. Without this, a newly created tool is dispatchable but
            // invisible to the model until the next user turn.
            if (result.success) {
              const data = result.data as { names?: string[]; createdTools?: string[] } | undefined;
              const discoveredNames = toolCall.function.name === 'tool_search' ? data?.names : undefined;
              const names = [...new Set([
                ...(Array.isArray(discoveredNames) ? discoveredNames : []),
                ...(Array.isArray(data?.createdTools) ? data.createdTools : []),
              ])];
              if (names.length > 0) {
                try {
                  const added = await this.deps.toolSelectionStrategy.expandCachedTools(names);
                  logger.debug('tool selection expanded after tool result', {
                    source: toolCall.function.name,
                    names,
                    added,
                  });
                } catch (err) {
                  logger.warn('tool selection expansion failed', {
                    source: toolCall.function.name,
                    error: String(err),
                  });
                }
              }
            }

            // --- User hooks: PostToolUse / PostToolUseFailure (streaming path) ---
            await runPostToolUseHook(process.cwd(), toolCall, result);
            // --- Per-tool metrics (streaming path, DeepWiki gap #3) ---
            await recordToolMetric(
              toolCall.function.name,
              result.success,
              Date.now() - _streamToolStartMs,
            );
            // Phase (d).2 — fleet broadcast on completion (opt-in).
            emitFleetToolCompleted(toolCall, result, Date.now() - _streamToolStartMs);
            // Phase (d).21 ship 3 — proactive notification on tool completion.
            // Default sink logs at info (success) / warn (failure). Gated by
            // quiet hours + rate limit in NotificationManager.
            try {
              const _toolDurationStream = Date.now() - _streamToolStartMs;
              notify({
                channelType: 'cli',
                channelId: 'tool-completion',
                message: result.success
                  ? `${toolCall.function.name} completed in ${_toolDurationStream}ms`
                  : `${toolCall.function.name} failed: ${result.error ?? 'unknown error'}`,
                priority: result.success ? 'low' : 'high',
              });
            } catch { /* notification optional */ }
            // Phase (d).21 ship 4 — progress update.
            try {
              getProgressTracker().update(
                toolCall.id,
                result.success ? 'completed' : 'failed',
                toolCall.function.name,
              );
            } catch { /* progress optional */ }

            // --- Track file access for code graph context (streaming, incremental update) ---
            try {
              const fileToolsStream = new Set(['view_file', 'create_file', 'str_replace_editor', 'file_read', 'file_write']);
              if (!isolatedSharedHost && fileToolsStream.has(toolCall.function.name)) {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const filePath = args.path || args.file_path || args.target_file || '';
                if (filePath) {
                  trackRecentFile(filePath);
                  if (['create_file', 'str_replace_editor', 'file_write'].includes(toolCall.function.name)) {
                    const kg = getKnowledgeGraph();
                    if (kg.getStats().tripleCount > 0) {
                      const absPath = resolvePath(process.cwd(), filePath);
                      updateGraphForFile(kg, absPath, process.cwd());
                    }
                  }
                }
              }
            } catch { /* file tracking is optional */ }

            // --- JIT context discovery: load subdirectory context files ---
            // Décision #2 du plan task #5 — promu du sequential vers streaming
            // pour parité d'enrichissement après chaque tool qui touche un path.
            jitContextMessages.push(...await runJitContextDiscovery(toolCall));

            // Build three deliberately separate views of one observation:
            //   1. recovery: exact native output persisted before any hook/optimizer,
            //   2. display: provider-sanitized ToolResult emitted to the UI,
            //   3. model: token-budgeted observation appended to the transcript.
            // Non-streaming ToolHandler calls already persisted (1) before their
            // after-hooks. Streaming adapters are persisted here on first sight.
            const recoveryStore = getRestorableCompressor();
            const toolWorkspace = typeof this.deps.toolHandler.getWorkingDirectory === 'function'
              ? this.deps.toolHandler.getWorkingDirectory()
              : process.cwd();
            const recoverySessionId =
              typeof this.deps.toolHandler.getRecoverySessionId === 'function'
                ? this.deps.toolHandler.getRecoverySessionId()
                : undefined;
            let rawForRecovery = formatToolResultForRecovery(result);
            const executionWasAborted = result.error?.startsWith('aborted by user after ') ?? false;
            if (toolCall.id && recoveryStore && !executionWasAborted) {
              const existingRecovery = recoveryStore.restore(
                toolCall.id,
                toolWorkspace,
                recoverySessionId,
              );
              if (existingRecovery.found) {
                rawForRecovery = existingRecovery.content;
              } else {
                recoveryStore.writeToolResult(
                  toolCall.id,
                  rawForRecovery,
                  toolWorkspace,
                  recoverySessionId,
                );
              }
            }

            let modelObservation = rawForRecovery;
            // TokenJuice remains a lossless first pass for verbose web content.
            // It only affects the model view; recovery and display stay intact.
            if (
              isTokenJuiceEnabled() &&
              result?.success &&
              modelObservation.length > JUICE_MIN_CHARS &&
              JUICE_WEB_TOOLS.has(toolCall.function.name)
            ) {
              const juiced = tokenJuice(modelObservation, { html: true, dedupe: true });
              if (juiced.savedChars > 0) {
                logger.debug(
                  `[token-juice] ${toolCall.function.name}: saved ${juiced.savedChars} chars (${juiced.applied.join('+')})`,
                );
                modelObservation = juiced.output;
              }
            }

            let logicalCommand = '';
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
              if (typeof args.command === 'string') logicalCommand = args.command;
            } catch { /* malformed args were already handled by the dispatcher */ }

            const activeObservationModel = this.deps.client.getCurrentModel() ?? '';
            const activeObservationConfig = getModelToolConfig(activeObservationModel);
            const optimization = await optimizeToolObservation({
              toolName: toolCall.function.name,
              toolCallId: toolCall.id || `tool_${Date.now()}`,
              content: modelObservation,
              success: result?.success,
              exitCode: result?.success ? 0 : 1,
              command: logicalCommand,
              query: message ?? '',
              workspaceRoot: toolWorkspace,
              contextWindow: activeObservationConfig.contextWindow ?? 128_000,
              currentInputTokens: inputTokens,
              signal: abortController?.signal,
            });

            let modelStreamContent = optimization.content;
            // lm-resizer owns the semantic budget when available. Its absence or
            // an intentionally raw failure still receives a model-aware hard cap;
            // the exact observation remains available through restore_context.
            if (toolCall.function.name !== 'restore_context') {
              const budgetTokens = optimization.tokenBudget ?? 5_000;
              const hardLimitChars = Math.min(80_000, Math.max(8_000, budgetTokens * 4));
              if (
                modelStreamContent.length > hardLimitChars ||
                this.deps.tokenCounter.countTokens(modelStreamContent) > budgetTokens
              ) {
                const truncated = semanticTruncate(modelStreamContent, { maxChars: hardLimitChars });
                if (truncated.truncated) {
                  const recoveryNote = toolCall.id
                    ? `\n\n[Full exact observation: restore_context({"identifier":${JSON.stringify(toolCall.id)}})]`
                    : '';
                  modelStreamContent = `${truncated.output}${recoveryNote}`;
                }
              }
            }

            const observationMetadata = {
              optimizer: optimization.optimized ? 'lm-resizer' : 'none',
              reason: optimization.reason,
              rawRef: optimization.rawRef,
              originalBytes: optimization.originalBytes,
              finalBytes: Buffer.byteLength(modelStreamContent),
              bytesSaved: Math.max(0, optimization.originalBytes - Buffer.byteLength(modelStreamContent)),
              ...(optimization.transport ? { transport: optimization.transport } : {}),
            };
            result = {
              ...result,
              metadata: {
                ...(result?.metadata ?? {}),
                contextOptimization: observationMetadata,
              },
            };

            const rawStreamContent = sanitizeToolResult(rawForRecovery);
            const sanitizedModelObservation = sanitizeToolResult(modelStreamContent);
            const variedStreamContent = applyObservationVariator(
              toolCall.function.name,
              sanitizedModelObservation,
            );

            const visibleToolResult = relationshipSafety
              ? relationshipSafeToolResultForDisplay(result)
              : result;
            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: visibleToolResult.success
                ? visibleToolResult.output || "Success"
                : visibleToolResult.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: visibleToolResult,
            };
            history.push(toolResultEntry);
            yield { type: "tool_result", toolCall, toolResult: visibleToolResult };

            // Note: 'name' is required for Gemini API to match functionResponse with functionCall
            messages.push({
              role: "tool",
              content: variedStreamContent,
              tool_call_id: toolCall.id || `tool_${Date.now()}`,
              name: toolCall.function.name,
            } as CodeBuddyMessage);

            // --- Auto-commit after file-modifying tools (streaming path) ---
            if (result?.success) {
              try {
                const acResult = await maybeAutoCommit(
                  toolCall.function.name,
                  toolCall.function.arguments || '{}',
                  rawStreamContent.substring(0, 120),
                );
                if (acResult?.success) {
                  logger.debug('Auto-commit (stream):', { hash: acResult.commitHash });
                } else if (acResult && acResult.message && /failed/i.test(acResult.message)) {
                  // Real commit failure — surface to the user (see sequential path above).
                  logger.warn(`Auto-commit failed: ${acResult.message}`);
                }
              } catch (err) {
                logger.debug('Auto-commit threw (stream)', { err: err instanceof Error ? err.message : String(err) });
              }
            }

            // --- Fix 11: YOLO cost display after each tool (streaming path) ---
            await logYoloCostIfEnabled(this.config);

            // --- Terminate signal detection (OpenManus #5, streaming path) ---
            const streamTerminateMsg = extractTerminateMessage(rawStreamContent);
            if (streamTerminateMsg !== null) {
              yield { type: "content", content: `\n\n${streamTerminateMsg}` };
              terminateDetectedStreaming = true;
              break toolExecution;
            }

            // --- Interactive Shell Handoff detection (streaming path) ---
            const shellRequestMsg = extractSignalMessage(rawStreamContent, INTERACTIVE_SHELL_SIGNAL);
            if (shellRequestMsg !== null) {
              yield { type: "content", content: `\n\n⚠️ **INTERACTIVE SHELL HANDOFF REQUESTED**\n\n${shellRequestMsg}` };
              yield {
                type: "ask_user",
                askUser: {
                  question: "Do you want to open an interactive terminal to perform this action? (Type 'exit' in the terminal when done to return control to the AI)",
                  options: ["Yes, open interactive shell", "No, cancel tool"]
                }
              };
              terminateDetectedStreaming = true;
              break toolExecution;
            }

            // --- Plan Approval detection (streaming path) ---
            const planMsg = extractSignalMessage(rawStreamContent, PLAN_APPROVAL_SIGNAL);
            if (planMsg !== null) {
              yield { type: "content", content: `\n\n⚠️ **PLAN APPROVAL REQUIRED**\n\n${planMsg}` };
              yield {
                type: "ask_user",
                askUser: {
                  question: "Do you approve this plan? (Yes to execute, No to cancel, or provide feedback)",
                  options: ["Approve", "Reject"]
                }
              };
              terminateDetectedStreaming = true;
              break toolExecution;
            }

            // --- Yield signal detection (Native Engine v2026.3.14, streaming path) ---
            const streamYieldChildId = extractYieldChildId(rawStreamContent);
            if (streamYieldChildId) {
              yield { type: "content", content: `\n[Waiting for sub-agent to complete...]` };
              await processYieldSignal(streamYieldChildId, messages);
            }
          }
          }

          for (const toolCall of deferredToolCalls) {
            const toolResult: ToolResult = {
              success: false,
              error: 'Skipped because single-tool mode executes one call per round.',
            };
            history.push({
              type: 'tool_result',
              content: toolResult.error ?? 'Tool skipped',
              timestamp: new Date(),
              toolCall,
              toolResult,
            });
            messages.push({
              role: 'tool',
              content: toolResult.error ?? 'Tool skipped',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            } as CodeBuddyMessage);
            yield { type: 'tool_result', toolCall, toolResult };
          }

          messages.push(...jitContextMessages);

          if (terminateDetectedStreaming) break;

          if (abortController?.signal.aborted) {
            yield { type: "content", content: "\n\n[Operation cancelled by user]" };
            yield { type: "done" };
            return;
          }

          // Tool-call/result pairs are complete at this boundary, so a steer
          // that arrived while tools were running can now be injected safely.
          const deferredSteering = this.deps.messageQueue?.hasSteeringMessage()
            ? this.deps.messageQueue.consumeSteeringMessage()
            : null;
          if (deferredSteering) {
            yield {
              type: 'steer',
              steer: { content: deferredSteering.content, source: deferredSteering.source },
            };
            messages.push({ role: 'user', content: deferredSteering.content });
            history.push({
              type: 'user',
              content: deferredSteering.content,
              timestamp: deferredSteering.timestamp,
            });
            continue;
          }

          inputTokens = incrementalTokenCounter.count(messages);
          yield { type: "token_count", tokenCount: inputTokens + totalOutputTokens };

          // Run after_turn middleware (handles cost recording + limit)
          if (pipeline) {
            const ctx = this.buildMiddlewareContext(
              toolRounds, inputTokens, totalOutputTokens, history, messages, true, abortController
            );
            const mwResult = await pipeline.runAfterTurn(ctx);
            if (mwResult.action === 'stop') {
              if (mwResult.message) yield { type: "content", content: `\n\n${mwResult.message}` };
              yield { type: "done" };
              return;
            }
            if (mwResult.action === 'warn' && mwResult.message) {
              yield { type: "content", content: `\n${mwResult.message}\n` };
            }
          }
          // Note: cost is recorded once at end-of-loop, not here (avoids double-counting)

          // Apply TTL-based tool result expiry + image pruning + backward-scanned FIFO masking (streaming path)
          try {
            expireOldToolResults(messages, toolRounds);
            pruneImageContent(messages);
            applyToolOutputMasking(messages);
            incrementalTokenCounter.invalidate();
          } catch { /* masking is optional */ }
        } else {
          // ── In-loop recovery (Hermes parity) ─────────────────────────────
          // Re-prompt WITHIN the turn before accepting this as the final answer.
          // Only reachable in the no-tool-calls branch, so we never split a
          // tool_call/tool_result pair (keeps transcript-repair invariants intact).
          if (!abortController?.signal.aborted) {
            // (1) Length truncation: the model hit the output-token cap mid-prose.
            // Ask it to continue from where it stopped, bounded. A continuation
            // that produced ZERO new tokens (e.g. a too-small num_ctx) leaves
            // `streamedContentRaw` empty — we do NOT retry that (the fix is config,
            // not looping); we fall through and stop.
            if (
              streamFinishReason === 'length' &&
              streamedContentRaw.length > 0 &&
              lengthContinuations < maxLengthContinuations
            ) {
              lengthContinuations++;
              logger.debug('[agent-executor] length-truncation continuation', {
                attempt: lengthContinuations,
                max: maxLengthContinuations,
              });
              messages.push({
                role: 'user',
                content:
                  'Your previous message was cut off because it reached the output length limit. ' +
                  'Continue it from exactly where it stopped — do not repeat earlier text and do not ' +
                  'restart. When the full response is complete, finish normally.',
              });
              continue;
            }
            // (2) Post-tool empty response: the model went silent after running
            // tools. Nudge it to use the results and continue, bounded.
            if (
              streamedContentRaw.length === 0 &&
              streamFinishReason !== 'length' &&
              toolRounds > 0 &&
              emptyRetries < maxEmptyRetries
            ) {
              emptyRetries++;
              logger.debug('[agent-executor] empty-response re-prompt', {
                attempt: emptyRetries,
                max: maxEmptyRetries,
              });
              messages.push({
                role: 'user',
                content:
                  'Your last response was empty. Use the results of the tool calls you just made ' +
                  'to continue the task and produce your answer.',
              });
              continue;
            }
          }

          // Companion hosts own the canonical commit boundary: voice,
          // channel and Cowork persist only relationship-safe, semantically
          // accepted text in their surface continuity/session stores. Generic
          // core observers (AutoCapture, ICM and plugin ContextEngine hooks)
          // are deliberately not replayed for these protected turns: their
          // storage/privacy contracts are independent and must never receive a
          // pre-gate draft or intimate cross-surface transcript by accident.
          if (!isolatedSharedHost && !relationshipSafety) {
            this.commitAssistantSideEffects(message, messages, content || '', toolRounds);
          }

          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield { type: "content", content: "\n\nMaximum tool execution rounds reached." };
      }

      recordTurnCost();

      // Display per-turn token usage (streaming path). Pass the model
      // name so estimateCost can zero out subscription-billed models
      // (e.g. gpt-5.5 via ChatGPT Codex backend) — flat-fee, not per token.
      // Optional call: the real client always implements this, but test doubles
      // may be partial mocks — fall through to estimateCost when it's absent.
      const streamTurnCost = this.deps.client.isSubscriptionAuth?.()
        ? 0
        : estimateCost(
            totalInputTokensForCost,
            totalOutputTokens,
            undefined,
            undefined,
            this.deps.client.getCurrentModel(),
          );
      const streamUsageDisplay = formatTokenUsage({
        inputTokens: totalInputTokensForCost,
        outputTokens: totalOutputTokens,
        cost: streamTurnCost,
      });
      logger.info(`Token usage: ${streamUsageDisplay}`);
      yield { type: "content", content: `\n${streamUsageDisplay}` };

      if (this.config.isSessionCostLimitReached()) {
        const sessionCost = this.config.getSessionCost();
        const sessionCostLimit = this.config.getSessionCostLimit();
        yield {
          type: "content",
          content: `\n\n💸 Session cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}).`,
        };
      }

      // Process followup/collect messages if any are queued
      const mqEnd = this.deps.messageQueue;
      if (mqEnd?.hasPendingMessages()) {
        const mode = mqEnd.getMode();
        if (mode === 'followup') {
          const followups = mqEnd.drain();
          for (const msg of followups) {
            messages.push({ role: "user", content: msg.content });
            history.push({ type: "user", content: msg.content, timestamp: msg.timestamp });
          }
          // Signal that followup messages need re-processing (caller handles)
          yield { type: "steer", steer: { content: `${followups.length} followup message(s) queued`, source: 'queue' } };
        } else if (mode === 'collect') {
          const collected = mqEnd.collect();
          if (collected) {
            messages.push({ role: "user", content: collected });
            history.push({ type: "user", content: collected, timestamp: new Date() });
            yield { type: "steer", steer: { content: collected, source: 'collect' } };
          }
        }
      }

      yield { type: "done" };
    } catch (error) {
      if (abortController?.signal.aborted) {
        yield { type: "content", content: "\n\n[Operation cancelled by user]" };
        yield { type: "done" };
        return;
      }

      const errorMessage = getErrorMessage(error);
      logger.error('Agent turn failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
        error: errorMessage.slice(0, 2_000),
      });
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      history.push(errorEntry);
      messages.push({ role: "assistant", content: errorEntry.content });
      yield { type: "content", content: errorEntry.content };
      yield { type: "done" };
    } finally {
      recordTurnCost();
      if (timelineEnabled) {
        await this.recordCompletedTimelineTurn(
          timelineHistoryStart,
          timelineTurn,
          history,
          message,
        );
      }
    }
  }

  private async recordCompletedTimelineTurn(
    historyStart: number,
    turn: number,
    history: ChatEntry[],
    userMessage: string,
  ): Promise<void> {
    if (!this.deps.recordTimelineTurn) return;

    try {
      const turnHistory = history.slice(historyStart);
      const assistant = [...turnHistory]
        .reverse()
        .find((entry) => entry.type === 'assistant');
      const results = new Map<string, boolean>();
      for (const entry of turnHistory) {
        if (entry.type !== 'tool_result' || !entry.toolCall) continue;
        results.set(entry.toolCall.id, entry.toolResult?.success === true);
      }

      const toolCalls: TimelineToolCall[] = [];
      const seenCalls = new Set<string>();
      for (const entry of turnHistory) {
        const calls = entry.toolCalls ?? (entry.toolCall ? [entry.toolCall] : []);
        for (const call of calls) {
          const key = call.id || `${call.function.name}:${call.function.arguments}`;
          if (seenCalls.has(key)) continue;
          seenCalls.add(key);
          toolCalls.push({
            name: call.function.name,
            ok: results.get(call.id) ?? false,
          });
        }
      }

      const successfulCallIds = new Set(
        [...results.entries()]
          .filter(([, success]) => success)
          .map(([callId]) => callId),
      );
      const successfulHistory = turnHistory.map((entry) => ({
        ...entry,
        ...(entry.toolCalls
          ? { toolCalls: entry.toolCalls.filter((call) => successfulCallIds.has(call.id)) }
          : {}),
        ...(entry.toolCall && !successfulCallIds.has(entry.toolCall.id)
          ? { toolCall: undefined }
          : {}),
      }));

      await this.deps.recordTimelineTurn({
        turn,
        ts: new Date().toISOString(),
        role: assistant ? 'assistant' : 'user',
        text: assistant?.content ?? userMessage,
        toolCalls,
        filesTouched: extractEditedFilesFromHistory(successfulHistory),
      });
    } catch (error) {
      logger.warn('[agent-executor] timeline hook failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Notify internal memory/context observers for an ordinary committed turn. */
  private commitAssistantSideEffects(
    message: string,
    messages: CodeBuddyMessage[],
    content: string,
    toolRounds = 0,
  ): void {
    try {
      void import('../../memory/auto-capture.js').then(({ getAutoCaptureManager }) => {
        const acm = getAutoCaptureManager();
        return acm?.processMessage('assistant', content);
      }).catch(err => logger.debug('Auto-capture failed', { error: String(err) }));
    } catch { /* auto-capture optional */ }

    if (this.getICMBridgeProvider()) {
      try {
        const icm = this.getICMBridgeProvider()!();
        if (icm?.isAvailable()) {
          const episode = `User: ${message}\nAssistant: ${content.substring(0, 500)}`;
          void icm.storeEpisode(episode, {
            source: 'agent-executor-stream',
            sessionId: process.env.CODEBUDDY_SESSION_ID,
            turnNumber: toolRounds,
          }).catch(err => logger.debug('ICM episode store failed', { error: String(err) }));
        }
      } catch { /* ICM store optional */ }
    }

    try {
      const engine = this.deps.contextManager.getContextEngine?.();
      if (engine) {
        engine.afterTurn(messages, { role: 'assistant' as const, content });
      }
    } catch { /* afterTurn hook optional */ }
  }
}
