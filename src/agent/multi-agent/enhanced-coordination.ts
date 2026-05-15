/**
 * Enhanced Multi-Agent Coordination
 *
 * Advanced coordination mechanisms for the multi-agent system based on research:
 * - AgentCoder: Hierarchical multi-agent code generation
 * - RepairAgent: Autonomous LLM-based repair with learning
 * - ComplexAgents: Specialized agent roles and communication
 *
 * Key features:
 * - Adaptive task allocation based on agent performance
 * - Conflict resolution protocol between agents
 * - Resource pooling and efficient context sharing
 * - Progress synchronization for parallel tasks
 * - Learning from success/failure patterns
 */

import { EventEmitter } from 'events';
import {
  AgentRole,
  AgentTask,
  AgentExecutionResult,
  SharedContext,
  TaskArtifact,
} from './types.js';
import { logger } from '../../utils/logger.js';

/**
 * Agent performance metrics
 */
/** Per-role aggregated metrics. Phase L (V0.4) added totalCostUsd + avgCostPerTask. */
export interface AgentMetrics {
  role: AgentRole;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  avgDuration: number;
  avgRounds: number;
  successRate: number;
  specialties: Map<string, number>; // task type -> success count
  recentPerformance: number[]; // last N success/fail (1/0)
  /** Phase L (V0.4) — cumulative USD spent on this agent across all
   *  recorded tasks. Set by MAS via WorkflowCostManager + carried via
   *  recordTaskCompletion. 0 if cost tracking disabled. */
  totalCostUsd: number;
  /** Phase L — avgCostPerTask = totalCostUsd / totalTasks. Used for
   *  /agents metrics breakdown. */
  avgCostPerTask: number;
}

/**
 * Conflict between agents
 */
export interface AgentConflict {
  id: string;
  type: 'code_overlap' | 'approach_disagreement' | 'resource_contention' | 'deadline_conflict';
  agents: AgentRole[];
  description: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: Date;
  resolution?: ConflictResolution;
  /** Phase M (V0.4.1) — for `code_overlap` conflicts, the file path that
   *  triggered the overlap. Used by autoResolveConflicts to find which tasks
   *  to mutate. Other conflict types leave this undefined. */
  affectedFile?: string;
}

/**
 * Resolution for a conflict
 */
export interface ConflictResolution {
  strategy: 'priority' | 'consensus' | 'arbitration' | 'merge';
  decision: string;
  resolvedBy: AgentRole;
  timestamp: Date;
}

/**
 * Task dependency information
 */
export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
  blockedBy: string[];
  enables: string[];
}

/**
 * Phase M (V0.4.1) — auto-resolve strategy. Only `prefer-reviewer` ships in
 * V0.4.1 (other strategies kept as `'none'` until V0.5+). When `none`, the
 * coordinator only annotates conflicts; no task.status mutation happens.
 */
export type AutoResolveStrategy = 'prefer-reviewer' | 'none';

/**
 * Coordination configuration
 */
export interface CoordinationConfig {
  // Enable adaptive task allocation
  enableAdaptiveAllocation: boolean;
  // Minimum confidence for task assignment (0-1)
  minAssignmentConfidence: number;
  // Maximum parallel tasks per agent
  maxParallelPerAgent: number;
  // Enable conflict resolution
  enableConflictResolution: boolean;
  // Conflict resolution timeout (ms)
  conflictTimeout: number;
  // Enable learning from history
  enableLearning: boolean;
  // History size for learning
  historySize: number;
  // Checkpoint interval (tasks)
  checkpointInterval: number;
  /** Phase M (V0.4.1) — when true, `autoResolveConflicts(tasks)` mutates
   *  losing agents' tasks to `status='blocked'` for `code_overlap` conflicts.
   *  Default false to preserve V0.3/V0.4 annotation-only behaviour. */
  autoResolveEnabled: boolean;
  /** Phase M — strategy used for auto-resolve. V0.4.1 ships `prefer-reviewer`. */
  autoResolveStrategy: AutoResolveStrategy;
}

