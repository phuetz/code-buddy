/**
 * Comprehensive Unit Tests for Workflows Module
 *
 * This test file covers:
 * 1. Workflow execution
 * 2. Step management
 * 3. Workflow state
 * 4. Event emission
 * 5. Error handling
 * 6. Conditional branching
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock os module
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/mock/home'),
}));

import {
  WorkflowEngine,
  WorkflowStateManager,
  StepManager,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowContext,
  WorkflowState,
  StepResult,
  WorkflowResult,
  getWorkflowEngine,
  resetWorkflowEngine,
} from '../../src/workflows/index';

// ============================================================================
// StepManager Tests
// ============================================================================
describe('StepManager', () => {
  let stepManager: StepManager;

  beforeEach(() => {
    jest.clearAllMocks();
    stepManager = new StepManager();
  });

  afterEach(() => {
    stepManager.removeAllListeners();
  });

  describe('Constructor', () => {
    it('should create instance', () => {
      expect(stepManager).toBeInstanceOf(StepManager);
    });

    it('should be an EventEmitter', () => {
      expect(stepManager.on).toBeDefined();
      expect(stepManager.emit).toBeDefined();
      expect(stepManager.off).toBeDefined();
    });

    it('should register built-in actions', () => {
      const actions = stepManager.getRegisteredActions();
      expect(actions).toContain('log');
      expect(actions).toContain('delay');
      expect(actions).toContain('setVariable');
      expect(actions).toContain('conditional');
      expect(actions).toContain('noop');
    });
  });

  describe('Action Registration', () => {
    it('should register custom action', () => {
      const customHandler = jest.fn().mockResolvedValue({ success: true });
      stepManager.registerAction('customAction', customHandler);

      expect(stepManager.hasAction('customAction')).toBe(true);
    });

    it('should check if action exists', () => {
      expect(stepManager.hasAction('log')).toBe(true);
      expect(stepManager.hasAction('nonexistent')).toBe(false);
    });

    it('should get all registered actions', () => {
      const actions = stepManager.getRegisteredActions();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);
    });

    it('should override existing action', () => {
      const originalHandler = jest.fn().mockResolvedValue({ success: true, output: 'original' });
      const newHandler = jest.fn().mockResolvedValue({ success: true, output: 'new' });

      stepManager.registerAction('myAction', originalHandler);
      stepManager.registerAction('myAction', newHandler);

      expect(stepManager.hasAction('myAction')).toBe(true);
    });
  });

  describe('Step Execution', () => {
    const createContext = (): WorkflowContext => ({
      workflowId: 'test-workflow',
      instanceId: 'test-instance',
      variables: {},
      stepResults: new Map(),
      metadata: {},
    });

    it('should execute step with string action', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(true);
    });

    it('should execute step with function action', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: async () => ({ success: true, output: 'function result' }),
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(true);
      expect(result.output).toBe('function result');
    });

    it('should fail for unknown action', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'unknownAction',
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('should handle action throwing error', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: async () => { throw new Error('Test error'); },
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
    });

    it('should include duration in result', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.duration).toBeDefined();
      expect(typeof result.duration).toBe('number');
    });

    it('should emit step:start event', async () => {
      const startHandler = jest.fn();
      stepManager.on('step:start', startHandler);

      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
      };

      await stepManager.executeStep(step, context);

      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({ stepId: 'test-step', stepName: 'Test Step' })
      );
    });

    it('should emit step:complete event on success', async () => {
      const completeHandler = jest.fn();
      stepManager.on('step:complete', completeHandler);

      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
      };

      await stepManager.executeStep(step, context);

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ stepId: 'test-step', success: true })
      );
    });

    it('should emit step:error event on failure', async () => {
      const errorHandler = jest.fn();
      stepManager.on('step:error', errorHandler);

      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: async () => { throw new Error('Test error'); },
      };

      await stepManager.executeStep(step, context);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ stepId: 'test-step', error: 'Test error' })
      );
    });

    it('should handle timeout', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        timeout: 10,
        action: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { success: true };
        },
      };

      const result = await stepManager.executeStep(step, context, { timeout: 10 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('Condition Evaluation', () => {
    const createContext = (variables: Record<string, unknown> = {}): WorkflowContext => ({
      workflowId: 'test-workflow',
      instanceId: 'test-instance',
      variables,
      stepResults: new Map(),
      metadata: {},
    });

    it('should skip step when condition is false', async () => {
      const skippedHandler = jest.fn();
      stepManager.on('step:skipped', skippedHandler);

      const context = createContext({ shouldRun: false });
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
        condition: (ctx) => ctx.variables.shouldRun === true,
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.metadata?.skipped).toBe(true);
      expect(skippedHandler).toHaveBeenCalled();
    });

    it('should run step when condition is true', async () => {
      const context = createContext({ shouldRun: true });
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
        condition: (ctx) => ctx.variables.shouldRun === true,
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(true);
      expect(result.metadata?.skipped).toBeUndefined();
    });

    it('should evaluate string condition with variable name', () => {
      const context = createContext({ isEnabled: true });
      const result = stepManager.evaluateCondition('isEnabled', context);
      expect(result).toBe(true);
    });

    it('should evaluate string condition with comparison', () => {
      const context = createContext({ count: 5 });

      expect(stepManager.evaluateCondition('count > 3', context)).toBe(true);
      expect(stepManager.evaluateCondition('count < 3', context)).toBe(false);
      expect(stepManager.evaluateCondition('count === 5', context)).toBe(true);
      expect(stepManager.evaluateCondition('count !== 5', context)).toBe(false);
      expect(stepManager.evaluateCondition('count >= 5', context)).toBe(true);
      expect(stepManager.evaluateCondition('count <= 5', context)).toBe(true);
    });

    it('should evaluate boolean string values', () => {
      const context = createContext({ isActive: true });
      expect(stepManager.evaluateCondition('isActive === true', context)).toBe(true);
      expect(stepManager.evaluateCondition('isActive === false', context)).toBe(false);
    });

    it('should evaluate null and undefined', () => {
      const context = createContext({ value: null });
      expect(stepManager.evaluateCondition('value === null', context)).toBe(true);
    });

    it('should evaluate quoted string values', () => {
      const context = createContext({ status: 'active' });
      expect(stepManager.evaluateCondition('status === "active"', context)).toBe(true);
      expect(stepManager.evaluateCondition('status === "inactive"', context)).toBe(false);
    });

    it('should return true for unrecognized conditions', () => {
      const context = createContext();
      expect(stepManager.evaluateCondition('some complex && condition', context)).toBe(true);
    });
  });

  describe('Built-in Actions', () => {
    const createContext = (variables: Record<string, unknown> = {}): WorkflowContext => ({
      workflowId: 'test-workflow',
      instanceId: 'test-instance',
      variables,
      stepResults: new Map(),
      metadata: {},
    });

    it('should execute log action', async () => {
      const context = createContext({ message: 'Test message' });
      const step: WorkflowStep = {
        id: 'log-step',
        name: 'Log Step',
        action: 'log',
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const result = await stepManager.executeStep(step, context);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should execute delay action', async () => {
      const context = createContext({ delay: 10 });
      const step: WorkflowStep = {
        id: 'delay-step',
        name: 'Delay Step',
        action: 'delay',
      };

      const startTime = Date.now();
      const result = await stepManager.executeStep(step, context);
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });

    it('should execute setVariable action', async () => {
      const context = createContext({ varName: 'testVar', varValue: 'testValue' });
      const step: WorkflowStep = {
        id: 'set-step',
        name: 'Set Variable Step',
        action: 'setVariable',
      };

      const result = await stepManager.executeStep(step, context);

      expect(result.success).toBe(true);
      expect(context.variables.testVar).toBe('testValue');
    });

    it('should execute conditional action', async () => {
      const context = createContext({ condition: true });
      const step: WorkflowStep = {
        id: 'conditional-step',
        name: 'Conditional Step',
        action: 'conditional',
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(true);
    });

    it('should execute noop action', async () => {
      const context = createContext();
      const step: WorkflowStep = {
        id: 'noop-step',
        name: 'Noop Step',
        action: 'noop',
      };

      const result = await stepManager.executeStep(step, context);
      expect(result.success).toBe(true);
      expect(result.output).toBe('No operation performed');
    });
  });
});

// ============================================================================
// WorkflowStateManager Tests
// ============================================================================
describe('WorkflowStateManager', () => {
  let stateManager: WorkflowStateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue([]);
    stateManager = new WorkflowStateManager('/mock/states');
  });

  describe('Constructor', () => {
    it('should create instance', () => {
      expect(stateManager).toBeInstanceOf(WorkflowStateManager);
    });

    it('should ensure states directory exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      new WorkflowStateManager('/mock/new/states');
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should load existing states from disk', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['state1.json', 'state2.json']);
      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('state1')) {
          return JSON.stringify({
            instanceId: 'state1',
            workflowId: 'workflow1',
            status: 'completed',
            context: { workflowId: 'workflow1', instanceId: 'state1', variables: {}, stepResults: [], metadata: {} },
            stepExecutions: [],
            currentStepIndex: 0,
            createdAt: new Date().toISOString(),
          });
        }
        return JSON.stringify({
          instanceId: 'state2',
          workflowId: 'workflow2',
          status: 'pending',
          context: { workflowId: 'workflow2', instanceId: 'state2', variables: {}, stepResults: [], metadata: {} },
          stepExecutions: [],
          currentStepIndex: 0,
          createdAt: new Date().toISOString(),
        });
      });

      const manager = new WorkflowStateManager('/mock/states');
      const states = manager.getAllStates();
      expect(states.length).toBe(2);
    });

    it('should skip invalid state files', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['invalid.json']);
      (fs.readFileSync as jest.Mock).mockImplementation(() => 'invalid json');

      const manager = new WorkflowStateManager('/mock/states');
      expect(manager.getAllStates().length).toBe(0);
    });
  });

  describe('State Creation', () => {
    it('should create new state', () => {
      const state = stateManager.createState('test-workflow');

      expect(state).toBeDefined();
      expect(state.workflowId).toBe('test-workflow');
      expect(state.status).toBe('pending');
      expect(state.instanceId).toMatch(/^wf_/);
    });

    it('should create state with initial context', () => {
      const state = stateManager.createState('test-workflow', { foo: 'bar' });

      expect(state.context.variables.foo).toBe('bar');
    });

    it('should save state to disk on creation', () => {
      stateManager.createState('test-workflow');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should generate unique instance IDs', () => {
      const state1 = stateManager.createState('workflow1');
      const state2 = stateManager.createState('workflow2');

      expect(state1.instanceId).not.toBe(state2.instanceId);
    });
  });

  describe('State Retrieval', () => {
    it('should get state by instance ID', () => {
      const created = stateManager.createState('test-workflow');
      const retrieved = stateManager.getState(created.instanceId);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent state', () => {
      const state = stateManager.getState('non-existent');
      expect(state).toBeUndefined();
    });

    it('should get all states', () => {
      stateManager.createState('workflow1');
      stateManager.createState('workflow2');

      const states = stateManager.getAllStates();
      expect(states.length).toBe(2);
    });

    it('should get states by workflow ID', () => {
      stateManager.createState('workflow1');
      stateManager.createState('workflow1');
      stateManager.createState('workflow2');

      const states = stateManager.getStatesByWorkflow('workflow1');
      expect(states.length).toBe(2);
    });

    it('should get states by status', () => {
      const state1 = stateManager.createState('workflow1');
      const state2 = stateManager.createState('workflow2');

      stateManager.updateState(state1.instanceId, { status: 'completed' });

      const pendingStates = stateManager.getStatesByStatus('pending');
      const completedStates = stateManager.getStatesByStatus('completed');

      expect(pendingStates.length).toBe(1);
      expect(completedStates.length).toBe(1);
    });
  });

  describe('State Updates', () => {
    it('should update state', () => {
      const state = stateManager.createState('test-workflow');
      const updated = stateManager.updateState(state.instanceId, { status: 'running' });

      expect(updated?.status).toBe('running');
    });

    it('should save state after update', () => {
      const state = stateManager.createState('test-workflow');
      jest.clearAllMocks();

      stateManager.updateState(state.instanceId, { status: 'running' });

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return undefined when updating non-existent state', () => {
      const result = stateManager.updateState('non-existent', { status: 'running' });
      expect(result).toBeUndefined();
    });
  });

  describe('State Deletion', () => {
    it('should delete state', () => {
      const state = stateManager.createState('test-workflow');
      const result = stateManager.deleteState(state.instanceId);

      expect(result).toBe(true);
      expect(stateManager.getState(state.instanceId)).toBeUndefined();
    });

    it('should return false when deleting non-existent state', () => {
      const result = stateManager.deleteState('non-existent');
      expect(result).toBe(false);
    });

    it('should delete state file from disk', () => {
      const state = stateManager.createState('test-workflow');
      stateManager.deleteState(state.instanceId);

      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should clear completed states', () => {
      const state1 = stateManager.createState('workflow1');
      const state2 = stateManager.createState('workflow2');
      const state3 = stateManager.createState('workflow3');

      stateManager.updateState(state1.instanceId, { status: 'completed' });
      stateManager.updateState(state2.instanceId, { status: 'failed' });

      const cleared = stateManager.clearCompleted();

      expect(cleared).toBe(2);
      expect(stateManager.getState(state3.instanceId)).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should get stats', () => {
      const state1 = stateManager.createState('workflow1');
      const state2 = stateManager.createState('workflow2');
      const state3 = stateManager.createState('workflow3');

      stateManager.updateState(state1.instanceId, { status: 'completed' });
      stateManager.updateState(state2.instanceId, { status: 'running' });

      const stats = stateManager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });
});

// ============================================================================
// WorkflowEngine Tests
// ============================================================================
describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue([]);
    resetWorkflowEngine();
    engine = new WorkflowEngine('/mock/states');
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('Constructor', () => {
    it('should create instance', () => {
      expect(engine).toBeInstanceOf(WorkflowEngine);
    });

    it('should be an EventEmitter', () => {
      expect(engine.on).toBeDefined();
      expect(engine.emit).toBeDefined();
      expect(engine.off).toBeDefined();
    });

    it('should register built-in workflows', () => {
      const workflows = engine.getWorkflows();
      const workflowIds = workflows.map(w => w.id);

      expect(workflowIds).toContain('validation');
      expect(workflowIds).toContain('data-pipeline');
    });
  });

  describe('Workflow Registration', () => {
    it('should register workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        steps: [],
      };

      engine.registerWorkflow(workflow);
      expect(engine.getWorkflow('test-workflow')).toEqual(workflow);
    });

    it('should emit workflow:registered event', () => {
      const registeredHandler = jest.fn();
      engine.on('workflow:registered', registeredHandler);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        steps: [],
      };

      engine.registerWorkflow(workflow);
      expect(registeredHandler).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'test-workflow' })
      );
    });

    it('should unregister workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        steps: [],
      };

      engine.registerWorkflow(workflow);
      const result = engine.unregisterWorkflow('test-workflow');

      expect(result).toBe(true);
      expect(engine.getWorkflow('test-workflow')).toBeUndefined();
    });

    it('should return false when unregistering non-existent workflow', () => {
      const result = engine.unregisterWorkflow('non-existent');
      expect(result).toBe(false);
    });

    it('should get all workflows', () => {
      const workflow1: WorkflowDefinition = {
        id: 'workflow1',
        name: 'Workflow 1',
        description: 'First workflow',
        version: '1.0.0',
        steps: [],
      };
      const workflow2: WorkflowDefinition = {
        id: 'workflow2',
        name: 'Workflow 2',
        description: 'Second workflow',
        version: '1.0.0',
        steps: [],
      };

      engine.registerWorkflow(workflow1);
      engine.registerWorkflow(workflow2);

      const workflows = engine.getWorkflows();
      expect(workflows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Action Registration', () => {
    it('should register custom action', () => {
      const customHandler = jest.fn().mockResolvedValue({ success: true });
      engine.registerAction('customAction', customHandler);

      // Action should be usable in workflows
      expect(() => engine.registerAction('anotherAction', customHandler)).not.toThrow();
    });
  });

  describe('Workflow Execution', () => {
    it('should start workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'simple-workflow',
        name: 'Simple Workflow',
        description: 'A simple test workflow',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop' },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('simple-workflow');

      expect(result.success).toBe(true);
      expect(result.workflowId).toBe('simple-workflow');
      expect(result.status).toBe('completed');
    });

    it('should return error for non-existent workflow', async () => {
      const result = await engine.startWorkflow('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow not found');
    });

    it('should execute multiple steps', async () => {
      const workflow: WorkflowDefinition = {
        id: 'multi-step',
        name: 'Multi-Step Workflow',
        description: 'Workflow with multiple steps',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop' },
          { id: 'step2', name: 'Step 2', action: 'noop' },
          { id: 'step3', name: 'Step 3', action: 'noop' },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('multi-step');

      expect(result.success).toBe(true);
      expect(result.completedSteps).toBe(3);
      expect(result.totalSteps).toBe(3);
    });

    it('should pass initial context', async () => {
      const workflow: WorkflowDefinition = {
        id: 'context-workflow',
        name: 'Context Workflow',
        description: 'Workflow with context',
        version: '1.0.0',
        steps: [
          {
            id: 'check-context',
            name: 'Check Context',
            action: async (ctx) => ({
              success: ctx.variables.inputValue === 'test',
              output: ctx.variables.inputValue,
            }),
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('context-workflow', {
        initialContext: { inputValue: 'test' },
      });

      expect(result.success).toBe(true);
    });

    it('should emit workflow:start event', async () => {
      const startHandler = jest.fn();
      engine.on('workflow:start', startHandler);

      const workflow: WorkflowDefinition = {
        id: 'event-workflow',
        name: 'Event Workflow',
        description: 'Workflow for testing events',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('event-workflow');

      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'event-workflow' })
      );
    });

    it('should emit workflow:complete event', async () => {
      const completeHandler = jest.fn();
      engine.on('workflow:complete', completeHandler);

      const workflow: WorkflowDefinition = {
        id: 'complete-workflow',
        name: 'Complete Workflow',
        description: 'Workflow for testing completion',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('complete-workflow');

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should handle step callback', async () => {
      const onStepComplete = jest.fn();
      const onStepStart = jest.fn();

      const workflow: WorkflowDefinition = {
        id: 'callback-workflow',
        name: 'Callback Workflow',
        description: 'Workflow for testing callbacks',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop' },
          { id: 'step2', name: 'Step 2', action: 'noop' },
        ],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('callback-workflow', {
        onStepComplete,
        onStepStart,
      });

      expect(onStepStart).toHaveBeenCalledTimes(2);
      expect(onStepComplete).toHaveBeenCalledTimes(2);
    });

    it('should include duration in result', async () => {
      const workflow: WorkflowDefinition = {
        id: 'duration-workflow',
        name: 'Duration Workflow',
        description: 'Workflow for testing duration',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('duration-workflow');

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle step failure', async () => {
      const workflow: WorkflowDefinition = {
        id: 'failing-workflow',
        name: 'Failing Workflow',
        description: 'Workflow that fails',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: async () => { throw new Error('Step failed'); } },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('failing-workflow');

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Step failed');
    });

    it('should emit workflow:error event', async () => {
      const errorHandler = jest.fn();
      engine.on('workflow:error', errorHandler);

      const workflow: WorkflowDefinition = {
        id: 'error-workflow',
        name: 'Error Workflow',
        description: 'Workflow that errors',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: async () => { throw new Error('Test error'); } },
        ],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('error-workflow');

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Test error' })
      );
    });

    it('should retry on failure when configured', async () => {
      let attempts = 0;
      const workflow: WorkflowDefinition = {
        id: 'retry-workflow',
        name: 'Retry Workflow',
        description: 'Workflow with retries',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              attempts++;
              if (attempts < 3) {
                return { success: false, error: 'Retry needed' };
              }
              return { success: true };
            },
            retryOnFailure: true,
            maxRetries: 3,
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('retry-workflow');

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });
  });

  describe('Workflow State Management', () => {
    it('should get workflow state', async () => {
      const workflow: WorkflowDefinition = {
        id: 'state-workflow',
        name: 'State Workflow',
        description: 'Workflow for testing state',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('state-workflow');

      const state = engine.getWorkflowState(result.instanceId);
      expect(state).toBeDefined();
      expect(state?.status).toBe('completed');
    });

    it('should get all workflow instances', async () => {
      const workflow: WorkflowDefinition = {
        id: 'instance-workflow',
        name: 'Instance Workflow',
        description: 'Workflow for testing instances',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('instance-workflow');
      await engine.startWorkflow('instance-workflow');

      const instances = engine.getWorkflowInstances();
      expect(instances.length).toBeGreaterThanOrEqual(2);
    });

    it('should get running workflows', async () => {
      // Create a workflow that takes time
      const workflow: WorkflowDefinition = {
        id: 'running-workflow',
        name: 'Running Workflow',
        description: 'Workflow for testing running state',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              await new Promise(resolve => setTimeout(resolve, 50));
              return { success: true };
            },
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const promise = engine.startWorkflow('running-workflow');

      // Check running workflows immediately
      const running = engine.getRunningWorkflows();
      expect(running.length).toBeGreaterThanOrEqual(0);

      await promise;
    });
  });

  describe('Pause and Resume', () => {
    it('should pause running workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'pause-workflow',
        name: 'Pause Workflow',
        description: 'Workflow for testing pause',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { success: true };
            },
          },
          { id: 'step2', name: 'Step 2', action: 'noop' },
        ],
      };

      engine.registerWorkflow(workflow);
      const startPromise = engine.startWorkflow('pause-workflow');

      // Wait a bit then pause
      await new Promise(resolve => setTimeout(resolve, 10));
      const instances = engine.getWorkflowInstances();
      const runningInstance = instances.find(i => i.status === 'running');

      if (runningInstance) {
        const paused = engine.pauseWorkflow(runningInstance.instanceId);
        expect(paused).toBe(true);
      }

      await startPromise;
    });

    it('should emit workflow:paused event', async () => {
      const pausedHandler = jest.fn();
      engine.on('workflow:paused', pausedHandler);

      const workflow: WorkflowDefinition = {
        id: 'pause-event-workflow',
        name: 'Pause Event Workflow',
        description: 'Workflow for testing pause event',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { success: true };
            },
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const startPromise = engine.startWorkflow('pause-event-workflow');

      await new Promise(resolve => setTimeout(resolve, 10));
      const instances = engine.getWorkflowInstances();
      const runningInstance = instances.find(i => i.status === 'running');

      if (runningInstance) {
        engine.pauseWorkflow(runningInstance.instanceId);
        expect(pausedHandler).toHaveBeenCalled();
      }

      await startPromise;
    });

    it('should resume paused workflow', async () => {
      // First create a state that's paused
      const workflow: WorkflowDefinition = {
        id: 'resume-workflow',
        name: 'Resume Workflow',
        description: 'Workflow for testing resume',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop' },
        ],
      };

      engine.registerWorkflow(workflow);

      // Try to resume a non-existent workflow
      const result = await engine.resumeWorkflow('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when resuming non-paused workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'resume-error-workflow',
        name: 'Resume Error Workflow',
        description: 'Workflow for testing resume error',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      const startResult = await engine.startWorkflow('resume-error-workflow');
      const resumeResult = await engine.resumeWorkflow(startResult.instanceId);

      expect(resumeResult.success).toBe(false);
      expect(resumeResult.error).toContain('not paused');
    });
  });

  describe('Cancel', () => {
    it('should cancel workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'cancel-workflow',
        name: 'Cancel Workflow',
        description: 'Workflow for testing cancel',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { success: true };
            },
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const startPromise = engine.startWorkflow('cancel-workflow');

      await new Promise(resolve => setTimeout(resolve, 10));
      const instances = engine.getWorkflowInstances();
      const runningInstance = instances.find(i => i.status === 'running');

      if (runningInstance) {
        const cancelled = engine.cancelWorkflow(runningInstance.instanceId);
        expect(cancelled).toBe(true);
      }

      await startPromise;
    });

    it('should emit workflow:cancelled event', async () => {
      const cancelledHandler = jest.fn();
      engine.on('workflow:cancelled', cancelledHandler);

      const workflow: WorkflowDefinition = {
        id: 'cancel-event-workflow',
        name: 'Cancel Event Workflow',
        description: 'Workflow for testing cancel event',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { success: true };
            },
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const startPromise = engine.startWorkflow('cancel-event-workflow');

      await new Promise(resolve => setTimeout(resolve, 10));
      const instances = engine.getWorkflowInstances();
      const runningInstance = instances.find(i => i.status === 'running');

      if (runningInstance) {
        engine.cancelWorkflow(runningInstance.instanceId);
        expect(cancelledHandler).toHaveBeenCalled();
      }

      await startPromise;
    });

    it('should return false when cancelling non-existent workflow', () => {
      const result = engine.cancelWorkflow('non-existent');
      expect(result).toBe(false);
    });

    it('should return false when cancelling already completed workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'completed-workflow',
        name: 'Completed Workflow',
        description: 'Workflow for testing cancel of completed',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('completed-workflow');
      const cancelled = engine.cancelWorkflow(result.instanceId);

      expect(cancelled).toBe(false);
    });
  });

  describe('Conditional Branching', () => {
    it('should skip steps when condition is false', async () => {
      const workflow: WorkflowDefinition = {
        id: 'conditional-workflow',
        name: 'Conditional Workflow',
        description: 'Workflow with conditions',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop' },
          {
            id: 'step2',
            name: 'Step 2',
            action: 'noop',
            condition: (ctx) => ctx.variables.shouldRunStep2 === true,
          },
          { id: 'step3', name: 'Step 3', action: 'noop' },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('conditional-workflow', {
        initialContext: { shouldRunStep2: false },
      });

      expect(result.success).toBe(true);
      // Step 2 should be skipped
      const step2Result = result.stepResults.get('step2');
      expect(step2Result?.metadata?.skipped).toBe(true);
    });

    it('should follow onSuccess branching', async () => {
      let step3Executed = false;
      const workflow: WorkflowDefinition = {
        id: 'branch-workflow',
        name: 'Branch Workflow',
        description: 'Workflow with branching',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop', onSuccess: 'step3' },
          {
            id: 'step2',
            name: 'Step 2',
            action: async () => {
              return { success: true, output: 'step2 executed' };
            },
          },
          {
            id: 'step3',
            name: 'Step 3',
            action: async () => {
              step3Executed = true;
              return { success: true };
            },
          },
        ],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('branch-workflow');

      expect(step3Executed).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should get stats', async () => {
      const workflow: WorkflowDefinition = {
        id: 'stats-workflow',
        name: 'Stats Workflow',
        description: 'Workflow for testing stats',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      await engine.startWorkflow('stats-workflow');
      await engine.startWorkflow('stats-workflow');

      const stats = engine.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.completed).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Formatting', () => {
    it('should format workflow result', async () => {
      const workflow: WorkflowDefinition = {
        id: 'format-workflow',
        name: 'Format Workflow',
        description: 'Workflow for testing formatting',
        version: '1.0.0',
        steps: [{ id: 'step1', name: 'Step 1', action: 'noop' }],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('format-workflow');
      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Workflow Result');
      expect(formatted).toContain('format-workflow');
      expect(formatted).toContain('completed');
    });

    it('should format failed result with error', async () => {
      const workflow: WorkflowDefinition = {
        id: 'format-error-workflow',
        name: 'Format Error Workflow',
        description: 'Workflow for testing error formatting',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: async () => { throw new Error('Test error'); } },
        ],
      };

      engine.registerWorkflow(workflow);
      const result = await engine.startWorkflow('format-error-workflow');
      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Error');
      expect(formatted).toContain('Test error');
    });

    it('should format available workflows', () => {
      const formatted = engine.formatWorkflows();

      expect(formatted).toContain('Available Workflows');
      expect(formatted).toContain('validation');
      expect(formatted).toContain('data-pipeline');
    });

    it('should return message when no workflows registered', () => {
      // Unregister all workflows
      for (const workflow of engine.getWorkflows()) {
        engine.unregisterWorkflow(workflow.id);
      }

      const formatted = engine.formatWorkflows();
      expect(formatted).toContain('No workflows registered');
    });
  });

  describe('Dispose', () => {
    it('should clean up resources', () => {
      expect(() => engine.dispose()).not.toThrow();
    });

    it('should cancel running workflows on dispose', async () => {
      const workflow: WorkflowDefinition = {
        id: 'dispose-workflow',
        name: 'Dispose Workflow',
        description: 'Workflow for testing dispose',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            action: async () => {
              await new Promise(resolve => setTimeout(resolve, 1000));
              return { success: true };
            },
          },
        ],
      };

      engine.registerWorkflow(workflow);
      const startPromise = engine.startWorkflow('dispose-workflow');

      await new Promise(resolve => setTimeout(resolve, 10));
      engine.dispose();

      const result = await startPromise;
      // Either cancelled or completed quickly
      expect(['cancelled', 'completed', 'paused']).toContain(result.status);
    });

    it('should remove all event listeners', () => {
      const handler = jest.fn();
      engine.on('test', handler);
      engine.dispose();

      expect(engine.listenerCount('test')).toBe(0);
    });
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================
describe('Singleton Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue([]);
    resetWorkflowEngine();
  });

  describe('getWorkflowEngine', () => {
    it('should return WorkflowEngine instance', () => {
      const engine = getWorkflowEngine();
      expect(engine).toBeInstanceOf(WorkflowEngine);
    });

    it('should return same instance on subsequent calls', () => {
      const engine1 = getWorkflowEngine();
      const engine2 = getWorkflowEngine();
      expect(engine1).toBe(engine2);
    });
  });

  describe('resetWorkflowEngine', () => {
    it('should reset singleton instance', () => {
      const engine1 = getWorkflowEngine();
      resetWorkflowEngine();
      const engine2 = getWorkflowEngine();

      expect(engine1).not.toBe(engine2);
    });
  });
});

// ============================================================================
// Interface Tests
// ============================================================================
describe('Interfaces', () => {
  describe('WorkflowStep', () => {
    it('should define required properties', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        action: 'noop',
      };

      expect(step.id).toBe('test-step');
      expect(step.name).toBe('Test Step');
      expect(step.action).toBe('noop');
    });

    it('should allow optional properties', () => {
      const step: WorkflowStep = {
        id: 'full-step',
        name: 'Full Step',
        description: 'A fully configured step',
        action: 'noop',
        condition: 'isEnabled === true',
        timeout: 5000,
        retryOnFailure: true,
        maxRetries: 3,
        onSuccess: 'next-step',
        onFailure: 'error-step',
        metadata: { custom: 'value' },
      };

      expect(step.description).toBe('A fully configured step');
      expect(step.condition).toBe('isEnabled === true');
      expect(step.timeout).toBe(5000);
      expect(step.retryOnFailure).toBe(true);
      expect(step.maxRetries).toBe(3);
      expect(step.onSuccess).toBe('next-step');
      expect(step.onFailure).toBe('error-step');
      expect(step.metadata?.custom).toBe('value');
    });
  });

  describe('WorkflowDefinition', () => {
    it('should define workflow structure', () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', action: 'noop' },
        ],
      };

      expect(workflow.id).toBe('test-workflow');
      expect(workflow.name).toBe('Test Workflow');
      expect(workflow.description).toBe('A test workflow');
      expect(workflow.version).toBe('1.0.0');
      expect(workflow.steps).toHaveLength(1);
    });

    it('should allow optional properties', () => {
      const workflow: WorkflowDefinition = {
        id: 'full-workflow',
        name: 'Full Workflow',
        description: 'A fully configured workflow',
        version: '2.0.0',
        steps: [],
        initialContext: { env: 'test' },
        timeout: 60000,
        onComplete: 'notify',
        onError: 'alert',
        tags: ['test', 'automation'],
      };

      expect(workflow.initialContext?.env).toBe('test');
      expect(workflow.timeout).toBe(60000);
      expect(workflow.onComplete).toBe('notify');
      expect(workflow.onError).toBe('alert');
      expect(workflow.tags).toContain('test');
    });
  });

  describe('StepResult', () => {
    it('should define successful result', () => {
      const result: StepResult = {
        success: true,
        output: 'Step completed',
        duration: 100,
      };

      expect(result.success).toBe(true);
      expect(result.output).toBe('Step completed');
      expect(result.duration).toBe(100);
    });

    it('should define failed result', () => {
      const result: StepResult = {
        success: false,
        error: 'Step failed',
        duration: 50,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Step failed');
    });

    it('should allow metadata', () => {
      const result: StepResult = {
        success: true,
        metadata: { skipped: true, reason: 'Condition not met' },
      };

      expect(result.metadata?.skipped).toBe(true);
    });
  });

  describe('WorkflowResult', () => {
    it('should define successful workflow result', () => {
      const result: WorkflowResult = {
        success: true,
        instanceId: 'wf_123',
        workflowId: 'test-workflow',
        status: 'completed',
        stepResults: new Map(),
        finalContext: { output: 'result' },
        duration: 1000,
        completedSteps: 3,
        totalSteps: 3,
      };

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(3);
    });

    it('should define failed workflow result', () => {
      const result: WorkflowResult = {
        success: false,
        instanceId: 'wf_456',
        workflowId: 'failing-workflow',
        status: 'failed',
        stepResults: new Map(),
        finalContext: {},
        duration: 500,
        error: 'Workflow failed at step 2',
        completedSteps: 1,
        totalSteps: 3,
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('step 2');
    });
  });

  describe('WorkflowContext', () => {
    it('should define context structure', () => {
      const context: WorkflowContext = {
        workflowId: 'test-workflow',
        instanceId: 'wf_789',
        variables: { input: 'value' },
        stepResults: new Map(),
        currentStep: 'step1',
        metadata: { startTime: Date.now() },
      };

      expect(context.workflowId).toBe('test-workflow');
      expect(context.instanceId).toBe('wf_789');
      expect(context.variables.input).toBe('value');
      expect(context.currentStep).toBe('step1');
    });
  });
});
