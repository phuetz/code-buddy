/**
 * Tests for Planning Flow (OpenManus-compatible)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanningFlow, PlanStepStatus, FlowType, createFlow, type FlowAgent, type PlanningFlowConfig } from '../../src/agent/flow/planning-flow.js';
import { AgentStatus } from '../../src/agent/state-machine.js';

describe('PlanningFlow', () => {
  let mockPlanLLM: ReturnType<typeof vi.fn>;
  let mockSWEAgent: FlowAgent;
  let mockBrowserAgent: FlowAgent;
  let agents: Map<string, FlowAgent>;

  beforeEach(() => {
    mockPlanLLM = vi.fn();
    mockSWEAgent = { name: 'swe', run: vi.fn().mockResolvedValue('SWE result') };
    mockBrowserAgent = { name: 'browser', run: vi.fn().mockResolvedValue('Browser result') };
    agents = new Map([
      ['swe', mockSWEAgent],
      ['browser', mockBrowserAgent],
      ['default', mockSWEAgent],
    ]);
  });

  function createConfig(overrides: Partial<PlanningFlowConfig> = {}): PlanningFlowConfig {
    return {
      planWithLLM: mockPlanLLM,
      agents,
      defaultAgentKey: 'default',
      maxRetries: 1,
      ...overrides,
    };
  }

  it('creates plan and executes steps', async () => {
    mockPlanLLM.mockResolvedValue(JSON.stringify({
      steps: [
        { id: 'step_1', title: 'Read code', description: 'Read the source', agentKey: 'swe', dependencies: [] },
        { id: 'step_2', title: 'Fix bug', description: 'Fix the issue', agentKey: 'swe', dependencies: ['step_1'] },
      ],
    }));

    const flow = new PlanningFlow(createConfig());
    const result = await flow.execute('Fix the authentication bug');

    expect(result).toContain('Execution Summary');
    expect(result).toContain('2 completed');
    expect(flow.status).toBe(AgentStatus.FINISHED);
    expect(mockSWEAgent.run).toHaveBeenCalledTimes(2);
  });

  it('handles parallel steps (no dependencies)', async () => {
    mockPlanLLM.mockResolvedValue(JSON.stringify({
      steps: [
        { id: 's1', title: 'Task A', description: 'Do A', agentKey: 'swe', dependencies: [] },
        { id: 's2', title: 'Task B', description: 'Do B', agentKey: 'browser', dependencies: [] },
      ],
    }));

    const flow = new PlanningFlow(createConfig());
    await flow.execute('Do A and B');

    expect(mockSWEAgent.run).toHaveBeenCalled();
    expect(mockBrowserAgent.run).toHaveBeenCalled();
  });

  it('skips dependents on failure', async () => {
    mockPlanLLM.mockResolvedValue(JSON.stringify({
      steps: [
        { id: 's1', title: 'Failing step', description: 'Will fail', agentKey: 'swe', dependencies: [] },
        { id: 's2', title: 'Dependent', description: 'Depends on s1', agentKey: 'swe', dependencies: ['s1'] },
      ],
    }));

    // First step fails, retry also fails
    (mockSWEAgent.run as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Step failed'))
      .mockRejectedValueOnce(new Error('Step failed again'));

    const flow = new PlanningFlow(createConfig());
    const result = await flow.execute('Failing task');

    expect(result).toContain('1 failed');
    expect(result).toContain('1 skipped');

    const plan = flow.plan!;
    expect(plan.steps[1].status).toBe(PlanStepStatus.SKIPPED);
  });

  it('falls back to single step on invalid JSON', async () => {
    mockPlanLLM.mockResolvedValue('This is not JSON');

    const flow = new PlanningFlow(createConfig());
    await flow.execute('Simple task');

    expect(mockSWEAgent.run).toHaveBeenCalledTimes(1);
    expect(flow.plan!.steps).toHaveLength(1);
    expect(flow.plan!.steps[0].title).toBe('Execute task');
  });

  it('includes dependency results in step context', async () => {
    mockPlanLLM.mockResolvedValue(JSON.stringify({
      steps: [
        { id: 's1', title: 'Find file', description: 'Find the file', agentKey: 'swe', dependencies: [] },
        { id: 's2', title: 'Edit file', description: 'Edit it', agentKey: 'swe', dependencies: ['s1'] },
      ],
    }));

    (mockSWEAgent.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Found: src/main.ts')
      .mockResolvedValueOnce('Edited successfully');

    const flow = new PlanningFlow(createConfig());
    await flow.execute('Find and edit');

    // The second call should include the result from the first
    const secondCall = (mockSWEAgent.run as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(secondCall).toContain('Found: src/main.ts');
  });

  it('emits flow events', async () => {
    const events: string[] = [];
    mockPlanLLM.mockResolvedValue(JSON.stringify({
      steps: [{ id: 's1', title: 'Step', description: 'Do it', dependencies: [] }],
    }));

    const flow = new PlanningFlow(createConfig());
    flow.on('flow:start', () => events.push('start'));
    flow.on('flow:plan_created', () => events.push('plan'));
    flow.on('flow:step_start', () => events.push('step_start'));
    flow.on('flow:step_complete', () => events.push('step_complete'));
    flow.on('flow:complete', () => events.push('complete'));

    await flow.execute('Test');

    expect(events).toEqual(['start', 'plan', 'step_start', 'step_complete', 'complete']);
  });

  it('reports progress percentage', async () => {
    mockPlanLLM.mockResolvedValue(JSON.stringify({
      steps: [
        { id: 's1', title: 'A', description: 'A', dependencies: [] },
        { id: 's2', title: 'B', description: 'B', dependencies: [] },
      ],
    }));

    const flow = new PlanningFlow(createConfig());

    let progressValues: number[] = [];
    flow.on('flow:step_complete', () => {
      progressValues.push(flow.getProgress());
    });

    await flow.execute('Two steps');

    expect(progressValues).toEqual([50, 100]);
  });

  it('createFlow factory works', () => {
    const flow = createFlow(FlowType.PLANNING, createConfig());
    expect(flow).toBeInstanceOf(PlanningFlow);
  });
});
