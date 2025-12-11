/**
 * Agent State Module
 *
 * Manages the state of the agent including mode, cost tracking,
 * session management, and configuration.
 * Extracted from GrokAgent for better modularity and testability.
 */

import { EventEmitter } from "events";
import { CostTracker, getCostTracker } from "../utils/cost-tracker.js";
import { AgentModeManager, getAgentModeManager, AgentMode } from "./agent-mode.js";
import { SandboxManager, getSandboxManager } from "../security/sandbox.js";
import { ContextManagerV2, createContextManager } from "../context/context-manager-v2.js";
import { SessionStore, getSessionStore } from "../persistence/session-store.js";
import type { ChatEntry } from "./types.js";

/**
 * Agent configuration options
 */
export interface AgentConfig {
  maxToolRounds: number;
  sessionCostLimit: number;
  yoloMode: boolean;
  parallelToolExecution: boolean;
  ragToolSelection: boolean;
  selfHealing: boolean;
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxToolRounds: 50,
  sessionCostLimit: 10,
  yoloMode: false,
  parallelToolExecution: false,
  ragToolSelection: false,
  selfHealing: true,
};

/**
 * YOLO mode configuration
 */
export const YOLO_CONFIG: Partial<AgentConfig> = {
  maxToolRounds: 400,
  sessionCostLimit: Infinity,
  yoloMode: true,
};

/**
 * AgentState manages all state-related concerns for the agent.
 */
export class AgentState extends EventEmitter {
  // Configuration
  private config: AgentConfig;

  // Cost tracking
  private sessionCost = 0;
  private costTracker: CostTracker;

  // Managers
  private modeManager: AgentModeManager;
  private sandboxManager: SandboxManager;
  private contextManager: ContextManagerV2;
  private sessionStore: SessionStore;

  // Tool selection state
  private lastToolSelection: unknown | null = null;

  // Abort controller for cancellation
  private abortController: AbortController | null = null;

  constructor(options: Partial<AgentConfig> = {}) {
    super();

    // Merge config with defaults
    this.config = { ...DEFAULT_AGENT_CONFIG, ...options };

    // Apply YOLO mode if set in environment or options
    if (process.env.YOLO_MODE === "true" || options.yoloMode) {
      this.config = { ...this.config, ...YOLO_CONFIG };
    }

    // Apply MAX_COST from environment
    if (process.env.MAX_COST) {
      const maxCost = parseFloat(process.env.MAX_COST);
      if (!isNaN(maxCost) && maxCost > 0) {
        this.config.sessionCostLimit = maxCost;
      }
    }

    // Initialize managers - use existing singleton instances
    this.costTracker = getCostTracker();
    this.modeManager = getAgentModeManager();
    this.sandboxManager = getSandboxManager();
    this.contextManager = createContextManager("grok-3-latest");
    this.sessionStore = getSessionStore();
  }

  // ============ Configuration Methods ============

