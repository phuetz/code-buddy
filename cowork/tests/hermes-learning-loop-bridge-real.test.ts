import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getHermesLearningLoopStatusForReview,
  runHermesLearningRetrospectiveForReview,
} from '../src/main/tools/hermes-learning-loop-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltLearningCore = fs.existsSync(path.join(distRoot, 'agent', 'hermes-learning-loop-status.js'));

interface RealRunStoreForTest {
  dispose?: () => void;
  emit: (runId: string, event: { type: string; data: Record<string, unknown> }) => void;
  endRun: (runId: string, status: 'completed' | 'failed' | 'cancelled') => void;
  getArtifact: (runId: string, name: string) => string | null;
  saveArtifact: (runId: string, name: string, content: string) => void;
  startRun: (objective: string, metadata?: Record<string, unknown>) => string;
}

describe.skipIf(!hasBuiltLearningCore)('Hermes learning loop bridge real core integration', () => {
  let originalEnginePath: string | undefined;

  beforeEach(() => {
    originalEnginePath = process.env.CODEBUDDY_ENGINE_PATH;
    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
  });

  afterEach(() => {
    if (originalEnginePath === undefined) delete process.env.CODEBUDDY_ENGINE_PATH;
    else process.env.CODEBUDDY_ENGINE_PATH = originalEnginePath;
  });

  it('loads the real compiled Learning Agent status for Cowork without observation content', async () => {
    const status = await getHermesLearningLoopStatusForReview({
      rootDir: path.resolve(process.cwd(), '..'),
      limit: 3,
    });

    expect(status).toMatchObject({
      kind: 'hermes_learning_loop_status',
      schemaVersion: 1,
      ok: true,
    });
    expect(status?.commands.retrospective).toBe('buddy run retrospective <run-id> --force --json');
    expect(status?.commands.runDoctor).toBe('buddy run doctor --json --limit 3');
    expect(status?.commands.skillUsage).toBe('buddy skills learning-usage --json');
    if (status?.nextRetrospectiveRun) {
      expect(status.nextRetrospectiveRun.command).toBe(
        `buddy run retrospective ${status.nextRetrospectiveRun.runId} --force --json`,
      );
      expect(['completed', 'failed', 'cancelled']).toContain(status.nextRetrospectiveRun.status);
    }
    expect(status?.summary.recentRunCount).toBeGreaterThanOrEqual(0);
    expect(status?.summary.runningRunCount).toBeGreaterThanOrEqual(0);
    expect(status?.summary.staleRunningRunCount).toBeGreaterThanOrEqual(0);
    expect(status?.reviewGates).toMatchObject({
      lessonWritesRequireApproval: true,
      skillCandidatesRequireReview: true,
      skillLifecycleRequiresApproval: true,
      userModelWritesRequireApproval: true,
    });
    expect(JSON.stringify(status)).not.toContain('content');
    expect(JSON.stringify(status)).not.toContain('observation');
  });

  it('runs a real compiled Learning Agent retrospective through the Cowork bridge', async () => {
    const originalRunsDir = process.env.CODEBUDDY_RUNS_DIR;
    const originalLearningAgent = process.env.CODEBUDDY_LEARNING_AGENT;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-learning-retro-'));
    const runsDir = path.join(tempDir, 'runs');
    const workspaceDir = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    let store: RealRunStoreForTest | null = null;
    try {
      process.env.CODEBUDDY_RUNS_DIR = runsDir;
      process.env.CODEBUDDY_LEARNING_AGENT = 'false';
      const runStoreModule = await import(
        pathToFileURL(path.join(distRoot, 'observability', 'run-store.js')).href
      ) as {
        RunStore: new (runsPath?: string) => RealRunStoreForTest;
      };
      store = new runStoreModule.RunStore(runsDir);
      const runId = store.startRun('Cowork bridge real retrospective proof', {
        channel: 'cowork',
        tags: ['hermes', 'real-bridge'],
      });
      for (const [toolCallId, toolName] of [
        ['call_search', 'search'],
        ['call_read', 'view_file'],
        ['call_test', 'bash'],
      ] as const) {
        store.emit(runId, {
          type: 'tool_call',
          data: { toolCallId, toolName, args: { query: 'retrospective bridge' } },
        });
        store.emit(runId, {
          type: 'tool_result',
          data: { durationMs: 10, output: `${toolName} ok`, success: true, toolName },
        });
      }
      store.saveArtifact(runId, 'summary.md', 'Real Cowork bridge retrospective proof.');
      store.endRun(runId, 'completed');

      const result = await runHermesLearningRetrospectiveForReview({
        rootDir: workspaceDir,
        runId,
      });

      expect(result).toMatchObject({
        command: `buddy run retrospective ${runId} --force --json`,
        ok: true,
        retrospectiveArtifact: 'learning-retrospective.json',
        runId,
        skipped: false,
        toolSequence: ['search', 'view_file', 'bash'],
      });
      expect(store.getArtifact(runId, 'learning-retrospective.json')).toContain('"kind": "learning_retrospective"');
      expect(JSON.stringify(result)).not.toContain('Real Cowork bridge retrospective proof.');
    } finally {
      store?.dispose?.();
      if (originalRunsDir === undefined) delete process.env.CODEBUDDY_RUNS_DIR;
      else process.env.CODEBUDDY_RUNS_DIR = originalRunsDir;
      if (originalLearningAgent === undefined) delete process.env.CODEBUDDY_LEARNING_AGENT;
      else process.env.CODEBUDDY_LEARNING_AGENT = originalLearningAgent;
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
