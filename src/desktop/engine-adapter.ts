/**
 * Engine Adapter Interface
 *
 * Defines the contract between the Cowork Electron app and the
 * Code Buddy engine. Implementations wrap CodeBuddyAgent for
 * direct in-process usage (no HTTP).
 *
 * @module desktop/engine-adapter
 */

import type {
  EngineStreamEvent,
  EngineMessage,
  EngineSessionConfig,
  EngineSessionResult,
  EngineModelInfo,
  EngineMcpServerConfig,
  EnginePermissionRequest,
  EnginePermissionResponse,
} from '../shared/engine-types.js';

// Re-export shared types for convenience
export type {
  EngineStreamEvent,
  EngineStreamEventType,
  EngineMessage,
  EngineSessionConfig,
  EngineSessionResult,
  EngineModelInfo,
  EngineMcpServerConfig,
  EnginePermissionRequest,
  EnginePermissionResponse,
} from '../shared/engine-types.js';

/**
 * Callback for streaming events from the engine.
 */
export type EngineStreamCallback = (event: EngineStreamEvent) => void;

/**
 * Callback for permission requests from the engine.
 * Returns the user's decision (allow/deny/allow_always).
 */
export type EnginePermissionCallback = (
  request: EnginePermissionRequest
) => Promise<EnginePermissionResponse>;

/**
 * Abstract interface for the Code Buddy engine.
 *
 * The Cowork Electron main process instantiates a concrete implementation
 * (CodeBuddyEngineAdapter) and passes it to SessionManager. This decouples
 * the GUI from the agent internals.
 */
export interface EngineAdapter {
  /**
   * Run a streaming session with the engine.
   *
   * @param sessionId - Unique identifier for this session
   * @param messages - Conversation history
   * @param onEvent - Callback invoked for each streaming event
   * @param options - Optional session-level overrides
   * @returns Final session result once the stream completes
   */
  runSession(
    sessionId: string,
    messages: EngineMessage[],
    onEvent: EngineStreamCallback,
    options?: Partial<EngineSessionConfig>,
  ): Promise<EngineSessionResult>;

  /**
   * Cancel a running session.
   */
  cancel(sessionId: string): void;

  /**
   * Deliver user guidance into an active run when the underlying agent
   * supports steer mode. Returns false when there is no active run/agent.
   */
  steer?(sessionId: string, prompt: string): boolean | Promise<boolean>;

  /**
   * Clear internal state for a session (free memory, close resources).
   */
  clearSession(sessionId: string): void;

  /**
   * List available models from the engine.
   */
  getModels(): Promise<EngineModelInfo[]>;

  /**
   * Check if the engine is initialized and ready to accept sessions.
   */
  isReady(): boolean;

  /**
   * Set the permission callback. The engine calls this when it needs
   * user approval for destructive operations.
   */
  setPermissionCallback(callback: EnginePermissionCallback): void;

  /**
   * Synchronise the engine's MCP server registry with the host's
   * (Cowork's) view. Called at boot and whenever the user adds /
   * updates / removes / enables / disables a server in Settings.
   *
   * Implementations should diff against the current registry: add new
   * entries, remove missing ones, and reconnect entries whose transport
   * config changed. Only entries with `enabled !== false` are connected.
   *
   * Optional — adapters that don't expose MCP can omit this and the
   * host will skip the call.
   */
  setMcpServers?(configs: EngineMcpServerConfig[]): Promise<void>;

  /**
   * Reload the engine's skills registry from disk so a SKILL.md
   * installed / removed by the host is picked up without restarting
   * the process. Called from `SessionManager.invalidateSkillsSetup`
   * (Cowork) right after a marketplace install or a manual file edit
   * in `~/.codebuddy/skills/`.
   *
   * Optional — adapters without a skills system can omit this.
   */
  reloadSkills?(): Promise<void>;

  /**
   * Hot-swap the reasoning/thinking level for live sessions —
   * `off | minimal | low | medium | high | xhigh`. Updates the global
   * extended-thinking budget (read per-turn by the OpenAI-compat / Grok /
   * Ollama providers) and the Gemini-native default on cached agents, so the
   * Cowork ReasoningLevelPicker takes effect on the next turn without a session
   * restart. Optional — adapters without a thinking system can omit this.
   */
  setThinkingLevel?(level: string): Promise<void>;

  /**
   * Set the default visual grounding fallback configuration.
   */
  setDefaultVisionGrounding?(enabled: boolean, model?: string): void;

  /**
   * Release all resources. Called when the app is shutting down.
   */
  dispose(): void;
}