const DEFAULT_CONFIG: CoordinationConfig = {
  enableAdaptiveAllocation: true,
  minAssignmentConfidence: 0.6,
  maxParallelPerAgent: 2,
  enableConflictResolution: true,
  conflictTimeout: 30000,
  enableLearning: true,
  historySize: 50,
  checkpointInterval: 5,
  autoResolveEnabled: false,
  autoResolveStrategy: 'none',
};

/**
 * Resource value types for type-safe resource sharing
 */
export type CodeSnippetResource = { code: string; source: AgentRole; relevance: number };
export type FileModificationResource = { agent: AgentRole; timestamp: Date; type: 'create' | 'modify' | 'delete' };
export type InsightResource = { insight: string; source: AgentRole; confidence: number };
export type TestResultResource = { passed: boolean; output: string; timestamp: Date };

/**
 * Shared resource pool
 */
export interface ResourcePool {
  // Code snippets indexed by purpose
  codeSnippets: Map<string, CodeSnippetResource>;
  // File modifications tracking
  fileModifications: Map<string, FileModificationResource>;
  // Shared insights from analysis
  insights: Map<string, InsightResource>;
  // Test results cache
  testResults: Map<string, TestResultResource>;
}

/**
 * Maps resource pool keys to their value types
 */
export type ResourceValueType<K extends keyof ResourcePool> =
  K extends 'codeSnippets' ? CodeSnippetResource :
  K extends 'fileModifications' ? FileModificationResource :
  K extends 'insights' ? InsightResource :
  K extends 'testResults' ? TestResultResource :
  never;

/**
 * Checkpoint for recovery
 */
export interface Checkpoint {
  id: string;
  timestamp: Date;
  completedTasks: string[];
  pendingTasks: string[];
  artifacts: TaskArtifact[];
  metrics: Map<AgentRole, AgentMetrics>;
  resourcePool: ResourcePool;
}

/**
 * Phase N (V0.4.1) — disk persistence options for adaptive allocation
 * warm-start. Passed to `enablePersistence()`. See `metrics-persistence.ts`
 * for the storage envelope and atomic-write behaviour.
 */
export interface PersistenceOptions {
  /** Days after which persisted metrics are considered stale. V0.4.1 logs a
   *  warning at load time; V0.5+ will enforce by clearing the file. Default 30. */
  metricsTtlDays?: number;
  /** Debounce interval for save-on-update (ms). Default 5000. Tests use a
   *  much smaller value with vi.useFakeTimers(). */
  saveDebounceMs?: number;
}

/**
 * Enhanced Coordination Manager
 */
export class EnhancedCoordinator extends EventEmitter {
  private config: CoordinationConfig;
  private agentMetrics: Map<AgentRole, AgentMetrics> = new Map();
  private taskDependencies: Map<string, TaskDependency> = new Map();
  private conflicts: AgentConflict[] = [];
  private resourcePool: ResourcePool;
  private checkpoints: Checkpoint[] = [];
  private taskHistory: Array<{ task: AgentTask; result: AgentExecutionResult }> = [];
  private activeTasksPerAgent: Map<AgentRole, Set<string>> = new Map();

  // ─── Phase N (V0.4.1) — disk persistence ────────────────────────────────
  private persistenceEnabled = false;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private saveDebounceMs = 5000;
  private metricsTtlDays = 30;
  /** ISO timestamp of last successful save (or load). null = never persisted. */
  private metricsSavedAt: Date | null = null;
  private metricsUpdatedListener: (() => void) | null = null;

  constructor(config: Partial<CoordinationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.resourcePool = this.createEmptyResourcePool();
    this.initializeMetrics();
  }

  /**
   * Initialize metrics for all agent roles
   */
  private initializeMetrics(): void {
    const roles: AgentRole[] = ['orchestrator', 'coder', 'reviewer', 'tester'];
    for (const role of roles) {
      this.agentMetrics.set(role, {
        role,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        avgDuration: 0,
        avgRounds: 0,
        successRate: 0.5, // Start with neutral
        specialties: new Map(),
        recentPerformance: [],
        totalCostUsd: 0, // Phase L V0.4
        avgCostPerTask: 0, // Phase L V0.4
      });
      this.activeTasksPerAgent.set(role, new Set());
    }
  }

