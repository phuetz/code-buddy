import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { RunTracker } from '../../../src/channels/pro/run-tracker.js';
import { RunCommands } from '../../../src/channels/pro/run-commands.js';
import type { RunArtifact } from '../../../src/channels/pro/types.js';

describe('RunTracker', () => {
  let tracker: RunTracker;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'run-tracker-test-'));
    tracker = new RunTracker(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should start a run and return a RunRecord', () => {
    const run = tracker.startRun('sess1', 'Fix the bug', { chatId: 'c1', userId: 'u1' });

    expect(run.id).toMatch(/^run_/);
    expect(run.sessionId).toBe('sess1');
    expect(run.objective).toBe('Fix the bug');
    expect(run.status).toBe('running');
    expect(run.steps).toEqual([]);
    expect(run.artifacts).toEqual([]);
    expect(run.tokenCount).toBe(0);
    expect(run.totalCost).toBe(0);
    expect(run.chatId).toBe('c1');
    expect(run.userId).toBe('u1');
  });

  it('should track active run and clear on end', () => {
    const run = tracker.startRun('sess1', 'Task A');
    expect(tracker.getActiveRun()).toBeDefined();
    expect(tracker.getActiveRun()!.id).toBe(run.id);

    tracker.endRun(run.id, 'completed');
    expect(tracker.getActiveRun()).toBeUndefined();
  });

  it('should end a run and set status and endedAt', () => {
    const run = tracker.startRun('sess1', 'Task B');
    const ended = tracker.endRun(run.id, 'failed');

    expect(ended).toBeDefined();
    expect(ended!.status).toBe('failed');
    expect(ended!.endedAt).toBeDefined();
    expect(ended!.endedAt).toBeGreaterThanOrEqual(run.startedAt);
  });

  it('should return undefined when ending a nonexistent run', () => {
    expect(tracker.endRun('nonexistent', 'completed')).toBeUndefined();
  });

  it('should add steps and complete them', () => {
    const run = tracker.startRun('sess1', 'Add feature');
    const step = tracker.addStep(run.id, 'read_file', { path: '/foo.ts' }, { turnId: 1 });

    expect(step.stepId).toBe('step_1');
    expect(step.toolName).toBe('read_file');
    expect(step.turnId).toBe(1);
    expect(step.success).toBeUndefined();

    tracker.completeStep(run.id, step.stepId, 'file contents', true, ['foo.ts']);

    const updated = tracker.getRun(run.id)!;
    const completedStep = updated.steps[0];
    expect(completedStep.result).toBe('file contents');
    expect(completedStep.success).toBe(true);
    expect(completedStep.endedAt).toBeDefined();
    expect(completedStep.filesChanged).toEqual(['foo.ts']);
  });

  it('should throw when adding a step to nonexistent run', () => {
    expect(() => tracker.addStep('bad_id', 'bash', {})).toThrow('Run bad_id not found');
  });

  it('should silently ignore completing a step on nonexistent run or step', () => {
    const run = tracker.startRun('sess1', 'test');
    tracker.completeStep('nonexistent', 'step_1', 'result', true);
    tracker.completeStep(run.id, 'nonexistent_step', 'result', true);
  });

  it('should add artifacts to a run', () => {
    const run = tracker.startRun('sess1', 'Deploy');
    const artifact: RunArtifact = {
      type: 'commit',
      ref: 'abc123',
      description: 'Initial commit',
    };
    tracker.addArtifact(run.id, artifact);

    const updated = tracker.getRun(run.id)!;
    expect(updated.artifacts).toHaveLength(1);
    expect(updated.artifacts[0].ref).toBe('abc123');
  });

  it('should update usage metrics', () => {
    const run = tracker.startRun('sess1', 'Count tokens');
    tracker.updateUsage(run.id, 5000, 0.05);

    const updated = tracker.getRun(run.id)!;
    expect(updated.tokenCount).toBe(5000);
    expect(updated.totalCost).toBe(0.05);
  });

  it('should list runs sorted by recency', () => {
    const run1 = tracker.startRun('s1', 'First');
    const run2 = tracker.startRun('s2', 'Second');
    const run3 = tracker.startRun('s3', 'Third');

    (run1 as any).startedAt = 1000;
    (run2 as any).startedAt = 2000;
    (run3 as any).startedAt = 3000;

    const listed = tracker.listRuns();
    expect(listed[0].id).toBe(run3.id);
    expect(listed[listed.length - 1].id).toBe(run1.id);
  });

  it('should respect limit in listRuns', () => {
    tracker.startRun('s1', 'A');
    tracker.startRun('s2', 'B');
    tracker.startRun('s3', 'C');

    const listed = tracker.listRuns(2);
    expect(listed).toHaveLength(2);
  });

  it('should filter test steps correctly', () => {
    const run = tracker.startRun('sess1', 'Run tests');
    tracker.addStep(run.id, 'bash', { command: 'npm test' });
    tracker.addStep(run.id, 'bash', { command: 'jest --coverage' });
    tracker.addStep(run.id, 'bash', { command: 'ls -la' });
    tracker.addStep(run.id, 'bash', { command: 'pytest tests/' });
    tracker.addStep(run.id, 'read_file', { path: '/test.ts' });

    const testSteps = tracker.getTestSteps(run.id);
    expect(testSteps).toHaveLength(3);
    expect(testSteps.map((s) => s.args.command)).toEqual([
      'npm test',
      'jest --coverage',
      'pytest tests/',
    ]);
  });

  it('should return empty array for test steps on nonexistent run', () => {
    expect(tracker.getTestSteps('bad_id')).toEqual([]);
  });

  it('should get commit refs from artifacts', () => {
    const run = tracker.startRun('sess1', 'Commit');
    tracker.addArtifact(run.id, { type: 'commit', ref: 'abc123', description: 'feat' });
    tracker.addArtifact(run.id, { type: 'file', path: '/foo', description: 'file' });
    tracker.addArtifact(run.id, { type: 'commit', ref: 'def456', description: 'fix' });

    const refs = tracker.getCommitRefs(run.id);
    expect(refs).toEqual(['abc123', 'def456']);
  });

  it('should return empty array for commit refs on nonexistent run', () => {
    expect(tracker.getCommitRefs('bad_id')).toEqual([]);
  });

  it('should have static utility methods', () => {
    expect(RunTracker.getStatusIcon('completed')).toContain('DONE');
    expect(RunTracker.getStatusIcon('running')).toContain('RUN');
    expect(RunTracker.getStatusIcon('failed')).toContain('FAIL');
    expect(RunTracker.formatDuration(1000, 4000)).toContain('3');
    expect(RunTracker.formatArgs({ command: 'echo hi' })).toContain('echo hi');
    expect(RunTracker.truncate('a very long string', 5)).toHaveLength(5); // maxLen includes '...'
  });

  it('should prune runs beyond MAX_RUNS (100)', () => {
    for (let i = 0; i < 105; i++) {
      tracker.startRun(`sess${i}`, `Task ${i}`);
    }

    const all = tracker.listRuns(200);
    expect(all.length).toBeLessThanOrEqual(100);
  });

  it('should persist and reload runs from disk', () => {
    const run = tracker.startRun('sess1', 'Persistent task');
    tracker.addStep(run.id, 'bash', { command: 'echo hello' });
    tracker.endRun(run.id, 'completed');

    const tracker2 = new RunTracker(tmpDir);
    const reloaded = tracker2.getRun(run.id);

    expect(reloaded).toBeDefined();
    expect(reloaded!.objective).toBe('Persistent task');
    expect(reloaded!.status).toBe('completed');
    expect(reloaded!.steps).toHaveLength(1);
  });
});

