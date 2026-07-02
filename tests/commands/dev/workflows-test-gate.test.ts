/**
 * V1 — `buddy dev` workflows must FAIL CLOSED on a red test suite.
 *
 * Previously runWorkflow ran tests once and called endRun('completed')
 * unconditionally; runTests swallows a failure (returns "Tests failed…" without
 * throwing), so a red suite was reported as success. These tests pin the new
 * behaviour: a bounded fix loop, then status gated on the real test result.
 */

// ── Mocks ──────────────────────────────────────────────────────────
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

let profileTestCmd: string | undefined = 'npm test';
jest.mock('../../../src/agent/repo-profiler.js', () => ({
  getRepoProfiler: () => ({
    getProfile: async () => ({
      commands: { test: profileTestCmd },
      contextPack: 'repo-context',
    }),
  }),
}));

const endRunCalls: Array<{ runId: string; status: string }> = [];
jest.mock('../../../src/observability/run-store.js', () => ({
  RunStore: {
    getInstance: () => ({
      startRun: () => 'run-1',
      emit: () => {},
      saveArtifact: () => '/tmp/artifact',
      endRun: (runId: string, status: string) => { endRunCalls.push({ runId, status }); },
    }),
  },
}));

jest.mock('../../../src/security/write-policy.js', () => ({
  WritePolicy: {
    getInstance: () => ({ getMode: () => 'off', setMode: () => {} }),
  },
}));

import { runWorkflow } from '../../../src/commands/dev/workflows.js';

function createMockAgent() {
  const processUserMessageStream = jest.fn().mockImplementation(() => ({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content', content: 'ok' };
    },
  }));
  return { processUserMessageStream, setRunId: jest.fn() } as unknown as import('../../../src/agent/codebuddy-agent.js').CodeBuddyAgent & { processUserMessageStream: jest.Mock };
}

/** Make execSync succeed (green) or throw (red) like a real test command. */
function green() { return 'ok\n3 passed'; }
function red(): never { throw Object.assign(new Error('exit 1'), { stdout: 'AssertionError', stderr: '' }); }

describe('runWorkflow test gate (V1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    endRunCalls.length = 0;
    profileTestCmd = 'npm test';
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.stdout.write = (() => true) as typeof process.stdout.write;
  });
  afterEach(() => jest.restoreAllMocks());

  it("reports 'failed' when tests stay red through the fix loop", async () => {
    mockExecSync.mockImplementation(red); // always red
    const agent = createMockAgent();
    const result = await runWorkflow('fix-tests', 'x', agent, { nonInteractive: true });

    expect(result.status).toBe('failed');
    expect(endRunCalls.at(-1)).toEqual({ runId: 'run-1', status: 'failed' });
    // plan + implement + 1 fix round + summary = 4 agent turns
    expect((agent as unknown as { processUserMessageStream: jest.Mock }).processUserMessageStream).toHaveBeenCalledTimes(4);
    // tests were run twice (initial + after the single fix round)
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it("reports 'completed' when a fix round turns the suite green", async () => {
    mockExecSync.mockImplementationOnce(red).mockImplementation(green); // red then green
    const agent = createMockAgent();
    const result = await runWorkflow('fix-tests', 'x', agent, { nonInteractive: true });

    expect(result.status).toBe('completed');
    expect(endRunCalls.at(-1)).toEqual({ runId: 'run-1', status: 'completed' });
    expect(mockExecSync).toHaveBeenCalledTimes(2); // initial red + green after fix
  });

  it('does not attempt a fix when maxFixRounds is 0; reports failed on red', async () => {
    mockExecSync.mockImplementation(red);
    const agent = createMockAgent();
    const result = await runWorkflow('refactor', 'x', agent, { nonInteractive: true, maxFixRounds: 0 });

    expect(result.status).toBe('failed');
    // plan + implement + summary = 3 turns (no fix round)
    expect((agent as unknown as { processUserMessageStream: jest.Mock }).processUserMessageStream).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("reports 'completed' when there is no test command (nothing to fail)", async () => {
    profileTestCmd = undefined;
    const agent = createMockAgent();
    const result = await runWorkflow('add-feature', 'x', agent, { nonInteractive: true });

    expect(result.status).toBe('completed');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("reports 'completed' when tests pass on the first run", async () => {
    mockExecSync.mockImplementation(green);
    const agent = createMockAgent();
    const result = await runWorkflow('add-feature', 'x', agent, { nonInteractive: true });

    expect(result.status).toBe('completed');
    // plan + implement + summary = 3 turns (no fix round needed)
    expect((agent as unknown as { processUserMessageStream: jest.Mock }).processUserMessageStream).toHaveBeenCalledTimes(3);
  });
});