  /**
   * Create empty resource pool
   */
  private createEmptyResourcePool(): ResourcePool {
    return {
      codeSnippets: new Map(),
      fileModifications: new Map(),
      insights: new Map(),
      testResults: new Map(),
    };
  }

  /**
   * Adaptively allocate a task to the best suited agent
   */
  allocateTask(task: AgentTask, availableAgents: AgentRole[]): {
    agent: AgentRole;
    confidence: number;
    reasoning: string;
  } {
    if (!this.config.enableAdaptiveAllocation) {
      return {
        agent: task.assignedTo,
        confidence: 1,
        reasoning: 'Adaptive allocation disabled, using default assignment',
      };
    }

    const scores: Array<{ agent: AgentRole; score: number; reasons: string[] }> = [];

    for (const agent of availableAgents) {
      const metrics = this.agentMetrics.get(agent);
      if (!metrics) continue;

      // Check if agent has capacity
      const activeTasks = this.activeTasksPerAgent.get(agent)?.size || 0;
      if (activeTasks >= this.config.maxParallelPerAgent) {
        continue;
      }

      const reasons: string[] = [];
      let score = 0;

      // Base score from success rate
      score += metrics.successRate * 0.4;
      reasons.push(`Success rate: ${(metrics.successRate * 100).toFixed(0)}%`);

      // Specialty bonus
      const taskType = this.extractTaskType(task);
      const specialtyScore = metrics.specialties.get(taskType) || 0;
      const normalizedSpecialty = Math.min(specialtyScore / 10, 1);
      score += normalizedSpecialty * 0.3;
      if (specialtyScore > 0) {
        reasons.push(`Specialty in ${taskType}: ${specialtyScore} successes`);
      }

      // Recent performance trend
      const recentSuccessRate = this.calculateRecentSuccessRate(metrics);
      score += recentSuccessRate * 0.2;
      if (metrics.recentPerformance.length > 0) {
        reasons.push(`Recent performance: ${(recentSuccessRate * 100).toFixed(0)}%`);
      }

      // Load balancing factor
      const loadFactor = 1 - (activeTasks / this.config.maxParallelPerAgent);
      score += loadFactor * 0.1;
      reasons.push(`Current load: ${activeTasks}/${this.config.maxParallelPerAgent}`);

      // Default assignment bonus (slight preference for originally assigned)
      if (agent === task.assignedTo) {
        score += 0.05;
        reasons.push('Default assignment bonus');
      }

      scores.push({ agent, score, reasons });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    if (!best || best.score < this.config.minAssignmentConfidence) {
      // Fall back to default assignment
      return {
        agent: task.assignedTo,
        confidence: best?.score || 0.5,
        reasoning: `No agent met confidence threshold, using default: ${task.assignedTo}`,
      };
    }

    return {
      agent: best.agent,
      confidence: best.score,
      reasoning: best.reasons.join('; '),
    };
  }

  /**
   * Calculate recent success rate
   */
  private calculateRecentSuccessRate(metrics: AgentMetrics): number {
    if (metrics.recentPerformance.length === 0) return 0.5;
    const sum = metrics.recentPerformance.reduce((a, b) => a + b, 0);
    return sum / metrics.recentPerformance.length;
  }

  /**
   * Extract task type for specialty tracking
   */
  private extractTaskType(task: AgentTask): string {
    const title = task.title.toLowerCase();
    const description = task.description.toLowerCase();
    const content = `${title} ${description}`;

    if (content.includes('test') || content.includes('spec')) return 'testing';
    if (content.includes('refactor')) return 'refactoring';
    if (content.includes('fix') || content.includes('bug')) return 'bug_fix';
    if (content.includes('implement') || content.includes('add')) return 'implementation';
    if (content.includes('review') || content.includes('check')) return 'review';
    if (content.includes('document') || content.includes('comment')) return 'documentation';
    if (content.includes('optimize') || content.includes('performance')) return 'optimization';
    return 'general';
  }

  /**
   * Record task completion for learning
   */
  recordTaskCompletion(task: AgentTask, result: AgentExecutionResult): void {
    const metrics = this.agentMetrics.get(result.role);
    if (!metrics) return;

    // Update basic metrics
    metrics.totalTasks++;
    if (result.success) {
      metrics.successfulTasks++;
    } else {
      metrics.failedTasks++;
    }

    // Update averages
    metrics.avgDuration = (metrics.avgDuration * (metrics.totalTasks - 1) + result.duration) / metrics.totalTasks;
    metrics.avgRounds = (metrics.avgRounds * (metrics.totalTasks - 1) + result.rounds) / metrics.totalTasks;
    metrics.successRate = metrics.successfulTasks / metrics.totalTasks;

    // Phase L (V0.4) — accumulate cost if the result includes it. The
    // WorkflowCostManager populates result.costUsd before this method
    // is called (cf. multi-agent-system.ts executeTask).
    if (result.costUsd !== undefined) {
      metrics.totalCostUsd += result.costUsd;
      metrics.avgCostPerTask = metrics.totalCostUsd / metrics.totalTasks;
    }

    // Update specialties
    const taskType = this.extractTaskType(task);
    if (result.success) {
      metrics.specialties.set(taskType, (metrics.specialties.get(taskType) || 0) + 1);
    }

    // Update recent performance
    metrics.recentPerformance.push(result.success ? 1 : 0);
    if (metrics.recentPerformance.length > this.config.historySize) {
      metrics.recentPerformance.shift();
    }

    // Remove from active tasks
    this.activeTasksPerAgent.get(result.role)?.delete(task.id);

    // Store in history
    if (this.config.enableLearning) {
      this.taskHistory.push({ task, result });
      if (this.taskHistory.length > this.config.historySize) {
        this.taskHistory.shift();
      }
    }

    // Emit metrics update
    this.emit('metrics:updated', { role: result.role, metrics });

    // Check for checkpoint
    if (metrics.totalTasks % this.config.checkpointInterval === 0) {
      this.createCheckpoint();
    }
  }

  /**
   * Mark task as started
   */
  markTaskStarted(task: AgentTask, agent: AgentRole): void {
    this.activeTasksPerAgent.get(agent)?.add(task.id);
    this.emit('task:started', { taskId: task.id, agent });
  }

  /**
   * Detect and handle conflicts
   */
  detectConflicts(
    tasks: AgentTask[],
    _context: SharedContext
  ): AgentConflict[] {
    if (!this.config.enableConflictResolution) return [];

    const newConflicts: AgentConflict[] = [];

    // Check for code overlap conflicts.
    // Phase M (V0.4.1) — loosened status filter from `in_progress`-only to
    // include `pending` and `review_required`. The pre-V0.4.1 filter meant
    // detection ran post-batch (when tasks were already `completed`/`failed`),
    // making `code_overlap` effectively dead code. Pre-batch detection now
    // sees `pending` tasks before they execute, enabling auto-resolve to
    // actually block losing agents.
    const detectableStatuses: ReadonlyArray<AgentTask['status']> = ['pending', 'in_progress', 'review_required'];
    const fileToAgents = new Map<string, AgentRole[]>();
    for (const task of tasks) {
      const targetFiles = task.metadata?.targetFiles as string[] | undefined;
      if (detectableStatuses.includes(task.status) && targetFiles) {
        for (const file of targetFiles) {
          const agents = fileToAgents.get(file) || [];
          agents.push(task.assignedTo);
          fileToAgents.set(file, agents);
        }
      }
    }

    for (const [file, agents] of fileToAgents) {
      if (agents.length > 1) {
        newConflicts.push({
          id: `conflict-${Date.now()}-${file}`,
          type: 'code_overlap',
          agents: [...new Set(agents)],
          description: `Multiple agents modifying ${file}`,
          severity: 'high',
          timestamp: new Date(),
          affectedFile: file,
        });
      }
    }

    // Check for resource contention
    for (const agent of this.activeTasksPerAgent.entries()) {
      const [role, tasks] = agent;
      if (tasks.size > this.config.maxParallelPerAgent) {
        newConflicts.push({
          id: `conflict-${Date.now()}-${role}`,
          type: 'resource_contention',
          agents: [role],
          description: `Agent ${role} has too many active tasks (${tasks.size})`,
          severity: 'medium',
          timestamp: new Date(),
        });
      }
    }

    // Store and emit new conflicts
    this.conflicts.push(...newConflicts);
    for (const conflict of newConflicts) {
      this.emit('conflict:detected', conflict);
    }

    return newConflicts;
  }

  /**
   * Resolve a conflict
   */
  resolveConflict(
    conflictId: string,
    resolution: Omit<ConflictResolution, 'timestamp'>
  ): boolean {
    const conflict = this.conflicts.find(c => c.id === conflictId);
    if (!conflict || conflict.resolution) return false;

    conflict.resolution = {
      ...resolution,
      timestamp: new Date(),
    };

    this.emit('conflict:resolved', { conflict, resolution: conflict.resolution });
    return true;
  }

  /**
   * Auto-resolve conflicts using predefined strategies.
   *
   * Phase M (V0.4.1) — when `tasks` is provided AND `autoResolveEnabled` is
   * true AND `autoResolveStrategy` is `prefer-reviewer`, mutates losing
   * agents' tasks to `status='blocked'` for `code_overlap` conflicts. This
   * is the first concrete side-effect for autoResolve (V0.3 / V0.4 baseline
   * was annotation-only).
   *
   * Other conflict types (`resource_contention`, `approach_disagreement`,
   * `deadline_conflict`) stay unresolved, with a `logger.warn` flagging the
   * V0.5+ deferral. Advisory text must not be stored as a resolution because
   * the performance report treats `conflict.resolution` as genuinely resolved.
   *
   * Returns the IDs of tasks whose status was mutated, so callers can log
   * the side-effect or update streamers (empty array if no mutation
   * happened — strategy=`none`, autoResolveEnabled=false, no `tasks`
   * provided, or no concrete losing task could be blocked).
   */
  autoResolveConflicts(tasks?: AgentTask[]): string[] {
    const mutatedTaskIds: string[] = [];
    const strategy = this.config.autoResolveStrategy;
    const sideEffectsEnabled =
      this.config.autoResolveEnabled && strategy === 'prefer-reviewer' && tasks !== undefined;

    for (const conflict of this.conflicts) {
      if (conflict.resolution) continue;

      let resolution: Omit<ConflictResolution, 'timestamp'> | null = null;

      switch (conflict.type) {
        case 'code_overlap': {
          // Priority order: reviewer > coder > tester > orchestrator. The
          // first agent in `conflict.agents` matching this order wins; the
          // others have their conflicting tasks blocked (when side-effects
          // are enabled).
          const priorityOrder: AgentRole[] = ['reviewer', 'coder', 'tester', 'orchestrator'];
          const winner = [...conflict.agents].sort((a, b) =>
            priorityOrder.indexOf(a) - priorityOrder.indexOf(b)
          )[0];
          const losers = conflict.agents.filter((a) => a !== winner);
          const file = conflict.affectedFile;

          let blockedCount = 0;
          if (sideEffectsEnabled && file && tasks) {
            for (const task of tasks) {
              if (
                losers.includes(task.assignedTo) &&
                Array.isArray(task.metadata?.targetFiles) &&
                (task.metadata.targetFiles as string[]).includes(file) &&
                task.status !== 'blocked' &&
                task.status !== 'completed'
              ) {
                task.status = 'blocked';
                task.error = `Blocked by code_overlap conflict — ${winner} has priority on ${file}`;
                task.updatedAt = new Date();
                mutatedTaskIds.push(task.id);
                blockedCount++;
              }
            }
          }

          if (blockedCount > 0) {
            resolution = {
              strategy: 'priority',
              decision: `Agent ${winner} has priority for ${file} — blocked ${blockedCount} losing task(s): ${losers.join(', ')}`,
              resolvedBy: 'orchestrator',
            };
          } else if (sideEffectsEnabled) {
            logger.warn(
              `[multi-agent] code_overlap auto-resolve found no pending losing task to block${file ? ` for ${file}` : ''}; conflict remains unresolved`
            );
          }
          break;
        }

        case 'resource_contention':
          if (sideEffectsEnabled) {
            logger.warn(
              `[multi-agent] auto-resolve for type=resource_contention not implemented in V0.4.1 (annotation-only); deferred to V0.5+`
            );
          }
          break;

        case 'approach_disagreement':
          if (sideEffectsEnabled) {
            logger.warn(
              `[multi-agent] auto-resolve for type=approach_disagreement not implemented in V0.4.1 (annotation-only); deferred to V0.5+`
            );
          }
          break;

        case 'deadline_conflict':
          if (sideEffectsEnabled) {
            logger.warn(
              `[multi-agent] auto-resolve for type=deadline_conflict not implemented in V0.4.1 (annotation-only); deferred to V0.5+`
            );
          }
          break;
      }

      if (resolution) {
        this.resolveConflict(conflict.id, resolution);
      }
    }

    return mutatedTaskIds;
  }

  /**
   * Share a resource with the pool
   */
  shareResource<K extends keyof ResourcePool>(
    type: K,
    key: string,
    value: ResourceValueType<K>,
    source: AgentRole
  ): void {
    switch (type) {
      case 'codeSnippets':
        this.resourcePool.codeSnippets.set(key, value as CodeSnippetResource);
        break;
      case 'fileModifications':
        this.resourcePool.fileModifications.set(key, value as FileModificationResource);
        break;
      case 'insights':
        this.resourcePool.insights.set(key, value as InsightResource);
        break;
      case 'testResults':
        this.resourcePool.testResults.set(key, value as TestResultResource);
        break;
    }

    this.emit('resource:shared', { type, key, source });
  }

  /**
   * Get resource from pool
   */
  getResource<T>(type: keyof ResourcePool, key: string): T | undefined {
    const pool = this.resourcePool[type] as Map<string, T>;
    return pool.get(key);
  }

  /**
   * Build task dependencies
   */
  buildDependencies(tasks: AgentTask[]): Map<string, TaskDependency> {
    this.taskDependencies.clear();

    for (const task of tasks) {
      const dep: TaskDependency = {
        taskId: task.id,
        dependsOn: task.dependencies || [],
        blockedBy: [],
        enables: [],
      };
      this.taskDependencies.set(task.id, dep);
    }

    // Build reverse dependencies
    for (const task of tasks) {
      for (const depId of task.dependencies || []) {
        const dep = this.taskDependencies.get(depId);
        if (dep) {
          dep.enables.push(task.id);
        }
      }
    }

    // Identify blocked tasks
    for (const [taskId, dep] of this.taskDependencies) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) continue;

      for (const depId of dep.dependsOn) {
        const depTask = tasks.find(t => t.id === depId);
        if (depTask && depTask.status !== 'completed') {
          dep.blockedBy.push(depId);
        }
      }
    }

