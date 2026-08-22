import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerInsightsCommands } from '../../src/commands/cli/insights-command.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetToolAnalytics } from '../../src/analytics/tool-analytics.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempDir: string;
let store: RunStore;

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

describe('Insights CLI commands', () => {
  beforeEach(() => {
    // Isolate RunStore activity to an empty temp dir so tests don't read real runs.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-cli-'));
    store = new RunStore(tempDir);
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    // Force-empty tool analytics so the snapshot is deterministic.
    resetToolAnalytics();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    exitSpy.mockRestore();
    store.dispose();
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
    resetToolAnalytics();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('registers the insights command and its subcommands', () => {
    const program = createProgram();
    registerInsightsCommands(program);

    const insights = program.commands.find((c) => c.name() === 'insights');
    expect(insights).toBeDefined();
    const subNames = insights!.commands.map((c) => c.name()).sort();
    expect(subNames).toEqual(['cost', 'summary', 'tools']);
  });

  it('produces parsable JSON for the summary view', async () => {
    const program = createProgram();
    registerInsightsCommands(program);

    await program.parseAsync(['node', 'test', 'insights', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      schemaVersion: number;
      generatedAt: string;
      cost: { totalCost: number; sessionTokens: { input: number; output: number } };
      tools: { totalExecutions: number; uniqueTools: number };
      activity: { totalRuns: number; recentRuns: unknown[] };
    };

    expect(output.schemaVersion).toBe(1);
    expect(new Date(output.generatedAt).toString()).not.toBe('Invalid Date');
    // Structure / types, not exact zeros (cost history may exist on the host).
    expect(typeof output.cost.totalCost).toBe('number');
    expect(typeof output.cost.sessionTokens.input).toBe('number');
    expect(typeof output.tools.totalExecutions).toBe('number');
    // RunStore is isolated to an empty temp dir, so activity is provably empty.
    expect(output.activity.totalRuns).toBe(0);
    expect(output.activity.recentRuns).toEqual([]);
  });

  it('produces parsable JSON for the cost subcommand', async () => {
    const program = createProgram();
    registerInsightsCommands(program);

    await program.parseAsync(['node', 'test', 'insights', 'cost', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      schemaVersion: number;
      cost: { sessionCost: number; modelBreakdown: Record<string, unknown> };
    };

    expect(output.schemaVersion).toBe(1);
    expect(typeof output.cost.sessionCost).toBe('number');
    expect(typeof output.cost.modelBreakdown).toBe('object');
  });

  it('produces parsable JSON for the tools subcommand', async () => {
    const program = createProgram();
    registerInsightsCommands(program);

    await program.parseAsync(['node', 'test', 'insights', 'tools', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      schemaVersion: number;
      tools: { mostUsedTools: unknown[]; overallSuccessRate: number };
    };

    expect(output.schemaVersion).toBe(1);
    expect(Array.isArray(output.tools.mostUsedTools)).toBe(true);
    expect(typeof output.tools.overallSuccessRate).toBe('number');
  });

  it('renders human-readable output without crashing on empty data', async () => {
    const program = createProgram();
    registerInsightsCommands(program);

    await program.parseAsync(['node', 'test', 'insights']);

    const output = getLogOutput();
    expect(output).toContain('Code Buddy Insights');
    expect(output).toContain('Cost & Tokens');
    expect(output).toContain('Tool Usage');
    expect(output).toContain('Agent Activity');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not crash and emits valid JSON when run activity exists', async () => {
    const runId = store.startRun('Insights activity proof', { channel: 'cli' });
    store.endRun(runId, 'completed');

    const program = createProgram();
    registerInsightsCommands(program);

    await program.parseAsync(['node', 'test', 'insights', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      activity: { totalRuns: number; byStatus: Record<string, number> };
    };

    expect(output.activity.totalRuns).toBe(1);
    expect(output.activity.byStatus.completed).toBe(1);
  });
});