describe('RunCommands', () => {
  let tracker: RunTracker;
  let commands: RunCommands;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'run-cmds-test-'));
    tracker = new RunTracker(tmpDir);
    commands = new RunCommands(tracker);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should list runs returning structured data', () => {
    tracker.startRun('s1', 'Task 1');
    tracker.startRun('s2', 'Task 2');

    const result = commands.handleRunsList('chat1', 'user1');
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].objective).toBeDefined();
  });

  it('should return empty runs array when no runs', () => {
    const result = commands.handleRunsList('chat1', 'user1');
    expect(result.runs).toEqual([]);
  });

  it('should show run detail with structured data', () => {
    const run = tracker.startRun('s1', 'Build project');
    tracker.addStep(run.id, 'bash', { command: 'npm test' });
    tracker.addArtifact(run.id, { type: 'commit', ref: 'abc', description: 'commit' });
    tracker.endRun(run.id, 'completed');

    const result = commands.handleRunDetail('chat1', run.id);
    expect(result).not.toBeNull();
    expect(result!.run.objective).toBe('Build project');
    expect(result!.testSteps).toHaveLength(1);
    expect(result!.commitRefs).toEqual(['abc']);
  });

  it('should return null for unknown run detail', () => {
    const result = commands.handleRunDetail('chat1', 'nonexistent');
    expect(result).toBeNull();
  });

  it('should handle rerun without auth manager', async () => {
    const run = tracker.startRun('s1', 'Original task');
    tracker.endRun(run.id, 'completed');

    const result = await commands.handleRerun(run.id, 'user1', 'chat1');
    expect(result.text).toContain('Re-running');
    expect(result.objective).toBe('Original task');
  });

  it('should handle rerun tests', async () => {
    const run = tracker.startRun('s1', 'Test suite');
    tracker.addStep(run.id, 'bash', { command: 'npm test' });
    tracker.addStep(run.id, 'bash', { command: 'jest --verbose' });
    tracker.endRun(run.id, 'completed');

    const result = await commands.handleRerunTests(run.id, 'user1', 'chat1');
    expect(result.commands).toBeDefined();
    expect(result.commands).toHaveLength(2);
    expect(result.text).toContain('2 test command');
  });

  it('should return no tests message when run has no test steps', async () => {
    const run = tracker.startRun('s1', 'No tests here');
    tracker.addStep(run.id, 'bash', { command: 'echo hi' });
    tracker.endRun(run.id, 'completed');

    const result = await commands.handleRerunTests(run.id, 'user1', 'chat1');
    expect(result.text).toContain('No test commands found');
    expect(result.commands).toBeUndefined();
  });

  it('should handle rollback without auth manager', async () => {
    const run = tracker.startRun('s1', 'Deploy');
    tracker.addArtifact(run.id, { type: 'commit', ref: 'abc123', description: 'deploy commit' });
    tracker.endRun(run.id, 'completed');

    const result = await commands.handleRollback(run.id, 'user1', 'chat1');
    expect(result.text).toContain('Ready to rollback');
    expect(result.commitRef).toBe('abc123');
  });

  it('should handle rollback with no commits', async () => {
    const run = tracker.startRun('s1', 'No commits');
    tracker.endRun(run.id, 'completed');

    const result = await commands.handleRollback(run.id, 'user1', 'chat1');
    expect(result.text).toContain('No commit refs found');
  });

  it('should require deploy scope for rollback with auth manager', async () => {
    const mockAuth = {
      checkScope: jest.fn().mockReturnValue({ allowed: false, reason: 'no deploy scope' }),
      requireDoubleConfirm: jest.fn(),
    } as any;

    const authedCommands = new RunCommands(tracker, mockAuth);
    const run = tracker.startRun('s1', 'Deploy');
    tracker.addArtifact(run.id, { type: 'commit', ref: 'abc', description: 'c' });
    tracker.endRun(run.id, 'completed');

    const result = await authedCommands.handleRollback(run.id, 'user1', 'chat1');
    expect(result.text).toContain('Permission denied');
    expect(result.text).toContain('deploy');
    expect(mockAuth.checkScope).toHaveBeenCalledWith('user1', 'deploy');
  });
});
