/**
 * Workflow Engine - Main orchestrator for workflow execution
 */

import { EventEmitter } from 'events';
import type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowState,
  WorkflowResult,
  WorkflowExecutionOptions,
  StepResult,
  StepExecution,
} from './types.js';
import { StepManager } from './step-manager.js';
import { WorkflowStateManager } from './state-manager.js';

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private stateManager: WorkflowStateManager;
  private stepManager: StepManager;
  private runningWorkflows: Set<string> = new Set();

  constructor(statesDir?: string) {
    super();
    this.stateManager = new WorkflowStateManager(statesDir);
    this.stepManager = new StepManager();
  }

  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    this.emit('workflow:registered', { workflowId: workflow.id, name: workflow.name });
  }

  unregisterWorkflow(workflowId: string): boolean {
    const existed = this.workflows.delete(workflowId);
    if (existed) {
      this.emit('workflow:unregistered', { workflowId });
    }
    return existed;
  }

  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  getWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  registerAction(name: string, handler: (context: WorkflowContext) => Promise<StepResult>): void {
    this.stepManager.registerAction(name, handler);
  }

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

  private async executeWorkflow(
    workflow: WorkflowDefinition,
    state: WorkflowState,
    options: WorkflowExecutionOptions
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const instanceId = state.instanceId;

    this.runningWorkflows.add(instanceId);
    this.stateManager.updateState(instanceId, {
      status: 'running',
      startedAt: state.startedAt || new Date(),
    });

    this.emit('workflow:start', { instanceId, workflowId: workflow.id });

    let stepIndex = state.currentStepIndex;
    if (options.startFromStep) {
      const idx = workflow.steps.findIndex(s => s.id === options.startFromStep);
      if (idx !== -1) {
        stepIndex = idx;
      }
    }

    try {
      for (; stepIndex < workflow.steps.length; stepIndex++) {
        const currentState = this.stateManager.getState(instanceId);
        if (!currentState || currentState.status === 'paused' || currentState.status === 'cancelled') {
          break;
        }

        const step = workflow.steps[stepIndex];
        state.context.currentStep = step.id;

        if (options.onStepStart) {
          options.onStepStart(step.id);
        }

        const execution: StepExecution = {
          stepId: step.id,
          stepName: step.name,
          status: 'running',
          startedAt: new Date(),
          retries: 0,
        };
        state.stepExecutions.set(step.id, execution);

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

        execution.status = result.success ? 'completed' : 'failed';
        execution.completedAt = new Date();
        execution.result = result;

        state.context.stepResults.set(step.id, result);

        this.stateManager.updateState(instanceId, {
          currentStepIndex: stepIndex + 1,
          context: state.context,
          stepExecutions: state.stepExecutions,
        });

        if (options.onStepComplete) {
          options.onStepComplete(execution);
        }

        if (!result.success) {
          if (step.onFailure) {
            const failureIdx = workflow.steps.findIndex(s => s.id === step.onFailure);
            if (failureIdx !== -1) {
              stepIndex = failureIdx - 1;
              continue;
            }
          }
          throw new Error(result.error || `Step ${step.id} failed`);
        }

        if (step.onSuccess && result.success) {
          const successIdx = workflow.steps.findIndex(s => s.id === step.onSuccess);
          if (successIdx !== -1) {
            stepIndex = successIdx - 1;
          }
        }
      }

      const finalState = this.stateManager.getState(instanceId);
      if (finalState?.status === 'paused' || finalState?.status === 'cancelled') {
        return this.buildResult(finalState, workflow, startTime);
      }

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

  getWorkflowState(instanceId: string): WorkflowState | undefined {
    return this.stateManager.getState(instanceId);
  }

  getWorkflowInstances(): WorkflowState[] {
    return this.stateManager.getAllStates();
  }

  getRunningWorkflows(): string[] {
    return Array.from(this.runningWorkflows);
  }

  getStats(): ReturnType<WorkflowStateManager['getStats']> {
    return this.stateManager.getStats();
  }

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

  dispose(): void {
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
