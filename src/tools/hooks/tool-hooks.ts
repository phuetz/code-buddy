/**
 * Tool Lifecycle Hooks System
 *
 * OpenClaw-inspired hook system for intercepting tool execution at multiple stages:
 * - before_tool_call: Modify parameters before execution
 * - after_tool_call: Process results after execution
 * - tool_result_persist: Transform results before transcript storage
 *
 * Features:
 * - Priority-based hook ordering
 * - Async hook execution
 * - Hook chaining with result passing
 * - Error isolation (one hook failure doesn't stop others)
 * - Plugin-prefixed hooks for tracking
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Hook execution stages
 */
export type ToolHookStage =
  | 'before_tool_call'    // Before tool execution - can modify args
  | 'after_tool_call'     // After tool execution - can modify result
  | 'tool_result_persist' // Before persisting to transcript - synchronous transform
  | 'tool_error'          // On tool execution error
  | 'tool_timeout'        // On tool timeout
  | 'tool_denied';        // When tool is blocked by policy

/**
 * Tool execution context passed to hooks
 */
export interface ToolHookContext {
  /** Tool name */
  toolName: string;
  /** Original arguments */
  originalArgs: Record<string, unknown>;
  /** Current arguments (may be modified by previous hooks) */
  args: Record<string, unknown>;
  /** Tool call ID */
  toolCallId: string;
  /** Session ID */
  sessionId?: string;
  /** Agent ID */
  agentId?: string;
  /** Timestamp */
  timestamp: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Tool result passed to after hooks
 */
export interface ToolHookResult {
  /** Success status */
  success: boolean;
  /** Output content */
  output?: string;
  /** Error message */
  error?: string;
  /** Execution time in ms */
  executionTimeMs?: number;
  /** Whether result was modified by hooks */
  modified?: boolean;
  /** Provider-specific data */
  providerData?: Record<string, unknown>;
}

/**
 * Hook handler function type
 */
export type BeforeToolHook = (
  context: ToolHookContext
) => Promise<ToolHookContext | void> | ToolHookContext | void;

export type AfterToolHook = (
  context: ToolHookContext,
  result: ToolHookResult
) => Promise<ToolHookResult | void> | ToolHookResult | void;

export type PersistHook = (
  context: ToolHookContext,
  result: ToolHookResult
) => ToolHookResult;

export type ErrorHook = (
  context: ToolHookContext,
  error: Error
) => Promise<void> | void;

/**
 * Registered hook entry
 */
export interface RegisteredHook<T> {
  /** Hook ID */
  id: string;
  /** Hook name for display */
  name: string;
  /** Priority (higher = runs first) */
  priority: number;
  /** Hook handler */
  handler: T;
  /** Plugin ID if from plugin */
  pluginId?: string;
  /** Is hook enabled */
  enabled: boolean;
}

/**
 * Hook manager configuration
 */
export interface ToolHooksConfig {
  /** Enable hook system */
  enabled: boolean;
  /** Continue on hook error */
  continueOnError: boolean;
  /** Hook timeout in ms */
  hookTimeoutMs: number;
  /** Maximum hooks per stage */
  maxHooksPerStage: number;
  /** Enable hook metrics */
  enableMetrics: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_TOOL_HOOKS_CONFIG: ToolHooksConfig = {
  enabled: true,
  continueOnError: true,
  hookTimeoutMs: 5000,
  maxHooksPerStage: 50,
  enableMetrics: true,
};

/**
 * Hook execution metrics
 */
export interface HookMetrics {
  /** Total executions */
  executions: number;
  /** Total errors */
  errors: number;
  /** Total timeouts */
  timeouts: number;
  /** Average execution time */
  avgExecutionTimeMs: number;
  /** Last execution time */
  lastExecutionTimeMs: number;
}

/**
 * Hook manager events
 */
export interface ToolHooksEvents {
  'hook:registered': (stage: ToolHookStage, hookId: string) => void;
  'hook:unregistered': (stage: ToolHookStage, hookId: string) => void;
  'hook:executed': (stage: ToolHookStage, hookId: string, durationMs: number) => void;
  'hook:error': (stage: ToolHookStage, hookId: string, error: Error) => void;
  'hook:timeout': (stage: ToolHookStage, hookId: string) => void;
}

// ============================================================================
// Tool Hooks Manager
// ============================================================================

/**
 * Manages tool lifecycle hooks
 */
export class ToolHooksManager extends EventEmitter {
  private config: ToolHooksConfig;
  private beforeHooks: Map<string, RegisteredHook<BeforeToolHook>> = new Map();
  private afterHooks: Map<string, RegisteredHook<AfterToolHook>> = new Map();
  private persistHooks: Map<string, RegisteredHook<PersistHook>> = new Map();
  private errorHooks: Map<string, RegisteredHook<ErrorHook>> = new Map();
  private timeoutHooks: Map<string, RegisteredHook<ErrorHook>> = new Map();
  private deniedHooks: Map<string, RegisteredHook<ErrorHook>> = new Map();
  private metrics: Map<string, HookMetrics> = new Map();

