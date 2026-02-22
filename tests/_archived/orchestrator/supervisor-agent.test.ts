import { SupervisorAgent, type OrchestrationPlan, type SubAgentResult } from '../../src/agent/orchestrator/supervisor-agent.js';
import { SharedContext } from '../../src/agent/orchestrator/shared-context.js';
import { SelfHealing } from '../../src/agent/orchestrator/self-healing.js';
import { CheckpointRollback } from '../../src/agent/orchestrator/checkpoint-rollback.js';

describe('SupervisorAgent', () => {
  let supervisor: SupervisorAgent;

  beforeEach(() => {
    supervisor = new SupervisorAgent();
    supervisor.setExecutor(async (agent, task, context) => ({
      success: true,
      output: `${agent}: ${task}`,
      duration: 10,
    }));
  });

  it('should execute sequential plan', async () => {
    const plan: OrchestrationPlan = {
      mainGoal: 'Test',
      mergeStrategy: 'sequential',
      subAgents: [
        { id: 's1', agent: 'explorer', task: 'Find files', dependencies: [] },
        { id: 's2', agent: 'debugger', task: 'Fix bug', dependencies: [] },
      ],
    };

    const result = await supervisor.orchestrate(plan);
    expect(result.success).toBe(true);
    expect(result.results.size).toBe(2);
  });

  it('should execute parallel plan', async () => {
    const plan: OrchestrationPlan = {
      mainGoal: 'Test',
      mergeStrategy: 'parallel',
      subAgents: [
        { id: 's1', agent: 'explorer', task: 'Find files', dependencies: [] },
        { id: 's2', agent: 'debugger', task: 'Fix bug', dependencies: [] },
        { id: 's3', agent: 'test-runner', task: 'Run tests', dependencies: ['s1', 's2'] },
      ],
    };

    const result = await supervisor.orchestrate(plan);
    expect(result.success).toBe(true);
    expect(result.results.size).toBe(3);
  });

  it('should execute race plan', async () => {
    supervisor.setExecutor(async (agent) => ({
      success: agent === 'fast',
      output: `${agent} result`,
      duration: 10,
      error: agent !== 'fast' ? 'slow' : undefined,
    }));

    const plan: OrchestrationPlan = {
      mainGoal: 'Race test',
      mergeStrategy: 'race',
      subAgents: [
        { id: 's1', agent: 'fast', task: 'Go', dependencies: [] },
        { id: 's2', agent: 'slow', task: 'Go', dependencies: [] },
      ],
    };

    const result = await supervisor.orchestrate(plan);
    expect(result.success).toBe(true);
  });

  it('should handle executor failure', async () => {
    supervisor.setExecutor(async () => {
      throw new Error('Agent crashed');
    });

    const plan: OrchestrationPlan = {
      mainGoal: 'Test',
      mergeStrategy: 'sequential',
      subAgents: [
        { id: 's1', agent: 'explorer', task: 'crash', dependencies: [] },
      ],
    };

    const result = await supervisor.orchestrate(plan);
    expect(result.success).toBe(false);
  });
});

describe('SharedContext', () => {
  let ctx: SharedContext;

  beforeEach(() => {
    ctx = new SharedContext();
  });

  it('should get and set values', () => {
    ctx.set('key1', 'value1', 'agent-1');
    expect(ctx.get('key1')).toBe('value1');
  });

  it('should track versions', () => {
    ctx.set('key1', 'v1', 'agent-1');
    ctx.set('key1', 'v2', 'agent-1');
    expect(ctx.getVersion('key1')).toBe(2);
  });

  it('should detect version conflicts', () => {
    ctx.set('key1', 'v1', 'agent-1');
    // Try to update with wrong expected version
    const success = ctx.set('key1', 'v2', 'agent-2', 99);
    expect(success).toBe(false);
    expect(ctx.get('key1')).toBe('v1');
  });

  it('should support locking', () => {
    expect(ctx.lock('key1', 'agent-1')).toBe(true);
    expect(ctx.lock('key1', 'agent-2')).toBe(false); // Already locked
    expect(ctx.set('key1', 'blocked', 'agent-2')).toBe(false); // Lock blocks write
    expect(ctx.unlock('key1', 'agent-1')).toBe(true);
    expect(ctx.set('key1', 'ok', 'agent-2')).toBe(true);
  });

  it('should snapshot', () => {
    ctx.set('a', 1, 'agent-1');
    ctx.set('b', 'two', 'agent-1');
    const snap = ctx.snapshot();
    expect(snap).toEqual({ a: 1, b: 'two' });
  });
});

