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

/**
 * Abstract base class for all agents
 * Provides common infrastructure for message handling, tool execution, and state management
 */
export abstract class BaseAgent extends EventEmitter implements Agent {
  protected chatHistory: ChatEntry[] = [];
  protected messages: CodeBuddyMessage[] = [];
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

  // Configuration & State
  protected maxToolRounds: number = 50;
  protected yoloMode: boolean = false;
  protected sessionCostLimit: number = 10;
  protected sessionCost: number = 0;
  protected useRAGToolSelection: boolean = true;
  protected parallelToolExecution: boolean = true;
  protected useModelRouting: boolean = false;
  protected lastRoutingDecision: RoutingDecision | null = null;

  constructor() {
    super();
  }

  /**
   * Process a user message and return the response entries
   */
  abstract processUserMessage(message: string): Promise<ChatEntry[]>;

  /**
   * Process a user message with streaming response
   */
  abstract processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown>;

  /**
   * Execute a single tool call
   */
  protected abstract executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult>;

  /**
   * Get the full chat history
   */
  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  /**
   * Clear the current conversation
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