  constructor(config: Partial<ToolHooksConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TOOL_HOOKS_CONFIG, ...config };
  }

  // ==========================================================================
  // Hook Registration
  // ==========================================================================

  /**
   * Register a before_tool_call hook
   */
  registerBeforeHook(
    id: string,
    handler: BeforeToolHook,
    options: { name?: string; priority?: number; pluginId?: string } = {}
  ): void {
    this.registerHook(this.beforeHooks, 'before_tool_call', id, handler, options);
  }

  /**
   * Register an after_tool_call hook
   */
  registerAfterHook(
    id: string,
    handler: AfterToolHook,
    options: { name?: string; priority?: number; pluginId?: string } = {}
  ): void {
    this.registerHook(this.afterHooks, 'after_tool_call', id, handler, options);
  }

  /**
   * Register a tool_result_persist hook (synchronous)
   */
  registerPersistHook(
    id: string,
    handler: PersistHook,
    options: { name?: string; priority?: number; pluginId?: string } = {}
  ): void {
    this.registerHook(this.persistHooks, 'tool_result_persist', id, handler, options);
  }

  /**
   * Register a tool_error hook
   */
  registerErrorHook(
    id: string,
    handler: ErrorHook,
    options: { name?: string; priority?: number; pluginId?: string } = {}
  ): void {
    this.registerHook(this.errorHooks, 'tool_error', id, handler, options);
  }

  /**
   * Register a tool_timeout hook
   */
  registerTimeoutHook(
    id: string,
    handler: ErrorHook,
    options: { name?: string; priority?: number; pluginId?: string } = {}
  ): void {
    this.registerHook(this.timeoutHooks, 'tool_timeout', id, handler, options);
  }

  /**
   * Register a tool_denied hook
   */
  registerDeniedHook(
    id: string,
    handler: ErrorHook,
    options: { name?: string; priority?: number; pluginId?: string } = {}
  ): void {
    this.registerHook(this.deniedHooks, 'tool_denied', id, handler, options);
  }

  /**
   * Generic hook registration
   */
  private registerHook<T>(
    registry: Map<string, RegisteredHook<T>>,
    stage: ToolHookStage,
    id: string,
    handler: T,
    options: { name?: string; priority?: number; pluginId?: string }
  ): void {
    if (registry.size >= this.config.maxHooksPerStage) {
      throw new Error(`Maximum hooks (${this.config.maxHooksPerStage}) reached for stage ${stage}`);
    }

    const fullId = options.pluginId ? `plugin:${options.pluginId}:${id}` : id;

    registry.set(fullId, {
      id: fullId,
      name: options.name || id,
      priority: options.priority ?? 100,
      handler,
      pluginId: options.pluginId,
      enabled: true,
    });

    this.initMetrics(fullId);
    this.emit('hook:registered', stage, fullId);

    logger.debug(`Registered ${stage} hook: ${fullId}`, { priority: options.priority });
  }

  /**
   * Unregister a hook
   */
  unregisterHook(stage: ToolHookStage, id: string): boolean {
    const registry = this.getRegistry(stage);
    if (registry.delete(id)) {
      this.emit('hook:unregistered', stage, id);
      return true;
    }
    return false;
  }

