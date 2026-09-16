import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleAgents: vi.fn(async () => ({
    handled: true,
    entry: { type: 'assistant', content: 'started', timestamp: new Date() },
  })),
  peek: vi.fn(() => 'hierarchical'),
  set: vi.fn(),
}));

vi.mock('../../src/commands/handlers/agents-handler.js', () => ({
  handleAgents: mocks.handleAgents,
  _peekActiveStrategy: mocks.peek,
  _setActiveStrategy: mocks.set,
}));

import { handleSwarm } from '../../src/commands/handlers/swarm-handler.js';
import { MultiAgentSystem } from '../../src/agent/multi-agent/multi-agent-system.js';
import type {
  AgentExecutionResult,
  AgentRole,
  AgentTask,
  ExecutionPlan,
  WorkflowOptions,
  WorkflowThreadDelegationOptions,
} from '../../src/agent/multi-agent/types.js';

/** Vue privée du système multi-agent : c'est lui qui porte le runner de `/swarm`. */
interface SwarmInternals {
  agents: Map<AgentRole, { execute: unknown; getRole(): AgentRole }>;
  currentPlan: ExecutionPlan | null;
  startThreadDelegation(options: WorkflowThreadDelegationOptions): void;
  closeThreadDelegation(): Promise<void>;
  executeParallel(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions,
  ): Promise<void>;
}

function makeTask(id: string, role: AgentRole): AgentTask {
  return {
    id,
    title: id,
    description: id,
    status: 'pending',
    priority: 'medium',
    assignedTo: role,
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePlan(tasks: AgentTask[]): ExecutionPlan {
  return {
    id: 'plan-swarm-fifo',
    goal: 'toy',
    summary: 'toy',
    phases: [
      {
        id: 'phase-1',
        name: 'phase-1',
        description: 'toy',
        tasks,
        parallelizable: true,
        order: 1,
      },
    ],
    estimatedComplexity: 'simple',
    requiredAgents: tasks.map((task) => task.assignedTo),
    createdAt: new Date(),
    status: 'executing',
  };
}

describe('/swarm thread delegation wiring', () => {
  const originalConcurrency = process.env.CODEBUDDY_SWARM_CONCURRENCY;

  beforeEach(() => {
    delete process.env.CODEBUDDY_SWARM_CONCURRENCY;
    mocks.handleAgents.mockClear();
    mocks.peek.mockClear();
    mocks.set.mockClear();
  });

  afterEach(() => {
    if (originalConcurrency === undefined) delete process.env.CODEBUDDY_SWARM_CONCURRENCY;
    else process.env.CODEBUDDY_SWARM_CONCURRENCY = originalConcurrency;
    vi.restoreAllMocks();
  });

  it('routes a swarm run through thread delegation with unchanged concurrency default', async () => {
    await handleSwarm(['build', 'the', 'toy']);

    expect(mocks.handleAgents).toHaveBeenCalledWith(
      ['run', 'build the toy'],
      expect.objectContaining({
        threadDelegation: expect.objectContaining({
          concurrency: 1,
        }),
      }),
    );
  });

  it('admits three queued swarm roles in arrival order with the concurrency it selected', async () => {
    // Les deux tests ci-dessus n'observent que le CÂBLAGE : ils n'exécutent
    // aucun créneau, donc `waiters.shift()` et `waiters.pop()` y sont
    // indiscernables. Ici les options que `/swarm` a réellement choisies
    // pilotent le vrai runner du système multi-agent, avec trois rôles en
    // attente derrière un quatrième qui tient l'unique créneau.
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleSwarm(['build', 'the', 'toy']);
    const invocation = mocks.handleAgents.mock.calls[0]?.[1] as {
      threadDelegation?: WorkflowThreadDelegationOptions;
    };
    const delegation = invocation.threadDelegation;
    expect(delegation).toBeDefined();
    expect(delegation?.concurrency).toBe(1);

    const mas = new MultiAgentSystem('test-key');
    const internals = mas as unknown as SwarmInternals;
    const admissionOrder: string[] = [];
    let announceActiveStarted!: () => void;
    let releaseActive!: () => void;
    const activeStarted = new Promise<void>((resolve) => {
      announceActiveStarted = resolve;
    });
    const activeReleased = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });

    const roles: AgentRole[] = ['orchestrator', 'coder', 'reviewer', 'tester'];
    for (const role of roles) {
      const agent = internals.agents.get(role);
      expect(agent).toBeDefined();
      (agent as { execute: unknown }).execute = async (
        task: AgentTask,
      ): Promise<AgentExecutionResult> => {
        admissionOrder.push(task.id);
        if (task.id === 'active') await activeReleased;
        else if (admissionOrder.length === 1) throw new Error('active must be admitted first');
        return {
          success: true,
          role,
          taskId: task.id,
          output: task.id,
          artifacts: [],
          toolsUsed: [],
          rounds: 1,
          duration: 0,
        };
      };
    }
    const activeAgent = internals.agents.get('orchestrator') as { execute: unknown };
    const activeExecute = activeAgent.execute as (task: AgentTask) => Promise<AgentExecutionResult>;
    activeAgent.execute = async (task: AgentTask): Promise<AgentExecutionResult> => {
      announceActiveStarted();
      return activeExecute(task);
    };

    const tasks = [
      makeTask('active', 'orchestrator'),
      makeTask('first', 'coder'),
      makeTask('second', 'reviewer'),
      makeTask('third', 'tester'),
    ];
    const plan = makePlan(tasks);
    internals.currentPlan = plan;
    internals.startThreadDelegation(delegation as WorkflowThreadDelegationOptions);

    const results = new Map<string, AgentExecutionResult>();
    const errors: string[] = [];
    const running = internals.executeParallel(plan, results, errors, {
      strategy: 'parallel',
      threadDelegation: delegation as WorkflowThreadDelegationOptions,
    });

    await activeStarted;
    // Laisser les trois rôles restants atteindre le sémaphore avant de rendre
    // le créneau : c'est la file d'attente elle-même que l'on observe.
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseActive();
    await running;
    await internals.closeThreadDelegation();
    mas.dispose();

    expect(errors).toEqual([]);
    expect(admissionOrder).toEqual(['active', 'first', 'second', 'third']);
    expect([...results.keys()].sort()).toEqual(['active', 'first', 'second', 'third']);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('[swarm:coder:'));
  });

  it('renders every multiplexed event with an agent and kind tag', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleSwarm(['inspect', 'toy']);
    const invocation = mocks.handleAgents.mock.calls[0]?.[1] as {
      threadDelegation?: { onEvent?: (event: { agentId: string; kind: string; payload: unknown }) => void };
    };

    invocation.threadDelegation?.onEvent?.({
      agentId: 'coder',
      kind: 'output',
      payload: { output: 'coder finished' },
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining('[swarm:coder:output]'));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('coder finished'));
  });
});
