import { CodeBuddyClient, CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolSelectionResult } from "../codebuddy/tools.js";
import { ToolResult } from "../types/index.js";
import { createTokenCounter } from "../utils/token-counter.js";
import { loadCustomInstructions } from "../utils/custom-instructions.js";
import { getCheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { getSessionStore } from "../persistence/session-store.js";
import { getAgentModeManager } from "./agent-mode.js";
import { getSandboxManager } from "../security/sandbox.js";
import { getMCPClient } from "../mcp/mcp-client.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { getChatOnlySystemPrompt } from "../prompts/index.js";
import { getCostTracker } from "../utils/cost-tracker.js";
import { getAutonomyManager } from "../utils/autonomy-manager.js";
import { createContextManager } from "../context/context-manager-v2.js";
import { logger } from "../utils/logger.js";
import { getPromptCacheManager } from "../optimization/prompt-cache.js";
import { getHooksManager } from "../hooks/lifecycle-hooks.js";
import { getModelRouter } from "../optimization/model-routing.js";
import { getPluginMarketplace } from "../plugins/marketplace.js";
import { getToolSelectionStrategy, ToolSelectionStrategy } from "./execution/tool-selection-strategy.js";
import { getRepairCoordinator } from "./execution/repair-coordinator.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { StreamingHandler } from "./streaming/index.js";
import { AgentExecutor } from "./execution/agent-executor.js";
import { ToolHandler } from "./tool-handler.js";
import { BaseAgent } from "./base-agent.js";

// Re-export types for backwards compatibility
export type { ChatEntry, StreamingChunk } from "./types.js";
import type { ChatEntry, StreamingChunk } from "./types.js";

/**
 * Main agent class that orchestrates conversation with CodeBuddy AI and tool execution
 *
 * Usage:
 * ```typescript
 * const agent = new CodeBuddyAgent(apiKey);
 * for await (const chunk of agent.processUserMessageStream("Hello")) {
 *   console.log(chunk);
 * }
 *
 * // Clean up when done
 * agent.dispose();
 * ```
 */
export class CodeBuddyAgent extends BaseAgent {
  private codebuddyClient: CodeBuddyClient;
  private toolHandler: ToolHandler;
  private promptBuilder: PromptBuilder;
  private streamingHandler: StreamingHandler;
  private executor: AgentExecutor;
  
  // Maximum history entries to prevent memory bloat (keep last N entries)
  private static readonly MAX_HISTORY_SIZE = 1000;
  
  private toolSelectionStrategy: ToolSelectionStrategy;

  /**
   * Create a new CodeBuddyAgent instance
   *
   * @param apiKey - API key for authentication
   * @param baseURL - Optional base URL for the API endpoint
   * @param model - Optional model name (defaults to saved model or grok-code-fast-1)
   * @param maxToolRounds - Maximum tool execution rounds (default: depends on YOLO mode)
   * @param useRAGToolSelection - Enable RAG-based tool selection (default: true)
   */
  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    useRAGToolSelection: boolean = true,
    systemPromptId?: string  // New: external prompt ID (default, minimal, secure, etc.)
  ) {
    super();
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const modelToUse = model || savedModel || "grok-code-fast-1";

    // YOLO mode: requires BOTH env var AND explicit config confirmation
    // This prevents accidental activation via env var alone
    const autonomyManager = getAutonomyManager();
    const envYoloMode = process.env.YOLO_MODE === "true";
    const configYoloMode = autonomyManager.isYOLOEnabled();

    // YOLO mode requires explicit enablement through autonomy manager
    // Env var alone only triggers a warning, doesn't enable YOLO
    if (envYoloMode && !configYoloMode) {
      logger.warn("YOLO_MODE env var set but not enabled via /yolo command or config. Use '/yolo on' to explicitly enable YOLO mode.");
      this.yoloMode = false;
    } else {
      this.yoloMode = configYoloMode;
    }

    this.maxToolRounds = maxToolRounds || (this.yoloMode ? 400 : 50);

    // Session cost limit: ALWAYS have a hard limit, even in YOLO mode
    // Default $10, YOLO mode gets $100 max (prevents runaway costs)
    const YOLO_HARD_LIMIT = 100; // $100 max even in YOLO mode
    const maxCostEnv = process.env.MAX_COST ? parseFloat(process.env.MAX_COST) : null;

    if (this.yoloMode) {
      // In YOLO mode, use env var if set, otherwise $100 hard limit
      this.sessionCostLimit = maxCostEnv !== null
        ? Math.min(maxCostEnv, YOLO_HARD_LIMIT * 10) // Allow up to $1000 if explicitly set
        : YOLO_HARD_LIMIT;
      logger.warn(`YOLO MODE ACTIVE - Cost limit: $${this.sessionCostLimit}, Max rounds: ${this.maxToolRounds}`);
    } else {
      this.sessionCostLimit = maxCostEnv !== null ? maxCostEnv : 10;
    }

    this.costTracker = getCostTracker();
    this.useRAGToolSelection = useRAGToolSelection;
    this.toolSelectionStrategy = getToolSelectionStrategy({
      useRAG: useRAGToolSelection
    });
    this.codebuddyClient = new CodeBuddyClient(apiKey, modelToUse, baseURL);
    // Tools are now lazy-loaded via getters (see lazy tool getters above)
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize context manager with model-specific limits
    // Detect max tokens from environment or use model default
    const envMaxContext = Number(process.env.CODEBUDDY_MAX_CONTEXT);
    const maxContextTokens = Number.isFinite(envMaxContext) && envMaxContext > 0
      ? envMaxContext
      : undefined;
    this.contextManager = createContextManager(modelToUse, maxContextTokens);

    this.checkpointManager = getCheckpointManager();
    this.sessionStore = getSessionStore();
    this.modeManager = getAgentModeManager();
    this.sandboxManager = getSandboxManager();
    this.mcpClient = getMCPClient();
    this.promptCacheManager = getPromptCacheManager();
    this.hooksManager = getHooksManager(process.cwd());
    this.modelRouter = getModelRouter();
    this.marketplace = getPluginMarketplace();
    this.repairCoordinator = getRepairCoordinator(apiKey, baseURL);

    // Forward repair events from RepairCoordinator
    this.repairCoordinator.on('repair:start', (data) => this.emit('repair:start', data));
    this.repairCoordinator.on('repair:success', (data) => this.emit('repair:success', data));
    this.repairCoordinator.on('repair:failed', (data) => this.emit('repair:failed', data));
    this.repairCoordinator.on('repair:error', (data) => this.emit('repair:error', data));

    // Initialize StreamingHandler
    this.streamingHandler = new StreamingHandler({
      model: modelToUse,
      trackTokens: true,
      sanitizeOutput: true
    });

    // Initialize ToolHandler
    this.toolHandler = new ToolHandler({
      checkpointManager: this.checkpointManager,
      hooksManager: this.hooksManager,
      marketplace: this.marketplace,
      repairCoordinator: this.repairCoordinator
    });

    // Initialize Executor
    this.executor = new AgentExecutor({
      client: this.codebuddyClient,
      toolHandler: this.toolHandler,
      toolSelectionStrategy: this.toolSelectionStrategy,
      streamingHandler: this.streamingHandler,
      contextManager: this.contextManager,
      tokenCounter: this.tokenCounter,
    }, {
      maxToolRounds: this.maxToolRounds,
      isGrokModel: this.isGrokModel.bind(this),
      recordSessionCost: this.recordSessionCost.bind(this),
      isSessionCostLimitReached: this.isSessionCostLimitReached.bind(this),
      sessionCost: this.sessionCost,
      sessionCostLimit: this.sessionCostLimit,
    });

    // Initialize PromptBuilder
    this.promptBuilder = new PromptBuilder({
      yoloMode: this.yoloMode,
      memoryEnabled: this.memoryEnabled,
      morphEditorEnabled: !!this.toolHandler.morphEditor,
      cwd: process.cwd()
    }, this.promptCacheManager, this.memory);

    // Set up executors for the repair coordinator
    this.repairCoordinator.setExecutors({
      commandExecutor: async (cmd: string) => {
        const result = await this.toolHandler.bash.execute(cmd);
        return {
          success: result.success,
          output: result.output || '',
          error: result.error,
        };
      },
      fileReader: async (path: string) => {
        const result = await this.toolHandler.textEditor.view(path);
        return result.output || '';
      },
      fileWriter: async (path: string, content: string) => {
        // Use edit to write file content
        await this.toolHandler.textEditor.create(path, content);
      },
    });

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Load custom instructions and generate system prompt
    const customInstructions = loadCustomInstructions();

    // Initialize system prompt (async operation)
    this.initializeAgentSystemPrompt(systemPromptId, modelToUse, customInstructions);
  }

  private async initializeAgentSystemPrompt(
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null
  ): Promise<void> {
    try {
      const systemPrompt = await this.promptBuilder.buildSystemPrompt(systemPromptId, modelName, customInstructions);
      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    } catch (error) {
      logger.error("Failed to initialize system prompt", error as Error);
    }
  }

  private isGrokModel(): boolean {
    const currentModel = this.codebuddyClient.getCurrentModel();
    return currentModel.toLowerCase().includes("codebuddy");
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    // Reset cached tools for new conversation turn
    this.toolSelectionStrategy.clearCache();

    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });

    // Trim history to prevent memory bloat
    this.trimHistory();

    const newEntries = await this.executor.processUserMessage(
      message,
      this.chatHistory,
      this.messages
    );

    return [userEntry, ...newEntries];
  }

  async *processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    // Create new abort controller for this request
    this.abortController = new AbortController();

    // Reset cached tools for new conversation turn
    this.toolSelectionStrategy.clearCache();

    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });

    // Trim history to prevent memory bloat
    this.trimHistory();

    // Model routing - select optimal model based on task complexity
    let originalModel: string | null = null;
    if (this.useModelRouting) {
      const conversationContext = this.chatHistory
        .slice(-5)
        .map(e => e.content)
        .filter((c): c is string => typeof c === 'string');

      const routingDecision = this.modelRouter.route(
        message,
        conversationContext,
        this.codebuddyClient.getCurrentModel()
      );
      this.lastRoutingDecision = routingDecision;

      // Switch model if different from current
      if (routingDecision.recommendedModel !== this.codebuddyClient.getCurrentModel()) {
        originalModel = this.codebuddyClient.getCurrentModel();
        this.codebuddyClient.setModel(routingDecision.recommendedModel);
        logger.debug(`Model routing: ${originalModel} → ${routingDecision.recommendedModel} (${routingDecision.reason})`);
      }
    }

    try {
      yield* this.executor.processUserMessageStream(
        message,
        this.chatHistory,
        this.messages,
        this.abortController
      );
    } finally {
      // Restore original model if it was changed by routing
      if (originalModel) {
        this.codebuddyClient.setModel(originalModel);
        logger.debug(`Model routing: restored to ${originalModel}`);
      }

      // Record usage with model router for cost tracking
      if (this.useModelRouting && this.lastRoutingDecision) {
        const inputTokens = this.tokenCounter.countMessageTokens(this.messages as any);
        const totalOutputTokens = this.streamingHandler.getTokenCount() || 0;
        
        this.modelRouter.recordUsage(
          this.lastRoutingDecision.recommendedModel,
          inputTokens + totalOutputTokens,
          this.lastRoutingDecision.estimatedCost
        );
      }

      // Clean up abort controller
      this.abortController = null;
    }
  }

  protected async executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    return this.toolHandler.executeTool(toolCall);
  }

  isAutoRepairEnabled(): boolean {
    return this.repairCoordinator.isRepairEnabled();
  }

  setAutoRepair(enabled: boolean): void {
    this.repairCoordinator.setRepairEnabled(enabled);
  }

  async attemptAutoRepair(errorOutput: string, command?: string): Promise<{
    attempted: boolean;
    success: boolean;
    fixes: unknown[];
    message?: string;
  }> {
    return this.repairCoordinator.attemptRepair(errorOutput, command);
  }

  getChatHistory(): ChatEntry[] {
    return super.getChatHistory();
  }

  getCurrentDirectory(): string {
    return this.toolHandler.bash.getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.toolHandler.bash.execute(command);
  }

  getCurrentModel(): string {
    return this.codebuddyClient.getCurrentModel();
  }

  getClient(): CodeBuddyClient {
    return this.codebuddyClient;
  }

  setModel(model: string): void {
    this.codebuddyClient.setModel(model);
    // Update token counter for new model
    this.tokenCounter.dispose();
    this.tokenCounter = createTokenCounter(model);
    // Update context manager for new model limits
    this.contextManager.updateConfig({ model });
  }

  /**
   * Probe the model to check if it supports function calling
   * Makes a quick test request with a simple tool
   */
  async probeToolSupport(): Promise<boolean> {
    return this.codebuddyClient.probeToolSupport();
  }

  switchToChatOnlyMode(): void {
    const customInstructions = loadCustomInstructions();
    const chatOnlyPrompt = getChatOnlySystemPrompt(process.cwd(), customInstructions || undefined);

    // Replace the system message
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = chatOnlyPrompt;
    } else {
      // Insert at the beginning if no system message exists
      this.messages.unshift({
        role: 'system',
        content: chatOnlyPrompt,
      });
    }
  }

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // Clear chat and reset
  clearChat(): void {
    super.clearChat();
  }

  // Image methods
  async processImage(imagePath: string): Promise<ToolResult> {
    return this.toolHandler.imageTool.processImage({ type: 'file', data: imagePath });
  }

  isImageFile(filePath: string): boolean {
    return this.toolHandler.imageTool.isImage(filePath);
  }

  // RAG Tool Selection methods

  /**
   * Enable or disable RAG-based tool selection
   *
   * When enabled, only semantically relevant tools are sent to the LLM,
   * reducing prompt bloat and improving tool selection accuracy.
   *
   * @param enabled - Whether to enable RAG tool selection
   */
  setRAGToolSelection(enabled: boolean): void {
    this.useRAGToolSelection = enabled;
    this.toolSelectionStrategy.updateConfig({ useRAG: enabled });
  }

  /**
   * Check if RAG tool selection is enabled
   */
  isRAGToolSelectionEnabled(): boolean {
    return this.useRAGToolSelection;
  }

  /**
   * Get the last tool selection result
   *
   * Contains information about which tools were selected,
   * their scores, and token savings.
   */
  getLastToolSelection(): ToolSelectionResult | null {
    return this.toolSelectionStrategy.getLastSelection();
  }

  /**
   * Get a formatted summary of the last tool selection
   */
  formatToolSelectionStats(): string {
    return this.toolSelectionStrategy.formatLastSelectionStats();
  }

  /**
   * Classify a query to understand what types of tools might be needed
   */
  classifyUserQuery(query: string) {
    return this.toolSelectionStrategy.classifyQuery(query);
  }

  /**
   * Get tool selection metrics (success rates, missed tools, etc.)
   */
  getToolSelectionMetrics() {
    return this.toolSelectionStrategy.getSelectionMetrics();
  }

  /**
   * Format tool selection metrics as a readable string
   */
  formatToolSelectionMetrics(): string {
    return this.toolSelectionStrategy.formatSelectionMetrics();
  }

  /**
   * Get most frequently missed tools for debugging
   */
  getMostMissedTools(limit: number = 10) {
    return this.toolSelectionStrategy.getMostMissedTools(limit);
  }

  /**
   * Reset tool selection metrics
   */
  resetToolSelectionMetrics(): void {
    this.toolSelectionStrategy.resetMetrics();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.toolSelectionStrategy.getCacheStats();
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.toolSelectionStrategy.clearAllCaches();
  }

  // Parallel Tool Execution methods

  /**
   * Enable or disable parallel tool execution
   *
   * When enabled, multiple read-only tool calls (view_file, search, web_search, etc.)
   * will be executed in parallel for faster response times.
   *
   * Write operations are automatically serialized to prevent conflicts.
   *
   * @param enabled - Whether to enable parallel tool execution
   */
  setParallelToolExecution(enabled: boolean): void {
    this.parallelToolExecution = enabled;
  }

  /**
   * Enable or disable self-healing for bash commands
   *
   * When enabled, failed bash commands will attempt automatic remediation.
   * When disabled (via --no-self-heal flag), commands fail without auto-fix attempts.
   *
   * @param enabled - Whether to enable self-healing
   */
  setSelfHealing(enabled: boolean): void {
    this.toolHandler.bash.setSelfHealing(enabled);
  }

  /**
   * Check if self-healing is enabled for bash commands
   */
  isSelfHealingEnabled(): boolean {
    return this.toolHandler.bash.isSelfHealingEnabled();
  }

  /**
   * Set a custom system prompt (for custom agents)
   *
   * This replaces the current system prompt with a custom one.
   * Used by --agent flag to load custom agent configurations.
   *
   * @param prompt - The custom system prompt content
   */
  setSystemPrompt(prompt: string): void {
    // Find and update the system message
    const systemMessageIndex = this.messages.findIndex(m => m.role === 'system');
    if (systemMessageIndex >= 0) {
      this.messages[systemMessageIndex].content = prompt;
    } else {
      // Add system message if none exists
      this.messages.unshift({
        role: 'system',
        content: prompt,
      });
    }
  }

  /**
   * Get the current system prompt
   */
  getSystemPrompt(): string | null {
    const systemMessage = this.messages.find(m => m.role === 'system');
    return systemMessage?.content as string || null;
  }

  /**
   * Check if parallel tool execution is enabled
   */
  isParallelToolExecutionEnabled(): boolean {
    return this.parallelToolExecution;
  }

  // YOLO Mode methods

  /**
   * Enable or disable YOLO mode
   *
   * YOLO mode enables full autonomy with:
   * - 400 max tool rounds (vs 50 in normal mode)
   * - No session cost limit
   * - Aggressive system prompt for autonomous operation
   *
   * @param enabled - Whether to enable YOLO mode
   */
  setYoloMode(enabled: boolean): void {
    this.yoloMode = enabled;
    this.maxToolRounds = enabled ? 400 : 50;
    this.sessionCostLimit = enabled ? Infinity : 10;

    // Update prompt builder config
    this.promptBuilder.updateConfig({ yoloMode: enabled });

    // Update system prompt for new mode
    const customInstructions = loadCustomInstructions();
    
    (async () => {
      const systemPrompt = await this.promptBuilder.buildSystemPrompt(undefined, this.getCurrentModel(), customInstructions);
      
      // Update the system message
      if (this.messages.length > 0 && this.messages[0].role === "system") {
        this.messages[0].content = systemPrompt;
      }
    })().catch(error => {
      logger.error("Failed to update system prompt for YOLO mode", error as Error);
    });
  }

  /**
   * Record cost for current request
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   */
  private recordSessionCost(inputTokens: number, outputTokens: number): void {
    const model = this.codebuddyClient.getCurrentModel();
    const cost = this.costTracker.calculateCost(inputTokens, outputTokens, model);
    this.sessionCost += cost;
    this.costTracker.recordUsage(inputTokens, outputTokens, model);
  }

  /**
   * Format cost status for display
   */
  formatCostStatus(): string {
    const limitStr = this.sessionCostLimit === Infinity
      ? "unlimited"
      : `$${this.sessionCostLimit.toFixed(2)}`;
    const modeStr = this.yoloMode ? "🔥 YOLO" : "🛡️ Safe";

    return `${modeStr} | Session: $${this.sessionCost.toFixed(4)} / ${limitStr} | Rounds: ${this.maxToolRounds} max`;
  }

  /**
   * Clean up all resources
   * Should be called when the agent is no longer needed
   */
  dispose(): void {
    super.dispose();
  }
}
