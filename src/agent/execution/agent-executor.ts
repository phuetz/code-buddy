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
  persistToolResult,
  applyObservationVariator,
  logYoloCostIfEnabled,
} from "./post-tool-handlers.js";
import type { LaneQueue } from "../../concurrency/lane-queue.js";
import type { MiddlewarePipeline, MiddlewareContext } from "../middleware/index.js";
import { extractEditedFilesFromHistory } from "../middleware/changed-files.js";
import type { MessageQueue } from "../message-queue.js";
import { semanticTruncate } from "../../utils/head-tail-truncation.js";
import { compressWithLmResizer, isLmResizerEnabled } from "../../context/lm-resizer-compressor.js";
import { compress as tokenJuice, isTokenJuiceEnabled, JUICE_MIN_CHARS } from "../../context/token-juice.js";
import { getRestorableCompressor } from "../../context/restorable-compression.js";
import { recordCompactionFork } from "../../context/compaction-fork.js";
import { getActiveRunStore } from "../../observability/run-store.js";
import type { ICMBridge } from "../../memory/icm-bridge.js";
import { shouldCompactBeforeToolExec, estimateToolResultTokens } from "../../context/proactive-compaction.js";
import { formatTokenUsage, estimateCost } from "../../utils/token-display.js";
import { classifyQuery } from "./query-classifier.js";
import { getModelToolConfig } from "../../config/model-tools.js";
import { getLatencyOptimizer, getStreamingOptimizer } from "../../optimization/latency-optimizer.js";

/**
 * Tools whose (verbose, prose/HTML) output TokenJuice may losslessly compress before it
 * enters message history. Scoped to web tools on purpose — never structured output the
 * agent parses. See `context/token-juice.ts`.
 */
const JUICE_WEB_TOOLS = new Set(['web_fetch', 'web_search', 'fetch', 'browser_fetch']);

