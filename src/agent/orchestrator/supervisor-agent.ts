/**
 * Supervisor Agent
 *
 * Coordinates multiple sub-agents in parallel, with multiple execution strategies.
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type MergeStrategy = 'sequential' | 'parallel' | 'race' | 'all';

export interface OrchestrationPlan {
  mainGoal: string;
  subAgents: SubAgentTask[];
  mergeStrategy: MergeStrategy;
}

export interface SubAgentTask {
  id: string;
  agent: string;
  task: string;
  dependencies: string[];
  timeout?: number;
}

export interface OrchestrationResult {
  success: boolean;
  results: Map<string, SubAgentResult>;
  strategy: MergeStrategy;
  totalDuration: number;
  mergedOutput: string;
}

export interface SubAgentResult {
  success: boolean;
  output: string;
  duration: number;
  error?: string;
}

// ============================================================================
// Supervisor Agent
// ============================================================================

export class SupervisorAgent extends EventEmitter {
  private executor: ((agent: string, task: string, context: string) => Promise<SubAgentResult>) | null = null;

  /**
   * Set the sub-agent executor function
   */
  setExecutor(exec: (agent: string, task: string, context: string) => Promise<SubAgentResult>): void {
    this.executor = exec;
  }

  /**
   * Orchestrate a plan
   */
  async orchestrate(plan: OrchestrationPlan): Promise<OrchestrationResult> {
    const startTime = Date.now();
    this.emit('orchestrate:start', { goal: plan.mainGoal, strategy: plan.mergeStrategy });

    let results: Map<string, SubAgentResult>;

    switch (plan.mergeStrategy) {
      case 'sequential':
        results = await this.executeSequential(plan.subAgents);
        break;
      case 'parallel':
        results = await this.executeParallel(plan.subAgents);
        break;
      case 'race':
        results = await this.executeRace(plan.subAgents);
        break;
      case 'all':
        results = await this.executeAll(plan.subAgents);
        break;
      default:
        results = await this.executeSequential(plan.subAgents);
    }

    const mergedOutput = this.mergeResults(results, plan.mergeStrategy);
    const success = Array.from(results.values()).some(r => r.success);

    const result: OrchestrationResult = {
      success,
      results,
      strategy: plan.mergeStrategy,
      totalDuration: Date.now() - startTime,
      mergedOutput,
    };

    this.emit('orchestrate:complete', result);
    return result;
  }

  /**
   * Execute tasks sequentially
   */
  private async executeSequential(tasks: SubAgentTask[]): Promise<Map<string, SubAgentResult>> {
    const results = new Map<string, SubAgentResult>();
    let context = '';

    for (const task of tasks) {
      const result = await this.executeTask(task, context);
      results.set(task.id, result);

      if (result.success) {
        context += `\n[${task.id}]: ${result.output}`;
      } else {
        break; // Stop on failure for sequential
      }
    }

    return results;
  }

  /**
   * Execute tasks in parallel (respecting dependencies)
   */
  private async executeParallel(tasks: SubAgentTask[]): Promise<Map<string, SubAgentResult>> {
    const results = new Map<string, SubAgentResult>();
    const completed = new Set<string>();
    const remaining = [...tasks];

    while (remaining.length > 0) {
      const ready = remaining.filter(t =>
        t.dependencies.every(d => completed.has(d))
      );

      if (ready.length === 0 && remaining.length > 0) {
        // Deadlock
        for (const t of remaining) {
          results.set(t.id, { success: false, output: '', duration: 0, error: 'Deadlocked' });
        }
        break;
      }

      const batchResults = await Promise.allSettled(
        ready.map(async task => {
          const context = task.dependencies
            .map(d => results.get(d))
            .filter(r => r?.success)
            .map(r => r!.output)
            .join('\n');

          const result = await this.executeTask(task, context);
          results.set(task.id, result);
          completed.add(task.id);
          return result;
        })
      );

      // Remove completed from remaining (reverse order to preserve indices)
      const readySet = new Set(ready);
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (readySet.has(remaining[i])) remaining.splice(i, 1);
      }
    }

    return results;
  }

  /**
   * Race: first successful result wins
   */
  private async executeRace(tasks: SubAgentTask[]): Promise<Map<string, SubAgentResult>> {
    const results = new Map<string, SubAgentResult>();

    const winner = await Promise.any(
      tasks.map(async task => {
        const result = await this.executeTask(task, '');
        if (!result.success) throw new Error(result.error);
        results.set(task.id, result);
        return { task, result };
      })
    ).catch(() => null);

    if (!winner) {
      // All failed
      for (const task of tasks) {
        if (!results.has(task.id)) {
          results.set(task.id, { success: false, output: '', duration: 0, error: 'All agents failed' });
        }
      }
    }

    return results;
  }

  /**
   * All: execute all regardless of failures
   */
  private async executeAll(tasks: SubAgentTask[]): Promise<Map<string, SubAgentResult>> {
    const results = new Map<string, SubAgentResult>();

    await Promise.allSettled(
      tasks.map(async task => {
        const result = await this.executeTask(task, '');
        results.set(task.id, result);
      })
    );

    return results;
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: SubAgentTask, context: string): Promise<SubAgentResult> {
    const startTime = Date.now();
    this.emit('task:start', { id: task.id, agent: task.agent });

    try {
      if (!this.executor) {
        throw new Error('No executor set');
      }

      const result = await this.executor(task.agent, task.task, context);
      this.emit('task:complete', { id: task.id, success: result.success });
      return result;

    } catch (error) {
      const result: SubAgentResult = {
        success: false,
        output: '',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit('task:error', { id: task.id, error: result.error });
      return result;
    }
  }

  /**
   * Merge results into a single output
   */
  private mergeResults(results: Map<string, SubAgentResult>, strategy: MergeStrategy): string {
    const outputs = Array.from(results.entries())
      .filter(([_, r]) => r.success)
      .map(([id, r]) => `[${id}]: ${r.output}`);

    if (strategy === 'race') {
      return outputs[0] || 'No successful results';
    }

    return outputs.join('\n\n---\n\n') || 'No successful results';
  }
}
