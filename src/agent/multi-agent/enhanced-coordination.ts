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

/**
 * Agent performance metrics
 */
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
};

/**
 * Shared resource pool
 */
export interface ResourcePool {
  // Code snippets indexed by purpose
  codeSnippets: Map<string, { code: string; source: AgentRole; relevance: number }>;
  // File modifications tracking
  fileModifications: Map<string, { agent: AgentRole; timestamp: Date; type: 'create' | 'modify' | 'delete' }>;
  // Shared insights from analysis
  insights: Map<string, { insight: string; source: AgentRole; confidence: number }>;
  // Test results cache
  testResults: Map<string, { passed: boolean; output: string; timestamp: Date }>;
}

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

    // Check for code overlap conflicts
    const fileToAgents = new Map<string, AgentRole[]>();
    for (const task of tasks) {
      const targetFiles = task.metadata?.targetFiles as string[] | undefined;
      if (task.status === 'in_progress' && targetFiles) {
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
   * Auto-resolve conflicts using predefined strategies
   */
  autoResolveConflicts(): void {
    for (const conflict of this.conflicts) {
      if (conflict.resolution) continue;

      let resolution: Omit<ConflictResolution, 'timestamp'> | null = null;

      switch (conflict.type) {
        case 'code_overlap':
          // Priority-based: reviewer > coder > tester
          const priorityOrder: AgentRole[] = ['reviewer', 'coder', 'tester', 'orchestrator'];
          const winner = conflict.agents.sort((a, b) =>
            priorityOrder.indexOf(a) - priorityOrder.indexOf(b)
          )[0];
          resolution = {
            strategy: 'priority',
            decision: `Agent ${winner} has priority for this file`,
            resolvedBy: 'orchestrator',
          };
          break;

        case 'resource_contention':
          resolution = {
            strategy: 'arbitration',
            decision: 'Queue excess tasks for later execution',
            resolvedBy: 'orchestrator',
          };
          break;

        case 'approach_disagreement':
          resolution = {
            strategy: 'consensus',
            decision: 'Prefer approach with higher confidence score',
            resolvedBy: 'orchestrator',
          };
          break;

        case 'deadline_conflict':
          resolution = {
            strategy: 'priority',
            decision: 'Prioritize critical path tasks',
            resolvedBy: 'orchestrator',
          };
          break;
      }

      if (resolution) {
        this.resolveConflict(conflict.id, resolution);
      }
    }
  }

  /**
   * Share a resource with the pool
   */
  shareResource(
    type: keyof ResourcePool,
    key: string,
    value: unknown,
    source: AgentRole
  ): void {
    /* eslint-disable @typescript-eslint/no-explicit-any -- value is unknown, cast needed for type-specific Maps */
    switch (type) {
      case 'codeSnippets':
        this.resourcePool.codeSnippets.set(key, value as any);
        break;
      case 'fileModifications':
        this.resourcePool.fileModifications.set(key, value as any);
        break;
      case 'insights':
        this.resourcePool.insights.set(key, value as any);
        break;
      case 'testResults':
        this.resourcePool.testResults.set(key, value as any);
        break;
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

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

  /**
   * Dispose and cleanup
   */
  dispose(): void {
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
