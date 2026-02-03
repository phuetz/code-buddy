/**
 * Workflows Module - Multi-step workflow execution engine
 *
 * Provides:
 * - Workflow definition and registration
 * - Step-by-step execution with state management
 * - Event-driven workflow lifecycle
 * - Conditional branching and error handling
 * - Workflow persistence and resume capability
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  action: string | ((context: WorkflowContext) => Promise<StepResult>);
  condition?: string | ((context: WorkflowContext) => boolean);
  timeout?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
  onSuccess?: string;  // Next step ID on success
  onFailure?: string;  // Next step ID on failure
  metadata?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  initialContext?: Record<string, unknown>;
  timeout?: number;
  onComplete?: string;   // Action to run on completion
  onError?: string;      // Action to run on error
  tags?: string[];
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface StepExecution {
  stepId: string;
  stepName: string;
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: StepResult;
  retries: number;
}

export interface WorkflowContext {
  workflowId: string;
  instanceId: string;
  variables: Record<string, unknown>;
  stepResults: Map<string, StepResult>;
  currentStep?: string;
  metadata: Record<string, unknown>;
}

export interface WorkflowState {
  instanceId: string;
  workflowId: string;
  status: WorkflowStatus;
  context: WorkflowContext;
  stepExecutions: Map<string, StepExecution>;
  currentStepIndex: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
  error?: string;
  totalDuration?: number;
}

export interface WorkflowResult {
  success: boolean;
  instanceId: string;
  workflowId: string;
  status: WorkflowStatus;
  stepResults: Map<string, StepResult>;
  finalContext: Record<string, unknown>;
  duration: number;
  error?: string;
  completedSteps: number;
  totalSteps: number;
}

export interface WorkflowExecutionOptions {
  initialContext?: Record<string, unknown>;
  startFromStep?: string;
  timeout?: number;
  onStepComplete?: (step: StepExecution) => void;
  onStepStart?: (stepId: string) => void;
}

// ============================================================================
// Step Manager - Manages individual step execution
// ============================================================================

export class StepManager extends EventEmitter {
  private actionHandlers: Map<string, (context: WorkflowContext) => Promise<StepResult>> = new Map();

  constructor() {
    super();
    this.registerBuiltInActions();
  }

  /**
   * Register built-in action handlers
   */
  private registerBuiltInActions(): void {
    // Log action
    this.registerAction('log', async (context) => {
      const message = context.variables.message || 'No message';
      console.log(`[Workflow ${context.instanceId}] ${message}`);
      return { success: true, output: message };
    });

    // Delay action
    this.registerAction('delay', async (context) => {
      const ms = (context.variables.delay as number) || 1000;
      await new Promise(resolve => setTimeout(resolve, ms));
      return { success: true, output: `Delayed ${ms}ms` };
    });

    // Set variable action
    this.registerAction('setVariable', async (context) => {
      const name = context.variables.varName as string;
      const value = context.variables.varValue;
      if (name) {
        context.variables[name] = value;
      }
      return { success: true, output: { [name]: value } };
    });

    // Conditional action (always succeeds, used for branching)
    this.registerAction('conditional', async (context) => {
      return { success: true, output: context.variables };
    });

    // Noop action
    this.registerAction('noop', async () => {
      return { success: true, output: 'No operation performed' };
    });
  }

  /**
   * Register a custom action handler
   */
  registerAction(name: string, handler: (context: WorkflowContext) => Promise<StepResult>): void {
    this.actionHandlers.set(name, handler);
  }

  /**
   * Check if an action is registered
   */
  hasAction(name: string): boolean {
    return this.actionHandlers.has(name);
  }

  /**
   * Get all registered action names
   */
  getRegisteredActions(): string[] {
    return Array.from(this.actionHandlers.keys());
  }

  /**
   * Execute a step
   */
  async executeStep(
    step: WorkflowStep,
    context: WorkflowContext,
    options: { timeout?: number } = {}
  ): Promise<StepResult> {
    const startTime = Date.now();

    this.emit('step:start', { stepId: step.id, stepName: step.name });

    try {
      // Check condition
      if (step.condition) {
        const shouldRun = this.evaluateCondition(step.condition, context);
        if (!shouldRun) {
          this.emit('step:skipped', { stepId: step.id, reason: 'Condition not met' });
          return { success: true, output: 'Step skipped', metadata: { skipped: true } };
        }
      }

      // Execute action
      let result: StepResult;

      if (typeof step.action === 'function') {
        result = await this.executeWithTimeout(
          step.action(context),
          options.timeout || step.timeout || 30000
        );
      } else if (typeof step.action === 'string') {
        const handler = this.actionHandlers.get(step.action);
        if (!handler) {
          throw new Error(`Unknown action: ${step.action}`);
        }
        result = await this.executeWithTimeout(
          handler(context),
          options.timeout || step.timeout || 30000
        );
      } else {
        throw new Error('Invalid action type');
      }

      result.duration = Date.now() - startTime;

      this.emit('step:complete', {
        stepId: step.id,
        stepName: step.name,
        success: result.success,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit('step:error', {
        stepId: step.id,
        stepName: step.name,
        error: errorMessage,
        duration,
      });

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step execution timed out after ${timeout}ms`));
      }, timeout);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Evaluate a condition
   */
  evaluateCondition(
    condition: string | ((context: WorkflowContext) => boolean),
    context: WorkflowContext
  ): boolean {
    if (typeof condition === 'function') {
      return condition(context);
    }

    // Simple condition evaluation for string conditions
    // Supports: "variable === value", "variable > value", etc.
    try {
      // Check for variable existence conditions
      if (condition.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return !!context.variables[condition];
      }

      // Check for comparison conditions
      const comparisonMatch = condition.match(/^(\w+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
      if (comparisonMatch) {
        const [, variable, operator, valueStr] = comparisonMatch;
        const actualValue = context.variables[variable];
        let expectedValue: unknown = valueStr;

        // Parse value
        if (valueStr === 'true') expectedValue = true;
        else if (valueStr === 'false') expectedValue = false;
        else if (valueStr === 'null') expectedValue = null;
        else if (valueStr === 'undefined') expectedValue = undefined;
        else if (!isNaN(Number(valueStr))) expectedValue = Number(valueStr);
        else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
          expectedValue = valueStr.slice(1, -1);
        }

        switch (operator) {
          case '===':
          case '==':
            return actualValue === expectedValue;
          case '!==':
          case '!=':
            return actualValue !== expectedValue;
          case '>':
            return (actualValue as number) > (expectedValue as number);
          case '<':
            return (actualValue as number) < (expectedValue as number);
          case '>=':
            return (actualValue as number) >= (expectedValue as number);
          case '<=':
            return (actualValue as number) <= (expectedValue as number);
        }
      }

      // Default to true for unrecognized conditions
      return true;
    } catch {
      return true;
    }
  }
}

// ============================================================================
// Workflow State Manager - Persists and manages workflow state
// ============================================================================

export class WorkflowStateManager {
  private statesDir: string;
  private states: Map<string, WorkflowState> = new Map();

  constructor(statesDir?: string) {
    this.statesDir = statesDir || path.join(os.homedir(), '.codebuddy', 'workflows');
    this.ensureDir();
    this.loadStates();
  }

  /**
   * Ensure the states directory exists
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.statesDir)) {
      fs.mkdirSync(this.statesDir, { recursive: true });
    }
  }

  /**
   * Load existing states from disk
   */
  private loadStates(): void {
    try {
      const files = fs.readdirSync(this.statesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const statePath = path.join(this.statesDir, file);
          const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          const state = this.deserializeState(data);
          this.states.set(state.instanceId, state);
        } catch {
          // Skip invalid state files
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  /**
   * Serialize state for storage
   */
  private serializeState(state: WorkflowState): Record<string, unknown> {
    return {
      ...state,
      context: {
        ...state.context,
        stepResults: Array.from(state.context.stepResults.entries()),
      },
      stepExecutions: Array.from(state.stepExecutions.entries()),
      createdAt: state.createdAt.toISOString(),
      startedAt: state.startedAt?.toISOString(),
      completedAt: state.completedAt?.toISOString(),
      pausedAt: state.pausedAt?.toISOString(),
    };
  }

  /**
   * Deserialize state from storage
   */
  private deserializeState(data: Record<string, unknown>): WorkflowState {
    const contextData = data.context as Record<string, unknown>;
    return {
      ...data,
      context: {
        ...contextData,
        stepResults: new Map(contextData.stepResults as [string, StepResult][]),
      },
      stepExecutions: new Map(data.stepExecutions as [string, StepExecution][]),
      createdAt: new Date(data.createdAt as string),
      startedAt: data.startedAt ? new Date(data.startedAt as string) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt as string) : undefined,
      pausedAt: data.pausedAt ? new Date(data.pausedAt as string) : undefined,
    } as WorkflowState;
  }

  /**
   * Generate unique instance ID
   */
  generateInstanceId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `wf_${timestamp}_${random}`;
  }

  /**
   * Create a new workflow state
   */
  createState(workflowId: string, initialContext: Record<string, unknown> = {}): WorkflowState {
    const instanceId = this.generateInstanceId();

    const state: WorkflowState = {
      instanceId,
      workflowId,
      status: 'pending',
      context: {
        workflowId,
        instanceId,
        variables: { ...initialContext },
        stepResults: new Map(),
        metadata: {},
      },
      stepExecutions: new Map(),
      currentStepIndex: 0,
      createdAt: new Date(),
    };

    this.states.set(instanceId, state);
    this.saveState(state);

    return state;
  }

  /**
   * Get a workflow state by instance ID
   */
  getState(instanceId: string): WorkflowState | undefined {
    return this.states.get(instanceId);
  }

  /**
   * Update a workflow state
   */
  updateState(instanceId: string, updates: Partial<WorkflowState>): WorkflowState | undefined {
    const state = this.states.get(instanceId);
    if (!state) return undefined;

    Object.assign(state, updates);
    this.saveState(state);

    return state;
  }

  /**
   * Save state to disk
   */
  saveState(state: WorkflowState): void {
    const statePath = path.join(this.statesDir, `${state.instanceId}.json`);
    fs.writeFileSync(statePath, JSON.stringify(this.serializeState(state), null, 2));
  }

  /**
   * Delete a workflow state
   */
  deleteState(instanceId: string): boolean {
    const existed = this.states.delete(instanceId);
    if (existed) {
      const statePath = path.join(this.statesDir, `${instanceId}.json`);
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    }
    return existed;
  }

  /**
   * Get all states
   */
  getAllStates(): WorkflowState[] {
    return Array.from(this.states.values());
  }

  /**
   * Get states by workflow ID
   */
  getStatesByWorkflow(workflowId: string): WorkflowState[] {
    return Array.from(this.states.values()).filter(s => s.workflowId === workflowId);
  }

  /**
   * Get states by status
   */
  getStatesByStatus(status: WorkflowStatus): WorkflowState[] {
    return Array.from(this.states.values()).filter(s => s.status === status);
  }

  /**
   * Clear completed states
   */
  clearCompleted(): number {
    const completed = this.getStatesByStatus('completed');
    const failed = this.getStatesByStatus('failed');
    const cancelled = this.getStatesByStatus('cancelled');

    const toDelete = [...completed, ...failed, ...cancelled];
    for (const state of toDelete) {
      this.deleteState(state.instanceId);
    }

    return toDelete.length;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    paused: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const states = this.getAllStates();
    return {
      total: states.length,
      pending: states.filter(s => s.status === 'pending').length,
      running: states.filter(s => s.status === 'running').length,
      paused: states.filter(s => s.status === 'paused').length,
      completed: states.filter(s => s.status === 'completed').length,
      failed: states.filter(s => s.status === 'failed').length,
      cancelled: states.filter(s => s.status === 'cancelled').length,
    };
  }
}

// ============================================================================
// Workflow Engine - Main orchestrator for workflow execution
// ============================================================================

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private stateManager: WorkflowStateManager;
  private stepManager: StepManager;
  private runningWorkflows: Set<string> = new Set();

  constructor(statesDir?: string) {
    super();
    this.stateManager = new WorkflowStateManager(statesDir);
    this.stepManager = new StepManager();
    this.registerBuiltInWorkflows();
  }

  /**
   * Register built-in workflows
   */
  private registerBuiltInWorkflows(): void {
    // Sample validation workflow
    this.registerWorkflow({
      id: 'validation',
      name: 'Validation Workflow',
      description: 'Basic validation workflow template',
      version: '1.0.0',
      steps: [
        { id: 'validate-input', name: 'Validate Input', action: 'noop' },
        { id: 'process', name: 'Process', action: 'noop' },
        { id: 'complete', name: 'Complete', action: 'log' },
      ],
    });

    // Sample data pipeline workflow
    this.registerWorkflow({
      id: 'data-pipeline',
      name: 'Data Pipeline',
      description: 'Sample data processing pipeline',
      version: '1.0.0',
      steps: [
        { id: 'extract', name: 'Extract Data', action: 'noop' },
        { id: 'transform', name: 'Transform Data', action: 'noop' },
        { id: 'load', name: 'Load Data', action: 'noop' },
      ],
    });
  }

  /**
   * Register a workflow definition
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    this.emit('workflow:registered', { workflowId: workflow.id, name: workflow.name });
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(workflowId: string): boolean {
    const existed = this.workflows.delete(workflowId);
    if (existed) {
      this.emit('workflow:unregistered', { workflowId });
    }
    return existed;
  }

  /**
   * Get a workflow definition
   */
  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get all registered workflows
   */
  getWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Register a custom action
   */
  registerAction(name: string, handler: (context: WorkflowContext) => Promise<StepResult>): void {
    this.stepManager.registerAction(name, handler);
  }

  /**
   * Start a new workflow instance
   */
  async startWorkflow(
    workflowId: string,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return {
        success: false,
        instanceId: '',
        workflowId,
        status: 'failed',
        stepResults: new Map(),
        finalContext: {},
        duration: 0,
        error: `Workflow not found: ${workflowId}`,
        completedSteps: 0,
        totalSteps: 0,
      };
    }

    const state = this.stateManager.createState(workflowId, {
      ...workflow.initialContext,
      ...options.initialContext,
    });

    return this.executeWorkflow(workflow, state, options);
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(instanceId: string): Promise<WorkflowResult> {
    const state = this.stateManager.getState(instanceId);
    if (!state) {
      return {
        success: false,
        instanceId,
        workflowId: '',
        status: 'failed',
        stepResults: new Map(),
        finalContext: {},
        duration: 0,
        error: `Workflow instance not found: ${instanceId}`,
        completedSteps: 0,
        totalSteps: 0,
      };
    }

    if (state.status !== 'paused') {
      return {
        success: false,
        instanceId,
        workflowId: state.workflowId,
        status: state.status,
        stepResults: state.context.stepResults,
        finalContext: state.context.variables,
        duration: state.totalDuration || 0,
        error: `Workflow is not paused (status: ${state.status})`,
        completedSteps: state.currentStepIndex,
        totalSteps: this.workflows.get(state.workflowId)?.steps.length || 0,
      };
    }

    const workflow = this.workflows.get(state.workflowId);
    if (!workflow) {
      return {
        success: false,
        instanceId,
        workflowId: state.workflowId,
        status: 'failed',
        stepResults: state.context.stepResults,
        finalContext: state.context.variables,
        duration: 0,
        error: `Workflow definition not found: ${state.workflowId}`,
        completedSteps: state.currentStepIndex,
        totalSteps: 0,
      };
    }

    return this.executeWorkflow(workflow, state, {});
  }

  /**
   * Pause a running workflow
   */
  pauseWorkflow(instanceId: string): boolean {
    const state = this.stateManager.getState(instanceId);
    if (!state || state.status !== 'running') {
      return false;
    }

    this.stateManager.updateState(instanceId, {
      status: 'paused',
      pausedAt: new Date(),
    });

    this.emit('workflow:paused', { instanceId });
    return true;
  }

  /**
   * Cancel a workflow
   */
  cancelWorkflow(instanceId: string): boolean {
    const state = this.stateManager.getState(instanceId);
    if (!state) {
      return false;
    }

    if (state.status === 'completed' || state.status === 'cancelled') {
      return false;
    }

    this.runningWorkflows.delete(instanceId);
    this.stateManager.updateState(instanceId, {
      status: 'cancelled',
      completedAt: new Date(),
    });

    this.emit('workflow:cancelled', { instanceId });
    return true;
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(
    workflow: WorkflowDefinition,
    state: WorkflowState,
    options: WorkflowExecutionOptions
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const instanceId = state.instanceId;

    // Mark as running
    this.runningWorkflows.add(instanceId);
    this.stateManager.updateState(instanceId, {
      status: 'running',
      startedAt: state.startedAt || new Date(),
    });

    this.emit('workflow:start', { instanceId, workflowId: workflow.id });

    // Find starting step
    let stepIndex = state.currentStepIndex;
    if (options.startFromStep) {
      const idx = workflow.steps.findIndex(s => s.id === options.startFromStep);
      if (idx !== -1) {
        stepIndex = idx;
      }
    }

    try {
      for (; stepIndex < workflow.steps.length; stepIndex++) {
        // Check if paused or cancelled
        const currentState = this.stateManager.getState(instanceId);
        if (!currentState || currentState.status === 'paused' || currentState.status === 'cancelled') {
          break;
        }

        const step = workflow.steps[stepIndex];
        state.context.currentStep = step.id;

        // Emit step start
        if (options.onStepStart) {
          options.onStepStart(step.id);
        }

        // Create step execution record
        const execution: StepExecution = {
          stepId: step.id,
          stepName: step.name,
          status: 'running',
          startedAt: new Date(),
          retries: 0,
        };
        state.stepExecutions.set(step.id, execution);

        // Execute step with retries
        let result: StepResult | null = null;
        let retries = 0;
        const maxRetries = step.maxRetries || 0;

        while (retries <= maxRetries) {
          result = await this.stepManager.executeStep(step, state.context, {
            timeout: options.timeout || step.timeout,
          });

          if (result.success || !step.retryOnFailure) {
            break;
          }
          retries++;
          execution.retries = retries;
        }

        if (!result) {
          result = { success: false, error: 'No result from step execution' };
        }

        // Update execution record
        execution.status = result.success ? 'completed' : 'failed';
        execution.completedAt = new Date();
        execution.result = result;

        // Store result in context
        state.context.stepResults.set(step.id, result);

        // Update state
        this.stateManager.updateState(instanceId, {
          currentStepIndex: stepIndex + 1,
          context: state.context,
          stepExecutions: state.stepExecutions,
        });

        // Emit step complete
        if (options.onStepComplete) {
          options.onStepComplete(execution);
        }

        // Handle failure
        if (!result.success) {
          if (step.onFailure) {
            // Jump to failure step
            const failureIdx = workflow.steps.findIndex(s => s.id === step.onFailure);
            if (failureIdx !== -1) {
              stepIndex = failureIdx - 1; // -1 because loop will increment
              continue;
            }
          }
          // Default: fail the workflow
          throw new Error(result.error || `Step ${step.id} failed`);
        }

        // Handle success branching
        if (step.onSuccess && result.success) {
          const successIdx = workflow.steps.findIndex(s => s.id === step.onSuccess);
          if (successIdx !== -1) {
            stepIndex = successIdx - 1; // -1 because loop will increment
          }
        }
      }

      // Check final state
      const finalState = this.stateManager.getState(instanceId);
      if (finalState?.status === 'paused') {
        return this.buildResult(finalState, workflow, startTime);
      }

      if (finalState?.status === 'cancelled') {
        return this.buildResult(finalState, workflow, startTime);
      }

      // Mark as completed
      this.runningWorkflows.delete(instanceId);
      this.stateManager.updateState(instanceId, {
        status: 'completed',
        completedAt: new Date(),
        totalDuration: Date.now() - startTime,
      });

      this.emit('workflow:complete', { instanceId, success: true });

      return this.buildResult(
        this.stateManager.getState(instanceId)!,
        workflow,
        startTime
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.runningWorkflows.delete(instanceId);
      this.stateManager.updateState(instanceId, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMessage,
        totalDuration: Date.now() - startTime,
      });

      this.emit('workflow:error', { instanceId, error: errorMessage });

      return this.buildResult(
        this.stateManager.getState(instanceId)!,
        workflow,
        startTime,
        errorMessage
      );
    }
  }

  /**
   * Build workflow result
   */
  private buildResult(
    state: WorkflowState,
    workflow: WorkflowDefinition,
    startTime: number,
    error?: string
  ): WorkflowResult {
    return {
      success: state.status === 'completed',
      instanceId: state.instanceId,
      workflowId: state.workflowId,
      status: state.status,
      stepResults: state.context.stepResults,
      finalContext: state.context.variables,
      duration: Date.now() - startTime,
      error: error || state.error,
      completedSteps: state.currentStepIndex,
      totalSteps: workflow.steps.length,
    };
  }

  /**
   * Get workflow state
   */
  getWorkflowState(instanceId: string): WorkflowState | undefined {
    return this.stateManager.getState(instanceId);
  }

  /**
   * Get all workflow instances
   */
  getWorkflowInstances(): WorkflowState[] {
    return this.stateManager.getAllStates();
  }

  /**
   * Get running workflows
   */
  getRunningWorkflows(): string[] {
    return Array.from(this.runningWorkflows);
  }

  /**
   * Get statistics
   */
  getStats(): ReturnType<WorkflowStateManager['getStats']> {
    return this.stateManager.getStats();
  }

  /**
   * Format workflow result for display
   */
  formatResult(result: WorkflowResult): string {
    const statusEmoji = result.success ? '✅' : '❌';
    let output = `\n${statusEmoji} Workflow Result: ${result.workflowId}\n`;
    output += '═'.repeat(50) + '\n\n';
    output += `Instance: ${result.instanceId}\n`;
    output += `Status: ${result.status.toUpperCase()}\n`;
    output += `Duration: ${(result.duration / 1000).toFixed(2)}s\n`;
    output += `Steps: ${result.completedSteps}/${result.totalSteps}\n`;

    if (result.error) {
      output += `Error: ${result.error}\n`;
    }

    if (result.stepResults.size > 0) {
      output += '\nStep Results:\n';
      for (const [stepId, stepResult] of result.stepResults) {
        const stepEmoji = stepResult.success ? '  ✓' : '  ✗';
        output += `${stepEmoji} ${stepId}: ${stepResult.success ? 'completed' : 'failed'}`;
        if (stepResult.duration) {
          output += ` (${stepResult.duration}ms)`;
        }
        output += '\n';
      }
    }

    output += '\n' + '═'.repeat(50) + '\n';
    return output;
  }

  /**
   * Format available workflows for display
   */
  formatWorkflows(): string {
    const workflows = this.getWorkflows();
    if (workflows.length === 0) {
      return 'No workflows registered.\n';
    }

    let output = 'Available Workflows:\n\n';
    for (const workflow of workflows) {
      output += `  📋 ${workflow.name} (${workflow.id})\n`;
      output += `     ${workflow.description}\n`;
      output += `     Version: ${workflow.version} | Steps: ${workflow.steps.length}\n\n`;
    }
    return output;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Cancel all running workflows
    for (const instanceId of this.runningWorkflows) {
      this.cancelWorkflow(instanceId);
    }
    this.runningWorkflows.clear();
    this.workflows.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton and Factory Functions
// ============================================================================

let workflowEngineInstance: WorkflowEngine | null = null;

export function getWorkflowEngine(statesDir?: string): WorkflowEngine {
  if (!workflowEngineInstance) {
    workflowEngineInstance = new WorkflowEngine(statesDir);
  }
  return workflowEngineInstance;
}

export function resetWorkflowEngine(): void {
  if (workflowEngineInstance) {
    workflowEngineInstance.dispose();
  }
  workflowEngineInstance = null;
}

// ============================================================================
// Pipeline Compositor (Lobster-inspired)
// ============================================================================

export type {
  PipelineStep,
  PipelineOperator,
  PipelineToken,
  StepResult as PipelineStepResult,
  PipelineResult,
  ToolExecutor,
  PipelineConfig,
} from './pipeline.js';

export {
  PipelineCompositor,
  getPipelineCompositor,
  resetPipelineCompositor,
} from './pipeline.js';
