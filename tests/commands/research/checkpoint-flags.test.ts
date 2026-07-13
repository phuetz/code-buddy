import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  research: vi.fn(),
  on: vi.fn(),
  ensureWorkerFactory: vi.fn(async () => undefined),
  orchestratorOptions: [] as unknown[],
  resolveProvider: vi.fn(() => ({
    apiKey: 'test-key',
    model: 'test-model',
    baseURL: 'http://127.0.0.1:11434/v1',
    providerLabel: 'test-provider',
  })),
}));

vi.mock('../../../src/agent/wide-research.js', () => ({
  computeWideResearchDefaultOverallTimeoutMs: (input: {
    items: number;
    concurrency: number;
    workerTimeoutMs?: number;
  }) => Math.max(
    300_000,
    Math.ceil(input.items / input.concurrency) * (input.workerTimeoutMs ?? 90_000) + 120_000,
  ),
  WideResearchOrchestrator: class {
    on = mocks.on;
    research = mocks.research;

    constructor(options: unknown) {
      mocks.orchestratorOptions.push(options);
    }
  },
}));

vi.mock('../../../src/commands/llm-provider-resolution.js', () => ({
  resolveCommandProvider: mocks.resolveProvider,
}));

vi.mock('../../../src/commands/research/wire-research-worker.js', () => ({
  ensureResearchWorkerFactory: mocks.ensureWorkerFactory,
}));

vi.mock('../../../src/commands/research/deep.js', () => ({
  maybeRunDeepResearch: vi.fn(async () => false),
  runDeepResearchCli: vi.fn(),
}));

vi.mock('../../../src/agent/deep-research-ckg.js', () => ({
  resolveCkgEnabled: vi.fn(() => false),
}));

import { createResearchCommand } from '../../../src/commands/research/index.js';

const result = {
  topic: 'durable topic',
  subtopics: ['a', 'b'],
  workerResults: [
    { subtopic: 'a', workerIndex: 0, output: 'A', success: true, durationMs: 1 },
    { subtopic: 'b', workerIndex: 1, output: 'B', success: true, durationMs: 1 },
  ],
  report: '# Durable report',
  durationMs: 10,
  successCount: 2,
};
const tempDirs: string[] = [];

