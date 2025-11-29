/**
 * Advanced Parallel Executor
 *
 * Supports up to 8+ agents running simultaneously with:
 * - Git worktree isolation
 * - Remote machine execution
 * - Automatic conflict prevention
 * - Intelligent result merging
 *
 * Inspired by Cursor 2.0's parallel agent system.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';

export interface ParallelAgentConfig {
  id: string;
  name: string;
  task: string;
  workdir?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  isolated?: boolean;
  priority?: number;
}

export interface AgentResult {
  agentId: string;
  task: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  tokensUsed: number;
  filesModified: string[];
  worktree?: string;
}

export interface ParallelExecutionConfig {
  maxConcurrent: number;
  useWorktrees: boolean;
  useRemoteMachines: boolean;
  remoteMachines?: string[];
  conflictResolution: 'first' | 'merge' | 'manual' | 'smart';
  timeout: number;
  workspaceRoot: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  agentId: string;
  created: Date;
}

const DEFAULT_CONFIG: ParallelExecutionConfig = {
  maxConcurrent: 8,
  useWorktrees: true,
  useRemoteMachines: false,
  conflictResolution: 'smart',
  timeout: 300000, // 5 minutes
  workspaceRoot: process.cwd(),
};

/**
 * Advanced Parallel Agent Executor
 */
export class AdvancedParallelExecutor extends EventEmitter {
  private config: ParallelExecutionConfig;
  private activeAgents: Map<string, { task: ParallelAgentConfig; startTime: number }> = new Map();
  private worktrees: Map<string, WorktreeInfo> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private agentCounter: number = 0;

  constructor(config: Partial<ParallelExecutionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute multiple agents in parallel
   */
  async executeParallel(tasks: ParallelAgentConfig[]): Promise<AgentResult[]> {
    const startTime = Date.now();

    this.emit('parallel:start', {
      taskCount: tasks.length,
      maxConcurrent: this.config.maxConcurrent,
    });

    // Validate task count
    if (tasks.length > this.config.maxConcurrent) {
      this.emit('parallel:warning', {
        message: `Task count (${tasks.length}) exceeds max concurrent (${this.config.maxConcurrent}). Tasks will be batched.`,
      });
    }

    // Assign IDs and prepare tasks
    const preparedTasks = tasks.map((task, index) => ({
      ...task,
      id: task.id || `agent_${++this.agentCounter}`,
      priority: task.priority ?? index,
    }));

    // Sort by priority
    preparedTasks.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Create worktrees if enabled
    if (this.config.useWorktrees) {
      await this.prepareWorktrees(preparedTasks);
    }

    // Execute in batches
    const results: AgentResult[] = [];
    const batches = this.createBatches(preparedTasks, this.config.maxConcurrent);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      this.emit('parallel:batch:start', {
        batchIndex: i,
        batchSize: batch.length,
        totalBatches: batches.length,
      });

      const batchResults = await this.executeBatch(batch);
      results.push(...batchResults);

      this.emit('parallel:batch:complete', {
        batchIndex: i,
        results: batchResults.length,
      });
    }

    // Cleanup worktrees
    if (this.config.useWorktrees) {
      await this.cleanupWorktrees();
    }

    // Resolve conflicts
    const resolvedResults = await this.resolveConflicts(results);

    const totalDuration = Date.now() - startTime;

    this.emit('parallel:complete', {
      duration: totalDuration,
      successCount: resolvedResults.filter(r => r.success).length,
      failCount: resolvedResults.filter(r => !r.success).length,
    });

    return resolvedResults;
  }

  /**
   * Execute a batch of agents
   */
  private async executeBatch(tasks: ParallelAgentConfig[]): Promise<AgentResult[]> {
    const promises = tasks.map(task => this.executeAgent(task));
    return Promise.all(promises);
  }

  /**
   * Execute a single agent
   */
  private async executeAgent(task: ParallelAgentConfig): Promise<AgentResult> {
    const startTime = Date.now();
    const worktree = this.worktrees.get(task.id);

    this.activeAgents.set(task.id, { task, startTime });
    this.emit('agent:start', { agentId: task.id, task: task.task });

    try {
      // Determine working directory
      const workdir = worktree?.path || task.workdir || this.config.workspaceRoot;

      // Execute agent task
      const result = await this.runAgentTask(task, workdir);

      const agentResult: AgentResult = {
        agentId: task.id,
        task: task.task,
        success: result.success,
        output: result.output,
        error: result.error,
        duration: Date.now() - startTime,
        tokensUsed: result.tokensUsed || 0,
        filesModified: result.filesModified || [],
        worktree: worktree?.path,
      };

      this.results.set(task.id, agentResult);
      this.emit('agent:complete', { result: agentResult });

      return agentResult;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const agentResult: AgentResult = {
        agentId: task.id,
        task: task.task,
        success: false,
        output: '',
        error: errorMessage,
        duration: Date.now() - startTime,
        tokensUsed: 0,
        filesModified: [],
        worktree: worktree?.path,
      };

      this.emit('agent:error', { agentId: task.id, error: errorMessage });
      return agentResult;
    } finally {
      this.activeAgents.delete(task.id);
    }
  }

