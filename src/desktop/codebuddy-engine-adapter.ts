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
import type {
  EngineAdapter,
  EngineStreamCallback,
  EnginePermissionCallback,
} from './engine-adapter.js';
import type {
  EngineMessage,
  EngineSessionConfig,
  EngineSessionResult,
  EngineModelInfo,
  EngineMcpServerConfig,
} from '../shared/engine-types.js';

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
      const desiredIdentity = `${config.apiKey || ''}:${config.baseURL || ''}:${config.model || ''}`;
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
        );

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
              const cleanMsg = msg.replace(/\x1b\[[0-9;]*m/g, '');
              fullContent += cleanMsg;
              onEvent({ type: 'content', content: cleanMsg });
          });

          return {
            content: fullContent,
            tokenCount: totalTokens,
            toolCallCount,
          };
      }

      // Stream the response
      const stream = agent.processUserMessageStream(lastMessage.content);

      for await (const chunk of stream) {
        // Check for abort
        if (abortController.signal.aborted) {
          break;
        }

        switch (chunk.type) {
          case 'content':
            if (chunk.content) {
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
              onEvent({
                type: 'tool_end',
                tool: {
                  id: chunk.toolCall.id,
                  name: chunk.toolCall.function.name,
                  output: finalOutput,
                  isError: !chunk.toolResult.success,
                  data: chunk.toolResult.data,
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
