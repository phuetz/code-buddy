/**
 * Formal Tool Registry
 *
 * Centralized registry for all tools with:
 * - Type-safe registration via ITool interface
 * - Query and filtering capabilities
 * - Execution tracking and metrics
 * - Event emission for monitoring
 */

import { EventEmitter } from 'events';
import type { ToolResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import type {
  ITool,
  IToolRegistry,
  IRegisteredTool,
  IToolMetadata,
  IToolRegistrationOptions,
  IToolQueryOptions,
  IToolExecutionContext,
  IToolExecutionResult,
  IRegistryStats,
  ToolSchema,
  ToolCategoryType,
  IToolRegistryEvents,
  ToolRegistryEventHandler,
} from './types.js';

// ============================================================================
// Tool Registry Implementation
// ============================================================================

/**
 * Formal tool registry implementing IToolRegistry interface.
 *
 * Features:
 * - Singleton pattern for global access
 * - Type-safe tool registration
 * - Query and filter tools
 * - Execution tracking with metrics
 * - Event emission for tool lifecycle
 */
export class FormalToolRegistry extends EventEmitter implements IToolRegistry {
  private static instance: FormalToolRegistry | null = null;
  private tools: Map<string, IRegisteredTool> = new Map();
  private executionStats: {
    totalExecutions: number;
    totalDuration: number;
    byTool: Map<string, { count: number; totalDuration: number }>;
  } = {
    totalExecutions: 0,
    totalDuration: 0,
    byTool: new Map(),
  };

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): FormalToolRegistry {
    if (!FormalToolRegistry.instance) {
      FormalToolRegistry.instance = new FormalToolRegistry();
    }
    return FormalToolRegistry.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    if (FormalToolRegistry.instance) {
      FormalToolRegistry.instance.clear();
    }
    FormalToolRegistry.instance = null;
  }

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Register a tool
   */
  register(tool: ITool, options: IToolRegistrationOptions = {}): void {
    const name = tool.name;

    if (this.tools.has(name) && !options.override) {
      throw new Error(`Tool "${name}" is already registered. Use override: true to replace.`);
    }

    // Build metadata
    const toolMetadata = tool.getMetadata?.();
    const metadata: IToolMetadata = {
      name,
      description: tool.description,
      category: toolMetadata?.category ?? 'utility',
      keywords: toolMetadata?.keywords ?? [],
      priority: toolMetadata?.priority ?? 1,
      ...options.metadata,
    };

    const entry: IRegisteredTool = {
      tool,
      metadata,
      isEnabled: options.isEnabled ?? (() => tool.isAvailable?.() ?? true),
      registeredAt: new Date(),
    };

    this.tools.set(name, entry);
    logger.debug(`Tool registered: ${name}`);

    this.emit('tool:registered', { name, tool });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const existed = this.tools.has(name);
    if (existed) {
      const entry = this.tools.get(name)!;
      // Dispose if available
      if (entry.tool.dispose) {
        Promise.resolve(entry.tool.dispose()).catch(err => {
          logger.warn(`Error disposing tool ${name}:`, err);
        });
      }
      this.tools.delete(name);
      this.emit('tool:unregistered', { name });
    }
    return existed;
  }

  // ============================================================================
  // Retrieval
  // ============================================================================

  /**
   * Get a tool by name
   */
  get(name: string): IRegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Check if a tool is enabled
   */
  isEnabled(name: string): boolean {
    const entry = this.tools.get(name);
    return entry ? entry.isEnabled() : false;
  }

  /**
   * Get all registered tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all registered tools
   */
  getAll(): IRegisteredTool[] {
    return Array.from(this.tools.values());
  }

  // ============================================================================
  // Query
  // ============================================================================

  /**
   * Query tools with filters
   */
  query(options: IToolQueryOptions = {}): IRegisteredTool[] {
    let results = Array.from(this.tools.values());

    // Filter by enabled
    if (options.enabledOnly) {
      results = results.filter(t => t.isEnabled());
    }

    // Filter by category
    if (options.category) {
      results = results.filter(t => t.metadata.category === options.category);
    }

    // Filter by categories
    if (options.categories && options.categories.length > 0) {
      results = results.filter(t => options.categories!.includes(t.metadata.category));
    }

    // Filter by keywords
    if (options.keywords && options.keywords.length > 0) {
      const lowerKeywords = options.keywords.map(k => k.toLowerCase());
      results = results.filter(t => {
        const toolKeywords = t.metadata.keywords.map(k => k.toLowerCase());
        return lowerKeywords.some(
          k =>
            toolKeywords.includes(k) ||
            t.metadata.name.toLowerCase().includes(k) ||
            t.metadata.description.toLowerCase().includes(k)
        );
      });
    }

    // Filter by minimum priority
    if (options.minPriority !== undefined) {
      results = results.filter(t => t.metadata.priority >= options.minPriority!);
    }

    // Sort by priority (descending)
    results.sort((a, b) => b.metadata.priority - a.metadata.priority);

    // Limit results
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get tool schemas for LLM
   */
  getSchemas(options: IToolQueryOptions = {}): ToolSchema[] {
    const tools = this.query({ ...options, enabledOnly: true });
    return tools.map(t => t.tool.getSchema());
  }

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * Execute a tool by name
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context?: IToolExecutionContext
  ): Promise<IToolExecutionResult> {
    const entry = this.tools.get(name);

    if (!entry) {
      const result: IToolExecutionResult = {
        success: false,
        error: `Tool "${name}" not found`,
        toolName: name,
        duration: 0,
        timestamp: new Date(),
        context,
      };
      this.emit('tool:error', { name, error: new Error(result.error!), input });
      return result;
    }

    if (!entry.isEnabled()) {
      const result: IToolExecutionResult = {
        success: false,
        error: `Tool "${name}" is currently disabled`,
        toolName: name,
        duration: 0,
        timestamp: new Date(),
        context,
      };
      this.emit('tool:error', { name, error: new Error(result.error!), input });
      return result;
    }

    // Validate input if tool supports it
    if (entry.tool.validate) {
      const validation = entry.tool.validate(input);
      if (!validation.valid) {
        const result: IToolExecutionResult = {
          success: false,
          error: `Validation failed: ${validation.errors?.join(', ') || 'Unknown error'}`,
          toolName: name,
          duration: 0,
          timestamp: new Date(),
          context,
        };
        this.emit('tool:error', { name, error: new Error(result.error!), input });
        return result;
      }
    }

    // Execute
    const startTime = Date.now();
    let toolResult: ToolResult;

    try {
      toolResult = await entry.tool.execute(input);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const result: IToolExecutionResult = {
        success: false,
        error: err.message,
        toolName: name,
        duration: Date.now() - startTime,
        timestamp: new Date(),
        context,
      };
      this.emit('tool:error', { name, error: err, input });
      return result;
    }

    const duration = Date.now() - startTime;

    // Update stats
    this.executionStats.totalExecutions++;
    this.executionStats.totalDuration += duration;

    const toolStats = this.executionStats.byTool.get(name) || { count: 0, totalDuration: 0 };
    toolStats.count++;
    toolStats.totalDuration += duration;
    this.executionStats.byTool.set(name, toolStats);

    const result: IToolExecutionResult = {
      ...toolResult,
      toolName: name,
      duration,
      timestamp: new Date(),
      context,
    };

    this.emit('tool:executed', result);
    return result;
  }

  // ============================================================================
  // Management
  // ============================================================================

  /**
   * Clear all tools
   */
  clear(): void {
    // Dispose all tools
    for (const [name, entry] of this.tools) {
      if (entry.tool.dispose) {
        Promise.resolve(entry.tool.dispose()).catch(err => {
          logger.warn(`Error disposing tool ${name}:`, err);
        });
      }
    }
    this.tools.clear();
    this.executionStats = {
      totalExecutions: 0,
      totalDuration: 0,
      byTool: new Map(),
    };
  }

  /**
   * Get registry statistics
   */
  getStats(): IRegistryStats {
    const byCategory: Record<ToolCategoryType, number> = {
      file_read: 0,
      file_write: 0,
      file_search: 0,
      system: 0,
      git: 0,
      web: 0,
      planning: 0,
      media: 0,
      document: 0,
      utility: 0,
      codebase: 0,
      mcp: 0,
    };

    let enabledCount = 0;

    for (const entry of this.tools.values()) {
      byCategory[entry.metadata.category]++;
      if (entry.isEnabled()) {
        enabledCount++;
      }
    }

    return {
      totalTools: this.tools.size,
      enabledTools: enabledCount,
      byCategory,
      totalExecutions: this.executionStats.totalExecutions,
      averageExecutionTime:
        this.executionStats.totalExecutions > 0
          ? this.executionStats.totalDuration / this.executionStats.totalExecutions
          : 0,
    };
  }

  // ============================================================================
  // Event Helpers (type-safe)
  // ============================================================================

  /**
   * Type-safe event subscription
   */
  on<K extends keyof IToolRegistryEvents>(
    event: K,
    handler: ToolRegistryEventHandler<K>
  ): this {
    return super.on(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Type-safe event emission
   */
  emit<K extends keyof IToolRegistryEvents>(event: K, data: IToolRegistryEvents[K]): boolean {
    return super.emit(event, data);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the singleton tool registry instance
 */
export function getFormalToolRegistry(): FormalToolRegistry {
  return FormalToolRegistry.getInstance();
}

/**
 * Create a test registry (non-singleton)
 */
export function createTestToolRegistry(): FormalToolRegistry {
  // Create new instance without using singleton
  const registry = new (FormalToolRegistry as unknown as { new (): FormalToolRegistry })();
  return registry;
}
