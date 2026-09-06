import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'url';

import { registerRunCommands } from '../../src/commands/run-cli/index.js';
import { RunStore } from '../../src/observability/run-store.js';
import {
  buildTrajectory,
  renderTrajectory,
  unlogged,
} from '../../src/observability/run-trajectory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA_TMP = path.resolve(HERE, '../../_qa/traj/tmp');

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let tempDir: string;
let store: RunStore;
let activeRunIds: string[];

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('buildTrajectory (pure)', () => {
  it('aligns tools, permissions, usage, side effects and cost from fixtures', () => {
    const trajectory = buildTrajectory({
      runId: 'run_fixture',
      generatedAt: '2026-09-06T00:00:00.000Z',
      summary: {
        objective: 'edit then search',
        status: 'completed',
        startedAt: 1_000,
        endedAt: 5_000,
        sessionId: 'session_fixture',
      },
      metrics: {
        promptTokens: 100,
        completionTokens: 20,
        totalCost: 0,
        durationMs: 4_000,
        toolCallCount: 2,
      },
      events: [
        {
          ts: 1_100,
          type: 'tool_call',
          data: { toolName: 'view_file', toolCallId: 'c1', args: { path: 'README.md' } },
        },
        {
          ts: 1_200,
          type: 'tool_result',
          data: { toolName: 'view_file', toolCallId: 'c1', success: true, durationMs: 12 },
        },
        {
          ts: 2_000,
          type: 'tool_call',
          data: { toolName: 'bash', toolCallId: 'c2', args: { command: 'echo hi' } },
        },
        {
          ts: 2_400,
          type: 'tool_result',
          data: { toolName: 'bash', toolCallId: 'c2', success: true, durationMs: 80 },
        },
        {
          ts: 3_000,
          type: 'patch_applied',
          data: { filesApplied: ['src/hello.ts'] },
        },
      ],
      auditEntries: [
        {
          timestamp: '1970-01-01T00:00:02.000Z',
          action: 'confirmation_granted',
          decision: 'allow',
          target: 'bash',
          details: 'execute',
          source: 'gate:session',
        },
      ],
      timelineEntries: [
        {
          turn: 1,
          ts: '1970-01-01T00:00:01.000Z',
          toolCalls: [{ name: 'view_file', ok: true }, { name: 'bash', ok: true }],
          filesTouched: ['src/hello.ts'],
        },
      ],
      sessionTurns: [
        {
          timestamp: '1970-01-01T00:00:01.100Z',
          inputTokens: 100,
          outputTokens: 20,
          costUsd: 0,
        },
      ],
      ruleRuns: [],
      missing: [],
    });

    expect(trajectory.schemaVersion).toBe(1);
    expect(trajectory.kind).toBe('run_trajectory');
    expect(trajectory.turns).toHaveLength(1);
    expect(trajectory.turns[0]?.tools.map((tool) => tool.name)).toEqual(['view_file', 'bash']);
    expect(trajectory.turns[0]?.tools[0]?.effect).toBe('read');
    expect(trajectory.turns[0]?.tools[1]?.effect).toBe('emission');
    expect(trajectory.turns[0]?.permissions).toEqual([
      expect.objectContaining({ action: 'granted', target: 'bash' }),
    ]);
    expect(trajectory.summary.emissionPct).toBe(50);
    expect(trajectory.summary.pointsOfNoReturn[0]?.tool).toBe('bash');
    expect(trajectory.summary.totals.cacheTokens).toEqual(unlogged(
      'non journalisé: tokens cache agrégés',
    ));
    const text = renderTrajectory(trajectory);
    expect(text).toContain('effect=emission');
    expect(text).toContain('non journalisé');
    expect(text).not.toMatch(/\/home\/[a-z]/);
  });

  it('keeps permission keys as unlogged when the audit source is omitted', () => {
    const trajectory = buildTrajectory({
      runId: 'run_no_audit',
      generatedAt: '2026-09-06T00:00:00.000Z',
      summary: {
        objective: 'read only',
        status: 'completed',
        startedAt: 1_000,
        endedAt: 2_000,
      },
      events: [
        { ts: 1_100, type: 'tool_call', data: { toolName: 'view_file', toolCallId: 'c1' } },
        { ts: 1_150, type: 'tool_result', data: { toolName: 'view_file', toolCallId: 'c1', success: true, durationMs: 5 } },
      ],
    });
    expect(trajectory.turns[0]?.permissions).toEqual(expect.objectContaining({
      journaled: false,
    }));
    expect(JSON.stringify(trajectory)).toContain('non journalisé');
    expect(trajectory.unlogged.some((item) => item.includes('audit'))).toBe(true);
  });

  it('honours --since by dropping earlier tool calls', () => {
    const trajectory = buildTrajectory({
      runId: 'run_since',
      since: 2_000,
      generatedAt: '2026-09-06T00:00:00.000Z',
      summary: {
        objective: 'windowed',
        status: 'completed',
        startedAt: 1_000,
        endedAt: 4_000,
      },
      events: [
        { ts: 1_100, type: 'tool_call', data: { toolName: 'view_file', toolCallId: 'old' } },
        { ts: 1_200, type: 'tool_result', data: { toolName: 'view_file', toolCallId: 'old', success: true, durationMs: 1 } },
        { ts: 2_500, type: 'tool_call', data: { toolName: 'stock_quote', toolCallId: 'new' } },
        { ts: 2_800, type: 'tool_result', data: { toolName: 'stock_quote', toolCallId: 'new', success: true, durationMs: 10 } },
      ],
      auditEntries: [],
      timelineEntries: null,
      sessionTurns: null,
      ruleRuns: [],
    });
    expect(trajectory.turns[0]?.tools.map((tool) => tool.name)).toEqual(['stock_quote']);
    expect(trajectory.turns[0]?.tools[0]?.effect).toBe('emission');
  });
});

describe('buddy run trajectory CLI', () => {
  beforeEach(() => {
    fs.mkdirSync(QA_TMP, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(QA_TMP, 'run-traj-'));
    store = new RunStore(tempDir);
    activeRunIds = [];
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // already ended
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    consoleLogSpy.mockRestore();
    store.dispose();
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('prints versioned JSON for an existing run', async () => {
    const runId = store.startRun('say hello', { sessionId: 'session_cli' });
    activeRunIds.push(runId);
    store.emit(runId, {
      type: 'tool_call',
      data: { toolName: 'view_file', toolCallId: 'c1', args: { path: 'README.md' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { toolName: 'view_file', toolCallId: 'c1', success: true, durationMs: 8 },
    });
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);
    await program.parseAsync(['node', 'test', 'run', 'trajectory', '--json', runId]);

    const output = JSON.parse(getLogOutput()) as {
      schemaVersion: number;
      kind: string;
      runId: string;
      turns: Array<{ tools: Array<{ name: string; effect: string }> }>;
      unlogged: string[];
    };
    expect(output.schemaVersion).toBe(1);
    expect(output.kind).toBe('run_trajectory');
    expect(output.runId).toBe(runId);
    expect(output.turns[0]?.tools[0]).toEqual(expect.objectContaining({
      name: 'view_file',
      effect: 'read',
    }));
    expect(output.unlogged.length).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toMatch(/\/home\/[a-z]/);
  });
});
