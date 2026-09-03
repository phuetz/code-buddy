import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetTeamHandlerForTests,
  handleTeam,
  type TeamDelegatedTask,
  type TeamDelegationOutput,
} from '../../src/commands/handlers/team-handlers.js';
import { getTeamManager, resetTeamManager } from '../../src/agent/multi-agent/team-manager.js';

function assignTask(memberId: string, title: string): string {
  const team = getTeamManager();
  const task = team.addTask(title, title);
  team.assignTask(task.id, memberId);
  return task.id;
}

describe('/team thread delegation', () => {
  beforeEach(async () => {
    await _resetTeamHandlerForTests();
    resetTeamManager();
    await handleTeam(['start', 'toy goal']);
  });

  afterEach(async () => {
    await _resetTeamHandlerForTests();
    resetTeamManager();
    vi.restoreAllMocks();
  });

  it('runs assigned members through the unchanged default concurrency of one', async () => {
    const team = getTeamManager();
    const coder = team.addMember('coder', 'coder-one').memberId;
    const tester = team.addMember('tester', 'tester-one').memberId;
    assignTask(coder, 'write toy');
    assignTask(tester, 'test toy');
    let active = 0;
    let maxActive = 0;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const result = await handleTeam(['run', 'all'], {
      agentFactory: ({ agentId }) => ({
        async execute(input: TeamDelegatedTask): Promise<TeamDelegationOutput> {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return {
            type: 'result',
            success: true,
            summary: `${agentId}:${input.task.title}`,
          };
        },
        abortCurrentOperation() {},
        dispose() {},
      }),
    });

    expect(maxActive).toBe(1);
    expect(result.entry?.content).toContain('Completed: 2/2');
    expect(team.getTasks().every((task) => task.status === 'completed')).toBe(true);
    expect(write).toHaveBeenCalledWith(expect.stringContaining(`[team:${coder}:result]`));
    expect(write).toHaveBeenCalledWith(expect.stringContaining(`[team:${tester}:result]`));
  });

  it('keeps FIFO order per member and reports the reduced turn budget honestly', async () => {
    const team = getTeamManager();
    const coder = team.addMember('coder', 'coder-one').memberId;
    const firstId = assignTask(coder, 'first');
    const secondId = assignTask(coder, 'second');
    const calls: string[] = [];

    const result = await handleTeam(['run', 'all'], {
      parentBudget: { maxTurns: 2, maxCostUsd: 2, maxContextTokens: 16_000 },
      eventSink: () => undefined,
      agentFactory: () => ({
        async execute(input: TeamDelegatedTask): Promise<TeamDelegationOutput> {
          calls.push(input.task.title);
          return { type: 'result', success: true, summary: input.task.title };
        },
        abortCurrentOperation() {},
        dispose() {},
      }),
    });

    expect(calls).toEqual(['first']);
    expect(team.getTask(firstId)?.status).toBe('completed');
    expect(team.getTask(secondId)?.status).toBe('failed');
    expect(team.getTask(secondId)?.error).toContain('budget exhausted');
    expect(result.entry?.content).toContain('Completed: 1/2');
    expect(result.entry?.content).toContain('turn_budget_exhausted');
  });

  it('contains a throwing member and lets its sibling finish', async () => {
    const team = getTeamManager();
    const broken = team.addMember('coder', 'broken').memberId;
    const healthy = team.addMember('tester', 'healthy').memberId;
    const brokenTask = assignTask(broken, 'break');
    const healthyTask = assignTask(healthy, 'survive');

    const result = await handleTeam(['run', 'all'], {
      concurrency: 2,
      eventSink: () => undefined,
      agentFactory: ({ agentId }) => ({
        async execute(input: TeamDelegatedTask): Promise<TeamDelegationOutput> {
          if (agentId === broken) throw new Error('member exploded');
          return { type: 'result', success: true, summary: input.task.title };
        },
        abortCurrentOperation() {},
        dispose() {},
      }),
    });

    expect(result.entry?.content).toContain('Completed: 1/2');
    expect(team.getTask(brokenTask)?.status).toBe('failed');
    expect(team.getTask(brokenTask)?.error).toContain('member exploded');
    expect(team.getTask(healthyTask)?.status).toBe('completed');
  });

  it('propagates a parent abort signal to every running teammate', async () => {
    const team = getTeamManager();
    const coder = team.addMember('coder', 'coder-one').memberId;
    const tester = team.addMember('tester', 'tester-one').memberId;
    assignTask(coder, 'hang one');
    assignTask(tester, 'hang two');
    const parent = new AbortController();
    const aborted: string[] = [];

    const running = handleTeam(['run', 'all'], {
      concurrency: 2,
      parentSignal: parent.signal,
      eventSink: () => undefined,
      agentFactory: ({ agentId, signal }) => ({
        execute: () => new Promise<TeamDelegationOutput>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
        abortCurrentOperation() {
          aborted.push(agentId);
        },
        dispose() {},
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    parent.abort('lead stopped');
    const result = await running;

    expect(aborted.sort()).toEqual([coder, tester].sort());
    expect(result.entry?.content).toContain('Completed: 0/2');
    expect(result.entry?.content).toContain('cancelled');
  });

  it('/team stop cancels the active child before dissolving the team', async () => {
    const team = getTeamManager();
    const coder = team.addMember('coder', 'coder-one').memberId;
    assignTask(coder, 'hang');
    const abort = vi.fn();

    const running = handleTeam(['run', 'all'], {
      eventSink: () => undefined,
      agentFactory: ({ signal }) => ({
        execute: () => new Promise<TeamDelegationOutput>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
        abortCurrentOperation: abort,
        dispose() {},
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const stopped = await handleTeam(['stop']);
    const result = await running;

    expect(abort).toHaveBeenCalledOnce();
    expect(stopped.entry?.content).toContain('Team dissolved');
    expect(result.entry?.content).toContain('Completed: 0/1');
    expect(team.isActive()).toBe(false);
  });
});