const CONTEXT_MENTION_PATTERN = /@(?:file:|url:|image:|git(?::|\s)|symbol:|search:|web\s|terminal\b)/i;

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
  private executeToolViaLane(toolCall: Parameters<ToolHandler['executeTool']>[0]): ReturnType<ToolHandler['executeTool']> {
    const laneQueue = this.deps.laneQueue;
    if (!laneQueue) {
      return this.deps.toolHandler.executeTool(toolCall);
    }

    const laneId = this.deps.laneId ?? 'default';
    const isParallel = this.isToolParallelizable(toolCall);
    const timeoutMs = this.getLaneTaskTimeoutMs(isParallel);

    return laneQueue.enqueue(
      laneId,
      () => this.deps.toolHandler.executeTool(toolCall),
      {
        parallel: isParallel,
        category: toolCall.function.name,
        timeout: timeoutMs,
      }
    );
  }

  /**
   * Compute adaptive compaction threshold based on the model's context window.
   * Reserves ~30% of context for tool results; rest for system prompt + history.
   * Falls back to 70K chars if model info unavailable.
   */
  private getAdaptiveCompactionThreshold(): number {
    try {
      const modelName = this.deps.client.getCurrentModel();
      const { getModelToolConfig } = require('../../config/model-tools.js');
      const config = getModelToolConfig(modelName);
      const contextChars = (config.contextWindow ?? 128_000) * 4; // ~4 chars/token
      // Allocate 30% of context window for tool results
      return Math.max(40_000, Math.floor(contextChars * 0.3));
    } catch {
      return 70_000; // Fallback
    }
  }

  /**
   * Tool Result Compaction Guard (Native Engine / Manus AI #13)
   *
   * Before each model call, scan accumulated tool result messages.
   * If their total size exceeds an adaptive threshold (scaled to model context),
   * compress the oldest ones using RestorableCompressor — replacing full content
   * with a compact stub referencing the callId. The content remains restorable
   * via the `restore_context` tool.
   *
   * This prevents deep agent chains from silently overflowing the context window.
   */
  private compactLargeToolResults(
    preparedMessages: CodeBuddyMessage[],
    maxToolResultChars?: number
  ): CodeBuddyMessage[] {
    const threshold = maxToolResultChars ?? this.getAdaptiveCompactionThreshold();
    // Sum characters from tool result messages
    let totalToolChars = 0;
    for (const m of preparedMessages) {
      if (m.role === 'tool' && typeof m.content === 'string') {
        totalToolChars += m.content.length;
      }
    }

    if (totalToolChars <= threshold) return preparedMessages;

    const compressor = getRestorableCompressor();
    // Compress oldest tool results first (front of the list)
    const result = [...preparedMessages];
    let charsToFree = totalToolChars - threshold;

    for (let i = 0; i < result.length && charsToFree > 0; i++) {
      const m = result[i];
      if (m === undefined) continue;
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
        const callId = (m as { tool_call_id?: string }).tool_call_id || `tool_${i}`;
        const compressed = compressor.compress([{
          role: m.role,
          content: m.content,
          tool_call_id: callId,
        }]);
        if (compressed.messages[0]) {
          charsToFree -= (m.content.length - (compressed.messages[0].content?.length ?? 0));
          result[i] = { ...m, content: compressed.messages[0].content ?? m.content };
        }
      }
    }

    logger.debug(`ToolResultCompactionGuard: compacted tool results`, {
      before: totalToolChars,
      freed: totalToolChars - charsToFree,
    });

    return result;
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
  ): Promise<string> {
    // Avoid loading the sizeable mention parser (fs-extra, axios, child_process)
    // for the overwhelmingly common case where the message contains no mention.
    const mentionPromise = CONTEXT_MENTION_PATTERN.test(message)
      ? import('../../input/context-mentions.js')
          .then(({ processMentions }) => processMentions(message))
          .catch(() => null)
      : Promise.resolve(null);

    // Persona selection affects this turn's system prompt, so keep it on the
    // critical path, but load it concurrently with explicit mention expansion.
    const personaPromise = import('../../personas/persona-manager.js')
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
    if (classifyQuery(message).complexity !== 'trivial') {
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
    turnStartedAt: number = Date.now()
  ): Promise<ChatEntry[]> {
    const initialHistoryLength = history.length;
    for await (const _event of this.runMeasuredTurn(message, history, messages, null, turnStartedAt)) {
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
    turnStartedAt: number = Date.now()
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    yield* this.runMeasuredTurn(message, history, messages, abortController, turnStartedAt);
  }

  /** Measure end-to-end perceived latency around the single authoritative loop. */
  private async *runMeasuredTurn(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    abortController: AbortController | null,
    startedAt: number
  ): AsyncGenerator<ExecutorEvent, void, unknown> {
    const operationId = getLatencyOptimizer().startOperation('assistant_turn', startedAt);
    let recordedFirstVisibleResponse = false;

    try {
      for await (const event of this.runTurnLoop(message, history, messages, abortController)) {
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
    abortController: AbortController | null
  ): AsyncGenerator<ExecutorEvent, void, unknown> {
    // Shared pre-processing with the sequential path (@mentions, persona
    // auto-select, knowledge graph extraction). Single source of truth in
    // preprocessUserMessage (F10).
    message = await this.preprocessUserMessage(message, messages);

    const { injection: ctxLevel, complexity: queryComplexity } = classifyQuery(message);
    logger.debug(`Query classified as '${queryComplexity}' — context injection level: ${JSON.stringify(ctxLevel)}`);

    // Calculate input tokens
    let inputTokens = this.deps.tokenCounter.countMessageTokens(messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]);
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.config.maxToolRounds;
    let toolRounds = 0;
    let turnInputTokens = 0;
    let totalOutputTokens = 0;
    let uncommittedRoundOutputTokens = 0;
    let sessionCostRecorded = false;
    const recordTurnCost = (): void => {
      if (sessionCostRecorded) return;
      sessionCostRecorded = true;
      this.config.recordSessionCost(
        turnInputTokens,
        totalOutputTokens + uncommittedRoundOutputTokens,
      );
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

    // Phase (d).21 ship 4 — start a progress session for this turn.
    // The default sink (boot-wired) logs at 25/50/75/100. Lazy-import to
    // avoid circular load at module init time.
    try {
      const { getProgressTracker } = await import('../planner/progress-default-sink.js');
      getProgressTracker().start(maxToolRounds);
    } catch { /* progress tracker optional */ }

    try {
      const pipeline = this.deps.middlewarePipeline;
      // Cost accounting is centralized in this loop so every provider request
      // is counted exactly once, including early returns. The legacy middleware
      // recorded cumulative snapshots after tool rounds and the executor then
      // recorded them again at the end of the turn.
      if (pipeline?.getMiddlewareNames?.().includes('cost-limit')) {
        pipeline.remove?.('cost-limit');
        logger.debug('[agent-executor] removed duplicate cost-limit middleware');
      }
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
            compactTurnMessagesInPlace(this.deps.contextManager, messages);
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
          toolRounds === 0 && rebuildSystemPromptForQuery
            ? rebuildSystemPromptForQuery(message).catch((err) => {
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
        if (modelToolConfig.promptProfile === 'lite') {
          selectionOpts = {
            ...selectionOpts,
            maxTools: 5,
            alwaysInclude: ['view_file', 'bash', 'search'],
          };
        }
        const selectionPromise = this.deps.toolSelectionStrategy.selectToolsForQuery(message, selectionOpts);

        // Build context in a scratch array while the prompt and tools are being
        // prepared. It is appended only after transcript preparation so the
        // existing compaction and repair ordering remains unchanged.
        const contextBlocks: CodeBuddyMessage[] = [];
        const contextPromise = toolRounds === 0
          ? injectInitialContext(contextBlocks, {
              message,
              cwd: process.cwd(),
              ctxLevel,
              loadWorkspaceContext: lazyGetWorkspaceContext,
              decisionContextProvider: this.getDecisionContextProvider(),
              icmBridgeProvider: this.getICMBridgeProvider(),
              codeGraphContextProvider: this.getCodeGraphContextProvider(),
              docsContextProvider: this.getDocsContextProvider(),
            })
          : injectNextRoundContext(contextBlocks, {
              message,
              cwd: process.cwd(),
              queryComplexity,
            });

        const [rebuiltSystemPrompt, selectionResult] = await Promise.all([
          rebuiltSystemPromptPromise,
          selectionPromise,
          contextPromise,
        ]);

        const firstMessage = messages[0];
        if (rebuiltSystemPrompt && firstMessage && firstMessage.role === 'system') {
          firstMessage.content = rebuiltSystemPrompt;
          logger.debug(
            `[agent-executor] system prompt rebuilt query-aware (${rebuiltSystemPrompt.length} chars)`,
          );
        }

        let tools = selectionResult.tools;
        let forcedChatOnlyToolRunModel: string | null = null;
        if (toolRounds === 0) this.deps.toolSelectionStrategy.cacheTools(tools, activeModelName);

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

        const preparedMessages = prepareTurnMessages(this.deps.contextManager, messages);
        preparedMessages.push(...contextBlocks);

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

        const roundInputTokens = this.deps.tokenCounter.countMessageTokens(
          preparedMessages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]
        );

        // Refuse a request whose input alone would cross the session budget.
        // It has not been sent yet, so do not add it to the billed turn total.
        if (this.config.estimateSessionCostLimitReached(
          turnInputTokens + roundInputTokens,
          totalOutputTokens,
        )) {
          const sessionCost = this.config.getSessionCost();
          const sessionCostLimit = this.config.getSessionCostLimit();
          yield {
            type: "content",
            content: `\n\nSession cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}). Stopping before the next model request.`,
          };
          yield { type: "done" };
          return;
        }

        inputTokens = roundInputTokens;
        turnInputTokens += roundInputTokens;

        const stream = this.deps.client.chatStream(
          preparedMessages,
          tools,
          undefined,
          this.config.isGrokModel() && this.deps.toolSelectionStrategy.shouldUseSearchFor(message)
            ? { search_parameters: { mode: "auto" } }
            : { search_parameters: { mode: "off" } }
        );

        this.deps.streamingHandler.reset();

        // Stall guard: some backends (ChatGPT/Codex OAuth observed) accept
        // the request then never send a byte — without a bound this loop
        // hangs FOREVER (turns stuck for hours in Cowork and headless waves).
        // Fail fast with a clear error instead; the caller/user retries.
        for await (const chunk of withStallGuard(stream)) {
          if (abortController?.signal.aborted) {
            yield { type: "content", content: "\n\n[Operation cancelled by user]" };
            yield { type: "done" };
            return;
          }

          const result = this.deps.streamingHandler.accumulateChunk(chunk as RawStreamingChunk);
          uncommittedRoundOutputTokens = Math.max(
            uncommittedRoundOutputTokens,
            result.tokenCount ?? this.deps.streamingHandler.getTokenCount() ?? 0,
          );

          if (result.reasoningContent) {
            yield { type: "reasoning", reasoning: result.reasoningContent };
          }

          if (result.hasNewToolCalls && result.toolCalls) {
            yield { type: "tool_calls", toolCalls: result.toolCalls };
          }

          if (result.displayContent) {
            yield { type: "content", content: result.displayContent };
          }

          if (result.shouldEmitTokenCount && result.tokenCount !== undefined) {
            yield { type: "token_count", tokenCount: inputTokens + result.tokenCount };
          }
        }

        if (tools.length > 0 && !this.deps.streamingHandler.hasYieldedToolCalls()) {
          const extracted = this.deps.streamingHandler.extractToolCalls();
          if (extracted.toolCalls.length > 0) {
            yield { type: "tool_calls", toolCalls: extracted.toolCalls };
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
            'Use a tool-capable model such as qwen3.5-ctx32k or gpt-5.5 for goals that need shell/tools.';
          yield { type: "content", content: `${rawStreamedContent}\n` };
        }
        if (!rawStreamedContent) rawStreamedContent = "Using tools to help you...";
        const content = sanitizeAssistantOutput(rawStreamedContent);

        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: content,
          timestamp: new Date(),
          toolCalls: toolCalls,
        };
        history.push(assistantEntry);
        messages.push({ role: "assistant", content: content, tool_calls: toolCalls });

        const currentOutputTokens = Math.max(
          uncommittedRoundOutputTokens,
          this.deps.streamingHandler.getTokenCount() || 0,
        );
        totalOutputTokens += currentOutputTokens;
        uncommittedRoundOutputTokens = 0;
        yield { type: "token_count", tokenCount: inputTokens + totalOutputTokens };

        if (toolCalls && toolCalls.length > 0) {
          toolRounds++;

          // Pre-check cost limit before executing tools (estimate only — no side effects)
          if (this.config.estimateSessionCostLimitReached(turnInputTokens, totalOutputTokens)) {
            const sessionCost = this.config.getSessionCost();
            const sessionCostLimit = this.config.getSessionCostLimit();
            yield { type: "content", content: `\n\nSession cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}). Stopping before tool execution.` };
            yield { type: "done" };
            return;
          }

          // Check for steering messages (steer mode: interrupt execution)
          const mq = this.deps.messageQueue;
          if (mq?.hasSteeringMessage()) {
            const steering = mq.consumeSteeringMessage();
            if (steering) {
              yield { type: "steer", steer: { content: steering.content, source: steering.source } };
              // Inject as user message and skip remaining tool calls
              messages.push({ role: "user", content: steering.content });
              history.push({
                type: "user",
                content: steering.content,
                timestamp: new Date(),
              });
              // Rollback toolRounds since we didn't actually execute any tools
              toolRounds--;
              continue; // Re-enter loop to get new LLM response
            }
          }

          // Single-tool mode: only execute first tool call, re-enqueue rest
          const streamToolCallsToExecute = this.config.singleToolMode
            ? toolCalls.slice(0, 1)
            : toolCalls;

          if (this.config.singleToolMode && toolCalls.length > 1) {
            const deferred = toolCalls.slice(1);
            preparedMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: deferred,
            } as CodeBuddyMessage);
            logger.debug(`Single-tool mode (stream): deferred ${deferred.length} tool calls`);
          }

          if (!this.deps.streamingHandler.hasYieldedToolCalls()) {
            yield { type: "tool_calls", toolCalls: streamToolCallsToExecute };
          }

          // Buffer for streaming adapter chunks (cannot yield from inside a callback)
          const streamChunkBuffer: Array<{ type: "tool_stream"; toolStreamData: { toolCallId: string; toolName: string; delta: string } }> = [];
          // JIT context must persist into the next provider request, but only
          // after every result in this assistant tool-call batch. Inserting a
          // system message between sibling tool results violates provider
          // transcript ordering requirements.
          const jitContextMessages: CodeBuddyMessage[] = [];

          for (const toolCall of streamToolCallsToExecute) {
            if (abortController?.signal.aborted) {
              yield { type: "content", content: "\n\n[Operation cancelled by user]" };
              yield { type: "done" };
              return;
            }

            // --- Proactive context compaction (streaming path) ---
            try {
              const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
              const estimatedTokens = estimateToolResultTokens(toolCall.function.name, toolArgs);
              const modelName = this.deps.client.getCurrentModel();
              const { getModelToolConfig } = await import('../../config/model-tools.js');
              const modelConfig = getModelToolConfig(modelName);
              const contextWindow = modelConfig.contextWindow ?? 128_000;
              if (shouldCompactBeforeToolExec(inputTokens, estimatedTokens, contextWindow)) {
                logger.debug('Proactive compaction (stream): compacting before tool execution', {
                  toolName: toolCall.function.name,
                  inputTokens,
                  estimatedTokens,
                  contextWindow,
                });
                // IN PLACE — the discarded return used to make this a no-op,
                // so the recomputed inputTokens never shrank and this guard
                // re-fired on every tool call while the transcript kept growing.
                compactTurnMessagesInPlace(this.deps.contextManager, messages);
                inputTokens = this.deps.tokenCounter.countMessageTokens(
                  messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]
                );
              }
            } catch { /* proactive compaction is non-critical */ }

            // --- User hooks: PreToolUse (streaming path) ---
            const streamPreHook = await runPreToolUseHook(process.cwd(), toolCall);
            if (!streamPreHook.allowed) {
              const blockedContent = streamPreHook.feedback ?? 'Action blocked by PreToolUse hook';
              yield { type: "content", content: `\n[Hook blocked: ${blockedContent}]\n` };
              pushBlockedToolMessage(messages, toolCall, blockedContent);
              continue;
            }

            // Phase (d).2 — broadcast tool_started to the fleet (opt-in via
            // CODEBUDDY_FLEET_STREAM=1). Best-effort, no-op when disabled
            // or when the WS server isn't running.
            emitFleetToolStarted(toolCall);

            // Use dedicated streaming execution only for tools whose streaming
            // implementation follows the same authorization/observability path
            // as normal dispatch. Bash deliberately goes through executeToolViaLane
            // below so PolicyManager, lifecycle hooks, RunStore and auto-repair
            // cannot be bypassed; the adapter still emits its completed output.
            let result;
            const _streamToolStartMs = Date.now();
            const STREAMING_TOOLS = ['reason', 'generate_document'];
            if (STREAMING_TOOLS.includes(toolCall.function.name)) {
              const gen = this.deps.toolHandler.executeToolStreaming(toolCall);
              let genResult = await gen.next();
              while (!genResult.done) {
                // Check abort between stream chunks
                if (abortController?.signal.aborted) {
                  await gen.return({ success: false, error: 'Aborted' });
                  yield { type: "content", content: "\n\n[Operation cancelled by user]" };
                  yield { type: "done" };
                  return;
                }
                yield {
                  type: "tool_stream",
                  toolStreamData: {
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    delta: genResult.value,
                  },
                };
                genResult = await gen.next();
              }
              result = genResult.value ?? { success: false, error: 'Tool returned no result' };
            } else {
              // Check if the streaming adapter supports this tool
              const { getStreamingAdapter } = await import('../../tools/streaming-adapter.js');
              const streamingAdapter = getStreamingAdapter();
              if (streamingAdapter.supportsStreaming(toolCall.function.name)) {
                const tc = toolCall; // capture for closure
                result = await streamingAdapter.wrapWithStreaming(
                  tc.function.name,
                  () => this.executeToolViaLane(tc),
                  (chunk: string) => {
                    // We cannot yield from inside a callback, so we accumulate
                    // chunks and emit them after. Instead, use a buffer approach.
                    streamChunkBuffer.push({
                      type: "tool_stream" as const,
                      toolStreamData: {
                        toolCallId: tc.id,
                        toolName: tc.function.name,
                        delta: chunk,
                      },
                    });
                  },
                );
                // Flush buffered streaming chunks
                for (const chunk of streamChunkBuffer) {
                  yield chunk;
                }
                streamChunkBuffer.length = 0;
              } else {
                result = await this.executeToolViaLane(toolCall);
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
            await recordToolMetric(toolCall.function.name, result.success, Date.now() - _streamToolStartMs);
            // Phase (d).2 — fleet broadcast on completion (opt-in).
            emitFleetToolCompleted(toolCall, result, Date.now() - _streamToolStartMs);
            // Phase (d).21 ship 3 — proactive notification on tool completion.
            // Default sink logs at info (success) / warn (failure). Gated by
            // quiet hours + rate limit in NotificationManager.
            try {
              const { notify } = await import('../proactive/notification-default-sink.js');
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
              const { getProgressTracker } = await import('../planner/progress-default-sink.js');
              getProgressTracker().update(
                toolCall.id,
                result.success ? 'completed' : 'failed',
                toolCall.function.name,
              );
            } catch { /* progress optional */ }

            // --- Track file access for code graph context (streaming, incremental update) ---
            try {
              const fileToolsStream = new Set(['view_file', 'create_file', 'str_replace_editor', 'file_read', 'file_write']);
              if (fileToolsStream.has(toolCall.function.name)) {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const filePath = args.path || args.file_path || args.target_file || '';
                if (filePath) {
                  const { trackRecentFile } = await import('../../knowledge/code-graph-context-provider.js');
                  trackRecentFile(filePath);
                  if (['create_file', 'str_replace_editor', 'file_write'].includes(toolCall.function.name)) {
                    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
                    const kg = getKnowledgeGraph();
                    if (kg.getStats().tripleCount > 0) {
                      const { updateGraphForFile } = await import('../../knowledge/graph-updater.js');
                      const pathMod = await import('path');
                      const absPath = pathMod.default.resolve(process.cwd(), filePath);
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

            // Check abort after tool execution completes
            if (abortController?.signal.aborted) {
              yield { type: "content", content: "\n\n[Operation cancelled by user]" };
              yield { type: "done" };
              return;
            }

            // Persist the FULL raw output for recovery (restore_context) BEFORE any
            // truncation/compression, so the original is always recoverable, not the shrunk copy.
            const rawForRecovery = sanitizeToolResult(result?.success ? result.output || "Success" : result?.error || "Error");
            persistToolResult(toolCall.id, rawForRecovery);

            // TokenJuice (lossless): before the lossy shrink below, dedupe exactly-repeated
            // blocks + convert any raw HTML → markdown in VERBOSE WEB output (web_fetch/web_search),
            // where the gain is clear and the risk is low. Scoped to those tools on purpose — never
            // applied blindly to structured tool output the agent must parse. Only kicks in above a
            // size threshold; default ON (transforms are exact/semantically-preserving), kill-switch
            // via CODEBUDDY_TOKEN_JUICE=false. The full original was persisted above (recoverable).
            if (
              isTokenJuiceEnabled() &&
              result?.output &&
              result.output.length > JUICE_MIN_CHARS &&
              JUICE_WEB_TOOLS.has(toolCall.function.name)
            ) {
              const juiced = tokenJuice(result.output, { html: true, dedupe: true });
              if (juiced.savedChars > 0) {
                logger.debug(
                  `[token-juice] ${toolCall.function.name}: saved ${juiced.savedChars} chars (${juiced.applied.join('+')})`,
                );
                result = { ...result, output: juiced.output };
              }
            }

            // Shrink very large tool output (> 20k chars) before it reaches the LLM. Prefer
            // lm-resizer (signal-preserving, keeps errors/paths, recoverable) when enabled
            // (CODEBUDDY_LM_RESIZER=true); otherwise fall back to semantic truncation. Both are
            // best-effort; off by default → unchanged behaviour.
            const RAW_OUTPUT_LIMIT = 20_000;
            if (result?.output && result.output.length > RAW_OUTPUT_LIMIT) {
              let shrunk: string | null = null;
              if (isLmResizerEnabled()) {
                const r = await compressWithLmResizer(result.output, message ?? "");
                if (r && r.compressed.length < result.output.length) {
                  const note = r.hash
                    ? `\n[lm-resizer: ~${r.bytesSaved} bytes saved — full output via restore_context (or \`lm-resizer retrieve ${r.hash}\`)]`
                    : "";
                  shrunk = r.compressed + note;
                }
              }
              if (shrunk === null) {
                const truncResult = semanticTruncate(result.output, { maxChars: RAW_OUTPUT_LIMIT });
                if (truncResult.truncated) shrunk = truncResult.output;
              }
              if (shrunk !== null) {
                result = { ...result, output: shrunk };
              }
            }

            // --- Disk-backed tool result (Manus AI #19): the content sent to the LLM
            // (already-shrunk above; the full original was persisted at rawForRecovery). ---
            const rawStreamContent = sanitizeToolResult(result?.success ? result.output || "Success" : result?.error || "Error");

            // --- Observation Variator (Manus AI #17) ---
            const variedStreamContent = applyObservationVariator(toolCall.function.name, rawStreamContent);

            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: result?.success ? result.output || "Success" : result?.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result,
            };
            history.push(toolResultEntry);
            yield { type: "tool_result", toolCall, toolResult: result };

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
                const { maybeAutoCommit } = await import('../../tools/auto-commit.js');
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
              break;
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
              break;
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
              break;
            }

            // --- Yield signal detection (Native Engine v2026.3.14, streaming path) ---
            const streamYieldChildId = extractYieldChildId(rawStreamContent);
            if (streamYieldChildId) {
              yield { type: "content", content: `\n[Waiting for sub-agent to complete...]` };
              await processYieldSignal(streamYieldChildId, messages);
            }
          }

          messages.push(...jitContextMessages);

          if (terminateDetectedStreaming) break;

          inputTokens = this.deps.tokenCounter.countMessageTokens(messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]);
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
            const { applyToolOutputMasking, expireOldToolResults, pruneImageContent } = await import('../../context/tool-output-masking.js');
            expireOldToolResults(messages, toolRounds);
            pruneImageContent(messages);
            applyToolOutputMasking(messages);
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

          // Fire-and-forget auto-capture on final assistant response (streaming)
          try {
            const { getAutoCaptureManager } = await import('../../memory/auto-capture.js');
            const acm = getAutoCaptureManager();
            if (acm) {
              acm.processMessage('assistant', content || '').catch(err => logger.debug('Auto-capture failed', { error: String(err) }));
            }
          } catch { /* auto-capture optional */ }

          // Fire-and-forget ICM episode storage (streaming path)
          if (this.getICMBridgeProvider()) {
            try {
              const icm = this.getICMBridgeProvider()!();
              if (icm?.isAvailable()) {
                const episode = `User: ${message}\nAssistant: ${(content || '').substring(0, 500)}`;
                icm.storeEpisode(episode, {
                  source: 'agent-executor-stream',
                  sessionId: process.env.CODEBUDDY_SESSION_ID,
                  turnNumber: toolRounds,
                }).catch(err => logger.debug('ICM episode store failed', { error: String(err) }));
              }
            } catch { /* ICM store optional */ }
          }

          // Context engine afterTurn hook (Native Engine v2026.3.7 — streaming path)
          try {
            const engine = this.deps.contextManager.getContextEngine?.();
            if (engine) {
              engine.afterTurn(messages, { role: 'assistant' as const, content: content || '' });
            }
          } catch { /* afterTurn hook optional */ }

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
            turnInputTokens,
            totalOutputTokens,
            undefined,
            undefined,
            this.deps.client.getCurrentModel(),
          );
      const streamUsageDisplay = formatTokenUsage({
        inputTokens: turnInputTokens,
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
    }
  }
}
