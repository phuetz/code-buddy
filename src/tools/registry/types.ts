/**
 * Tool Registry Types
 *
 * Formal interfaces for the tool system enabling:
 * - Consistent tool contract via ITool interface
 * - Dependency injection via IToolRegistry
 * - Type-safe tool execution
 * - Schema validation support
 */

import type { ToolResult } from '../../types/index.js';

// ============================================================================
// JSON Schema Types
// ============================================================================

/**
 * JSON Schema for tool parameters
 */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

/**
 * Individual property in JSON schema
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

// ============================================================================
// Tool Schema Types
// ============================================================================

/**
 * Schema definition for a tool (OpenAI function calling format)
 */
export interface ToolSchema {
  /** Tool name (must be unique) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for parameters */
  parameters: JsonSchema;
}

/**
 * Tool category for grouping and filtering
 */
export type ToolCategoryType =
  | 'file_read'
  | 'file_write'
  | 'file_search'
  | 'system'
  | 'git'
  | 'web'
  | 'planning'
  | 'media'
  | 'document'
  | 'utility'
  | 'codebase'
  | 'mcp';

/**
 * Tool metadata for selection and display
 */
export interface IToolMetadata {
  /** Tool name */
  name: string;
  /** Primary category */
  category: ToolCategoryType;
  /** Keywords for search */
  keywords: string[];
  /** Selection priority (higher = more likely) */
  priority: number;
  /** Description */
  description: string;
  /** Version string */
  version?: string;
  /** Author/owner */
  author?: string;
  /** Dependencies on other tools */
  dependencies?: string[];
  /** Whether tool requires user confirmation */
  requiresConfirmation?: boolean;
  /** Whether tool modifies files */
  modifiesFiles?: boolean;
  /** Whether tool makes network requests */
  makesNetworkRequests?: boolean;
}

// ============================================================================
// Tool Interface
// ============================================================================

/**
 * Core tool interface for all tools in the system.
 *
 * Implements a consistent contract:
 * - `name` and `description` for identification
 * - `execute` for running the tool
 * - `getSchema` for LLM integration
 * - `validate` for input validation
 */
export interface ITool {
  /** Unique tool name */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /**
   * Execute the tool with given input
   * @param input - Tool-specific input parameters
   * @returns Promise resolving to ToolResult
   */
  execute(input: Record<string, unknown>): Promise<ToolResult>;

  /**
   * Get the tool schema for LLM function calling
   */
  getSchema(): ToolSchema;

  /**
   * Validate input before execution
   * @param input - Input to validate
   * @returns Validation result
   */
  validate?(input: unknown): IValidationResult;

  /**
   * Get tool metadata
   */
  getMetadata?(): IToolMetadata;

  /**
   * Check if tool is currently available/enabled
   */
  isAvailable?(): boolean;

  /**
   * Dispose of tool resources
   */
  dispose?(): void | Promise<void>;
}

/**
 * Validation result
 */
export interface IValidationResult {
  valid: boolean;
  errors?: string[];
}

// ============================================================================
// Tool Executor Interface
// ============================================================================

/**
 * Function type for tool executors
 */
export type ToolExecutorFn = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<ToolResult>;

/**
 * Tool execution context
 */
export interface IToolExecutionContext {
  /** Current working directory */
  cwd: string;
  /** User who invoked the tool */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Whether running in dry-run mode */
  dryRun?: boolean;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Custom context data */
  extra?: Record<string, unknown>;
}

/**
 * Tool execution result with timing
 */
export interface IToolExecutionResult extends ToolResult {
  /** Tool name */
  toolName: string;
  /** Execution duration in ms */
  duration: number;
  /** Timestamp */
  timestamp: Date;
  /** Context used */
  context?: IToolExecutionContext;
}

// ============================================================================
// Registry Interface
// ============================================================================

/**
 * Tool registration options
 */
export interface IToolRegistrationOptions {
  /** Override existing tool with same name */
  override?: boolean;
  /** Additional metadata */
  metadata?: Partial<IToolMetadata>;
  /** Enable function (default: always enabled) */
  isEnabled?: () => boolean;
}

/**
 * Registered tool entry
 */
export interface IRegisteredTool {
  /** Tool instance or definition */
  tool: ITool;
  /** Tool metadata */
  metadata: IToolMetadata;
  /** Enable check function */
  isEnabled: () => boolean;
  /** Registration timestamp */
  registeredAt: Date;
}

/**
 * Tool query options for filtering
 */
export interface IToolQueryOptions {
  /** Filter by category */
  category?: ToolCategoryType;
  /** Filter by categories */
  categories?: ToolCategoryType[];
  /** Filter by keywords */
  keywords?: string[];
  /** Only include enabled tools */
  enabledOnly?: boolean;
  /** Minimum priority */
  minPriority?: number;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Tool registry interface for dependency injection.
 *
 * Provides:
 * - Tool registration and retrieval
 * - Tool filtering and search
 * - Tool execution
 */
export interface IToolRegistry {
  /**
   * Register a tool
   */
  register(tool: ITool, options?: IToolRegistrationOptions): void;

  /**
   * Unregister a tool by name
   */
  unregister(name: string): boolean;

  /**
   * Get a tool by name
   */
  get(name: string): IRegisteredTool | undefined;

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean;

  /**
   * Check if a tool is enabled
   */
  isEnabled(name: string): boolean;

  /**
   * Get all registered tool names
   */
  getNames(): string[];

  /**
   * Get all registered tools
   */
  getAll(): IRegisteredTool[];

  /**
   * Query tools with filters
   */
  query(options: IToolQueryOptions): IRegisteredTool[];

  /**
   * Get tools for LLM (schema format)
   */
  getSchemas(options?: IToolQueryOptions): ToolSchema[];

  /**
   * Execute a tool by name
   */
  execute(
    name: string,
    input: Record<string, unknown>,
    context?: IToolExecutionContext
  ): Promise<IToolExecutionResult>;

  /**
   * Clear all registered tools
   */
  clear(): void;

  /**
   * Get registry statistics
   */
  getStats(): IRegistryStats;
}

/**
 * Registry statistics
 */
export interface IRegistryStats {
  totalTools: number;
  enabledTools: number;
  byCategory: Record<ToolCategoryType, number>;
  totalExecutions: number;
  averageExecutionTime: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Tool registry events
 */
export interface IToolRegistryEvents {
  'tool:registered': { name: string; tool: ITool };
  'tool:unregistered': { name: string };
  'tool:executed': IToolExecutionResult;
  'tool:error': { name: string; error: Error; input: unknown };
}

/**
 * Event handler type
 */
export type ToolRegistryEventHandler<K extends keyof IToolRegistryEvents> = (
  data: IToolRegistryEvents[K]
) => void;