    return this.taskDependencies;
  }

  /**
   * Get ready tasks (no blockers)
   */
  getReadyTasks(tasks: AgentTask[]): AgentTask[] {
    return tasks.filter(task => {
      if (task.status !== 'pending') return false;

      const dep = this.taskDependencies.get(task.id);
      if (!dep) return true;

      return dep.blockedBy.length === 0;
    });
  }

  /**
   * Create a checkpoint for recovery
   */
  createCheckpoint(): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `checkpoint-${Date.now()}`,
      timestamp: new Date(),
      completedTasks: this.taskHistory
        .filter(h => h.result.success)
        .map(h => h.task.id),
      pendingTasks: this.taskHistory
        .filter(h => !h.result.success)
        .map(h => h.task.id),
      artifacts: this.taskHistory
        .flatMap(h => h.result.artifacts),
      metrics: new Map(this.agentMetrics),
      resourcePool: { ...this.resourcePool },
    };

    this.checkpoints.push(checkpoint);
    this.emit('checkpoint:created', checkpoint);

    // Keep only last 5 checkpoints
    if (this.checkpoints.length > 5) {
      this.checkpoints.shift();
    }

    return checkpoint;
  }

  /**
   * Restore from checkpoint
   */
  restoreFromCheckpoint(checkpointId: string): boolean {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;

    this.agentMetrics = new Map(checkpoint.metrics);
    this.resourcePool = { ...checkpoint.resourcePool };

    this.emit('checkpoint:restored', checkpoint);
    return true;
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): string {
    const lines: string[] = [];

    lines.push('═'.repeat(60));
    lines.push('AGENT PERFORMANCE REPORT');
    lines.push('═'.repeat(60));
    lines.push('');

    for (const [role, metrics] of this.agentMetrics) {
      lines.push(`${role.toUpperCase()}`);
      lines.push('─'.repeat(40));
      lines.push(`  Total tasks: ${metrics.totalTasks}`);
      lines.push(`  Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
      lines.push(`  Avg duration: ${metrics.avgDuration.toFixed(0)}ms`);
      lines.push(`  Avg rounds: ${metrics.avgRounds.toFixed(1)}`);

      if (metrics.specialties.size > 0) {
        lines.push('  Specialties:');
        for (const [specialty, count] of metrics.specialties) {
          lines.push(`    - ${specialty}: ${count} successes`);
        }
      }
      lines.push('');
    }

    // Conflicts summary
    const unresolvedConflicts = this.conflicts.filter(c => !c.resolution);
    if (this.conflicts.length > 0) {
      lines.push('CONFLICTS');
      lines.push('─'.repeat(40));
      lines.push(`  Total: ${this.conflicts.length}`);
      lines.push(`  Resolved: ${this.conflicts.length - unresolvedConflicts.length}`);
      lines.push(`  Pending: ${unresolvedConflicts.length}`);
      lines.push('');
    }

    // Resource pool summary
    lines.push('RESOURCE POOL');
    lines.push('─'.repeat(40));
    lines.push(`  Code snippets: ${this.resourcePool.codeSnippets.size}`);
    lines.push(`  File modifications: ${this.resourcePool.fileModifications.size}`);
    lines.push(`  Insights: ${this.resourcePool.insights.size}`);
    lines.push(`  Test results: ${this.resourcePool.testResults.size}`);
    lines.push('');

    lines.push('═'.repeat(60));
    return lines.join('\n');
  }

  /**
   * Get metrics for an agent
   */
  getAgentMetrics(role: AgentRole): AgentMetrics | undefined {
    return this.agentMetrics.get(role);
  }

  /**
   * Get all conflicts
   */
  getConflicts(): AgentConflict[] {
    return [...this.conflicts];
  }

  /**
   * Get the resource pool
   */
  getResourcePool(): ResourcePool {
    return this.resourcePool;
  }

  /**
   * Reset coordinator state
   */
  reset(): void {
    this.initializeMetrics();
    this.taskDependencies.clear();
    this.conflicts = [];
    this.resourcePool = this.createEmptyResourcePool();
    this.checkpoints = [];
    this.taskHistory = [];
    this.emit('coordinator:reset');
  }

  // ─── Phase N (V0.4.1) — disk persistence API ───────────────────────────

  /**
   * Enable disk persistence for adaptive allocation warm-start.
   *
   * - Loads `~/.codebuddy/agents/metrics.json` (if present) and merges
   *   into `agentMetrics`. Each role's metrics are replaced atomically:
   *   the persisted entry wins over the freshly-initialised default
   *   (totalTasks=0, successRate=0.5).
   * - Subscribes to the `metrics:updated` event with a debounced save
   *   (default 5s) so a burst of recordTaskCompletion calls produces a
   *   single write.
   * - Idempotent — subsequent calls are no-ops.
   *
   * Side-effects:
   * - Logs a warning if the persisted file is older than `metricsTtlDays`
   *   (V0.4.1 = warning only; V0.5 will clear stale automatically).
   * - Caller may `await` the returned promise to know that the in-memory
   *   metrics reflect disk state before scheduling work — this avoids the
   *   race where allocateTask runs against fresh defaults while disk load
   *   is still pending.
   */
  async enablePersistence(opts: PersistenceOptions = {}): Promise<void> {
    if (this.persistenceEnabled) return;
    this.persistenceEnabled = true;
    this.metricsTtlDays = opts.metricsTtlDays ?? 30;
    this.saveDebounceMs = opts.saveDebounceMs ?? 5000;

    // Load disk state when learning is enabled (otherwise persisted
    // metrics would be ignored anyway since the allocator skips them).
    if (this.config.enableLearning) {
      try {
        const { loadMetrics, clearMetrics } = await import('./metrics-persistence.js');
        const loaded = await loadMetrics();
        if (loaded) {
          // V0.5 (Phase d.21 ship 5) — TTL enforcement: clear stale
          // metrics before they bias allocation. Mirrors the V0.4.1
          // warning behaviour but actually deletes the file and resets
          // the in-memory baseline.
          const ageMs = Date.now() - loaded.savedAt.getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays > this.metricsTtlDays) {
            await clearMetrics();
            this.initializeMetrics();
            this.metricsSavedAt = null;
            logger.info(
              `[multi-agent] persisted metrics ${Math.floor(ageDays)} days old (TTL ${this.metricsTtlDays}d) — cleared (V0.5 enforcement)`,
            );
          } else {
            for (const [role, metrics] of loaded.metrics) {
              this.agentMetrics.set(role, metrics);
            }
            this.metricsSavedAt = loaded.savedAt;
          }
        }
      } catch (err) {
        logger.warn('[multi-agent] enablePersistence load failed (best-effort)', { error: String(err) });
      }
    }

    // Wire debounced save listener. Stored as a field so disable can `.off()`.
    this.metricsUpdatedListener = () => this.scheduleSave();
    this.on('metrics:updated', this.metricsUpdatedListener);
  }

  /**
   * Schedule a debounced save. Each call resets the timer; only the last
   * burst of updates within the debounce window triggers a write.
   */
  private scheduleSave(): void {
    if (!this.persistenceEnabled) return;
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.flushSave().catch((err) =>
        logger.warn('[multi-agent] metrics scheduled save failed', { error: String(err) })
      );
    }, this.saveDebounceMs);
  }

  /**
   * Flush any pending debounced save synchronously. Tests use this to
   * await disk writes deterministically. Production code calls it from
   * dispose() to avoid losing the last burst of metrics updates when
   * the process exits between debounce ticks.
   */
  async flushSave(): Promise<void> {
    if (!this.persistenceEnabled) return;
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    try {
      const { saveMetrics } = await import('./metrics-persistence.js');
      await saveMetrics(this.agentMetrics);
      this.metricsSavedAt = new Date();
    } catch (err) {
      logger.warn('[multi-agent] metrics flush save failed', { error: String(err) });
    }
  }

  /** Returns the timestamp of the last successful save/load, or null if
   *  persistence has never run successfully. Used by /agents metrics. */
  getMetricsSavedAt(): Date | null {
    return this.metricsSavedAt;
  }

  /** Whether disk persistence is currently active. */
  isPersistenceEnabled(): boolean {
    return this.persistenceEnabled;
  }

  /**
   * Dispose and cleanup. Phase N — clears the debounce timer to prevent
   * leaked timers in tests; if a save was pending, it is dropped (caller
   * must call `flushSave()` first if they need the last burst persisted).
   */
  dispose(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    if (this.metricsUpdatedListener) {
      this.off('metrics:updated', this.metricsUpdatedListener);
      this.metricsUpdatedListener = null;
    }
    this.persistenceEnabled = false;
    this.reset();
    this.removeAllListeners();
  }
}

/**
 * Create an EnhancedCoordinator instance
 */
export function createEnhancedCoordinator(
  config: Partial<CoordinationConfig> = {}
): EnhancedCoordinator {
  return new EnhancedCoordinator(config);
}

// Singleton instance
let coordinatorInstance: EnhancedCoordinator | null = null;

export function getEnhancedCoordinator(
  config: Partial<CoordinationConfig> = {}
): EnhancedCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = createEnhancedCoordinator(config);
  }
  return coordinatorInstance;
}

export function resetEnhancedCoordinator(): void {
  if (coordinatorInstance) {
    coordinatorInstance.dispose();
  }
  coordinatorInstance = null;
}