describe('SelfHealing', () => {
  let healing: SelfHealing;

  beforeEach(() => {
    healing = new SelfHealing();
  });

  it('should match error patterns', () => {
    const pattern = healing.matchPattern(new Error('ENOENT: no such file'));
    expect(pattern).not.toBeNull();
    expect(pattern!.name).toBe('FileNotFound');
  });

  it('should match permission errors', () => {
    const pattern = healing.matchPattern(new Error('permission denied'));
    expect(pattern!.name).toBe('PermissionDenied');
  });

  it('should return null for unknown errors', () => {
    const pattern = healing.matchPattern(new Error('some random error'));
    expect(pattern).toBeNull();
  });

  it('should heal with retry', async () => {
    let attempts = 0;
    const result = await healing.attemptHeal(
      new Error('ENOENT: file not found'),
      { toolName: 'bash', args: {}, workingDirectory: '/tmp' },
      3,
      async () => {
        attempts++;
        if (attempts >= 2) return; // succeed on 2nd try
        throw new Error('still not found');
      }
    );

    // Retry strategy should attempt the action
    expect(result.strategy).toBe('retry');
  });

  it('should escalate for out-of-memory', async () => {
    const result = await healing.attemptHeal(
      new Error('heap out of memory'),
      { toolName: 'bash', args: {}, workingDirectory: '/tmp' },
      3
    );

    expect(result.strategy).toBe('escalate');
    expect(result.healed).toBe(false);
  });
});

describe('CheckpointRollback', () => {
  let rollback: CheckpointRollback;

  beforeEach(() => {
    rollback = new CheckpointRollback();
  });

  it('should detect risky bash operations', () => {
    expect(rollback.isRiskyOperation('bash', { command: 'rm -rf /tmp/test' })).toBe(true);
    expect(rollback.isRiskyOperation('bash', { command: 'ls -la' })).toBe(false);
    expect(rollback.isRiskyOperation('bash', { command: 'git reset --hard' })).toBe(true);
  });

  it('should detect risky tool operations', () => {
    expect(rollback.isRiskyOperation('str_replace_editor')).toBe(true);
    expect(rollback.isRiskyOperation('view_file')).toBe(false);
  });

  it('should create checkpoints', () => {
    const cp = rollback.autoCheckpoint('edit file', [
      { path: '/tmp/test.ts', content: 'original', existed: true },
    ]);
    expect(cp.id).toBeTruthy();
    expect(cp.files).toHaveLength(1);
  });

  it('should list checkpoints', () => {
    rollback.autoCheckpoint('op1', []);
    rollback.autoCheckpoint('op2', []);
    expect(rollback.listCheckpoints()).toHaveLength(2);
  });

  it('should rollback to checkpoint', async () => {
    const written: Array<{ path: string; content: string }> = [];
    const cp = rollback.autoCheckpoint('edit', [
      { path: '/tmp/a.ts', content: 'original-a', existed: true },
    ]);

    const result = await rollback.rollbackTo(
      cp.id,
      async (p, c) => { written.push({ path: p, content: c }); },
      async () => {}
    );

    expect(result.success).toBe(true);
    expect(result.filesRestored).toBe(1);
    expect(written[0].content).toBe('original-a');
  });

  it('should fail rollback for unknown checkpoint', async () => {
    const result = await rollback.rollbackTo('nope', async () => {}, async () => {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should clear all checkpoints', () => {
    rollback.autoCheckpoint('op', []);
    rollback.clear();
    expect(rollback.listCheckpoints()).toHaveLength(0);
  });
});