async function run(...args: string[]): Promise<{ logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const command = createResearchCommand();
  command.exitOverride();
  const logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
    logs.push(String(value ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((value?: unknown) => {
    errors.push(String(value ?? ''));
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await command.parseAsync(['node', 'research', 'durable topic', ...args]);
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { logs, errors };
}

describe('buddy research checkpoint/resume flags', () => {
  beforeEach(() => {
    mocks.research.mockReset();
    mocks.research.mockResolvedValue(result);
    mocks.on.mockClear();
    mocks.ensureWorkerFactory.mockClear();
    mocks.resolveProvider.mockClear();
    mocks.orchestratorOptions.length = 0;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
    process.exitCode = undefined;
  });

  it('exposes checkpoint, resume and structured JSON options', () => {
    const optionNames = createResearchCommand().options.map((option) => option.long);
    expect(optionNames).toContain('--checkpoint');
    expect(optionNames).toContain('--resume');
    expect(optionNames).toContain('--json');
  });

  it('resolves a checkpoint path, forces Wide Research and emits one JSON document', async () => {
    const { logs, errors } = await run('--checkpoint', './state/research.json', '--json');
    expect(errors).toEqual([]);
    expect(logs).toHaveLength(1);
    const output = JSON.parse(logs[0]!) as {
      kind: string;
      status: string;
      checkpoint: { path: string; mode: string };
      result: { successCount: number };
    };
    const checkpointPath = resolve('./state/research.json');
    expect(output).toMatchObject({
      kind: 'wide_research_run',
      status: 'completed',
      checkpoint: { path: checkpointPath, mode: 'created' },
      result: { successCount: 2 },
    });
    expect(mocks.research).toHaveBeenCalledWith(
      'durable topic',
      'test-key',
      { model: 'test-model', baseURL: 'http://127.0.0.1:11434/v1' },
      { checkpointPath },
    );
    expect(mocks.ensureWorkerFactory).toHaveBeenCalledTimes(1);
  });

  it('passes --resume in place and gives clear human UX', async () => {
    const checkpointPath = resolve('./state/research.json');
    const { logs } = await run('--resume', './state/research.json');
    expect(logs.join('\n')).toContain(`Resume checkpoint: ${checkpointPath}`);
    expect(logs.join('\n')).toContain(`Checkpoint complete: ${checkpointPath}`);
    expect(mocks.research).toHaveBeenCalledWith(
      'durable topic',
      'test-key',
      expect.any(Object),
      { resumePath: checkpointPath },
    );
  });

  it('provides structured JSON without requiring persistence', async () => {
    const { logs } = await run('--json');
    const output = JSON.parse(logs[0]!) as { checkpoint: unknown; status: string };
    expect(output).toMatchObject({ checkpoint: null, status: 'completed' });
    expect(mocks.research).toHaveBeenCalledWith(
      'durable topic',
      'test-key',
      { model: 'test-model', baseURL: 'http://127.0.0.1:11434/v1' },
    );
  });

  it('keeps --workers as a bounded shorthand for items and concurrency', async () => {
    await run('--workers=0', '--rounds=0', '--json');
    expect(mocks.orchestratorOptions.at(-1)).toMatchObject({
      items: 1,
      concurrency: 1,
      maxRoundsPerWorker: 1,
    });

    await run('--workers=99', '--rounds=-8', '--json');
    expect(mocks.orchestratorOptions.at(-1)).toMatchObject({
      items: 20,
      concurrency: 20,
      maxRoundsPerWorker: 1,
    });
  });

  it('accepts 250 total items while capping each parallel wave at 20', async () => {
    await run('--items=999', '--concurrency=99', '--json');
    expect(mocks.orchestratorOptions.at(-1)).toMatchObject({
      items: 250,
      concurrency: 20,
    });

    await run('--items=3', '--concurrency=20', '--json');
    expect(mocks.orchestratorOptions.at(-1)).toMatchObject({
      items: 3,
      concurrency: 3,
    });
  });

  it('auto-scales the default timeout by wave count and respects an explicit override', async () => {
    await run('--items=250', '--concurrency=5', '--json');
    expect(mocks.orchestratorOptions.at(-1)).toEqual(
      expect.objectContaining({ overallTimeoutMs: expect.any(Number) }),
    );
    expect(
      (mocks.orchestratorOptions.at(-1) as { overallTimeoutMs: number }).overallTimeoutMs,
    ).toBeGreaterThan(300_000);

    await run('--items=250', '--concurrency=5', '--timeout-ms=45000', '--json');
    expect(mocks.orchestratorOptions.at(-1)).toMatchObject({ overallTimeoutMs: 45_000 });
  });

  it('emits partial JSON, exit code 1, and scrubs result credential patterns', async () => {
    mocks.research.mockResolvedValueOnce({
      topic: 'durable topic',
      subtopics: ['a', 'b'],
      workerResults: [
        {
          subtopic: 'a',
          workerIndex: 0,
          output: 'test-key Authorization: Bearer cloud-secret',
          success: true,
          durationMs: 1,
        },
        {
          subtopic: 'b',
          workerIndex: 1,
          output: '',
          success: false,
          error: 'OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnop password=hunter2',
          durationMs: 1,
        },
      ],
      report: 'Summary token=visible-token and test-key',
      durationMs: 10,
      successCount: 1,
    });

    const { logs, errors } = await run('--checkpoint', './state/partial.json', '--json');
    expect(errors).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain('test-key');
    expect(logs[0]).not.toContain('cloud-secret');
    expect(logs[0]).not.toContain('abcdefghijklmnop');
    expect(logs[0]).not.toContain('hunter2');
    expect(logs[0]).not.toContain('visible-token');
    expect(JSON.parse(logs[0]!)).toMatchObject({
      status: 'partial',
      summary: { succeeded: 1, failed: 1, total: 2 },
      resumeAvailable: true,
    });
    expect(process.exitCode).toBe(1);
  });

  it('creates nested durable report directories and writes only scrubbed content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wide-research-cli-'));
    tempDirs.push(directory);
    const checkpointPath = join(directory, 'state', 'run.json');
    const reportPath = join(directory, 'reports', 'nested', 'report.md');
    mocks.research.mockResolvedValueOnce({
      ...result,
      report: '# Durable report\n\napi_key=test-key',
    });

    await run('--checkpoint', checkpointPath, '--report', reportPath, '--json');

    const report = await readFile(reportPath, 'utf8');
    expect(report).toContain('Status: completed');
    expect(report).toContain('api_key=[REDACTED]');
    expect(report).not.toContain('test-key');
  });

  it('rejects checkpoint/report collisions before starting research', async () => {
    const file = resolve('./state/shared.json');
    const { logs } = await run('--checkpoint', file, '--report', file, '--json');
    expect(JSON.parse(logs[0]!)).toMatchObject({ status: 'failed' });
    expect(mocks.research).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects ambiguous or unsupported option combinations before provider/network work', async () => {
    const both = await run('--checkpoint', 'a.json', '--resume', 'b.json', '--json');
    expect(JSON.parse(both.logs[0]!)).toMatchObject({ status: 'failed' });
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();

    mocks.resolveProvider.mockClear();
    const deep = await run('--checkpoint', 'a.json', '--deep');
    expect(deep.errors.join('\n')).toContain('Wide Research only');
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it('reports checkpoint failures clearly without mixing human logs into JSON output', async () => {
    mocks.research.mockRejectedValueOnce(
      new Error('Unable to atomically write checkpoint; previous file preserved.'),
    );
    const machine = await run('--checkpoint', 'a.json', '--json');
    expect(machine.logs).toHaveLength(1);
    expect(JSON.parse(machine.logs[0]!)).toMatchObject({
      kind: 'wide_research_run',
      status: 'failed',
      error: expect.stringContaining('previous file preserved'),
    });
    expect(machine.errors).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('keeps the historical three-argument orchestrator call when new options are absent', async () => {
    await run('--wide');
    expect(mocks.research).toHaveBeenCalledWith(
      'durable topic',
      'test-key',
      { model: 'test-model', baseURL: 'http://127.0.0.1:11434/v1' },
    );
  });
});
