import { EventEmitter } from "events";
import { ChatEntry, StreamingChunk } from "./types.js";
import { Agent } from "../types/agent.js";
import { CodeBuddyMessage, CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolResult } from "../types/index.js";
import { TokenCounter } from "../utils/token-counter.js";
import { ContextManagerV2 } from "../context/context-manager-v2.js";
import { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { SessionStore } from "../persistence/session-store.js";
import { AgentModeManager, AgentMode } from "./agent-mode.js";
import { SandboxManager } from "../security/sandbox.js";
import { MCPClient } from "../mcp/mcp-client.js";
import { CostTracker } from "../utils/cost-tracker.js";
import { PromptCacheManager } from "../optimization/prompt-cache.js";
import { HooksManager } from "../hooks/lifecycle-hooks.js";
import { ModelRouter, RoutingDecision } from "../optimization/model-routing.js";
import { PluginMarketplace } from "../plugins/marketplace.js";
import { getErrorMessage } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { getEnhancedMemory, EnhancedMemory, type MemoryEntry, type MemoryType } from "../memory/index.js";

/**
 * Abstract base class for all agents in the CodeBuddy system.
 * 
 * Provides the foundational infrastructure for:
 * - Message history management (`chatHistory`, `messages`)
 * - Tool execution abstraction
 * - State management (cost, mode, token counting)
 * - Resource disposal
 * 
 * Concrete implementations (like `CodeBuddyAgent`) must implement:
 * - `processUserMessage`: For single-turn interactions
 * - `processUserMessageStream`: For streaming interactions
 * - `executeTool`: For handling tool calls
 */
export abstract class BaseAgent extends EventEmitter implements Agent {
  /** Full history of the current chat session including tool results */
  protected chatHistory: ChatEntry[] = [];
  
  /** 
   * Messages in the format expected by the LLM provider.
   * Includes system prompt, user messages, and tool call/result chains.
   */
  protected messages: CodeBuddyMessage[] = [];
  
  /** Controller for aborting ongoing operations */
  protected abortController: AbortController | null = null;
  
  // Infrastructure
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

  // Memory system
  protected _memory: EnhancedMemory | null = null;
  protected memoryEnabled = true;

  // Configuration & State
  /** Maximum number of tool rounds allowed per user request */
  protected maxToolRounds: number = 50;
  
  /** Whether "YOLO mode" (fully autonomous) is enabled */
  protected yoloMode: boolean = false;
  
  /** Cost limit for the current session in USD */
  protected sessionCostLimit: number = 10;
  
  /** Current accumulated cost of the session in USD */
  protected sessionCost: number = 0;
  
  /** Whether to use RAG for selecting relevant tools */
  protected useRAGToolSelection: boolean = true;
  
  /** Whether to execute independent tool calls in parallel */
  protected parallelToolExecution: boolean = true;
  
  /** Whether to use model routing optimization */
  protected useModelRouting: boolean = false;
  
  /** Result of the last model routing decision */
  protected lastRoutingDecision: RoutingDecision | null = null;

  constructor() {
    super();
  }

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

      // Set project context if we have a working directory
      const cwd = process.cwd();
      if (cwd) {
        this._memory.setProjectContext(cwd).catch(err => {
          logger.warn('Failed to set project context for memory', { error: getErrorMessage(err) });
        });
      }
    }
    return this._memory;
  }

  /**
   * Process a user message and return the response entries.
   * 
   * This method handles the entire agentic loop:
   * 1. Sending the user message to the LLM
   * 2. Receiving tool calls
   * 3. Executing tools
   * 4. Feeding results back to the LLM
   * 5. Repeating until completion or max rounds
   * 
   * @param message - The user's input message
   * @returns A promise resolving to an array of chat entries generated during the turn
   */
  abstract processUserMessage(message: string): Promise<ChatEntry[]>;

  /**
   * Process a user message with streaming response.
   * 
   * Yields chunks of data as they become available, allowing for real-time UI updates.
   * Handles tool execution and multi-turn logic internally while streaming updates.
   * 
   * @param message - The user's input message
   * @returns An async generator yielding `StreamingChunk` objects
   */
  abstract processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown>;

  /**
   * Execute a single tool call requested by the LLM.
   * 
   * @param toolCall - The tool call object from the LLM
   * @returns A promise resolving to the result of the tool execution
   */
  protected abstract executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult>;

  /**
   * Get the full chat history of the current session.
   * 
   * @returns A shallow copy of the chat history array
   */
  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  /**
   * Clear the current conversation history.
   * 
   * Resets `chatHistory` and `messages`.
   * Preserves the system prompt if present.
   * Emits `chat:cleared` event.
   */
  clearChat(): void {
    this.chatHistory = [];
    // Keep only the system message if it exists
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages = [this.messages[0]];
    } else {
      this.messages = [];
    }
    this.emit("chat:cleared");
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
   * Clean up resources
   */
  dispose(): void {
    if (this.tokenCounter) {
      this.tokenCounter.dispose();
    }
    if (this.contextManager) {
      this.contextManager.dispose();
    }
    this.abortCurrentOperation();
    this.chatHistory = [];
    this.messages = [];
    this.emit("disposed");
  }

  // Common getters for infrastructure
  getMode(): AgentMode {
    return this.modeManager.getMode();
  }

  setMode(mode: AgentMode): void {
    this.modeManager.setMode(mode);
    this.emit("mode:changed", mode);
  }

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
  }

  isSessionCostLimitReached(): boolean {
    return this.sessionCost >= this.sessionCostLimit;
  }

  // Checkpoint methods
  createCheckpoint(description: string): void {
    this.checkpointManager.createCheckpoint(description);
  }

  rewindToLastCheckpoint(): { success: boolean; message: string } {
    const result = this.checkpointManager.rewindToLast();
    if (result.success) {
      return {
        success: true,
        message: result.checkpoint
          ? `Rewound to: ${result.checkpoint.description}\nRestored: ${result.restored.join(', ')}`
          : 'No checkpoint found'
      };
    }
    return {
      success: false,
      message: result.errors.join('\n') || 'Failed to rewind'
    };
  }

  getCheckpointList(): string {
    return this.checkpointManager.formatCheckpointList();
  }

  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  // Session methods
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  saveCurrentSession(): void {
    this.sessionStore.updateCurrentSession(this.chatHistory);
  }

  getSessionList(): string {
    return this.sessionStore.formatSessionList();
  }

  exportCurrentSession(outputPath?: string): string | null {
    const currentId = this.sessionStore.getCurrentSessionId();
    if (!currentId) return null;
    return this.sessionStore.exportSessionToFile(currentId, outputPath);
  }

  // Mode methods
  getModeStatus(): string {
    return this.modeManager.formatModeStatus();
  }

  isToolAllowedInCurrentMode(toolName: string): boolean {
    return this.modeManager.isToolAllowed(toolName);
  }

  // Sandbox methods
  getSandboxStatus(): string {
    return this.sandboxManager.formatStatus();
  }

  validateCommand(command: string): { valid: boolean; reason?: string } {
    return this.sandboxManager.validateCommand(command);
  }

  // MCP methods
  async connectMCPServers(): Promise<void> {
    await this.mcpClient.connectAll();
  }

  getMCPStatus(): string {
    return this.mcpClient.formatStatus();
  }

  async getMCPTools(): Promise<Map<string, unknown[]>> {
    return this.mcpClient.getAllTools();
  }

  getMCPClient(): MCPClient {
    return this.mcpClient;
  }

  // Context Management methods

  /**
   * Get current context statistics
   */
  getContextStats() {
    return this.contextManager.getStats(this.messages);
  }

  /**
   * Format context stats as a readable string
   */
  formatContextStats(): string {
    const stats = this.contextManager.getStats(this.messages);
    const status = stats.isCritical ? '🔴 Critical' :
                   stats.isNearLimit ? '🟡 Warning' : '🟢 Normal';
    return `Context: ${stats.totalTokens}/${stats.maxTokens} tokens (${stats.usagePercent.toFixed(1)}%) ${status} | Messages: ${stats.messageCount} | Summaries: ${stats.summarizedSessions}`;
  }

  /**
   * Update context manager configuration
   * @param config - Partial configuration to update
   */
  updateContextConfig(config: {
    maxContextTokens?: number;
    responseReserveTokens?: number;
    recentMessagesCount?: number;
    enableSummarization?: boolean;
    compressionRatio?: number;
  }): void {
    this.contextManager.updateConfig(config);
  }

  // Prompt Cache methods

  /**
   * Get prompt cache manager
   */
  getPromptCacheManager(): PromptCacheManager {
    return this.promptCacheManager;
  }

  /**
   * Get prompt cache statistics
   */
  getPromptCacheStats() {
    return this.promptCacheManager.getStats();
  }

  /**
   * Format prompt cache stats for display
   */
  formatPromptCacheStats(): string {
    return this.promptCacheManager.formatStats();
  }

  // Lifecycle Hooks methods

  /**
   * Get hooks manager
   */
  getHooksManager(): HooksManager {
    return this.hooksManager;
  }

  /**
   * Get hooks status
   */
  getHooksStatus(): string {
    return this.hooksManager.formatStatus();
  }

  // Model Routing methods

  /**
   * Enable or disable automatic model routing
   *
   * When enabled, requests are routed to optimal models based on task complexity
   *
   * @param enabled - Whether to enable model routing
   */
  setModelRouting(enabled: boolean): void {
    this.useModelRouting = enabled;
  }

  /**
   * Check if model routing is enabled
   */
  isModelRoutingEnabled(): boolean {
    return this.useModelRouting;
  }

  /**
   * Get the model router instance
   */
  getModelRouter(): ModelRouter {
    return this.modelRouter;
  }

  /**
   * Get the last routing decision
   */
  getLastRoutingDecision(): RoutingDecision | null {
    return this.lastRoutingDecision;
  }

  /**
   * Get model routing statistics
   */
  getModelRoutingStats() {
    return {
      enabled: this.useModelRouting,
      totalCost: this.modelRouter.getTotalCost(),
      savings: this.modelRouter.getEstimatedSavings(),
      usageByModel: Object.fromEntries(this.modelRouter.getUsageStats()),
      lastDecision: this.lastRoutingDecision,
    };
  }

  /**
   * Format model routing stats for display
   */
  formatModelRoutingStats(): string {
    const stats = this.getModelRoutingStats();
    const lines = [
      '🧭 Model Routing Statistics',
      `├─ Enabled: ${stats.enabled ? '✅' : '❌'}`,
      `├─ Total Cost: $${stats.totalCost.toFixed(4)}`,
      `├─ Savings: $${stats.savings.saved.toFixed(4)} (${stats.savings.percentage.toFixed(1)}%)`,
    ];

    if (stats.lastDecision) {
      lines.push(`├─ Last Model: ${stats.lastDecision.recommendedModel}`);
      lines.push(`└─ Reason: ${stats.lastDecision.reason}`);
    } else {
      lines.push('└─ No routing decisions yet');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Memory System Methods
  // ============================================================================

  /**
   * Store a memory for cross-session persistence
   *
   * @param type - Type of memory (fact, preference, decision, pattern, etc.)
   * @param content - Content to remember
   * @param options - Additional options (tags, importance, etc.)
   * @returns The stored memory entry
   */
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
    if (!this.memoryEnabled) {
      throw new Error('Memory system is disabled');
    }
    return this.memory.store({
      type,
      content,
      ...options,
    });
  }

  /**
   * Recall memories matching a query
   *
   * @param query - Search query
   * @param options - Filter options
   * @returns Matching memories
   */
  async recall(
    query?: string,
    options: {
      types?: MemoryType[];
      tags?: string[];
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryEntry[]> {
    if (!this.memoryEnabled) {
      return [];
    }
    return this.memory.recall({
      query,
      ...options,
    });
  }

  /**
   * Build memory context for system prompt augmentation
   *
   * @param query - Optional query to find relevant memories
   * @returns Context string to add to system prompt
   */
  async getMemoryContext(query?: string): Promise<string> {
    if (!this.memoryEnabled) {
      return '';
    }
    return this.memory.buildContext({
      query,
      includePreferences: true,
      includeProject: true,
      includeRecentSummaries: true,
    });
  }

  /**
   * Store a conversation summary for later recall
   *
   * @param summary - Summary text
   * @param topics - Key topics discussed
   * @param decisions - Decisions made
   */
  async storeConversationSummary(
    summary: string,
    topics: string[],
    decisions?: string[]
  ): Promise<void> {
    if (!this.memoryEnabled) return;

    const sessionId = this.sessionStore.getCurrentSessionId?.() || `session-${Date.now()}`;
    await this.memory.storeSummary({
      sessionId,
      summary,
      topics,
      decisions,
      messageCount: this.messages.length,
    });
  }

  /**
   * Enable or disable memory system
   */
  setMemoryEnabled(enabled: boolean): void {
    this.memoryEnabled = enabled;
    if (!enabled && this._memory) {
      this._memory.dispose();
      this._memory = null;
    }
  }

  /**
   * Check if memory system is enabled
   */
  isMemoryEnabled(): boolean {
    return this.memoryEnabled;
  }

  /**
   * Get memory system statistics
   */
  getMemoryStats(): { totalMemories: number; byType: Record<string, number>; projects: number; summaries: number } | null {
    if (!this.memoryEnabled || !this._memory) {
      return null;
    }
    return this.memory.getStats();
  }

  /**
   * Format memory status for display
   */
  formatMemoryStatus(): string {
    if (!this.memoryEnabled) {
      return '🧠 Memory: Disabled';
    }
    if (!this._memory) {
      return '🧠 Memory: Not initialized';
    }
    return this.memory.formatStatus();
  }

  /**
   * Trim history to prevent memory bloat
   */
  protected trimHistory(maxSize: number = 1000): void {
    if (this.chatHistory.length > maxSize) {
      this.chatHistory = this.chatHistory.slice(-maxSize);
    }

    const maxMessages = maxSize + 1;
    if (this.messages.length > maxMessages) {
      const systemMessage = this.messages[0];
      const recentMessages = this.messages.slice(-maxSize);
      this.messages = [systemMessage, ...recentMessages];
    }
  }
}
