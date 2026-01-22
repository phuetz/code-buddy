/**
 * Agent Interfaces
 *
 * Core interfaces for agent implementations in the CodeBuddy system.
 * These interfaces enable dependency injection, testability, and
 * consistent behavior across different agent types.
 */

import type { EventEmitter } from 'events';
import type { ToolResult } from '../../types/index.js';

// ============================================================================
// Chat Entry Types
// ============================================================================

/**
 * Type of chat entry
 */
export type ChatEntryType = 'user' | 'assistant' | 'tool_result' | 'tool_call';

/**
 * Represents a single entry in the chat history
 */
export interface IChatEntry {
  type: ChatEntryType;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

/**
 * Streaming chunk type
 */
export type StreamingChunkType = 'content' | 'tool_calls' | 'tool_result' | 'done' | 'token_count';

/**
 * Represents a chunk in a streaming response
 */
export interface IStreamingChunk {
  type: StreamingChunkType;
  content?: string;
  tokenCount?: number;
  toolResult?: ToolResult;
}

// ============================================================================
// Tool Interfaces
// ============================================================================

/**
 * Tool call request from the LLM
 */
export interface IToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Parsed tool call with typed arguments
 */
export interface IParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// Core Agent Interface
// ============================================================================

/**
 * Base agent interface for all agent implementations.
 *
 * This interface defines the minimal contract for agents:
 * - Process user messages (single-turn or streaming)
 * - Access chat history
 * - Lifecycle management
 */
export interface IAgent extends EventEmitter {
  /**
   * Process a user message and return the response entries.
   *
   * @param message - The user's input message
   * @returns Array of chat entries generated during the turn
   */
  processUserMessage(message: string): Promise<IChatEntry[]>;

  /**
   * Process a user message with streaming response.
   *
   * @param message - The user's input message
   * @returns Async generator yielding streaming chunks
   */
  processUserMessageStream(message: string): AsyncGenerator<IStreamingChunk, void, unknown>;

  /**
   * Get the full chat history
   */
  getChatHistory(): IChatEntry[];

  /**
   * Clear the current conversation history
   */
  clearChat(): void;

  /**
   * Clean up resources
   */
  dispose(): void;
}

// ============================================================================
// Extended Agent Interface
// ============================================================================

/**
 * Mode for agent operation
 */
export type AgentModeType = 'plan' | 'code' | 'ask' | 'architect';

/**
 * Extended agent interface with additional capabilities.
 *
 * Provides access to advanced features like:
 * - Mode management
 * - Session management
 * - Cost tracking
 * - Checkpoints
 */
export interface IExtendedAgent extends IAgent {
  /**
   * Get current agent mode
   */
  getMode(): AgentModeType;

  /**
   * Set agent mode
   */
  setMode(mode: AgentModeType): void;

  /**
   * Check if YOLO mode is enabled
   */
  isYoloModeEnabled(): boolean;

  /**
   * Get current session cost in USD
   */
  getSessionCost(): number;

  /**
   * Get session cost limit in USD
   */
  getSessionCostLimit(): number;

  /**
   * Set session cost limit in USD
   */
  setSessionCostLimit(limit: number): void;

  /**
   * Check if session cost limit is reached
   */
  isSessionCostLimitReached(): boolean;

  /**
   * Abort the current operation
   */
  abortCurrentOperation(): void;
}

// ============================================================================
// Specialized Agent Interface
// ============================================================================

/**
 * Agent capability identifiers
 */
export type AgentCapabilityType =
  | 'pdf-extract'
  | 'pdf-analyze'
  | 'excel-read'
  | 'excel-write'
  | 'csv-parse'
  | 'data-transform'
  | 'data-visualize'
  | 'sql-query'
  | 'archive-extract'
  | 'archive-create'
  | 'code-analyze'
  | 'code-review'
  | 'code-refactor'
  | 'code-security';

/**
 * Specialized agent task
 */
export interface IAgentTask {
  action: string;
  inputFiles?: string[];
  outputFile?: string;
  params?: Record<string, unknown>;
  data?: unknown;
}

/**
 * Specialized agent result
 */
export interface IAgentResult {
  success: boolean;
  data?: unknown;
  outputFile?: string;
  output?: string;
  error?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for specialized agents
 */
export interface ISpecializedAgentConfig {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapabilityType[];
  fileExtensions: string[];
  maxFileSize?: number;
  requiredTools?: string[];
  options?: Record<string, unknown>;
}

/**
 * Interface for specialized agents (PDF, Excel, SQL, etc.)
 */
export interface ISpecializedAgent extends EventEmitter {
  /**
   * Get agent configuration
   */
  getConfig(): ISpecializedAgentConfig;

  /**
   * Get agent ID
   */
  getId(): string;

  /**
   * Get agent name
   */
  getName(): string;

  /**
   * Check if agent has a specific capability
   */
  hasCapability(capability: AgentCapabilityType): boolean;

  /**
   * Check if agent can handle a file extension
   */
  canHandleExtension(ext: string): boolean;

  /**
   * Initialize the agent
   */
  initialize(): Promise<void>;

  /**
   * Check if agent is ready
   */
  isReady(): boolean;

  /**
   * Execute a task
   */
  execute(task: IAgentTask): Promise<IAgentResult>;

  /**
   * Get supported actions
   */
  getSupportedActions(): string[];

  /**
   * Get help text for an action
   */
  getActionHelp(action: string): string;

  /**
   * Cleanup resources
   */
  cleanup(): Promise<void>;
}

// ============================================================================
// Agent Factory Interface
// ============================================================================

/**
 * Options for creating an agent
 */
export interface IAgentOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxToolRounds?: number;
  yoloMode?: boolean;
  sessionCostLimit?: number;
  parallelToolExecution?: boolean;
  useRAGToolSelection?: boolean;
  useModelRouting?: boolean;
}

/**
 * Factory interface for creating agents
 */
export interface IAgentFactory {
  /**
   * Create a new agent instance
   */
  create(options?: IAgentOptions): IAgent;

  /**
   * Create an extended agent with full capabilities
   */
  createExtended(options?: IAgentOptions): IExtendedAgent;

  /**
   * Get a specialized agent by ID
   */
  getSpecialized(agentId: string): ISpecializedAgent | undefined;

  /**
   * List available specialized agents
   */
  listSpecialized(): ISpecializedAgentConfig[];
}
