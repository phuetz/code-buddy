/**
 * Delegation Engine
 *
 * Matches PlannedTask to the best subagent, manages shared context, aggregates results.
 */

import { EventEmitter } from 'events';
import { formatTaskFailureOutput, normalizeTaskResult, type PlannedTask, type TaskResult } from './task-graph.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface DelegationMapping {
  taskType: string;
  subagent: string;
  priority: number;
}

export interface DelegationResult {
  taskId: string;
  subagent: string;
  result: TaskResult;
  retries: number;
}

export interface DelegationEngineConfig {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: DelegationEngineConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
};

// ============================================================================
// Delegation Engine
// ============================================================================

export class DelegationEngine extends EventEmitter {
  private config: DelegationEngineConfig;
  private sharedContext: Map<string, string> = new Map();
  private customMappings: DelegationMapping[] = [];

  constructor(config: Partial<DelegationEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Determine the best subagent for a task
   */
  matchSubagent(task: PlannedTask): string {
    // Explicit delegation
    if (task.delegateTo) return task.delegateTo;

    // Custom mappings
    for (const mapping of this.customMappings) {
      if (task.description.toLowerCase().includes(mapping.taskType.toLowerCase())) {
        return mapping.subagent;
      }
    }

    // Heuristic matching based on description keywords
    const desc = task.description.toLowerCase();

    if (desc.includes('review') || desc.includes('audit')) return 'code-reviewer';
    if (desc.includes('debug') || desc.includes('fix') || desc.includes('error')) return 'debugger';
    if (desc.includes('test') || desc.includes('spec')) return 'test-runner';
    if (desc.includes('explore') || desc.includes('find') || desc.includes('search')) return 'explorer';
    if (desc.includes('refactor') || desc.includes('restructure')) return 'refactorer';
    if (desc.includes('document') || desc.includes('readme') || desc.includes('doc')) return 'documenter';

    // Default: no delegation (main agent handles it)
    return 'main';
  }

  /**
   * Execute a task with retry and backoff
   */
  async executeWithRetry(
    task: PlannedTask,
    executor: (task: PlannedTask, context: string) => Promise<TaskResult>
  ): Promise<DelegationResult> {
    const subagent = this.matchSubagent(task);
    let retries = 0;
    let lastError: string | undefined;

    const context = this.buildContext(task);

    while (retries <= this.config.maxRetries) {
      try {
        this.emit('delegation:attempt', { taskId: task.id, subagent, attempt: retries + 1 });

        const result = normalizeTaskResult(await executor(task, context));

        if (result.success) {
          // Store output in shared context for downstream tasks
          this.sharedContext.set(task.id, result.output);

          return { taskId: task.id, subagent, result, retries };
        }

        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      retries++;
      if (retries <= this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(this.config.backoffMultiplier, retries - 1);
        logger.debug(`Retrying task ${task.id} in ${delay}ms (attempt ${retries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      taskId: task.id,
      subagent,
      result: {
        success: false,
        output: formatTaskFailureOutput(lastError || 'Max retries exceeded'),
        duration: 0,
        error: lastError || 'Max retries exceeded',
      },
      retries,
    };
  }

  /**
   * Build context string from shared context of dependency tasks
   */
  private buildContext(task: PlannedTask): string {
    const parts: string[] = [];
    for (const depId of task.dependencies) {
      const depContext = this.sharedContext.get(depId);
      if (depContext) {
        parts.push(`[Result from ${depId}]: ${depContext}`);
      }
    }
    return parts.join('\n\n');
  }

  /**
   * Add a custom mapping
   */
  addMapping(mapping: DelegationMapping): void {
    this.customMappings.push(mapping);
    this.customMappings.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get shared context
   */
  getSharedContext(): Map<string, string> {
    return new Map(this.sharedContext);
  }

  /**
   * Clear shared context
   */
  clearContext(): void {
    this.sharedContext.clear();
  }

  /**
   * Aggregate results from multiple delegations
   */
  aggregateResults(results: DelegationResult[]): {
    success: boolean;
    summary: string;
    totalRetries: number;
  } {
    const successful = results.filter(r => r.result.success);
    const failed = results.filter(r => !r.result.success);

    let summary = `Completed ${successful.length}/${results.length} tasks.\n`;
    if (failed.length > 0) {
      summary += `\nFailed tasks:\n`;
      for (const f of failed) {
        summary += `  - ${f.taskId}: ${f.result.error}\n`;
      }
    }

    return {
      success: failed.length === 0,
      summary,
      totalRetries: results.reduce((sum, r) => sum + r.retries, 0),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let engineInstance: DelegationEngine | null = null;

export function getDelegationEngine(config?: Partial<DelegationEngineConfig>): DelegationEngine {
  if (!engineInstance) {
    engineInstance = new DelegationEngine(config);
  }
  return engineInstance;
}

export function resetDelegationEngine(): void {
  engineInstance = null;
}
