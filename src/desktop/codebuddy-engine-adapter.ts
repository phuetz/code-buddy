/**
 * Code Buddy Engine Adapter
 *
 * Wraps CodeBuddyAgent for direct in-process usage from the
 * Electron main process. Translates the AsyncGenerator<StreamingChunk>
 * interface into EngineStreamEvent callbacks.
 *
 * @module desktop/codebuddy-engine-adapter
 */

import { logger } from '../utils/logger.js';
import { createHash } from 'node:crypto';
import { maybeContinueGoalAfterTurn } from '../goals/goal-loop.js';
import { getGoalManager } from '../goals/goal-manager.js';
import type {
  EngineAdapter,
  EngineStreamCallback,
  EnginePermissionCallback,
} from './engine-adapter.js';
import type { EnginePermissionResponse } from '../shared/engine-types.js';
import type { StreamingChunk } from '../agent/types.js';
import type { CodeBuddyClient } from '../codebuddy/client.js';
import { parseContextOptimizationMetadata } from '../shared/context-optimization-metadata.js';
import type {
  EngineMessage,
  EngineSessionConfig,
  EngineSessionResult,
  EngineModelInfo,
  EngineMcpServerConfig,
} from '../shared/engine-types.js';

const COWORK_GOAL_SESSION_PREFIX = 'cowork:';
const GOAL_LOOP_HARD_BACKSTOP = 100;

interface GoalStreamingAgent {
  processUserMessageStream(prompt: string): AsyncIterable<StreamingChunk>;
  getClient?: () => CodeBuddyClient;
}

/**
 * Concrete implementation of EngineAdapter that wraps CodeBuddyAgent.
 *
 * Each session gets its own CodeBuddyAgent instance (stored in a Map).
 * The agent is lazily created on the first runSession() call to avoid
 * slowing down Electron startup.
 */
export class CodeBuddyEngineAdapter implements EngineAdapter {
  private config: EngineSessionConfig;
  /**
   * Cached `CodeBuddyAgent` per session, ordered by last access.
   * `Map` preserves insertion order, so we re-insert on access to keep
   * the LRU semantics: oldest entries (least-recently-used) sit at the
   * head, freshly-touched entries at the tail. When `agents.size >
   * MAX_CACHED_SESSIONS`, we evict from the head (Phase 9).
   */
  private agents: Map<string, unknown> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private permissionCallback: EnginePermissionCallback | null = null;
  private ready = true;
  private disposed = false;
  /** Last-pushed MCP server snapshots for diff-on-sync. */
  private mcpServerSnapshots?: Map<string, string>;
  /**
   * Identity of the cached agent per session: stringified
   * `apiKey:baseURL:model`. When a `runSession` call arrives with a
   * different identity, the cached agent is disposed and a fresh one
   * is created so the user's model switch in Settings actually takes
   * effect on the next turn (Phase 8).
   */
  private agentIdentities: Map<string, string> = new Map();

  /**
   * Configured reasoning/thinking level (`off | minimal | … | xhigh`), set via
   * {@link setThinkingLevel}. Re-applied to each freshly-created agent so a
   * model swap / new session keeps the user's chosen level.
   */
  private thinkingLevel?: string;

  /**
   * Hard cap on cached agents — matches the pi-runner's
   * `MAX_CACHED_SESSIONS` (50) so memory pressure is comparable
   * across runners. Long-running Cowork sessions used to grow the
   * agent registry without bound (Phase 9 fixes that).
   */
  static readonly MAX_CACHED_SESSIONS = 50;

  constructor(config: EngineSessionConfig) {
    this.config = config;
    logger.info('[CodeBuddyEngineAdapter] initialized', {
      model: config.model,
      baseURL: config.baseURL,
      embedded: config.embedded,
      // Surface the optional capabilities so a host (Cowork) log line
      // makes it easy to grep `ag,setMcpServers,reloadSkills,hot-swap,LRU=50`
      // and confirm we're on a recent bundle.
      capabilities: 'setMcpServers,reloadSkills,hot-swap,LRU=' + CodeBuddyEngineAdapter.MAX_CACHED_SESSIONS,
    });
  }

