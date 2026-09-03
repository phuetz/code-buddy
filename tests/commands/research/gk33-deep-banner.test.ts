/**
 * GK33 — `buddy research --deep` must not advertise itself as Wide Research.
 *
 * Live 2026-09-03: `--deep --iterations 2` printed
 *   🔬 Wide Research: "hystérésis d'un VAD"
 *   Items: 5 | Concurrency: 5 | Overall timeout: 5 min
 * then ran the Deep pipeline. That header is the Wide path leaking into Deep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runDeepResearchCli: vi.fn(async () => undefined),
  resolveProvider: vi.fn(() => ({
    apiKey: 'ollama',
    model: 'qwen3:4b-instruct',
    baseURL: 'http://127.0.0.1:11434/v1',
    providerLabel: 'ollama',
  })),
}));

vi.mock('../../../src/commands/llm-provider-resolution.js', () => ({
  resolveCommandProvider: mocks.resolveProvider,
}));

vi.mock('../../../src/commands/research/deep.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/commands/research/deep.js')>(
    '../../../src/commands/research/deep.js',
  );
  return {
    ...actual,
    runDeepResearchCli: mocks.runDeepResearchCli,
  };
});

vi.mock('../../../src/agent/deep-research-ckg.js', () => ({
  resolveCkgEnabled: vi.fn(() => false),
}));

import { createResearchCommand } from '../../../src/commands/research/index.js';

async function run(...args: string[]): Promise<{ logs: string[] }> {
  const logs: string[] = [];
  const command = createResearchCommand();
  command.exitOverride();
  const logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
    logs.push(String(value ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await command.parseAsync(['node', 'research', ...args]);
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { logs };
}

describe('GK33 — Deep Research CLI banner', () => {
  beforeEach(() => {
    mocks.runDeepResearchCli.mockClear();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('does not print the Wide Research header when --deep is set', async () => {
    const { logs } = await run('--deep', '--iterations', '2', 'hystérésis d\'un VAD');
    const out = logs.join('\n');
    expect(mocks.runDeepResearchCli).toHaveBeenCalledTimes(1);
    expect(out).not.toMatch(/Wide Research/);
    expect(out).not.toMatch(/Items:\s*5/);
    expect(out).toMatch(/Deep Research/);
  });

  it('does not print the Wide Research header when --storm is set', async () => {
    const { logs } = await run('--storm', '--perspectives', '3', 'hystérésis d\'un VAD');
    const out = logs.join('\n');
    expect(mocks.runDeepResearchCli).toHaveBeenCalledTimes(1);
    expect(out).not.toMatch(/Wide Research/);
    expect(out).toMatch(/Deep Research|STORM/i);
  });
});
