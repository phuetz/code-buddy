/**
 * Fleet tick handler tests — Phase (d).18.
 *
 * Pure unit tests with full fs+git mocking. No real I/O, no real WebSocket,
 * no real Code Buddy agent. Verifies the deterministic flow ported from
 * `claude-et-patrice/tools/heartbeat_tick.py` :
 *   - FLEET_PAUSE detection
 *   - Priority-based task picking, with priorityThreshold filter
 *   - Dirty-repo abort
 *   - Pull-failed abort
 *   - Happy path: claim, run agent, append worklog, mark completed
 *   - Claim race-loss
 *   - Out-of-scope rollback → blocked
 *   - Timeout → blocked
 *   - JSON parser robustness
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import {
  buildChainStagePrompt,
  buildTaskPrompt,
  isFleetPaused,
  parseAgentOutput,
  pickTask,
  runFleetTick,
} from '../../../src/agent/autonomous/fleet-tick-handler.js';
import type {
  AgentTaskOutput,
  FleetTask,
  FleetTasksFile,
  PresenceFile,
  WorklogFile,
} from '../../../src/agent/autonomous/fleet-task-types.js';

// We mock node:fs/promises so we can simulate the .codebuddy files.
vi.mock('fs/promises');

// Mock saga-store's lesson recall — Phase F injection should never
// touch real user memory in tests. The default returns no lessons so
// existing tests see the pre-Phase-F prompt unchanged. Hoisted so the
// `vi.mock` factory below (which is itself hoisted) can reference it.
const { loadRelevantSagaLessonsMock } = vi.hoisted(() => ({
  loadRelevantSagaLessonsMock: vi.fn<
    (query: string, opts?: { limit?: number }) => Promise<string[]>
  >(async () => []),
}));
vi.mock('../../../src/fleet/saga-store.js', () => ({
  loadRelevantSagaLessons: loadRelevantSagaLessonsMock,
}));
const fsMock = fs as unknown as {
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
};

function makeTask(overrides: Partial<FleetTask> = {}): FleetTask {
  return {
    id: 'task-test',
    title: 'Test task',
    description: 'Do the test thing',
    status: 'open',
    priority: 'medium',
    claimedBy: null,
    claimedAt: null,
    filesToModify: ['journal/test.md'],
    acceptanceCriteria: ['done'],
    createdBy: 'test',
    createdAt: '2026-05-08T00:00:00Z',
    ...overrides,
  };
}

interface VirtualFs {
  tasks: FleetTasksFile;
  worklog: WorklogFile;
  presence?: PresenceFile;
  heartbeat?: string;
}

function setupVirtualFs(virtual: VirtualFs): void {
  fsMock.readFile.mockImplementation(async (p: string) => {
    if (p.endsWith('colab-tasks.json')) return JSON.stringify(virtual.tasks);
    if (p.endsWith('colab-worklog.json')) return JSON.stringify(virtual.worklog);
    if (p.endsWith('presence.json')) {
      if (!virtual.presence) {
        const err = new Error('ENOENT') as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return JSON.stringify(virtual.presence);
    }
    if (p.endsWith('HEARTBEAT.md')) {
      if (virtual.heartbeat === undefined) {
        const err = new Error('ENOENT') as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return virtual.heartbeat;
    }
    throw new Error(`unexpected readFile: ${p}`);
  });

  fsMock.writeFile.mockImplementation(async (p: string, body: string) => {
    if (p.endsWith('colab-tasks.json')) {
      virtual.tasks = JSON.parse(body) as FleetTasksFile;
    } else if (p.endsWith('colab-worklog.json')) {
      virtual.worklog = JSON.parse(body) as WorklogFile;
    } else if (p.endsWith('presence.json')) {
      virtual.presence = JSON.parse(body) as PresenceFile;
    }
  });
}

interface GitMock {
  calls: Array<{ args: string[]; cwd: string }>;
  responses: Map<string, { stdout: string; stderr: string; code: number }>;
  default: { stdout: string; stderr: string; code: number };
}

function makeGitMock(): GitMock {
  return {
    calls: [],
    responses: new Map(),
    default: { stdout: '', stderr: '', code: 0 },
  };
}

function gitRunFromMock(mock: GitMock) {
  return async (args: string[], cwd: string) => {
    mock.calls.push({ args, cwd });
    const key = args.join(' ');
    return mock.responses.get(key) ?? mock.default;
  };
}

describe('isFleetPaused', () => {
  it('returns false when file empty', () => {
    expect(isFleetPaused('')).toBe(false);
  });
  it('returns false when only headings/blockquotes', () => {
    expect(isFleetPaused('# title\n> note\n')).toBe(false);
  });
  it('returns true when first non-comment line is FLEET_PAUSE', () => {
    expect(isFleetPaused('# title\n\nFLEET_PAUSE\n')).toBe(true);
  });
  it('returns false when FLEET_PAUSE is mentioned but not the first content line', () => {
    expect(isFleetPaused('# title\n\nsome other line\nFLEET_PAUSE\n')).toBe(false);
  });
  it('ignores leading whitespace lines', () => {
    expect(isFleetPaused('   \n\nFLEET_PAUSE')).toBe(true);
  });
});

describe('pickTask', () => {
  it('returns null when no claimable tasks', () => {
    expect(pickTask([])).toBeNull();
  });
  it('skips claimed tasks', () => {
    const t = makeTask({ claimedBy: 'darkstar/grok-cli' });
    expect(pickTask([t])).toBeNull();
  });
  it('skips completed tasks', () => {
    expect(pickTask([makeTask({ status: 'completed' })])).toBeNull();
  });
  it('orders by priority (high before low)', () => {
    const low = makeTask({ id: 'low', priority: 'low' });
    const high = makeTask({ id: 'high', priority: 'high' });
    expect(pickTask([low, high])?.id).toBe('high');
  });
  it('priorityThreshold=high skips medium and low', () => {
    const med = makeTask({ id: 'med', priority: 'medium' });
    const low = makeTask({ id: 'low', priority: 'low' });
    expect(pickTask([med, low], 'high')).toBeNull();
  });
  it('priorityThreshold=high SKIPS critical (autonomous never claims critical)', () => {
    const crit = makeTask({ id: 'crit', priority: 'critical' });
    const high = makeTask({ id: 'high', priority: 'high' });
    expect(pickTask([crit, high], 'high')?.id).toBe('high');
  });
});

describe('parseAgentOutput', () => {
  it('returns null on empty input', () => {
    expect(parseAgentOutput('')).toBeNull();
  });
  it('parses last-line strict JSON', () => {
    const out = 'preamble\nmore text\n{"summary":"ok","files_modified":[],"issues":[],"next_steps":[]}';
    const r = parseAgentOutput(out);
    expect(r?.summary).toBe('ok');
  });
  it('parses penultimate line when last line is not JSON', () => {
    const out = '{"summary":"ok"}\ntrailing noise';
    expect(parseAgentOutput(out)?.summary).toBe('ok');
  });
  it('falls back to regex on multi-line JSON', () => {
    const out = 'preamble\n{\n  "summary": "multi-line",\n  "issues": []\n}';
    expect(parseAgentOutput(out)?.summary).toBe('multi-line');
  });
  it('returns null when no summary field', () => {
    expect(parseAgentOutput('{"foo":"bar"}')).toBeNull();
  });
});

describe('buildChainStagePrompt (Phase G — Hermes auto-chain)', () => {
  const task = makeTask({
    title: 'Fix off-by-one',
    description: 'Audit parser bounds',
    filesToModify: ['src/parser.ts'],
    acceptanceCriteria: ['no off-by-one', 'tests added'],
  });
  const basePrompt = 'BASE_PROMPT_PLACEHOLDER';

  it('first stage (no prior) returns the base prompt unchanged', () => {
    expect(buildChainStagePrompt('code', basePrompt, task, null)).toBe(basePrompt);
  });

  it('review stage prepends audit framing + prior summary', () => {
    const prior: AgentTaskOutput = {
      summary: 'Added bounds check at line 42',
      files_modified: [{ file: 'src/parser.ts', changes: '+5 / -1' }],
      issues: [],
      next_steps: [],
    };
    const out = buildChainStagePrompt('review', basePrompt, task, prior);
    expect(out).toContain(basePrompt);
    expect(out).toContain('# Stage: review');
    expect(out).toContain('Added bounds check');
    expect(out).toContain('src/parser.ts: +5 / -1');
  });

  it('safe/test stage prepends test-writing framing', () => {
    const prior: AgentTaskOutput = {
      summary: 'Reviewed and approved',
      files_modified: [],
      issues: [],
      next_steps: [],
    };
    const out = buildChainStagePrompt('safe', basePrompt, task, prior);
    expect(out).toContain('# Stage: test');
    expect(out).toContain('Reviewed and approved');
  });

  it('truncates very long prior summaries at 1500 chars', () => {
    const prior: AgentTaskOutput = {
      summary: 'X'.repeat(3000),
      files_modified: [],
      issues: [],
      next_steps: [],
    };
    const out = buildChainStagePrompt('review', basePrompt, task, prior);
    // Truncated summary appears once; explicit cap test.
    const summaryStart = out.indexOf('Previous stage summary:');
    const filesStart = out.indexOf('Files touched in the previous stage:');
    const between = filesStart > 0 ? out.slice(summaryStart, filesStart) : out.slice(summaryStart);
    expect(between).toContain('...');
    expect(between.length).toBeLessThanOrEqual('Previous stage summary:\n'.length + 1500 + 10);
  });
});

describe('buildTaskPrompt', () => {
  it('includes title, description, files, criteria, JSON-output protocol', () => {
    const t = makeTask({
      title: 'Write a haiku',
      description: 'About the robot',
      filesToModify: ['journal/x.md'],
      acceptanceCriteria: ['signed', 'short'],
    });
    const prompt = buildTaskPrompt('darkstar/grok-cli', t);
    expect(prompt).toContain('Write a haiku');
    expect(prompt).toContain('About the robot');
    expect(prompt).toContain('journal/x.md');
    expect(prompt).toContain('  - signed');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('Aucun texte après ce JSON');
  });
});

describe('runFleetTick — outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadRelevantSagaLessonsMock.mockImplementation(async () => []);
  });

  it('returns dirty_repo when status --porcelain shows changes', async () => {
    const git = makeGitMock();
    git.responses.set('status --porcelain', { stdout: ' M somefile\n', stderr: '', code: 0 });
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [] },
      worklog: { version: '0.1', entries: [] },
    });

    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun: vi.fn(),
    });
    expect(result.kind).toBe('dirty_repo');
  });

  it('returns pull_failed when git pull --rebase fails', async () => {
    const git = makeGitMock();
    git.responses.set('pull --rebase', { stdout: '', stderr: 'conflict', code: 1 });
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [] },
      worklog: { version: '0.1', entries: [] },
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun: vi.fn(),
    });
    expect(result.kind).toBe('pull_failed');
  });

  it('returns fleet_paused when HEARTBEAT.md says so', async () => {
    const git = makeGitMock();
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [] },
      worklog: { version: '0.1', entries: [] },
      heartbeat: 'FLEET_PAUSE\n',
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun: vi.fn(),
    });
    expect(result.kind).toBe('fleet_paused');
  });

  it('returns no_task when nothing claimable, updates presence', async () => {
    const git = makeGitMock();
    setupVirtualFs({
      tasks: {
        version: '0.1',
        tasks: [makeTask({ claimedBy: 'darkstar/grok-cli', status: 'in_progress' })],
      },
      worklog: { version: '0.1', entries: [] },
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test/grok-cli',
      gitRun: gitRunFromMock(git),
      agentRun: vi.fn(),
    });
    expect(result.kind).toBe('no_task');
    // presence.json was written
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('presence.json'),
      expect.any(String),
      'utf-8',
    );
  });

  it('happy path: claims, runs agent, appends worklog, completes', async () => {
    const git = makeGitMock();
    const virtual: VirtualFs = {
      tasks: { version: '0.1', tasks: [makeTask({ id: 'task-happy', priority: 'high' })] },
      worklog: { version: '0.1', entries: [] },
    };
    setupVirtualFs(virtual);

    const agentRun = vi.fn().mockResolvedValue({
      stdout:
        'I did the thing.\n{"summary":"created journal entry","files_modified":[{"file":"journal/test.md","changes":"+5 lines"}],"issues":[],"next_steps":[]}',
      timedOut: false,
    });

    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test/grok-cli',
      gitRun: gitRunFromMock(git),
      agentRun,
    });

    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.taskId).toBe('task-happy');
      expect(result.summary).toContain('created journal');
    }
    // task is now completed
    expect(virtual.tasks.tasks[0].status).toBe('completed');
    expect(virtual.tasks.tasks[0].claimedBy).toBe('test/grok-cli');
    // worklog has the entry
    expect(virtual.worklog.entries.length).toBe(1);
    expect(virtual.worklog.entries[0].summary).toContain('created journal');
    // git was called for: status, pull, claim-add, claim-commit, claim-push,
    // diff, final-add, final-commit, final-push
    const argsList = git.calls.map((c) => c.args.join(' '));
    expect(argsList).toContain('commit -m claim: task-happy by test/grok-cli');
    expect(argsList).toContain('commit -m complete: task-happy by test/grok-cli');
    expect(argsList.filter((a) => a === 'push').length).toBeGreaterThanOrEqual(2);
  });

  it('claim_lost: push rejected → outcome reflects the race', async () => {
    const git = makeGitMock();
    git.responses.set('push', { stdout: '', stderr: 'rejected (non-fast-forward)', code: 1 });
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [makeTask({ priority: 'high' })] },
      worklog: { version: '0.1', entries: [] },
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun: vi.fn(),
    });
    expect(result.kind).toBe('claim_lost');
  });

  it('out_of_scope: rollback + blocked', async () => {
    const git = makeGitMock();
    // diff shows a file not in filesToModify
    git.responses.set('diff --name-only', {
      stdout: 'journal/test.md\nUNRELATED.md\n',
      stderr: '',
      code: 0,
    });
    const virtual: VirtualFs = {
      tasks: { version: '0.1', tasks: [makeTask({ priority: 'high', filesToModify: ['journal/test.md'] })] },
      worklog: { version: '0.1', entries: [] },
    };
    setupVirtualFs(virtual);

    const agentRun = vi.fn().mockResolvedValue({
      stdout: '{"summary":"all good"}',
      timedOut: false,
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun,
    });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.reason).toBe('out_of_scope');
    expect(virtual.tasks.tasks[0].status).toBe('blocked');
    const argsList = git.calls.map((c) => c.args.join(' '));
    expect(argsList).toContain('checkout -- .');
  });

  it('timeout: blocked with reason=timeout', async () => {
    const git = makeGitMock();
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [makeTask({ priority: 'high' })] },
      worklog: { version: '0.1', entries: [] },
    });
    const agentRun = vi.fn().mockResolvedValue({ stdout: '', timedOut: true });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun,
      maxTaskMs: 100,
    });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.reason).toBe('timeout');
  });

  it('priorityThreshold respects autonomous policy: skips critical', async () => {
    const git = makeGitMock();
    setupVirtualFs({
      tasks: {
        version: '0.1',
        tasks: [makeTask({ id: 'crit', priority: 'critical' })],
      },
      worklog: { version: '0.1', entries: [] },
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun: vi.fn(),
      // default priorityThreshold = 'high', so critical is skipped
    });
    expect(result.kind).toBe('no_task');
  });
});

describe('runFleetTick — Phase F skill memory injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends <recent_fleet_lessons> block when loadRelevantSagaLessons returns matches', async () => {
    loadRelevantSagaLessonsMock.mockImplementation(async () => [
      '- Goal: similar bug\n\nOutcome: bounds check fixed it',
      '- Goal: another bug\n\nOutcome: added regression test',
    ]);
    const git = makeGitMock();
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [makeTask({ id: 'task-lessons', priority: 'high' })] },
      worklog: { version: '0.1', entries: [] },
    });
    const seenPrompts: string[] = [];
    const agentRun = vi.fn(async (prompt: string) => {
      seenPrompts.push(prompt);
      return { stdout: '{"summary":"done"}', timedOut: false };
    });

    await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun,
    });
    expect(seenPrompts).toHaveLength(1);
    expect(seenPrompts[0]).toContain('<recent_fleet_lessons>');
    expect(seenPrompts[0]).toContain('similar bug');
    expect(seenPrompts[0]).toContain('another bug');
  });

  it('leaves the prompt unchanged when no lessons match', async () => {
    loadRelevantSagaLessonsMock.mockImplementation(async () => []);
    const git = makeGitMock();
    setupVirtualFs({
      tasks: { version: '0.1', tasks: [makeTask({ priority: 'high' })] },
      worklog: { version: '0.1', entries: [] },
    });
    let captured = '';
    const agentRun = vi.fn(async (prompt: string) => {
      captured = prompt;
      return { stdout: '{"summary":"done"}', timedOut: false };
    });
    await runFleetTick({
      repoPath: '/fake',
      host: 'test',
      gitRun: gitRunFromMock(git),
      agentRun,
    });
    expect(captured).not.toContain('<recent_fleet_lessons>');
  });
});

describe('runFleetTick — Phase G auto-chain from FleetTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadRelevantSagaLessonsMock.mockImplementation(async () => []);
  });

  it('runs three sequential agentRun calls when task.chainRoles is set', async () => {
    const git = makeGitMock();
    const task = makeTask({
      id: 'chain-task',
      priority: 'high',
      chainRoles: ['code', 'review', 'safe'],
    });
    const virtual: VirtualFs = {
      tasks: { version: '0.1', tasks: [task] },
      worklog: { version: '0.1', entries: [] },
    };
    setupVirtualFs(virtual);

    const calls: string[] = [];
    const agentRun = vi.fn(async (prompt: string) => {
      calls.push(prompt);
      const stageIdx = calls.length;
      return {
        stdout: `stage ${stageIdx}\n{"summary":"stage-${stageIdx}-summary","files_modified":[],"issues":[],"next_steps":[]}`,
        timedOut: false,
      };
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test/grok-cli',
      gitRun: gitRunFromMock(git),
      agentRun,
      maxStageMs: 1000,
    });

    expect(result.kind).toBe('completed');
    expect(agentRun).toHaveBeenCalledTimes(3);
    // Stage 1 = bare base prompt (no '# Stage: review' framing yet).
    expect(calls[0]).not.toContain('# Stage: review');
    // Stage 2 = review framing + stage 1's summary.
    expect(calls[1]).toContain('# Stage: review');
    expect(calls[1]).toContain('stage-1-summary');
    // Stage 3 = test framing + stage 2's summary.
    expect(calls[2]).toContain('# Stage: test');
    expect(calls[2]).toContain('stage-2-summary');
    // Worklog has chainStages.
    expect(virtual.worklog.entries).toHaveLength(1);
    const entry = virtual.worklog.entries[0];
    expect(entry.chainStages).toHaveLength(3);
    expect(entry.chainStages?.map((s) => s.role)).toEqual(['code', 'review', 'safe']);
    expect(entry.chainStages?.[0].summary).toBe('stage-1-summary');
    // Final task summary = LAST stage's summary (carries through to completion).
    expect(entry.summary).toBe('stage-3-summary');
  });

  it('breaks chain on stage timeout — partial chainStages, task marked blocked', async () => {
    const git = makeGitMock();
    const task = makeTask({
      id: 'chain-timeout',
      priority: 'high',
      chainRoles: ['code', 'review', 'safe'],
    });
    const virtual: VirtualFs = {
      tasks: { version: '0.1', tasks: [task] },
      worklog: { version: '0.1', entries: [] },
    };
    setupVirtualFs(virtual);

    let callCount = 0;
    const agentRun = vi.fn(async () => {
      callCount += 1;
      if (callCount === 2) {
        // Review stage times out.
        return { stdout: '', timedOut: true };
      }
      return {
        stdout: `{"summary":"stage-${callCount}-ok","files_modified":[],"issues":[],"next_steps":[]}`,
        timedOut: false,
      };
    });
    const result = await runFleetTick({
      repoPath: '/fake',
      host: 'test/grok-cli',
      gitRun: gitRunFromMock(git),
      agentRun,
      maxStageMs: 100,
    });
    // Stage 3 never fires.
    expect(agentRun).toHaveBeenCalledTimes(2);
    // Outer outcome should be `blocked` with `reason: 'timeout'` (chain timed out).
    expect(result.kind).toBe('blocked');
    // Task surfaces as blocked in tasks.json.
    expect(virtual.tasks.tasks[0].status).toBe('blocked');
  });
});