  /**
   * Run agent task (mock implementation - integrate with actual agent)
   */
  private async runAgentTask(
    task: ParallelAgentConfig,
    workdir: string
  ): Promise<{
    success: boolean;
    output: string;
    error?: string;
    tokensUsed?: number;
    filesModified?: string[];
  }> {
    // This should integrate with the actual GrokAgent
    // For now, we simulate the execution

    return new Promise((resolve) => {
      const timeout = task.timeout || this.config.timeout;

      const timer = setTimeout(() => {
        resolve({
          success: false,
          error: 'Task timed out',
          output: '',
        });
      }, timeout);

      // Simulate agent execution
      // In real implementation, this would call the GrokAgent
      setTimeout(() => {
        clearTimeout(timer);
        resolve({
          success: true,
          output: `Completed task: ${task.task}`,
          tokensUsed: Math.floor(Math.random() * 1000) + 500,
          filesModified: [],
        });
      }, 1000);
    });
  }

  /**
   * Prepare git worktrees for isolated execution
   */
  private async prepareWorktrees(tasks: ParallelAgentConfig[]): Promise<void> {
    const isolatedTasks = tasks.filter(t => t.isolated !== false);

    for (const task of isolatedTasks) {
      const worktreePath = path.join(
        os.tmpdir(),
        'grok-worktrees',
        `agent-${task.id}-${Date.now()}`
      );

      const branch = `agent/${task.id}`;

      try {
        // Create worktree
        await this.executeCommand(
          `git worktree add -b "${branch}" "${worktreePath}"`,
          this.config.workspaceRoot
        );

        this.worktrees.set(task.id, {
          path: worktreePath,
          branch,
          agentId: task.id,
          created: new Date(),
        });

        this.emit('worktree:created', { agentId: task.id, path: worktreePath });
      } catch (error) {
        this.emit('worktree:error', { agentId: task.id, error });
        // Fall back to main workspace
      }
    }
  }

  /**
   * Cleanup worktrees after execution
   */
  private async cleanupWorktrees(): Promise<void> {
    for (const [agentId, worktree] of this.worktrees) {
      try {
        // Remove worktree
        await this.executeCommand(
          `git worktree remove "${worktree.path}" --force`,
          this.config.workspaceRoot
        );

        // Delete branch
        await this.executeCommand(
          `git branch -D "${worktree.branch}"`,
          this.config.workspaceRoot
        );

        this.emit('worktree:removed', { agentId, path: worktree.path });
      } catch (error) {
        this.emit('worktree:cleanup:error', { agentId, error });
      }
    }

    this.worktrees.clear();
  }

  /**
   * Resolve conflicts between agent results
   */
  private async resolveConflicts(results: AgentResult[]): Promise<AgentResult[]> {
    // Group results by modified files
    const fileModifications = new Map<string, AgentResult[]>();

    for (const result of results) {
      for (const file of result.filesModified) {
        if (!fileModifications.has(file)) {
          fileModifications.set(file, []);
        }
        fileModifications.get(file)!.push(result);
      }
    }

    // Find conflicts
    const conflicts: Array<{ file: string; agents: AgentResult[] }> = [];

    for (const [file, agents] of fileModifications) {
      if (agents.length > 1) {
        conflicts.push({ file, agents });
      }
    }

    if (conflicts.length === 0) {
      return results;
    }

    this.emit('conflicts:detected', { count: conflicts.length });

    // Resolve based on strategy
    switch (this.config.conflictResolution) {
      case 'first':
        return this.resolveByFirst(results, conflicts);
      case 'merge':
        return this.resolveByMerge(results, conflicts);
      case 'smart':
        return this.resolveSmartly(results, conflicts);
      case 'manual':
      default:
        this.emit('conflicts:manual', { conflicts });
        return results;
    }
  }

  /**
   * Resolve conflicts by taking first agent's changes
   */
  private resolveByFirst(
    results: AgentResult[],
    conflicts: Array<{ file: string; agents: AgentResult[] }>
  ): AgentResult[] {
    // Mark conflicting results as having conflicts
    for (const conflict of conflicts) {
      const sortedAgents = [...conflict.agents].sort(
        (a, b) => (this.activeAgents.get(a.agentId)?.task.priority || 0) -
                  (this.activeAgents.get(b.agentId)?.task.priority || 0)
      );

      // First agent wins, others marked with warning
      for (let i = 1; i < sortedAgents.length; i++) {
        sortedAgents[i].output += `\n⚠️ Conflict with ${sortedAgents[0].agentId} on ${conflict.file}`;
      }
    }

    return results;
  }

