/**
 * Multi-Agent Orchestrator
 *
 * Coordinates multiple agents working together on complex tasks.
 */

import { EventEmitter } from 'events';
import type {
  AgentDefinition,
  AgentInstance,
  AgentStatus,
  TaskDefinition,
  TaskInstance,
  WorkflowDefinition,
  WorkflowInstance,
  AgentMessage,
  OrchestratorConfig,
  OrchestratorStats,
  OrchestratorEventHandler,
  TaskPriority,
} from './types.js';
import { safeEvalCondition } from '../sandbox/safe-eval.js';

// Default configuration
const DEFAULT_CONFIG: OrchestratorConfig = {
  maxAgents: 10,
  maxTasks: 100,
  taskQueueSize: 1000,
  defaultTimeout: 300000, // 5 minutes
  autoScale: true,
  logLevel: 'info',
};

// Priority weights for task queue
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 1000,
  high: 100,
  medium: 10,
  low: 1,
};

/**
 * Multi-Agent Orchestrator
 */
export class Orchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private agents: Map<string, AgentInstance> = new Map();
  private tasks: Map<string, TaskInstance> = new Map();
  private workflows: Map<string, WorkflowInstance> = new Map();
  private taskQueue: TaskInstance[] = [];
  private messageQueue: AgentMessage[] = [];
  private startTime: number;
  private completedTaskCount = 0;
  private failedTaskCount = 0;
  private totalTaskDuration = 0;
  private running = false;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  /**
   * Register a new agent
   */
  registerAgent(definition: AgentDefinition): AgentInstance {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Maximum agent limit (${this.config.maxAgents}) reached`);
    }

    if (this.agents.has(definition.id)) {
      throw new Error(`Agent '${definition.id}' already exists`);
    }

    const instance: AgentInstance = {
      definition,
      status: 'idle',
      completedTasks: 0,
      failedTasks: 0,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.agents.set(definition.id, instance);
    this.emit('agent_created', { type: 'agent_created', agent: instance });
    this.log('info', `Agent registered: ${definition.name} (${definition.id})`);

    return instance;
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    if (agent.status === 'busy') {
      throw new Error(`Cannot unregister busy agent '${agentId}'`);
    }

    this.agents.delete(agentId);
    this.emit('agent_destroyed', { type: 'agent_destroyed', agentId });
    this.log('info', `Agent unregistered: ${agentId}`);

    return true;
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' not found`);
    }

    agent.status = status;
    agent.lastActivity = new Date();
    this.emit('agent_status_changed', { type: 'agent_status_changed', agentId, status });
  }

  /**
   * Find available agent for task
   */
  findAvailableAgent(task: TaskDefinition): AgentInstance | null {
    const candidates = Array.from(this.agents.values()).filter((agent) => {
      // Must be idle
      if (agent.status !== 'idle') return false;

      // Check required role
      if (task.requiredRole && agent.definition.role !== task.requiredRole) {
        return false;
      }

      // Check required capabilities
      if (task.requiredCapabilities) {
        const hasAllCapabilities = task.requiredCapabilities.every((cap) =>
          agent.definition.capabilities.tools.includes(cap) ||
          agent.definition.capabilities.taskTypes.includes(cap)
        );
        if (!hasAllCapabilities) return false;
      }

      return true;
    });

    if (candidates.length === 0) return null;

    // Sort by priority and completed tasks (prefer less loaded agents)
    candidates.sort((a, b) => {
      const priorityDiff = (b.definition.priority || 0) - (a.definition.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.completedTasks - b.completedTasks;
    });

    return candidates[0];
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  /**
   * Create a new task
   */
  createTask(definition: TaskDefinition): TaskInstance {
    if (this.tasks.size >= this.config.maxTasks) {
      throw new Error(`Maximum task limit (${this.config.maxTasks}) reached`);
    }

    const instance: TaskInstance = {
      definition,
      status: 'pending',
      retries: 0,
      createdAt: new Date(),
    };

    this.tasks.set(definition.id, instance);
    this.emit('task_created', { type: 'task_created', task: instance });
    this.log('debug', `Task created: ${definition.name} (${definition.id})`);

    return instance;
  }

  /**
   * Queue a task for execution
   */
  queueTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    if (task.status !== 'pending') {
      throw new Error(`Task '${taskId}' is not in pending state`);
    }

    task.status = 'queued';
    this.insertIntoQueue(task);
    this.log('debug', `Task queued: ${taskId}`);
  }

  /**
   * Insert task into priority queue
   */
  private insertIntoQueue(task: TaskInstance): void {
    const priority = PRIORITY_WEIGHTS[task.definition.priority];

    // Find insertion point (sorted by priority descending)
    let insertIdx = 0;
    for (let i = 0; i < this.taskQueue.length; i++) {
      const existingPriority = PRIORITY_WEIGHTS[this.taskQueue[i].definition.priority];
      if (priority > existingPriority) {
        break;
      }
      insertIdx = i + 1;
    }

    this.taskQueue.splice(insertIdx, 0, task);
  }

  /**
   * Assign task to agent
   */
  assignTask(taskId: string, agentId: string): void {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (!agent) throw new Error(`Agent '${agentId}' not found`);
    if (agent.status !== 'idle') throw new Error(`Agent '${agentId}' is not idle`);

    task.status = 'assigned';
    task.assignedAgent = agentId;
    agent.status = 'busy';
    agent.currentTask = taskId;
    agent.lastActivity = new Date();

    // Remove from queue
    const queueIdx = this.taskQueue.findIndex((t) => t.definition.id === taskId);
    if (queueIdx !== -1) {
      this.taskQueue.splice(queueIdx, 1);
    }

    this.emit('task_assigned', { type: 'task_assigned', taskId, agentId });
    this.log('info', `Task ${taskId} assigned to agent ${agentId}`);
  }

  /**
   * Start task execution
   */
  startTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (task.status !== 'assigned') throw new Error(`Task '${taskId}' is not assigned`);

    task.status = 'in_progress';
    task.startedAt = new Date();
    this.log('debug', `Task started: ${taskId}`);
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string, output: Record<string, unknown>): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    task.status = 'completed';
    task.output = output;
    task.completedAt = new Date();

    // Update stats
    this.completedTaskCount++;
    if (task.startedAt) {
      this.totalTaskDuration += task.completedAt.getTime() - task.startedAt.getTime();
    }

    // Free up agent
    if (task.assignedAgent) {
      const agent = this.agents.get(task.assignedAgent);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.completedTasks++;
        agent.lastActivity = new Date();
      }
    }

    this.emit('task_completed', { type: 'task_completed', taskId, output });
    this.log('info', `Task completed: ${taskId}`);

    // Process queue
    this.processQueue();
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    // Check for retries
    if (task.retries < (task.definition.maxRetries || 0)) {
      task.retries++;
      task.status = 'queued';
      this.insertIntoQueue(task);
      this.log('warn', `Task ${taskId} failed, retrying (${task.retries}/${task.definition.maxRetries})`);

      // Free up agent
      if (task.assignedAgent) {
        const agent = this.agents.get(task.assignedAgent);
        if (agent) {
          agent.status = 'idle';
          agent.currentTask = undefined;
          agent.lastActivity = new Date();
        }
        task.assignedAgent = undefined;
      }

      this.processQueue();
      return;
    }

    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date();
    this.failedTaskCount++;

    // Free up agent
    if (task.assignedAgent) {
      const agent = this.agents.get(task.assignedAgent);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.failedTasks++;
        agent.lastActivity = new Date();
      }
    }

    this.emit('task_failed', { type: 'task_failed', taskId, error });
    this.log('error', `Task failed: ${taskId} - ${error}`);

    // Process queue
    this.processQueue();
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): TaskInstance | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    task.status = 'cancelled';
    task.completedAt = new Date();

    // Remove from queue
    const queueIdx = this.taskQueue.findIndex((t) => t.definition.id === taskId);
    if (queueIdx !== -1) {
      this.taskQueue.splice(queueIdx, 1);
    }

    // Free up agent
    if (task.assignedAgent) {
      const agent = this.agents.get(task.assignedAgent);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.lastActivity = new Date();
      }
    }

    this.log('info', `Task cancelled: ${taskId}`);
  }

  // ============================================================================
  // Queue Processing
  // ============================================================================

  /**
   * Process the task queue
   */
  processQueue(): void {
    if (!this.running) return;

    for (const task of this.taskQueue) {
      // Check dependencies
      if (task.definition.dependsOn && task.definition.dependsOn.length > 0) {
        const allDepsComplete = task.definition.dependsOn.every((depId) => {
          const dep = this.tasks.get(depId);
          return dep?.status === 'completed';
        });
        if (!allDepsComplete) continue;
      }

      // Find available agent
      const agent = this.findAvailableAgent(task.definition);
      if (agent) {
        this.assignTask(task.definition.id, agent.definition.id);
        this.startTask(task.definition.id);
      }
    }
  }

  /**
   * Start the orchestrator
   */
  start(): void {
    this.running = true;
    this.log('info', 'Orchestrator started');
    this.processQueue();
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    this.running = false;
    this.log('info', 'Orchestrator stopped');
  }

  // ============================================================================
  // Workflow Management
  // ============================================================================

  /**
   * Start a workflow
   */
  async startWorkflow(
    definition: WorkflowDefinition,
    input: Record<string, unknown>
  ): Promise<WorkflowInstance> {
    const instanceId = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const instance: WorkflowInstance = {
      definition,
      instanceId,
      status: 'running',
      input,
      completedSteps: [],
      tasks: new Map(),
      startedAt: new Date(),
    };

    this.workflows.set(instanceId, instance);
    this.emit('workflow_started', { type: 'workflow_started', instanceId });
    this.log('info', `Workflow started: ${definition.name} (${instanceId})`);

    // Execute workflow
    try {
      const output = await this.executeWorkflow(instance);
      instance.status = 'completed';
      instance.output = output;
      instance.completedAt = new Date();
      this.emit('workflow_completed', { type: 'workflow_completed', instanceId, output });
      this.log('info', `Workflow completed: ${instanceId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      instance.status = 'failed';
      instance.error = errorMessage;
      instance.completedAt = new Date();
      this.emit('workflow_failed', { type: 'workflow_failed', instanceId, error: errorMessage });
      this.log('error', `Workflow failed: ${instanceId} - ${errorMessage}`);
    }

    return instance;
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(instance: WorkflowInstance): Promise<Record<string, unknown>> {
    const context: Record<string, unknown> = { ...instance.input };

    for (const step of instance.definition.steps) {
      instance.currentStep = step.id;
      await this.executeWorkflowStep(instance, step, context);
      instance.completedSteps.push(step.id);
      this.emit('workflow_step_completed', {
        type: 'workflow_step_completed',
        instanceId: instance.instanceId,
        stepId: step.id,
      });
    }

    return context;
  }

  /**
   * Execute a workflow step
   */
  private async executeWorkflowStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    context: Record<string, unknown>
  ): Promise<void> {
    switch (step.type) {
      case 'task':
        await this.executeTaskStep(instance, step, context);
        break;
      case 'parallel':
        await this.executeParallelStep(instance, step, context);
        break;
      case 'conditional':
        await this.executeConditionalStep(instance, step, context);
        break;
      case 'loop':
        await this.executeLoopStep(instance, step, context);
        break;
    }
  }

  /**
   * Execute a task step
   */
  private async executeTaskStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    context: Record<string, unknown>
  ): Promise<void> {
    if (!step.tasks || step.tasks.length === 0) return;

    for (const taskDef of step.tasks) {
      // Substitute variables in task input
      const resolvedInput = this.resolveVariables(taskDef.input, context);
      const resolvedDef = { ...taskDef, input: resolvedInput };

      const task = this.createTask(resolvedDef);
      instance.tasks.set(task.definition.id, task);
      this.queueTask(task.definition.id);

      // Wait for completion
      await this.waitForTask(task.definition.id);

      // Add output to context
      const completedTask = this.tasks.get(task.definition.id);
      if (completedTask?.output) {
        context[`task_${task.definition.id}`] = completedTask.output;
      }
    }
  }

  /**
   * Execute parallel branches
   */
  private async executeParallelStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    context: Record<string, unknown>
  ): Promise<void> {
    if (!step.branches || step.branches.length === 0) return;

    const branchPromises = step.branches.map(async (branch) => {
      const branchContext = { ...context };
      for (const branchStep of branch) {
        await this.executeWorkflowStep(instance, branchStep, branchContext);
      }
      return branchContext;
    });

    const results = await Promise.all(branchPromises);

    // Merge branch results
    for (let i = 0; i < results.length; i++) {
      context[`branch_${i}`] = results[i];
    }
  }

  /**
   * Execute conditional step
   */
  private async executeConditionalStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    context: Record<string, unknown>
  ): Promise<void> {
    const condition = this.evaluateCondition(step.condition || 'false', context);

    const branch = condition ? step.trueBranch : step.falseBranch;
    if (branch) {
      for (const branchStep of branch) {
        await this.executeWorkflowStep(instance, branchStep, context);
      }
    }
  }

  /**
   * Execute loop step
   */
  private async executeLoopStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    context: Record<string, unknown>
  ): Promise<void> {
    let iteration = 0;
    const maxIterations = 100; // Safety limit

    while (
      this.evaluateCondition(step.loopCondition || 'false', context) &&
      iteration < maxIterations
    ) {
      context['iteration'] = iteration;

      if (step.loopBody) {
        for (const bodyStep of step.loopBody) {
          await this.executeWorkflowStep(instance, bodyStep, context);
        }
      }

      iteration++;
    }
  }

  /**
   * Wait for task completion
   */
  private waitForTask(taskId: string, timeout?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkInterval = 100;
      const maxWait = timeout || this.config.defaultTimeout;
      let waited = 0;
      let settled = false;

      const check = () => {
        if (settled) return;

        const task = this.tasks.get(taskId);
        if (!task) {
          settled = true;
          reject(new Error(`Task '${taskId}' not found`));
          return;
        }

        if (task.status === 'completed') {
          settled = true;
          resolve();
          return;
        }

        if (task.status === 'failed') {
          settled = true;
          reject(new Error(task.error || 'Task failed'));
          return;
        }

        if (task.status === 'cancelled') {
          settled = true;
          reject(new Error('Task cancelled'));
          return;
        }

        waited += checkInterval;
        if (waited >= maxWait) {
          settled = true;
          reject(new Error('Task timeout'));
          return;
        }

        setTimeout(check, checkInterval);
      };

      check();
    });
  }

  /**
   * Resolve variables in an object
   */
  private resolveVariables(
    obj: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        const varName = value.slice(1);
        resolved[key] = context[varName] ?? value;
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveVariables(
          value as Record<string, unknown>,
          context
        );
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    // Substitute $variable references with their JSON values
    let resolved = condition;
    for (const [key, value] of Object.entries(context)) {
      resolved = resolved.replace(new RegExp(`\\$${key}`, 'g'), JSON.stringify(value));
    }

    return safeEvalCondition(resolved, context);
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send a message between agents
   */
  sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): void {
    const fullMessage: AgentMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    this.messageQueue.push(fullMessage);
    if (this.messageQueue.length > 2000) {
      this.messageQueue.splice(0, this.messageQueue.length - 1000);
    }
    this.emit('message_sent', { type: 'message_sent', message: fullMessage });
    this.log('debug', `Message sent from ${message.from} to ${message.to || 'all'}`);
  }

  /**
   * Get messages for an agent
   */
  getMessagesForAgent(agentId: string): AgentMessage[] {
    return this.messageQueue.filter(
      (m) => m.to === null || m.to === agentId
    );
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get orchestrator statistics
   */
  getStats(): OrchestratorStats {
    const agents = Array.from(this.agents.values());
    const tasks = Array.from(this.tasks.values());

    return {
      activeAgents: agents.filter((a) => a.status === 'busy').length,
      idleAgents: agents.filter((a) => a.status === 'idle').length,
      pendingTasks: tasks.filter((t) => t.status === 'pending' || t.status === 'queued').length,
      runningTasks: tasks.filter((t) => t.status === 'in_progress' || t.status === 'assigned').length,
      completedTasks: this.completedTaskCount,
      failedTasks: this.failedTaskCount,
      avgTaskDuration: this.completedTaskCount > 0
        ? this.totalTaskDuration / this.completedTaskCount
        : 0,
      throughput: this.calculateThroughput(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Calculate throughput (tasks/min)
   */
  private calculateThroughput(): number {
    const uptimeMinutes = (Date.now() - this.startTime) / 60000;
    if (uptimeMinutes < 1) return this.completedTaskCount;
    return this.completedTaskCount / uptimeMinutes;
  }

  // ============================================================================
  // Logging
  // ============================================================================

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) < levels.indexOf(this.config.logLevel)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [Orchestrator] [${level.toUpperCase()}]`;
    console[level](`${prefix} ${message}`);
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Add event handler
   */
  onEvent(handler: OrchestratorEventHandler): void {
    this.on('agent_created', handler);
    this.on('agent_destroyed', handler);
    this.on('agent_status_changed', handler);
    this.on('task_created', handler);
    this.on('task_assigned', handler);
    this.on('task_completed', handler);
    this.on('task_failed', handler);
    this.on('workflow_started', handler);
    this.on('workflow_step_completed', handler);
    this.on('workflow_completed', handler);
    this.on('workflow_failed', handler);
    this.on('message_sent', handler);
  }
}

// Import WorkflowStep type for method signatures
import type { WorkflowStep } from './types.js';
