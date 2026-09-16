/**
 * Workflow State Manager - Persists and manages workflow state
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import type {
  WorkflowStatus,
  WorkflowState,
  WorkflowContext,
  StepResult,
  StepExecution,
} from './types.js';

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
          const data = readJsonAtomicSync<Record<string, unknown> | null>(statePath, null, {
            mode: 0o600,
            isValid: (value): value is Record<string, unknown> => Boolean(
              value && typeof value === 'object' && !Array.isArray(value),
            ),
          });
          if (!data) continue;
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
    writeJsonAtomicSync(statePath, this.serializeState(state), { mode: 0o600 });
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