  /**
   * Unregister all hooks from a plugin
   */
  unregisterPluginHooks(pluginId: string): number {
    let count = 0;
    const prefix = `plugin:${pluginId}:`;

    for (const registry of [
      this.beforeHooks,
      this.afterHooks,
      this.persistHooks,
      this.errorHooks,
      this.timeoutHooks,
      this.deniedHooks,
    ]) {
      for (const [id] of registry) {
        if (id.startsWith(prefix)) {
          registry.delete(id);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Enable/disable a hook
   */
  setHookEnabled(stage: ToolHookStage, id: string, enabled: boolean): boolean {
    const registry = this.getRegistry(stage);
    const hook = registry.get(id);
    if (hook) {
      hook.enabled = enabled;
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Hook Execution
  // ==========================================================================

  /**
   * Execute before_tool_call hooks
   * Returns modified context or original if no modifications
   */
  async executeBeforeHooks(context: ToolHookContext): Promise<ToolHookContext> {
    if (!this.config.enabled) return context;

    let currentContext = { ...context };
    const sortedHooks = this.getSortedHooks(this.beforeHooks);

    for (const hook of sortedHooks) {
      if (!hook.enabled) continue;

      try {
        const start = Date.now();
        const result = await this.executeWithTimeout(
          hook.handler(currentContext),
          hook.id
        );

        if (result) {
          currentContext = { ...currentContext, ...result };
        }

        this.recordMetrics(hook.id, Date.now() - start, false);
        this.emit('hook:executed', 'before_tool_call', hook.id, Date.now() - start);
      } catch (error) {
        this.handleHookError('before_tool_call', hook.id, error as Error);
        if (!this.config.continueOnError) throw error;
      }
    }

    return currentContext;
  }

  /**
   * Execute after_tool_call hooks
   * Returns modified result or original if no modifications
   */
  async executeAfterHooks(
    context: ToolHookContext,
    result: ToolHookResult
  ): Promise<ToolHookResult> {
    if (!this.config.enabled) return result;

    let currentResult = { ...result };
    const sortedHooks = this.getSortedHooks(this.afterHooks);

    for (const hook of sortedHooks) {
      if (!hook.enabled) continue;

      try {
        const start = Date.now();
        const hookResult = await this.executeWithTimeout(
          hook.handler(context, currentResult),
          hook.id
        );

        if (hookResult) {
          currentResult = { ...currentResult, ...hookResult, modified: true };
        }

        this.recordMetrics(hook.id, Date.now() - start, false);
        this.emit('hook:executed', 'after_tool_call', hook.id, Date.now() - start);
      } catch (error) {
        this.handleHookError('after_tool_call', hook.id, error as Error);
        if (!this.config.continueOnError) throw error;
      }
    }

    return currentResult;
  }

  /**
   * Execute tool_result_persist hooks (synchronous)
   * Returns transformed result for transcript storage
   */
  executePersistHooks(context: ToolHookContext, result: ToolHookResult): ToolHookResult {
    if (!this.config.enabled) return result;

    let currentResult = { ...result };
    const sortedHooks = this.getSortedHooks(this.persistHooks);

    for (const hook of sortedHooks) {
      if (!hook.enabled) continue;

      try {
        const start = Date.now();
        currentResult = hook.handler(context, currentResult);
        this.recordMetrics(hook.id, Date.now() - start, false);
      } catch (error) {
        this.handleHookError('tool_result_persist', hook.id, error as Error);
        if (!this.config.continueOnError) throw error;
      }
    }

    return currentResult;
  }

  /**
   * Execute tool_error hooks
   */
  async executeErrorHooks(context: ToolHookContext, error: Error): Promise<void> {
    await this.executeNotificationHooks(this.errorHooks, 'tool_error', context, error);
  }

  /**
   * Execute tool_timeout hooks
   */
  async executeTimeoutHooks(context: ToolHookContext, error: Error): Promise<void> {
    await this.executeNotificationHooks(this.timeoutHooks, 'tool_timeout', context, error);
  }

  /**
   * Execute tool_denied hooks
   */
  async executeDeniedHooks(context: ToolHookContext, error: Error): Promise<void> {
    await this.executeNotificationHooks(this.deniedHooks, 'tool_denied', context, error);
  }

  /**
   * Execute notification-style hooks (error, timeout, denied)
   */
  private async executeNotificationHooks(
    registry: Map<string, RegisteredHook<ErrorHook>>,
    stage: ToolHookStage,
    context: ToolHookContext,
    error: Error
  ): Promise<void> {
    if (!this.config.enabled) return;

    const sortedHooks = this.getSortedHooks(registry);

    for (const hook of sortedHooks) {
      if (!hook.enabled) continue;

      try {
        const start = Date.now();
        await this.executeWithTimeout(hook.handler(context, error), hook.id);
        this.recordMetrics(hook.id, Date.now() - start, false);
      } catch (hookError) {
        this.handleHookError(stage, hook.id, hookError as Error);
        // Always continue for notification hooks
      }
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get sorted hooks by priority (descending)
   */
  private getSortedHooks<T>(registry: Map<string, RegisteredHook<T>>): RegisteredHook<T>[] {
    return Array.from(registry.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get registry for a stage
   */
  private getRegistry(stage: ToolHookStage): Map<string, RegisteredHook<unknown>> {
    switch (stage) {
      case 'before_tool_call':
        return this.beforeHooks as Map<string, RegisteredHook<unknown>>;
      case 'after_tool_call':
        return this.afterHooks as Map<string, RegisteredHook<unknown>>;
      case 'tool_result_persist':
        return this.persistHooks as Map<string, RegisteredHook<unknown>>;
      case 'tool_error':
        return this.errorHooks as Map<string, RegisteredHook<unknown>>;
      case 'tool_timeout':
        return this.timeoutHooks as Map<string, RegisteredHook<unknown>>;
      case 'tool_denied':
        return this.deniedHooks as Map<string, RegisteredHook<unknown>>;
      default:
        throw new Error(`Unknown hook stage: ${stage}`);
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T> | T,
    hookId: string
  ): Promise<T> {
    if (!(promise instanceof Promise)) {
      return promise;
    }

    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          this.emit('hook:timeout', 'unknown', hookId);
          reject(new Error(`Hook ${hookId} timed out after ${this.config.hookTimeoutMs}ms`));
        }, this.config.hookTimeoutMs);
      }),
    ]);
  }

  /**
   * Handle hook error
   */
  private handleHookError(stage: ToolHookStage, hookId: string, error: Error): void {
    this.recordMetrics(hookId, 0, true);
    this.emit('hook:error', stage, hookId, error);
    logger.error(`Hook error in ${stage}:${hookId}`, { error: error.message });
  }

  /**
   * Initialize metrics for a hook
   */
  private initMetrics(hookId: string): void {
    if (!this.config.enableMetrics) return;

    this.metrics.set(hookId, {
      executions: 0,
      errors: 0,
      timeouts: 0,
      avgExecutionTimeMs: 0,
      lastExecutionTimeMs: 0,
    });
  }

  /**
   * Record hook execution metrics
   */
  private recordMetrics(hookId: string, durationMs: number, isError: boolean): void {
    if (!this.config.enableMetrics) return;

    const metrics = this.metrics.get(hookId);
    if (!metrics) return;

    metrics.executions++;
    metrics.lastExecutionTimeMs = durationMs;

    if (isError) {
      metrics.errors++;
    } else {
      // Update average execution time
      metrics.avgExecutionTimeMs =
        (metrics.avgExecutionTimeMs * (metrics.executions - 1) + durationMs) /
        metrics.executions;
    }
  }

  // ==========================================================================
  // Statistics and Info
  // ==========================================================================

  /**
   * Get hook count by stage
   */
  getHookCounts(): Record<ToolHookStage, number> {
    return {
      before_tool_call: this.beforeHooks.size,
      after_tool_call: this.afterHooks.size,
      tool_result_persist: this.persistHooks.size,
      tool_error: this.errorHooks.size,
      tool_timeout: this.timeoutHooks.size,
      tool_denied: this.deniedHooks.size,
    };
  }

  /**
   * Get all registered hooks info
   */
  getRegisteredHooks(): Array<{
    stage: ToolHookStage;
    id: string;
    name: string;
    priority: number;
    enabled: boolean;
    pluginId?: string;
  }> {
    const hooks: Array<{
      stage: ToolHookStage;
      id: string;
      name: string;
      priority: number;
      enabled: boolean;
      pluginId?: string;
    }> = [];

    const stages: Array<[ToolHookStage, Map<string, RegisteredHook<unknown>>]> = [
      ['before_tool_call', this.beforeHooks as Map<string, RegisteredHook<unknown>>],
      ['after_tool_call', this.afterHooks as Map<string, RegisteredHook<unknown>>],
      ['tool_result_persist', this.persistHooks as Map<string, RegisteredHook<unknown>>],
      ['tool_error', this.errorHooks as Map<string, RegisteredHook<unknown>>],
      ['tool_timeout', this.timeoutHooks as Map<string, RegisteredHook<unknown>>],
      ['tool_denied', this.deniedHooks as Map<string, RegisteredHook<unknown>>],
    ];

    for (const [stage, registry] of stages) {
      for (const hook of registry.values()) {
        hooks.push({
          stage,
          id: hook.id,
          name: hook.name,
          priority: hook.priority,
          enabled: hook.enabled,
          pluginId: hook.pluginId,
        });
      }
    }

    return hooks;
  }

  /**
   * Get metrics for a hook
   */
  getHookMetrics(hookId: string): HookMetrics | undefined {
    return this.metrics.get(hookId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, HookMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Clear all hooks
   */
  clearAll(): void {
    this.beforeHooks.clear();
    this.afterHooks.clear();
    this.persistHooks.clear();
    this.errorHooks.clear();
    this.timeoutHooks.clear();
    this.deniedHooks.clear();
    this.metrics.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let toolHooksInstance: ToolHooksManager | null = null;

/**
 * Get the tool hooks manager instance
 */
export function getToolHooksManager(config?: Partial<ToolHooksConfig>): ToolHooksManager {
  if (!toolHooksInstance) {
    toolHooksInstance = new ToolHooksManager(config);
  }
  return toolHooksInstance;
}

/**
 * Reset the tool hooks manager
 */
export function resetToolHooksManager(): void {
  if (toolHooksInstance) {
    toolHooksInstance.clearAll();
    toolHooksInstance = null;
  }
}

export default ToolHooksManager;
