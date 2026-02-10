import { EventEmitter } from "events";
import { ChatEntry, StreamingChunk } from "./types.js";
import { Agent } from "../types/agent.js";
import { CodeBuddyMessage, CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolResult } from "../types/index.js";
import type { TokenCounter } from "../utils/token-counter.js";
import type { ContextManagerV2, ContextMemoryMetrics } from "../context/context-manager-v2.js";
import type { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import type { SessionStore } from "../persistence/session-store.js";
import { AgentModeManager, AgentMode } from "./agent-mode.js";
import type { SandboxManager } from "../security/sandbox.js";
import type { MCPClient } from "../mcp/mcp-client.js";
import type { CostTracker } from "../utils/cost-tracker.js";
import type { PromptCacheManager } from "../optimization/prompt-cache.js";
import type { HooksManager } from "../hooks/lifecycle-hooks.js";
import { ModelRouter, RoutingDecision } from "../optimization/model-routing.js";
import type { PluginMarketplace } from "../plugins/marketplace.js";
import { getEnhancedMemory, EnhancedMemory, type MemoryEntry, type MemoryType } from "../memory/index.js";
import { getErrorMessage } from "../errors/index.js";
import type { RepairCoordinator } from "./execution/repair-coordinator.js";
import { logger } from "../utils/logger.js";

// Import facades
import { AgentContextFacade, type ContextConfig } from "./facades/agent-context-facade.js";
import { SessionFacade, type RewindResult } from "./facades/session-facade.js";
import { ModelRoutingFacade, type ModelRoutingStats } from "./facades/model-routing-facade.js";
import { InfrastructureFacade } from "./facades/infrastructure-facade.js";
import { MessageHistoryManager, type HistoryStats } from "./facades/message-history-manager.js";

/**
 * Comprehensive memory metrics for the agent
 */
export interface AgentMemoryMetrics {
  /** Chat history size */
  chatHistorySize: number;
  /** LLM messages size */
  messagesSize: number;
  /** Maximum chat history allowed */
  maxHistory: number;
  /** Maximum LLM messages allowed */
  maxMessages: number;
  /** Context manager metrics (if available) */
  contextMetrics?: ContextMemoryMetrics;
  /** Estimated memory usage in bytes (rough estimate) */
  estimatedMemoryBytes: number;
  /** Large tool results currently cached */
  cachedToolResults: number;
  /** Whether garbage collection has been triggered this session */
  gcTriggered: boolean;
}

/**
 * Abstract base class for all agents in the CodeBuddy system.
 *
 * This class acts as a lightweight orchestrator that delegates to specialized facades:
 * - AgentContextFacade: Context and memory management
 * - SessionFacade: Session persistence and checkpoints
 * - ModelRoutingFacade: Model routing and cost tracking
 * - InfrastructureFacade: MCP, sandbox, hooks, plugins
 * - MessageHistoryManager: Chat history operations
 *
 * Concrete implementations (like `CodeBuddyAgent`) must implement:
 * - `processUserMessage`: For single-turn interactions
 * - `processUserMessageStream`: For streaming interactions
 * - `executeTool`: For handling tool calls
 */
export abstract class BaseAgent extends EventEmitter implements Agent {
  /**
   * Maximum number of chat history entries to keep in memory.
   * @deprecated Use MessageHistoryManager config instead
   */
  protected static readonly MAX_HISTORY_SIZE = 1000;

  /**
   * Maximum number of LLM messages to keep in memory.
   * @deprecated Use MessageHistoryManager config instead
   */
  protected static readonly MAX_MESSAGES_SIZE = 1000;

  /** Threshold for considering a tool result "large" (in characters) */
  protected static readonly LARGE_RESULT_THRESHOLD = 5000;

  // ============================================================================
  // Facades (initialized by subclasses via initializeFacades)
  // ============================================================================

  /** Context and memory management facade */
  protected contextFacade!: AgentContextFacade;

  /** Session and checkpoint management facade */
  protected sessionFacade!: SessionFacade;

  /** Model routing and cost management facade */
  protected routingFacade!: ModelRoutingFacade;

  /** Infrastructure services facade */
  protected infrastructureFacade!: InfrastructureFacade;

  /** Message history manager */
  protected historyManager: MessageHistoryManager;

  // ============================================================================
  // Legacy Properties (for backward compatibility with subclasses)
  // ============================================================================

  /**
   * @deprecated Use historyManager.getChatHistoryRef() instead
   */
  protected get chatHistory(): ChatEntry[] {
    return this.historyManager.getChatHistoryRef();
  }
  protected set chatHistory(value: ChatEntry[]) {
    this.historyManager.setChatHistory(value);
  }

  /**
   * @deprecated Use historyManager.getMessagesRef() instead
   */
  protected get messages(): CodeBuddyMessage[] {
    return this.historyManager.getMessagesRef();
  }
  protected set messages(value: CodeBuddyMessage[]) {
    this.historyManager.setMessages(value);
  }

  /** Controller for aborting ongoing operations */
  protected abortController: AbortController | null = null;

  /** Whether garbage collection has been explicitly triggered this session */
  protected gcTriggered: boolean = false;

  // Infrastructure managers (kept for backward compatibility with subclasses)
  protected tokenCounter!: TokenCounter;
  protected contextManager!: ContextManagerV2;
  protected checkpointManager!: CheckpointManager;
  protected sessionStore!: SessionStore;
  protected modeManager!: AgentModeManager;
  protected sandboxManager!: SandboxManager;
  protected mcpClient!: MCPClient;
  protected costTracker!: CostTracker;
  protected promptCacheManager!: PromptCacheManager;
  protected hooksManager!: HooksManager;
  protected modelRouter!: ModelRouter;
  protected marketplace!: PluginMarketplace;
  protected repairCoordinator!: RepairCoordinator;

  // Configuration & State
  /** Maximum number of tool rounds allowed per user request */
  protected maxToolRounds: number = 50;

  /** Whether "YOLO mode" (fully autonomous) is enabled */
  protected yoloMode: boolean = false;

  /** Whether to use RAG for selecting relevant tools */
  protected useRAGToolSelection: boolean = true;

  /** Whether to execute independent tool calls in parallel */
  protected parallelToolExecution: boolean = true;

  /** Cost limit for the current session in USD */
  protected sessionCostLimit: number = 10;

  /** Current accumulated cost of the session in USD */
  protected sessionCost: number = 0;

  /** Whether to use model routing optimization */
  protected useModelRouting: boolean = false;

  /** Result of the last model routing decision */
  protected lastRoutingDecision: RoutingDecision | null = null;

  /** Whether memory system is enabled */
  protected memoryEnabled: boolean = true;

  /** Memory system instance (lazy-loaded) */
  protected _memory: EnhancedMemory | null = null;

  /**
   * Lazy-loaded memory system for cross-session context persistence
   */
  protected get memory(): EnhancedMemory {
    if (!this._memory) {
      this._memory = getEnhancedMemory({
        enabled: this.memoryEnabled,
        embeddingEnabled: true,
        useSQLite: true,
        maxMemories: 10000,
        autoSummarize: true,
      });

      const cwd = process.cwd();
      if (cwd) {
        this._memory.setProjectContext(cwd).catch(err => {
          logger.warn('Failed to set project context for memory', { error: getErrorMessage(err) });
        });
      }
    }
    return this._memory;
  }

  constructor() {
    super();
    // Initialize history manager with default config
    this.historyManager = new MessageHistoryManager({
      maxHistorySize: BaseAgent.MAX_HISTORY_SIZE,
      maxMessagesSize: BaseAgent.MAX_MESSAGES_SIZE,
    });
  }

  /**
   * Initialize all facades after managers are set up.
   * Should be called by subclass constructors after setting up managers.
   */
  protected initializeFacades(): void {
    // Context facade
    this.contextFacade = new AgentContextFacade({
      tokenCounter: this.tokenCounter,
      contextManager: this.contextManager,
      getSessionId: () => this.sessionStore?.getCurrentSessionId() ?? undefined,
    });

    // Session facade
    this.sessionFacade = new SessionFacade({
      checkpointManager: this.checkpointManager,
      sessionStore: this.sessionStore,
    });

    // Routing facade
    this.routingFacade = new ModelRoutingFacade({
      modelRouter: this.modelRouter,
      costTracker: this.costTracker,
    });

    // Infrastructure facade
    this.infrastructureFacade = new InfrastructureFacade({
      mcpClient: this.mcpClient,
      sandboxManager: this.sandboxManager,
      hooksManager: this.hooksManager,
      promptCacheManager: this.promptCacheManager,
      marketplace: this.marketplace,
    });
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Process a user message and return the response entries.
   */
  abstract processUserMessage(message: string): Promise<ChatEntry[]>;

  /**
   * Process a user message with streaming response.
   */
  abstract processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown>;

  /**
   * Execute a single tool call requested by the LLM.
   */
  protected abstract executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult>;

  // ============================================================================
  // Core Methods
  // ============================================================================

  getChatHistory(): ChatEntry[] {
    return this.historyManager.getChatHistory();
  }

  clearChat(): void {
    this.historyManager.clearAll(true);
    this.emit("chat:cleared");
  }

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.emit("operation:aborted");
    }
  }

  dispose(): void {
    // Dispose facades
    if (this.contextFacade) {
      this.contextFacade.dispose();
    } else {
      // Backward-compatible fallback for agents/tests that do not initialize facades.
      if (this.tokenCounter) this.tokenCounter.dispose();
      if (this.contextManager) this.contextManager.dispose();
      if (this._memory) {
        this._memory.dispose();
        this._memory = null;
      }
    }
    if (this.repairCoordinator) this.repairCoordinator.dispose();
    if (this.historyManager) this.historyManager.dispose();

    this.abortCurrentOperation();
    this.emit("disposed");
  }

  // ============================================================================
  // Mode Management (delegates to modeManager directly)
  // ============================================================================

  getMode(): AgentMode {
    return this.modeManager.getMode();
  }

  setMode(mode: AgentMode): void {
    this.modeManager.setMode(mode);
    this.emit("mode:changed", mode);
  }

  getModeStatus(): string {
    return this.modeManager.formatModeStatus();
  }

  isToolAllowedInCurrentMode(toolName: string): boolean {
    return this.modeManager.isToolAllowed(toolName);
  }

  // ============================================================================
  // Cost & Session State (delegates to routingFacade)
  // ============================================================================

  isYoloModeEnabled(): boolean {
    return this.yoloMode;
  }

  getSessionCost(): number {
    return this.sessionCost;
  }

  getSessionCostLimit(): number {
    return this.sessionCostLimit;
  }

  setSessionCostLimit(limit: number): void {
    this.sessionCostLimit = limit;
    if (this.routingFacade) {
      this.routingFacade.setSessionCostLimit(limit);
    }
  }

  isSessionCostLimitReached(): boolean {
    return this.sessionCost >= this.sessionCostLimit;
  }

  // ============================================================================
  // Checkpoint Management (delegates to sessionFacade)
  // ============================================================================

  createCheckpoint(description: string): void {
    this.sessionFacade.createCheckpoint(description);
  }

  rewindToLastCheckpoint(): RewindResult {
    return this.sessionFacade.rewindToLastCheckpoint();
  }

  getCheckpointList(): string {
    return this.sessionFacade.getCheckpointList();
  }

  getCheckpointManager(): CheckpointManager {
    return this.sessionFacade.getCheckpointManager();
  }

  // ============================================================================
  // Session Management (delegates to sessionFacade)
  // ============================================================================

  getSessionStore(): SessionStore {
    return this.sessionFacade.getSessionStore();
  }

  saveCurrentSession(): Promise<void> | void {
    return this.sessionFacade.saveCurrentSession(this.historyManager.getChatHistory());
  }

  getSessionList(): Promise<string> | string {
    return this.sessionFacade.getSessionList();
  }

  exportCurrentSession(outputPath?: string): Promise<string | null> | string | null {
    return this.sessionFacade.exportCurrentSession(outputPath);
  }

  // ============================================================================
  // Sandbox Management (delegates to infrastructureFacade)
  // ============================================================================

  getSandboxStatus(): string {
    return this.infrastructureFacade.getSandboxStatus();
  }

  validateCommand(command: string): { valid: boolean; reason?: string } {
    return this.infrastructureFacade.validateCommand(command);
  }

  // ============================================================================
  // MCP Management (delegates to infrastructureFacade)
  // ============================================================================

  async connectMCPServers(): Promise<void> {
    await this.infrastructureFacade.connectMCPServers();
  }

  getMCPStatus(): string {
    return this.infrastructureFacade.getMCPStatus();
  }

  async getMCPTools(): Promise<Map<string, unknown[]>> {
    return this.infrastructureFacade.getMCPTools();
  }

  getMCPClient(): MCPClient {
    return this.infrastructureFacade.getMCPClient();
  }

  protected initializeMCP(): void {
    this.infrastructureFacade.initializeMCP();
  }

  // ============================================================================
  // Context Management (delegates to contextFacade)
  // ============================================================================

  getContextStats() {
    return this.contextFacade.getStats(this.historyManager.getMessages());
  }

  formatContextStats(): string {
    return this.contextFacade.formatStats(this.historyManager.getMessages());
  }

  updateContextConfig(config: ContextConfig): void {
    this.contextFacade.updateConfig(config);
  }

  // ============================================================================
  // Prompt Cache (delegates to infrastructureFacade)
  // ============================================================================

  getPromptCacheManager(): PromptCacheManager {
    return this.infrastructureFacade.getPromptCacheManager();
  }

  getPromptCacheStats() {
    return this.infrastructureFacade.getPromptCacheStats();
  }

  formatPromptCacheStats(): string {
    return this.infrastructureFacade.formatPromptCacheStats();
  }

  // ============================================================================
  // Lifecycle Hooks (delegates to infrastructureFacade)
  // ============================================================================

  getHooksManager(): HooksManager {
    return this.infrastructureFacade.getHooksManager();
  }

  getHooksStatus(): string {
    return this.infrastructureFacade.getHooksStatus();
  }

  // ============================================================================
  // Model Routing (delegates to routingFacade)
  // ============================================================================

  setModelRouting(enabled: boolean): void {
    this.routingFacade.setModelRouting(enabled);
  }

  isModelRoutingEnabled(): boolean {
    return this.routingFacade.isModelRoutingEnabled();
  }

  getModelRouter(): ModelRouter {
    return this.routingFacade.getModelRouter();
  }

  getLastRoutingDecision(): RoutingDecision | null {
    return this.routingFacade.getLastRoutingDecision();
  }

  getModelRoutingStats(): ModelRoutingStats {
    return this.routingFacade.getStats();
  }

  formatModelRoutingStats(): string {
    return this.routingFacade.formatStats();
  }

  // ============================================================================
  // Memory System (delegates to contextFacade)
  // ============================================================================

  async remember(
    type: MemoryType,
    content: string,
    options: {
      summary?: string;
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<MemoryEntry> {
    return this.contextFacade.remember(type, content, options);
  }

  async recall(
    query?: string,
    options: {
      types?: MemoryType[];
      tags?: string[];
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryEntry[]> {
    return this.contextFacade.recall(query, options);
  }

  async getMemoryContext(query?: string): Promise<string> {
    return this.contextFacade.getMemoryContext(query);
  }

  async storeConversationSummary(
    summary: string,
    topics: string[],
    decisions?: string[]
  ): Promise<void> {
    await this.contextFacade.storeConversationSummary(
      summary,
      topics,
      decisions,
      this.historyManager.getMessages().length
    );
  }

  setMemoryEnabled(enabled: boolean): void {
    this.contextFacade.setMemoryEnabled(enabled);
  }

  isMemoryEnabled(): boolean {
    return this.contextFacade.isMemoryEnabled();
  }

  getMemoryStats(): { totalMemories: number; byType: Record<string, number>; projects: number; summaries: number } | null {
    return this.contextFacade.getMemoryStats();
  }

  formatMemoryStatus(): string {
    return this.contextFacade.formatMemoryStatus();
  }

  // ============================================================================
  // Utility (delegates to historyManager)
  // ============================================================================

  /**
   * @deprecated Trimming is now automatic via MessageHistoryManager
   */
  protected trimHistory(
    _maxHistorySize?: number,
    _maxMessagesSize?: number
  ): void {
    // No-op: MessageHistoryManager handles trimming automatically
    // This method is kept for backward compatibility
  }

  /**
   * Get current history statistics for debugging
   */
  getHistoryStats(): HistoryStats {
    return this.historyManager.getStats();
  }

  /**
   * Get comprehensive memory metrics for monitoring and debugging.
   * Includes history sizes, context manager metrics, and estimated memory usage.
   */
  getAgentMemoryMetrics(): AgentMemoryMetrics {
    const stats = this.historyManager.getStats();
    let estimatedBytes = 0;

    // Estimate chat history size
    for (const entry of this.historyManager.getChatHistoryRef()) {
      estimatedBytes += (entry.content?.length || 0) * 2; // UTF-16 chars
      estimatedBytes += (entry.toolResult?.output?.length || 0) * 2;
      estimatedBytes += 100; // Object overhead
    }

    // Estimate messages size
    for (const msg of this.historyManager.getMessagesRef()) {
      if (typeof msg.content === 'string') {
        estimatedBytes += msg.content.length * 2;
      }
      estimatedBytes += 50; // Object overhead
    }

    // Get context manager metrics if available
    let contextMetrics: ContextMemoryMetrics | undefined;
    if (this.contextManager && typeof this.contextManager.getMemoryMetrics === 'function') {
      contextMetrics = this.contextManager.getMemoryMetrics();
    }

    return {
      chatHistorySize: stats.chatHistorySize,
      messagesSize: stats.messagesSize,
      maxHistory: stats.maxHistory,
      maxMessages: stats.maxMessages,
      contextMetrics,
      estimatedMemoryBytes: estimatedBytes,
      cachedToolResults: 0, // Managed by historyManager now
      gcTriggered: this.gcTriggered,
    };
  }

  /**
   * Format memory metrics as a human-readable string.
   * Useful for /memory or /debug commands.
   */
  formatMemoryMetrics(): string {
    const metrics = this.getAgentMemoryMetrics();
    const memoryMB = (metrics.estimatedMemoryBytes / (1024 * 1024)).toFixed(2);

    const lines = [
      '=== Agent Memory Metrics ===',
      '',
      'History:',
      `  Chat entries: ${metrics.chatHistorySize}/${metrics.maxHistory}`,
      `  LLM messages: ${metrics.messagesSize}/${metrics.maxMessages}`,
      `  Estimated size: ${memoryMB} MB`,
      `  GC triggered: ${metrics.gcTriggered ? 'Yes' : 'No'}`,
    ];

    if (metrics.contextMetrics) {
      lines.push('');
      lines.push('Context Manager:');
      lines.push(`  Summaries: ${metrics.contextMetrics.summaryCount}`);
      lines.push(`  Summary tokens: ${metrics.contextMetrics.summaryTokens.toLocaleString()}`);
      lines.push(`  Peak messages: ${metrics.contextMetrics.peakMessageCount}`);
      lines.push(`  Compressions: ${metrics.contextMetrics.compressionCount}`);
      lines.push(`  Tokens saved: ${metrics.contextMetrics.totalTokensSaved.toLocaleString()}`);
    }

    return lines.join('\n');
  }

  /**
   * Force garbage collection and cleanup of agent memory.
   * Should be called during long sessions or when memory pressure is detected.
   *
   * @returns Object with cleanup statistics
   */
  forceMemoryCleanup(): {
    entriesTrimmed: number;
    messagesTrimmed: number;
    contextCleanup?: { summariesRemoved: number; tokensFreed: number };
  } {
    const beforeStats = this.historyManager.getStats();

    // More aggressive trimming - keep only 50% of max
    const aggressiveHistoryLimit = Math.floor(BaseAgent.MAX_HISTORY_SIZE / 2);
    const aggressiveMessagesLimit = Math.floor(BaseAgent.MAX_MESSAGES_SIZE / 2);

    // Temporarily create a new history manager with aggressive limits
    const aggressiveManager = new MessageHistoryManager({
      maxHistorySize: aggressiveHistoryLimit,
      maxMessagesSize: aggressiveMessagesLimit,
    });

    // Transfer data (will auto-trim)
    const currentHistory = this.historyManager.getChatHistory();
    const currentMessages = this.historyManager.getMessages();
    aggressiveManager.setChatHistory(currentHistory);
    aggressiveManager.setMessages(currentMessages);

    // Copy back trimmed data
    this.historyManager.setChatHistory(aggressiveManager.getChatHistory());
    this.historyManager.setMessages(aggressiveManager.getMessages());
    aggressiveManager.dispose();

    // Force context manager cleanup if available
    let contextCleanup: { summariesRemoved: number; tokensFreed: number } | undefined;
    if (this.contextManager && typeof this.contextManager.forceCleanup === 'function') {
      contextCleanup = this.contextManager.forceCleanup();
    }

    this.gcTriggered = true;

    const afterStats = this.historyManager.getStats();
    const result = {
      entriesTrimmed: beforeStats.chatHistorySize - afterStats.chatHistorySize,
      messagesTrimmed: beforeStats.messagesSize - afterStats.messagesSize,
      contextCleanup,
    };

    logger.info('Forced memory cleanup', result);
    this.emit('memory:cleanup', result);

    return result;
  }

  /**
   * Check if memory usage is high and cleanup should be triggered.
   * Returns true if memory pressure is detected.
   */
  isMemoryPressureHigh(): boolean {
    const stats = this.historyManager.getStats();
    const historyUsage = stats.chatHistorySize / stats.maxHistory;
    const messagesUsage = stats.messagesSize / stats.maxMessages;

    // Memory pressure if either is above 80%
    return historyUsage > 0.8 || messagesUsage > 0.8;
  }
}
