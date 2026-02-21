import { CodeBuddyClient, CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolSelectionResult } from "../codebuddy/tools.js";
import { ToolResult } from "../types/index.js";
import { createTokenCounter } from "../utils/token-counter.js";
import { loadCustomInstructions } from "../utils/custom-instructions.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { getChatOnlySystemPrompt } from "../prompts/index.js";
import { getAutonomyManager } from "../utils/autonomy-manager.js";
import { logger } from "../utils/logger.js";
import { getRepoProfiler } from "./repo-profiler.js";
import { getToolSelectionStrategy, ToolSelectionStrategy } from "./execution/tool-selection-strategy.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { StreamingHandler } from "./streaming/index.js";
import { AgentExecutor } from "./execution/agent-executor.js";
import { ToolHandler } from "./tool-handler.js";
import { BaseAgent } from "./base-agent.js";
import { createAgentInfrastructureSync, AgentInfrastructure } from "./infrastructure/index.js";
import type { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import type { SessionStore } from "../persistence/session-store.js";
import type { CostTracker } from "../utils/cost-tracker.js";
import { getLaneQueue } from "../concurrency/lane-queue.js";
import type { RouteAgentConfig } from "../channels/peer-routing.js";
import { findSkill } from "../skills/index.js";
import { skillMdToUnified } from "../skills/adapters/index.js";
import { MessageQueue, type MessageQueueMode } from "./message-queue.js";
import { CostPredictor } from "../analytics/cost-predictor.js";
import { BudgetAlertManager } from "../analytics/budget-alerts.js";

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
  /** Encapsulated infrastructure dependencies */
  private readonly infrastructure: AgentInfrastructure;

  private codebuddyClient: CodeBuddyClient;
  private toolHandler: ToolHandler;
  private promptBuilder: PromptBuilder;
  private streamingHandler: StreamingHandler;
  private executor: AgentExecutor;

  private toolSelectionStrategy: ToolSelectionStrategy;

  /** Optional peer routing config applied from channel route resolution */
  private peerRoutingConfig: RouteAgentConfig | null = null;

  /** Message queue for steer/followup/collect modes */
  private messageQueue: MessageQueue = new MessageQueue();
  private repairListeners: Record<string, (data: unknown) => void> = {};

  /** Cost prediction before execution */
  private costPredictor!: CostPredictor;
  /** Budget alert monitoring */
  private budgetAlertManager: BudgetAlertManager = new BudgetAlertManager();

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

    // Determine model to use
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const modelToUse = model || savedModel || "grok-code-fast-1";

    // YOLO mode: requires BOTH env var AND explicit config confirmation
    const autonomyManager = getAutonomyManager();
    const envYoloMode = process.env.YOLO_MODE === "true";
    const configYoloMode = autonomyManager.isYOLOEnabled();

    if (envYoloMode && !configYoloMode) {
      logger.warn("YOLO_MODE env var set but not enabled via /yolo command or config. Use '/yolo on' to explicitly enable YOLO mode.");
      this.yoloMode = false;
    } else {
      this.yoloMode = configYoloMode;
    }

    this.maxToolRounds = maxToolRounds || (this.yoloMode ? 400 : 50);

    // Session cost limit with YOLO mode handling
    const YOLO_HARD_LIMIT = 100;
    const maxCostEnv = process.env.MAX_COST ? parseFloat(process.env.MAX_COST) : null;

    if (this.yoloMode) {
      this.sessionCostLimit = maxCostEnv !== null
        ? Math.min(maxCostEnv, YOLO_HARD_LIMIT * 10)
        : YOLO_HARD_LIMIT;
      logger.warn(`YOLO MODE ACTIVE - Cost limit: $${this.sessionCostLimit}, Max rounds: ${this.maxToolRounds}`);
    } else {
      this.sessionCostLimit = maxCostEnv !== null ? maxCostEnv : 10;
    }

    // Detect max context from environment
    const envMaxContext = Number(process.env.CODEBUDDY_MAX_CONTEXT);
    const maxContextTokens = Number.isFinite(envMaxContext) && envMaxContext > 0
      ? envMaxContext
      : undefined;

    // Create infrastructure - encapsulates all manager dependencies
    this.infrastructure = createAgentInfrastructureSync(
      { apiKey, model: modelToUse, baseURL, maxContextTokens },
      { memoryEnabled: this.memoryEnabled, useModelRouting: this.useModelRouting }
    );

    // Bridge to BaseAgent properties for backwards compatibility
    // Note: We cast interface types to concrete types since BaseAgent uses concrete types
    // This is safe because the singletons returned by getters are the concrete implementations
    this.tokenCounter = this.infrastructure.tokenCounter;
    this.contextManager = this.infrastructure.contextManager;
    this.checkpointManager = this.infrastructure.checkpoints as unknown as CheckpointManager;
    this.sessionStore = this.infrastructure.sessions as unknown as SessionStore;
    this.modeManager = this.infrastructure.modeManager;
    this.sandboxManager = this.infrastructure.sandboxManager;
    this.mcpClient = this.infrastructure.mcpClient;
    this.costTracker = this.infrastructure.costs as unknown as CostTracker;
    this.promptCacheManager = this.infrastructure.promptCacheManager;
    this.hooksManager = this.infrastructure.hooksManager;
    this.modelRouter = this.infrastructure.modelRouter;
    this.marketplace = this.infrastructure.marketplace;
    this.repairCoordinator = this.infrastructure.repairCoordinator;

    // Initialize cost prediction and budget alerts
    this.costPredictor = new CostPredictor(this.costTracker);
    this.budgetAlertManager = new BudgetAlertManager();
    this.budgetAlertManager.on('alert', (alert) => {
      logger.warn(`Budget alert [${alert.type}]: ${alert.message}`);
      this.emit('budget:alert', alert);
    });

    // Initialize tool selection
    this.useRAGToolSelection = useRAGToolSelection;
    this.toolSelectionStrategy = getToolSelectionStrategy({ useRAG: useRAGToolSelection });

    // Initialize client
    this.codebuddyClient = new CodeBuddyClient(apiKey, modelToUse, baseURL);

    // Forward repair events from RepairCoordinator (store refs for cleanup)
    this.repairListeners = {
      start: (data: unknown) => this.emit('repair:start', data),
      success: (data: unknown) => this.emit('repair:success', data),
      failed: (data: unknown) => this.emit('repair:failed', data),
      error: (data: unknown) => this.emit('repair:error', data),
    };
    this.repairCoordinator.on('repair:start', this.repairListeners.start);
    this.repairCoordinator.on('repair:success', this.repairListeners.success);
    this.repairCoordinator.on('repair:failed', this.repairListeners.failed);
    this.repairCoordinator.on('repair:error', this.repairListeners.error);

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
      laneQueue: getLaneQueue(),
      laneId: 'agent-tools',
      messageQueue: this.messageQueue,
    }, {
      maxToolRounds: this.maxToolRounds,
      isGrokModel: this.isGrokModel.bind(this),
      recordSessionCost: this.recordSessionCost.bind(this),
      isSessionCostLimitReached: this.isSessionCostLimitReached.bind(this),
      getSessionCost: this.getSessionCost.bind(this),
      getSessionCostLimit: this.getSessionCostLimit.bind(this),
    });

    // Initialize PromptBuilder with Moltbot hooks for intro injection
    this.promptBuilder = new PromptBuilder({
      yoloMode: this.yoloMode,
      memoryEnabled: this.memoryEnabled,
      morphEditorEnabled: !!this.toolHandler.morphEditor,
      cwd: process.cwd()
    }, this.promptCacheManager, this.memory, this.infrastructure.moltbotHooksManager);

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

    // Initialize facades (required before initializeMCP)
    this.initializeFacades();

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Load custom instructions and generate system prompt
    const customInstructions = loadCustomInstructions();

    // Initialize system prompt (async operation) — track readiness
    this.systemPromptReady = this.initializeAgentSystemPrompt(systemPromptId, modelToUse, customInstructions);
  }

  /** Resolves when the system prompt has been loaded (or failed gracefully). */
  public systemPromptReady: Promise<void>;

  /**
   * Link tool executions to an observability run.
   * Called by dev workflows to associate tool calls with a RunStore run.
   */
  public setRunId(runId: string | undefined): void {
    this.toolHandler.setRunId(runId);
  }

  private async initializeAgentSystemPrompt(
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null
  ): Promise<void> {
    try {
      let systemPrompt = await this.promptBuilder.buildSystemPrompt(systemPromptId, modelName, customInstructions);

      // Inject repoProfile.contextPack if available
      try {
        const profiler = getRepoProfiler();
        const profile = await profiler.getProfile();
        if (profile.contextPack) {
          systemPrompt = `${systemPrompt}\n\n[Repo] ${profile.contextPack}`;
          logger.debug('RepoProfiler: injected contextPack into system prompt');
        }
      } catch {
        // Non-fatal — repo profiling is best-effort
      }

      // Inject knowledge base context if any Knowledge.md files are loaded
      try {
        const { getKnowledgeManager } = await import('../knowledge/knowledge-manager.js');
        const km = getKnowledgeManager();
        await km.load();
        const knowledgeBlock = km.buildContextBlock();
        if (knowledgeBlock) {
          systemPrompt = `${systemPrompt}\n\n${knowledgeBlock}`;
          logger.debug('KnowledgeManager: injected knowledge context into system prompt');
        }
      } catch {
        // Non-fatal — knowledge injection is best-effort
      }

      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    } catch (error) {
      logger.error("Failed to initialize system prompt", error as Error);
      // Push a minimal fallback system prompt so the agent is still usable
      this.messages.push({
        role: "system",
        content: "You are a helpful AI coding assistant.",
      });
    }
  }

  private isGrokModel(): boolean {
    const currentModel = this.codebuddyClient.getCurrentModel();
    return currentModel.toLowerCase().includes("codebuddy");
  }

  /**
   * Match the user query against the skill registry and apply the matched
   * skill's context to the tool selection strategy (for tool augmentation)
   * and inject the skill's system prompt into the conversation.
   *
   * This is called at the start of every message processing cycle.
   */
  private applySkillMatching(message: string): void {
    try {
      const match = findSkill(message);
      if (match && match.confidence >= 0.3) {
        const unifiedSkill = skillMdToUnified(match.skill);

        // Set active skill on the tool selection strategy so required tools are included
        this.toolSelectionStrategy.setActiveSkill(unifiedSkill);

        // Inject skill system prompt into the conversation context
        const skillPrompt = unifiedSkill.systemPrompt || unifiedSkill.description;
        if (skillPrompt) {
          // Find existing skill context message and replace, or insert before the last user message
          const existingIdx = this.messages.findIndex(
            m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Skill:')
          );
          const skillMessage = {
            role: 'system' as const,
            content: `[Skill: ${unifiedSkill.name}]\n${skillPrompt}`,
          };

          if (existingIdx >= 0) {
            this.messages[existingIdx] = skillMessage;
          } else {
            // Insert after the main system prompt (index 1)
            const insertIdx = Math.min(1, this.messages.length);
            this.messages.splice(insertIdx, 0, skillMessage);
          }
        }

        logger.debug('Skill matched for query', {
          skill: unifiedSkill.name,
          confidence: match.confidence,
          reason: match.reason,
        });
      } else {
        // No skill matched - clear any previous skill context
        this.toolSelectionStrategy.setActiveSkill(null);
      }
    } catch (error) {
      // Skill matching is best-effort; don't block message processing
      logger.debug('Skill matching failed (non-fatal)', { error: String(error) });
    }
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    // Reset cached tools for new conversation turn
    this.toolSelectionStrategy.clearCache();

    // Match user query against skill registry
    this.applySkillMatching(message);

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

    // Match user query against skill registry
    this.applySkillMatching(message);

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

    // Cost prediction before execution
    const currentModel = this.codebuddyClient.getCurrentModel();
    const prediction = this.costPredictor.predict(
      this.messages as Array<{ role: string; content: string }>,
      currentModel
    );
    logger.debug('Cost prediction', {
      model: prediction.model,
      estimatedCost: `$${prediction.estimatedCost.toFixed(6)}`,
      estimatedInputTokens: prediction.estimatedInputTokens,
      estimatedOutputTokens: prediction.estimatedOutputTokens,
      confidence: prediction.confidence,
    });

    // Warn if predicted cost would exceed remaining budget
    const remainingBudget = this.sessionCostLimit - this.sessionCost;
    if (
      this.sessionCostLimit !== Infinity &&
      prediction.estimatedCost > remainingBudget
    ) {
      yield {
        type: 'content',
        content: `\nWarning: Estimated cost ($${prediction.estimatedCost.toFixed(4)}) may exceed remaining budget ($${remainingBudget.toFixed(4)}).\n`,
      };
    }

    // Model routing - select optimal model based on task complexity.
    // Use local variables (not instance state) to avoid race conditions
    // if multiple streams run concurrently.
    let originalModel: string | null = null;
    let routingDecision: typeof this.lastRoutingDecision = null;
    if (this.useModelRouting) {
      const conversationContext = this.chatHistory
        .slice(-5)
        .map(e => e.content)
        .filter((c): c is string => typeof c === 'string');

      routingDecision = this.modelRouter.route(
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
      // Restore original model if it was changed by routing.
      // Only restore if the model is still the one we set (another call may have changed it).
      if (originalModel && routingDecision &&
          this.codebuddyClient.getCurrentModel() === routingDecision.recommendedModel) {
        this.codebuddyClient.setModel(originalModel);
        logger.debug(`Model routing: restored to ${originalModel}`);
      }

      // Record usage with model router for cost tracking
      if (this.useModelRouting && routingDecision) {
        const inputTokens = this.tokenCounter.countMessageTokens(this.messages as Parameters<typeof this.tokenCounter.countMessageTokens>[0]);
        const totalOutputTokens = this.streamingHandler.getTokenCount() || 0;

        this.modelRouter.recordUsage(
          routingDecision.recommendedModel,
          inputTokens + totalOutputTokens,
          routingDecision.estimatedCost
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
   * Add context files content to the agent's message history.
   * Inserted as a system message after the main system prompt.
   */
  addSystemContext(contextContent: string): void {
    const systemIdx = this.messages.findIndex(m => m.role === 'system');
    const insertAt = systemIdx >= 0 ? systemIdx + 1 : 0;
    this.messages.splice(insertAt, 0, {
      role: 'system',
      content: contextContent,
    });
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

    // Update system prompt for new mode — track readiness
    const customInstructions = loadCustomInstructions();

    this.systemPromptReady = (async () => {
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
   * Enable auto-observation middleware for the computer-use verify loop.
   * Lazily imports and adds AutoObservationMiddleware to the executor's pipeline.
   * Called automatically when a profile with metadata.enableAutoObservation is active.
   */
  enableAutoObservation(config?: Partial<import('./middleware/auto-observation.js').AutoObservationConfig>): void {
    // Ensure the executor has a middleware pipeline
    if (!this.executor.getMiddlewarePipeline()) {
      const { MiddlewarePipeline } = require('./middleware/index.js');
      this.executor.setMiddlewarePipeline(new MiddlewarePipeline());
    }

    // Lazily import and add the middleware
    import('./middleware/auto-observation.js').then(({ AutoObservationMiddleware }) => {
      const pipeline = this.executor.getMiddlewarePipeline();
      if (!pipeline) return;
      // Don't add if already present
      if (pipeline.getMiddlewareNames().includes('auto-observation')) return;
      pipeline.use(new AutoObservationMiddleware(config));
      logger.info('Auto-observation middleware enabled');
    }).catch(err => {
      logger.error('Failed to enable auto-observation middleware', err);
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
    this.routingFacade?.addSessionCost(cost);
    this.costTracker.recordUsage(inputTokens, outputTokens, model);

    // Check budget alerts after recording cost
    if (this.sessionCostLimit !== Infinity) {
      this.budgetAlertManager.check(this.sessionCost, this.sessionCostLimit);
    }
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

  // =========================================================================
  // Peer Routing
  // =========================================================================

  /**
   * Apply peer routing configuration to the agent.
   *
   * When a message is resolved to a specific route via the PeerRouter,
   * the resulting RouteAgentConfig can be applied here to override model,
   * system prompt, temperature, and tool constraints for that session.
   *
   * @param config - The route agent config from peer routing resolution
   */
  /**
   * Set the message queue mode (steer/followup/collect)
   */
  setMessageQueueMode(mode: MessageQueueMode): void {
    this.messageQueue.setMode(mode);
  }

  /**
   * Get the message queue instance for external enqueuing
   */
  getMessageQueue(): MessageQueue {
    return this.messageQueue;
  }

  applyPeerRouting(config: RouteAgentConfig): void {
    this.peerRoutingConfig = config;

    // Apply model override
    if (config.model) {
      this.setModel(config.model);
      logger.debug(`Peer routing: model set to ${config.model}`);
    }

    // Apply system prompt override
    if (config.systemPrompt) {
      this.setSystemPrompt(config.systemPrompt);
      logger.debug('Peer routing: system prompt overridden');
    }

    // Apply max tool rounds
    if (config.maxToolRounds !== undefined) {
      this.maxToolRounds = config.maxToolRounds;
      logger.debug(`Peer routing: max tool rounds set to ${config.maxToolRounds}`);
    }

    this.emit('peer-routing:applied', config);
  }

  /**
   * Get the currently applied peer routing configuration.
   *
   * @returns The current peer routing config, or null if none is applied
   */
  getPeerRoutingConfig(): RouteAgentConfig | null {
    return this.peerRoutingConfig;
  }

  /**
   * Clear peer routing configuration, reverting to defaults.
   */
  clearPeerRouting(): void {
    this.peerRoutingConfig = null;
    this.emit('peer-routing:cleared');
  }

  /**
   * Check if a message should be forwarded to a different agent
   * based on the peer routing config.
   *
   * @returns The target agent ID if message should be forwarded, null otherwise
   */
  shouldForwardToAgent(): string | null {
    if (!this.peerRoutingConfig?.agentId) {
      return null;
    }
    return this.peerRoutingConfig.agentId;
  }

  // =========================================================================
  // Task Planning (Phase 4 - Iteration 2)
  // =========================================================================

  /**
   * Check if a request is complex enough to warrant planning
   */
  needsPlanning(request: string): boolean {
    const { TaskPlanner } = require('./planner/index.js');
    const planner = new TaskPlanner();
    return planner.needsPlanning(request);
  }

  /**
   * Execute a complex request via task planning and DAG execution
   */
  async executePlan(request: string): Promise<ChatEntry[]> {
    const { TaskPlanner, TaskGraph, DelegationEngine } = await import('./planner/index.js');
    const { ProgressTracker } = await import('./planner/progress-tracker.js');

    const planner = new TaskPlanner();
    const decompose = async (prompt: string): Promise<string> => {
      const entries = await this.processUserMessage(prompt);
      return entries.filter(e => e.type === 'assistant').map(e => e.content).join('\n');
    };
    const plan = await planner.createPlan(request, decompose);

    const graph = new TaskGraph(plan.tasks);
    const tracker = new ProgressTracker();
    tracker.start(plan.tasks.length);
    const delegationEngine = new DelegationEngine();
    const entries: ChatEntry[] = [];

    const result = await graph.execute(async (task) => {
      tracker.update(task.id, 'running');
      const progress = tracker.getProgress();
      this.emit('plan:progress', {
        taskId: task.id,
        status: 'running',
        total: progress.total,
        completed: progress.completed,
      });

      try {
        delegationEngine.matchSubagent(task);
        const agentResult = await this.processUserMessage(task.description);
        entries.push(...agentResult);

        tracker.update(task.id, 'completed');
        return { success: true, output: agentResult.map(e => e.content).join('\n'), duration: 0 };
      } catch (error) {
        tracker.update(task.id, 'failed');
        return { success: false, output: String(error), duration: 0 };
      }
    });

    return entries;
  }

  // =========================================================================
  // Orchestration (Phase 4 - Iteration 5)
  // =========================================================================

  /**
   * Check if a request needs multi-agent orchestration
   */
  needsOrchestration(request: string): boolean {
    const keywords = [
      'and also', 'while also', 'in parallel',
      'simultaneously', 'at the same time',
      'review and fix', 'test and deploy',
      'refactor and test', 'build and test',
    ];
    const lower = request.toLowerCase();
    const matchCount = keywords.filter(k => lower.includes(k)).length;
    // Also check for multiple distinct actions (3+ verbs)
    const verbs = lower.match(/\b(create|fix|update|test|deploy|review|refactor|build|add|remove|delete|install|run|check)\b/g);
    return matchCount >= 1 || (verbs ? new Set(verbs).size >= 3 : false);
  }

  /**
   * Handle a canvas event from the A2UI server.
   * Converts the event into a user message and processes it through the agent.
   */
  async onCanvasEvent(event: {
    surfaceId: string;
    componentId?: string;
    name: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    const message = `[Canvas Event] ${event.name} on component "${event.componentId || 'unknown'}" in surface "${event.surfaceId}"${event.context ? `: ${JSON.stringify(event.context)}` : ''}`;
    try {
      await this.processUserMessage(message);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Clean up all resources
   * Should be called when the agent is no longer needed
   */
  dispose(): void {
    // Remove only the forwarding listeners we attached (not other listeners)
    if (this.repairListeners.start) {
      this.repairCoordinator.off('repair:start', this.repairListeners.start);
      this.repairCoordinator.off('repair:success', this.repairListeners.success);
      this.repairCoordinator.off('repair:failed', this.repairListeners.failed);
      this.repairCoordinator.off('repair:error', this.repairListeners.error);
    }
    this.peerRoutingConfig = null;
    super.dispose();
  }
}