  /**
   * Get current configuration
   */
  getConfig(): Readonly<AgentConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AgentConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...updates };
    this.emit("config:updated", { old: oldConfig, new: this.config });
  }

  /**
   * Get max tool rounds
   */
  getMaxToolRounds(): number {
    return this.config.maxToolRounds;
  }

  /**
   * Set max tool rounds
   */
  setMaxToolRounds(rounds: number): void {
    this.config.maxToolRounds = rounds;
  }

  // ============ YOLO Mode Methods ============

  /**
   * Enable or disable YOLO mode
   */
  setYoloMode(enabled: boolean): void {
    if (enabled) {
      this.updateConfig(YOLO_CONFIG);
    } else {
      this.updateConfig({
        maxToolRounds: DEFAULT_AGENT_CONFIG.maxToolRounds,
        sessionCostLimit: DEFAULT_AGENT_CONFIG.sessionCostLimit,
        yoloMode: false,
      });
    }
    this.emit("yolo:changed", enabled);
  }

  /**
   * Check if YOLO mode is enabled
   */
  isYoloModeEnabled(): boolean {
    return this.config.yoloMode;
  }

  // ============ Cost Tracking Methods ============

  /**
   * Get current session cost
   */
  getSessionCost(): number {
    return this.sessionCost;
  }

  /**
   * Get session cost limit
   */
  getSessionCostLimit(): number {
    return this.config.sessionCostLimit;
  }

  /**
   * Set session cost limit
   */
  setSessionCostLimit(limit: number): void {
    this.config.sessionCostLimit = limit;
    this.emit("costLimit:changed", limit);
  }

  /**
   * Check if session cost limit has been reached
   */
  isSessionCostLimitReached(): boolean {
    return this.sessionCost >= this.config.sessionCostLimit;
  }

  /**
   * Record cost for current request
   */
  recordSessionCost(inputTokens: number, outputTokens: number, model: string): void {
    const cost = this.costTracker.calculateCost(inputTokens, outputTokens, model);
    this.sessionCost += cost;
    this.costTracker.recordUsage(inputTokens, outputTokens, model);
    this.emit("cost:recorded", { cost, total: this.sessionCost });

    if (this.isSessionCostLimitReached()) {
      this.emit("cost:limitReached", this.sessionCost);
    }
  }

  /**
   * Format cost status for display
   */
  formatCostStatus(): string {
    const limitStr =
      this.config.sessionCostLimit === Infinity
        ? "unlimited"
        : `$${this.config.sessionCostLimit.toFixed(2)}`;
    const modeStr = this.config.yoloMode ? "YOLO" : "Safe";

    return `${modeStr} | Session: $${this.sessionCost.toFixed(4)} / ${limitStr} | Rounds: ${this.config.maxToolRounds} max`;
  }

  /**
   * Get the cost tracker
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  // ============ Mode Methods ============

  /**
   * Get current mode
   */
  getMode(): AgentMode {
    return this.modeManager.getMode();
  }

  /**
   * Set mode
   */
  setMode(mode: AgentMode): void {
    this.modeManager.setMode(mode);
    this.emit("mode:changed", mode);
  }

  /**
   * Get mode status
   */
  getModeStatus(): string {
    return this.modeManager.formatModeStatus();
  }

  /**
   * Check if tool is allowed in current mode
   */
  isToolAllowedInCurrentMode(toolName: string): boolean {
    return this.modeManager.isToolAllowed(toolName);
  }

  /**
   * Get the mode manager
   */
  getModeManager(): AgentModeManager {
    return this.modeManager;
  }

  // ============ Sandbox Methods ============

  /**
   * Get sandbox status
   */
  getSandboxStatus(): string {
    return this.sandboxManager.formatStatus();
  }

  /**
   * Validate a command in sandbox
   */
  validateCommand(command: string): { valid: boolean; reason?: string } {
    return this.sandboxManager.validateCommand(command);
  }

  /**
   * Get the sandbox manager
   */
  getSandboxManager(): SandboxManager {
    return this.sandboxManager;
  }

  // ============ Context Methods ============

  /**
   * Get context statistics
   */
  getContextStats(messages: unknown[]) {
    // Cast to expected type - context manager expects GrokMessage[]
    return this.contextManager.getStats(messages as never[]);
  }

  /**
   * Format context stats as a readable string
   */
  formatContextStats(messages: unknown[]): string {
    const stats = this.contextManager.getStats(messages as never[]);
    const status = stats.isCritical
      ? "Critical"
      : stats.isNearLimit
        ? "Warning"
        : "Normal";
    return `Context: ${stats.totalTokens}/${stats.maxTokens} tokens (${stats.usagePercent.toFixed(1)}%) ${status} | Messages: ${stats.messageCount} | Summaries: ${stats.summarizedSessions}`;
  }

  /**
   * Update context manager configuration
   */
  updateContextConfig(config: {
    maxContextTokens?: number;
    responseReserveTokens?: number;
    recentMessagesCount?: number;
    enableSummarization?: boolean;
    compressionRatio?: number;
    model?: string;
  }): void {
    this.contextManager.updateConfig(config);
  }

  /**
   * Get the context manager
   */
  getContextManager(): ContextManagerV2 {
    return this.contextManager;
  }

  // ============ Session Methods ============

  /**
   * Save current session
   */
  saveCurrentSession(chatHistory: ChatEntry[]): void {
    this.sessionStore.updateCurrentSession(chatHistory);
  }

  /**
   * Get session list
   */
  getSessionList(): string {
    return this.sessionStore.formatSessionList();
  }

  /**
   * Export current session
   */
  exportCurrentSession(outputPath?: string): string | null {
    const currentId = this.sessionStore.getCurrentSessionId();
    if (!currentId) return null;
    return this.sessionStore.exportSessionToFile(currentId, outputPath);
  }

  /**
   * Get the session store
   */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  // ============ Parallel Execution Methods ============

  /**
   * Enable or disable parallel tool execution
   */
  setParallelToolExecution(enabled: boolean): void {
    this.config.parallelToolExecution = enabled;
    this.emit("parallel:changed", enabled);
  }

  /**
   * Check if parallel tool execution is enabled
   */
  isParallelToolExecutionEnabled(): boolean {
    return this.config.parallelToolExecution;
  }

  // ============ RAG Tool Selection Methods ============

  /**
   * Enable or disable RAG tool selection
   */
  setRAGToolSelection(enabled: boolean): void {
    this.config.ragToolSelection = enabled;
    this.emit("rag:changed", enabled);
  }

  /**
   * Check if RAG tool selection is enabled
   */
  isRAGToolSelectionEnabled(): boolean {
    return this.config.ragToolSelection;
  }

  /**
   * Set the last tool selection result
   */
  setLastToolSelection(selection: unknown): void {
    this.lastToolSelection = selection;
  }

  /**
   * Get the last tool selection result
   */
  getLastToolSelection(): unknown | null {
    return this.lastToolSelection;
  }

  // ============ Abort Control Methods ============

  /**
   * Create a new abort controller
   */
  createAbortController(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }

  /**
   * Get the current abort controller
   */
  getAbortController(): AbortController | null {
    return this.abortController;
  }

  /**
   * Abort the current operation
   */
  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.emit("operation:aborted");
    }
  }

  /**
   * Clear the abort controller
   */
  clearAbortController(): void {
    this.abortController = null;
  }

  /**
   * Check if operation was aborted
   */
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  // ============ Cleanup Methods ============

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Abort any ongoing operations
    this.abortCurrentOperation();
    this.abortController = null;

    // Clean up context manager
    this.contextManager.dispose();

    // Clear state
    this.sessionCost = 0;
    this.lastToolSelection = null;

    this.emit("disposed");
  }
}