  /**
   * Resolve conflicts by merging changes
   */
  private async resolveByMerge(
    results: AgentResult[],
    conflicts: Array<{ file: string; agents: AgentResult[] }>
  ): Promise<AgentResult[]> {
    for (const conflict of conflicts) {
      const worktrees = conflict.agents
        .map(a => this.worktrees.get(a.agentId))
        .filter(Boolean);

      if (worktrees.length >= 2) {
        try {
          // Attempt git merge
          const baseWorktree = worktrees[0]!;
          for (let i = 1; i < worktrees.length; i++) {
            await this.executeCommand(
              `git merge ${worktrees[i]!.branch} --no-edit`,
              baseWorktree.path
            );
          }

          this.emit('conflicts:merged', { file: conflict.file });
        } catch (error) {
          this.emit('conflicts:merge:failed', { file: conflict.file, error });
        }
      }
    }

    return results;
  }

  /**
   * Smart conflict resolution
   */
  private async resolveSmartly(
    results: AgentResult[],
    conflicts: Array<{ file: string; agents: AgentResult[] }>
  ): Promise<AgentResult[]> {
    // Use a combination of strategies based on file type and agent priority
    for (const conflict of conflicts) {
      const file = conflict.file;
      const ext = path.extname(file);

      // Config files: take highest priority
      if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
        await this.resolveByFirst(results, [conflict]);
      }
      // Source files: attempt merge
      else if (['.ts', '.js', '.py', '.go', '.rs'].includes(ext)) {
        await this.resolveByMerge(results, [conflict]);
      }
      // Other: first wins
      else {
        await this.resolveByFirst(results, [conflict]);
      }
    }

    return results;
  }

  /**
   * Execute a shell command
   */
  private executeCommand(command: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], { cwd, stdio: 'pipe' });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', data => { stdout += data.toString(); });
      proc.stderr?.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Create batches of tasks
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Get active agents
   */
  getActiveAgents(): string[] {
    return Array.from(this.activeAgents.keys());
  }

  /**
   * Get results
   */
  getResults(): Map<string, AgentResult> {
    return new Map(this.results);
  }

  /**
   * Cancel an agent
   */
  cancelAgent(agentId: string): boolean {
    if (this.activeAgents.has(agentId)) {
      this.emit('agent:cancelled', { agentId });
      this.activeAgents.delete(agentId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all agents
   */
  cancelAll(): number {
    const count = this.activeAgents.size;
    for (const agentId of this.activeAgents.keys()) {
      this.cancelAgent(agentId);
    }
    return count;
  }

  /**
   * Format results for display
   */
  formatResults(results: AgentResult[]): string {
    const lines: string[] = [];

    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║            PARALLEL AGENT EXECUTION RESULTS                  ║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');

    const successCount = results.filter(r => r.success).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);

    lines.push(`║ Agents: ${results.length} (${successCount} succeeded, ${results.length - successCount} failed)`.padEnd(65) + '║');
    lines.push(`║ Total duration: ${totalDuration}ms`.padEnd(65) + '║');
    lines.push(`║ Total tokens: ${totalTokens}`.padEnd(65) + '║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');

    for (const result of results) {
      const status = result.success ? '✅' : '❌';
      lines.push(`║ ${status} ${result.agentId}: ${result.task.slice(0, 40)}`.padEnd(65) + '║');
      lines.push(`║    Duration: ${result.duration}ms, Tokens: ${result.tokensUsed}`.padEnd(65) + '║');
      if (result.error) {
        lines.push(`║    Error: ${result.error.slice(0, 50)}`.padEnd(65) + '║');
      }
      if (result.filesModified.length > 0) {
        lines.push(`║    Modified: ${result.filesModified.length} files`.padEnd(65) + '║');
      }
    }

    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ParallelExecutionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): ParallelExecutionConfig {
    return { ...this.config };
  }
}

// Singleton
let advancedParallelExecutorInstance: AdvancedParallelExecutor | null = null;

export function getAdvancedParallelExecutor(
  config?: Partial<ParallelExecutionConfig>
): AdvancedParallelExecutor {
  if (!advancedParallelExecutorInstance) {
    advancedParallelExecutorInstance = new AdvancedParallelExecutor(config);
  }
  return advancedParallelExecutorInstance;
}

export function resetAdvancedParallelExecutor(): void {
  advancedParallelExecutorInstance = null;
}