  async runSession(
    sessionId: string,
    messages: EngineMessage[],
    onEvent: EngineStreamCallback,
    options?: Partial<EngineSessionConfig>,
  ): Promise<EngineSessionResult> {
    if (this.disposed) {
      throw new Error('Engine adapter has been disposed');
    }

    const config = { ...this.config, ...options };
    let fullContent = '';
    let totalTokens = 0;
    let toolCallCount = 0;

    try {
      // Lazy-import CodeBuddyAgent to avoid loading heavy modules at startup
      const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');

      // Phase 8 — detect model / endpoint / apiKey change between turns and
      // dispose the cached agent if the identity differs so the next
      // turn picks up the new config. Without this, switching model
      // mid-session in Cowork's Settings was a no-op until the user
      // manually closed the session.
      const promptAppendHash = config.systemPromptAppend
        ? createHash('sha256').update(config.systemPromptAppend).digest('hex').slice(0, 12)
        : '';
      const desiredIdentity = `${config.apiKey || ''}:${config.baseURL || ''}:${config.model || ''}:${config.workingDirectory || ''}:${config.thinkingLevel || ''}:${promptAppendHash}`;
      const cachedIdentity = this.agentIdentities.get(sessionId);
      let agent = this.agents.get(sessionId) as InstanceType<typeof CodeBuddyAgent> | undefined;
      if (agent && cachedIdentity !== desiredIdentity) {
        logger.info('[CodeBuddyEngineAdapter] config changed — disposing cached agent', {
          sessionId,
          from: cachedIdentity,
          to: desiredIdentity,
        });
        try {
          (agent as { dispose?: () => void }).dispose?.();
        } catch (err) {
          logger.warn('[CodeBuddyEngineAdapter] dispose failed during hot-swap', { err });
        }
        this.agents.delete(sessionId);
        agent = undefined;
      }

      // Get or create agent for this session
      if (!agent) {
        agent = new CodeBuddyAgent(
          config.apiKey,
          config.baseURL,
          config.model,
          config.maxToolRounds,
          true,
          undefined,
          config.workingDirectory,
          config.systemPromptAppend,
        );

        if (typeof (agent as any).setVisionGroundingModel === 'function') {
          (agent as any).setVisionGroundingModel(this.config.visionGroundingModel);
        }

        // Re-apply the configured thinking level so a freshly-created agent
        // (new session or post model-swap) keeps the user's chosen level on the
        // Gemini-native path. The OpenAI-compat / Grok / Ollama path reads the
        // global extended-thinking budget per turn, so it needs no per-agent step.
        const effectiveThinkingLevel = config.thinkingLevel || this.thinkingLevel;
        if (effectiveThinkingLevel) {
          this.applyGeminiThinkingLevel(agent, effectiveThinkingLevel);
        }

        // Phase 9 — enforce LRU before insertion so we never exceed
        // the cap. Evict the least-recently-used (head of the
        // insertion-ordered Map) until there's room.
        this.evictUntilUnderCap(CodeBuddyEngineAdapter.MAX_CACHED_SESSIONS - 1);
        this.agents.set(sessionId, agent);
        this.agentIdentities.set(sessionId, desiredIdentity);

        // Load prior conversation history into the agent (for session restore
        // OR for picking up where the previous incarnation left off after a
        // model swap — the messages array always carries the full history).
        if (messages.length > 1) {
          for (let i = 0; i < messages.length - 1; i++) {
            const msg = messages[i];
            if (!msg) continue;
            if (msg.content) {
              agent.addToHistory({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
              });
            }
          }
        }
      } else {
        // Phase 9 — touch the LRU position by re-inserting at the
        // tail. `Map.set` on an existing key is a no-op for value but
        // doesn't reorder; we have to delete + re-set.
        this.agents.delete(sessionId);
        this.agents.set(sessionId, agent);
      }

      // Scope tool execution to the session's working directory (the active
      // Cowork project). Without this the embedded agent's `.codebuddy/`-backed
      // tools (lessons_propose, user_model_observe, …) wrote to the Electron
      // process directory while the review panels read the project dir — the
      // self-improvement review loop never closed. Re-applied every turn so a
      // hot-swapped/reused cached agent always targets the current project.
      // NB: `{ ...this.config, ...options }` above lets an options key that is
      // PRESENT but undefined clobber the adapter default — log the effective
      // value so a missing session cwd is diagnosable from the host log.
      logger.debug('[CodeBuddyEngineAdapter] turn workingDirectory', {
        sessionId,
        workingDirectory: config.workingDirectory ?? '(undefined)',
      });
      agent.setWorkingDirectory(config.workingDirectory);
      agent.setSystemPromptAppend(config.systemPromptAppend);

      // The last message must be the user's current prompt
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        throw new Error('Last message must be a user message');
      }

      // Create abort controller for this session
      const abortController = new AbortController();
      this.abortControllers.set(sessionId, abortController);

      // Intercept /ultraplan
      if (lastMessage.content.trim().startsWith('/ultraplan')) {
          const { handleUltraplan } = await import('../commands/handlers/ultraplan-handler.js');
          const args = lastMessage.content.trim().replace('/ultraplan', '').trim().split(' ');
          
          await handleUltraplan(args, (msg: string) => {
              // Strip ANSI escape codes for cleaner UI display
              const escapeChar = String.fromCharCode(27);
              const cleanMsg = msg.replace(new RegExp(`${escapeChar}\\[[0-9;]*m`, 'g'), '');
              fullContent += cleanMsg;
              onEvent({ type: 'content', content: cleanMsg });
          });

          return {
            content: fullContent,
            tokenCount: totalTokens,
            toolCallCount,
          };
      }

      const streamingAgent = agent as GoalStreamingAgent;
      const goalSessionKey = buildCoworkGoalSessionKey(sessionId);
      const [
        { getPermissionModeManager },
        { getOperatingModeManager },
        { ConfirmationService },
      ] = await Promise.all([
        import('../security/permission-modes.js'),
        import('../agent/operating-modes.js'),
        import('../utils/confirmation-service.js'),
      ]);
      const permissionManager = getPermissionModeManager();
      const operatingModeManager = getOperatingModeManager();
      const confirmationService = ConfirmationService.getInstance();
      const turnPermissionMode = config.permissionMode ?? permissionManager.getMode();

      const runPromptTurn = async (
        prompt: string
      ): Promise<{ interrupted: boolean; judgeResponse: string }> => {
        let turnContent = '';
        const toolEvidence: string[] = [];
        // Tracks FAILED tool actions this turn so the goal judge can't be fooled
        // into a premature "done" by an assistant that narrates success after a
        // write/patch/command actually failed (Hermes-style mutation verifier).
        const toolFailures: string[] = [];
        const stream = streamingAgent.processUserMessageStream(prompt);

        for await (const chunk of stream) {
          // Check for abort
          if (abortController.signal.aborted) {
            return { interrupted: true, judgeResponse: buildGoalJudgeResponse(turnContent, toolEvidence, toolFailures) };
          }

          switch (chunk.type) {
            case 'content':
              if (chunk.content) {
                turnContent += chunk.content;
                fullContent += chunk.content;
                onEvent({ type: 'content', content: chunk.content });
              }
              break;

            case 'reasoning':
              if (chunk.reasoning) {
                onEvent({ type: 'thinking', thinking: chunk.reasoning });
              }
              break;

            case 'tool_calls':
              if (chunk.toolCalls) {
                for (const tc of chunk.toolCalls) {
                  toolCallCount++;
                  onEvent({
                    type: 'tool_start',
                    tool: {
                      id: tc.id,
                      name: tc.function.name,
                      input: tc.function.arguments,
                    },
                  });
                }
              }
              break;

            case 'tool_result':
              if (chunk.toolCall && chunk.toolResult) {
                const finalOutput = chunk.toolResult.output || chunk.toolResult.error;
                const contextOptimization = parseContextOptimizationMetadata(
                  chunk.toolResult.metadata?.contextOptimization,
                );
                const toolStatus = chunk.toolResult.success ? 'success' : 'error';
                if (finalOutput) {
                  toolEvidence.push(
                    `[tool:${chunk.toolCall.function.name} ${toolStatus}]\n${String(finalOutput)}`
                  );
                }
                // Record failures INDEPENDENTLY of finalOutput — a tool that
                // fails with no output/error would otherwise be invisible to the
                // judge (the silent-failure hole).
                if (!chunk.toolResult.success) {
                  const detail = finalOutput ? `: ${truncateFailureDetail(String(finalOutput))}` : '';
                  toolFailures.push(`${chunk.toolCall.function.name}${detail}`);
                }
                onEvent({
                  type: 'tool_end',
                  tool: {
                    id: chunk.toolCall.id,
                    name: chunk.toolCall.function.name,
                    input: chunk.toolCall.function.arguments,
                    output: finalOutput,
                    isError: !chunk.toolResult.success,
                    data: chunk.toolResult.data,
                    ...(contextOptimization ? { contextOptimization } : {}),
                  },
                });
              }
              break;

            case 'tool_stream':
              if (chunk.toolStreamData) {
                onEvent({
                  type: 'tool_stream',
                  tool: {
                    id: chunk.toolStreamData.toolCallId,
                    name: chunk.toolStreamData.toolName,
                    delta: chunk.toolStreamData.delta,
                  },
                });
              }
              break;

            case 'token_count':
              if (chunk.tokenCount !== undefined) {
                totalTokens = chunk.tokenCount;
                onEvent({ type: 'token_count', tokenCount: chunk.tokenCount });
              }
              break;

            case 'ask_user':
              if (chunk.askUser) {
                onEvent({ type: 'ask_user', askUser: chunk.askUser });
              }
              break;

            case 'plan_progress':
              if (chunk.planProgress) {
                onEvent({ type: 'plan_progress', planProgress: chunk.planProgress });
              }
              break;

            case 'steer':
              if (chunk.steer) {
                onEvent({ type: 'steer', steer: chunk.steer });
              }
              break;

            case 'diff_preview':
              if (chunk.diffPreview) {
                onEvent({ type: 'diff_preview', diffPreview: chunk.diffPreview });
              }
              break;

            case 'done':
              onEvent({ type: 'done' });
              break;
          }
        }

        return { interrupted: false, judgeResponse: buildGoalJudgeResponse(turnContent, toolEvidence, toolFailures) };
      };

      const runScopedPromptTurn = (prompt: string) =>
        confirmationService.withApprovalContextAsync(sessionId, () =>
          permissionManager.withModeAsync(turnPermissionMode, () =>
            operatingModeManager.withModeAsync(
              turnPermissionMode === 'plan' ? 'plan' : 'balanced',
              () => runPromptTurn(prompt),
            ),
          ),
        );

      const emitGoalStatus = (message: string): void => {
        const content = `${fullContent ? '\n\n' : ''}${message}\n\n`;
        fullContent += content;
        onEvent({ type: 'content', content });
      };

      // Structured goal-status event for host UIs (Cowork goal banner). Emits the
      // current GoalState snapshot so the renderer can show turn progress without
      // re-reading goal storage. Safe no-op when no goal is set.
      const emitGoalSnapshot = (): void => {
        const s = getGoalManager(goalSessionKey).state;
        if (!s || s.status === 'cleared') return;
        onEvent({
          type: 'goal_status',
          goalStatus: {
            goalId: s.goalId,
            goal: s.goal,
            status: s.status,
            turnsUsed: s.turnsUsed,
            maxTurns: s.maxTurns,
            verifyGated: s.verifyGated === true,
            ...(s.lastVerdict ? { lastVerdict: s.lastVerdict } : {}),
            ...(s.lastReason ? { lastReason: s.lastReason } : {}),
          },
        });
      };

      // Emit once up-front so the banner appears the instant a goal turn starts
      // (before the first judge verdict), then again after each judged turn.
      emitGoalSnapshot();
      let turn = await runScopedPromptTurn(lastMessage.content);
      for (let i = 0; i < GOAL_LOOP_HARD_BACKSTOP; i++) {
        const outcome = await maybeContinueGoalAfterTurn({
          client: streamingAgent.getClient?.() ?? null,
          lastResponse: turn.judgeResponse,
          interrupted: turn.interrupted,
          sessionKey: goalSessionKey,
        });

        if (outcome?.message) {
          emitGoalStatus(outcome.message);
        }
        if (outcome) {
          emitGoalSnapshot();
        }
        if (turn.interrupted || !outcome?.continuationPrompt) {
          break;
        }
        turn = await runScopedPromptTurn(outcome.continuationPrompt);
      }

      return {
        content: fullContent,
        tokenCount: totalTokens,
        toolCallCount,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      onEvent({ type: 'error', error: errorMsg });
      return {
        content: fullContent,
        tokenCount: totalTokens,
        toolCallCount,
      };
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  cancel(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      logger.info('[CodeBuddyEngineAdapter] cancelled session', { sessionId });
    }
  }

  steer(sessionId: string, prompt: string): boolean {
    const controller = this.abortControllers.get(sessionId);
    const agent = this.agents.get(sessionId) as
      | { getMessageQueue?: () => { setMode: (mode: 'steer') => void; enqueue: (msg: { content: string; source: string; timestamp: Date }) => void } }
      | undefined;
    const queue = agent?.getMessageQueue?.();
    if (!controller || controller.signal.aborted || !queue) {
      return false;
    }
    queue.setMode('steer');
    queue.enqueue({ content: prompt, source: 'cowork', timestamp: new Date() });
    logger.info('[CodeBuddyEngineAdapter] steer delivered', { sessionId });
    return true;
  }

  clearSession(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (agent && typeof (agent as { dispose?: () => void }).dispose === 'function') {
      (agent as { dispose: () => void }).dispose();
    }
    this.agents.delete(sessionId);
    this.abortControllers.delete(sessionId);
    this.agentIdentities.delete(sessionId);
    logger.debug('[CodeBuddyEngineAdapter] cleared session', { sessionId });
  }

  /**
   * Drop oldest cached agents until `agents.size <= maxRetained`.
   * `Map` iterates in insertion order, so the first key is the LRU
   * one. Disposes each evicted agent and clears its identity entry
   * so the next runSession for that session id will reconstruct.
   */
  private evictUntilUnderCap(maxRetained: number): void {
    while (this.agents.size > maxRetained) {
      const oldestKey = this.agents.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const evicted = this.agents.get(oldestKey);
      this.agents.delete(oldestKey);
      this.agentIdentities.delete(oldestKey);
      if (evicted && typeof (evicted as { dispose?: () => void }).dispose === 'function') {
        try {
          (evicted as { dispose: () => void }).dispose();
        } catch (err) {
          logger.warn('[CodeBuddyEngineAdapter] dispose failed during LRU eviction', { err });
        }
      }
      logger.info('[CodeBuddyEngineAdapter] LRU evicted agent', { sessionId: oldestKey });
    }
  }

  async getModels(): Promise<EngineModelInfo[]> {
    try {
      const { SUPPORTED_MODELS } = await import('../config/constants.js');
      return Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
        id,
        name: (info as { name?: string }).name || id,
        provider: (info as { provider?: string }).provider,
      }));
    } catch {
      return [{ id: this.config.model || 'default' }];
    }
  }

  isReady(): boolean {
    return this.ready && !this.disposed;
  }

  setPermissionCallback(callback: EnginePermissionCallback): void {
    this.permissionCallback = callback;
    logger.debug('[CodeBuddyEngineAdapter] permission callback set');
    void this.wireInteractiveConfirmationBridge();
  }

  /**
   * Connect the ConfirmationService to the host's permission dialog. This was
   * the dead link that made EVERY embedded confirmation fail closed with
   * « Approval requires an interactive terminal »: Cowork wired its
   * DesktopPermissionBridge to `setPermissionCallback`, but nothing ever
   * called the callback. The interactive bridge routes each confirmation
   * through the host dialog and carries an optional denial reason back to the
   * agent as feedback (Hermes `/deny <reason>` parity).
   */
  private async wireInteractiveConfirmationBridge(): Promise<void> {
    try {
      const { ConfirmationService } = await import('../utils/confirmation-service.js');
      const service = ConfirmationService.getInstance();
      let nextId = 1;
      service.setInteractiveBridge(async (options) => {
        const callback = this.permissionCallback;
        if (!callback) {
          return { confirmed: false, feedback: 'No permission callback available' };
        }
        const raw = await callback({
          id: `conf-${Date.now()}-${nextId++}`,
          operation: options.operation,
          filename: options.filename,
          ...(options.content !== undefined ? { content: options.content } : {}),
          ...(options.diffPreview !== undefined ? { diffPreview: options.diffPreview } : {}),
        });
        // Hosts may bind requestPermissionDetailed (object with a denial
        // reason) or the legacy requestPermission (bare string) — accept both.
        const detailed =
          typeof raw === 'string'
            ? { response: raw }
            : (raw as { response: EnginePermissionResponse; reason?: string });
        if (detailed.response === 'allow') return { confirmed: true };
        if (detailed.response === 'allow_always') return { confirmed: true, dontAskAgain: true };
        return {
          confirmed: false,
          feedback: detailed.reason ?? "Refusé par l'utilisateur depuis l'interface",
        };
      });
      logger.info('[CodeBuddyEngineAdapter] interactive confirmation bridge wired');
    } catch (err) {
      logger.warn('[CodeBuddyEngineAdapter] failed to wire confirmation bridge', { err });
    }
  }

  /**
   * Reload the global SKILL.md registry. Called by Cowork after the
   * user installs / uninstalls / toggles a skill in Settings (Phase 10).
   *
   * Failures are logged but never thrown — a broken skills load
   * shouldn't break the host. The next `findSkill()` call simply
   * returns whatever survived the previous load.
   */
  async reloadSkills(): Promise<void> {
    try {
      const { getSkillRegistry } = await import('../skills/registry.js');
      const registry = getSkillRegistry();
      await registry.reloadAll();
      logger.info('[CodeBuddyEngineAdapter] skills registry reloaded');
    } catch (err) {
      logger.warn('[CodeBuddyEngineAdapter] reloadSkills failed', { err });
    }
  }

  /**
   * Hot-swap the reasoning/thinking level for live sessions. Updates the global
   * extended-thinking budget (read per-turn by the OpenAI-compat / Grok / Ollama
   * providers → effective next turn, no rebuild) and the Gemini-native default on
   * every cached agent. The level is remembered so future agents inherit it.
   */
  async setThinkingLevel(level: string): Promise<void> {
    this.thinkingLevel = level;
    try {
      const { getExtendedThinking } = await import('../agent/extended-thinking.js');
      getExtendedThinking().applyThinkingLevel(level);
    } catch (err) {
      logger.warn('[CodeBuddyEngineAdapter] applyThinkingLevel failed', { err });
    }
    for (const agent of this.agents.values()) {
      this.applyGeminiThinkingLevel(agent, level);
    }
    logger.info('[CodeBuddyEngineAdapter] thinkingLevel set', { level });
  }

  /**
   * Map a UI level to the Gemini-native default thinking level on a single
   * agent's client. `GeminiThinkingLevel` is `minimal|low|medium|high`, so
   * `xhigh` clamps to `high` and `off`/unknown leaves the Gemini default
   * untouched (the global extended-thinking switch already disables it for the
   * OpenAI-compat path). Best-effort; never throws.
   */
  private applyGeminiThinkingLevel(agent: unknown, level: string): void {
    const geminiLevel =
      level === 'minimal' || level === 'low' || level === 'medium'
        ? level
        : level === 'high' || level === 'xhigh'
          ? 'high'
          : null;
    if (!geminiLevel) return;
    try {
      const getClient = (agent as { getClient?: () => CodeBuddyClient }).getClient;
      if (typeof getClient === 'function') {
        getClient.call(agent)?.setDefaultThinkingLevel(geminiLevel);
      }
    } catch {
      /* best effort — Gemini path only */
    }
  }

  /**
   * Synchronise the core MCPManager singleton with the host's view of
   * the MCP servers. Called by Cowork at boot and after any
   * add/update/delete/enable/disable.
   *
   * Diff strategy:
   * - Servers present in `configs` but not in current registry → addServer
   * - Servers present in current registry but not in `configs` → removeServer
   * - Servers in both → compare transport JSON; on mismatch, remove + re-add
   *   so the connection picks up the new config (no in-place patch in core).
   * - `enabled === false` entries are removed if connected, skipped on add.
   *
   * Errors per-server are logged but don't fail the whole sync — one
   * broken MCP shouldn't prevent the others from coming up.
   */
  async setMcpServers(configs: EngineMcpServerConfig[]): Promise<void> {
    const { getMCPManager } = await import('../codebuddy/tools.js');
    const manager = getMCPManager();
    const current = new Map<string, unknown>();
    // The core MCPManager exposes `serverConfigs` only as private state.
    // We track which servers we've added ourselves via this map so we
    // can diff cleanly without reading private internals.
    if (!this.mcpServerSnapshots) {
      this.mcpServerSnapshots = new Map();
    }
    for (const [name, snapshot] of this.mcpServerSnapshots) {
      current.set(name, snapshot);
    }

    const desired = new Map<string, EngineMcpServerConfig>();
    for (const cfg of configs) {
      if (cfg.enabled === false) continue;
      desired.set(cfg.name, cfg);
    }

    // Removals (in current, not in desired)
    for (const name of current.keys()) {
      if (!desired.has(name)) {
        try {
          await manager.removeServer(name);
          this.mcpServerSnapshots.delete(name);
          logger.info('[CodeBuddyEngineAdapter] removed MCP server', { name });
        } catch (err) {
          logger.warn('[CodeBuddyEngineAdapter] removeServer failed', { name, err });
        }
      }
    }

    // Additions + transport-change re-adds
    for (const [name, cfg] of desired) {
      const snapshot = JSON.stringify(cfg.transport);
      if (current.get(name) === snapshot) continue; // unchanged
      // Re-add (drops the existing connection if any)
      if (current.has(name)) {
        try {
          await manager.removeServer(name);
        } catch {
          /* ignore */
        }
      }
      try {
        await manager.addServer({
          name: cfg.name,
          transport: cfg.transport,
          enabled: true,
        });
        this.mcpServerSnapshots.set(name, snapshot);
        logger.info('[CodeBuddyEngineAdapter] added MCP server', {
          name,
          type: cfg.transport.type,
        });
      } catch (err) {
        logger.warn('[CodeBuddyEngineAdapter] addServer failed', { name, err });
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Cancel all running sessions
    for (const [sessionId, controller] of this.abortControllers) {
      controller.abort();
      logger.debug('[CodeBuddyEngineAdapter] aborted session on dispose', { sessionId });
    }

    // Dispose all agents
    for (const [sessionId, agent] of this.agents) {
      if (typeof (agent as { dispose?: () => void }).dispose === 'function') {
        (agent as { dispose: () => void }).dispose();
      }
      logger.debug('[CodeBuddyEngineAdapter] disposed agent', { sessionId });
    }

    this.agents.clear();
    this.abortControllers.clear();
    this.agentIdentities.clear();
    this.permissionCallback = null;
    logger.info('[CodeBuddyEngineAdapter] disposed');
  }

  /**
   * Set the default visual grounding fallback configuration.
   */
  setDefaultVisionGrounding(enabled: boolean, model?: string): void {
    process.env.CODEBUDDY_VISION_GROUNDING = enabled ? '1' : '0';
    if (model !== undefined) {
      process.env.CODEBUDDY_VISION_GROUNDING_MODEL = model;
      this.config.visionGroundingModel = model;
    }
    this.config.visionGroundingEnabled = enabled;

    logger.info('[CodeBuddyEngineAdapter] setDefaultVisionGrounding', { enabled, model });

    // Hot-apply to all currently active/cached agents
    for (const agent of this.agents.values()) {
      if (agent && typeof (agent as any).setVisionGroundingModel === 'function') {
        (agent as any).setVisionGroundingModel(model);
      }
    }
  }

  /**
   * Update the engine configuration (e.g., when user changes API key or model).
   * Existing sessions are not affected; new sessions will use the updated config.
   */
  updateConfig(config: Partial<EngineSessionConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('[CodeBuddyEngineAdapter] config updated', {
      model: this.config.model,
    });
  }
}

function buildCoworkGoalSessionKey(sessionId: string): string {
  return `${COWORK_GOAL_SESSION_PREFIX}${sessionId}`;
}

/** Cap a single failure detail so the footer stays compact for the judge. */
export function truncateFailureDetail(detail: string, max = 160): string {
  const flat = detail.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Build a prominent, NON-bracketed footer listing failed tool actions. The goal
 * judge prompt (goal-state.ts) treats `[tool:…]` bracketed lines as ignorable
 * metadata, so failures must be surfaced as a plain instruction line or the
 * judge discounts them. Returns '' when there are no failures.
 */
export function buildToolFailureFooter(failures: string[]): string {
  if (!failures.length) return '';
  return (
    `⚠️ ${failures.length} tool action(s) failed this turn: ${failures.join('; ')}. ` +
    `Do NOT treat the goal as done if these failures block it — fix or work around them first.`
  );
}

export function buildGoalJudgeResponse(
  content: string,
  toolEvidence: string[],
  toolFailures: string[] = [],
): string {
  const footer = buildToolFailureFooter(toolFailures);
  const parts = [
    content.trim(),
    ...toolEvidence.map((part) => part.trim()),
    footer, // last → most prominent for the LLM judge
  ].filter(Boolean);
  return parts.join('\n\n');
}
