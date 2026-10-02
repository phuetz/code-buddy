import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getProfile: vi.fn(),
  refresh: vi.fn(),
  agentImports: 0,
}));
vi.mock('../../../src/agent/repo-profiler.js', () => ({
  getRepoProfiler: () => ({ getProfile: state.getProfile, refresh: state.refresh }),
}));
vi.mock('../../../src/commands/llm-provider-resolution.js', () => ({ resolveCommandProvider: () => null }));
vi.mock('../../../src/agent/codebuddy-agent.js', () => {
  state.agentImports++;
  throw new Error('Optional native dependency must not be loaded without a provider');
});
vi.mock('../../../src/utils/logger.js', () => ({ logger: { error: vi.fn(), debug: vi.fn() } }));
import { registerDevCommands } from '../../../src/commands/dev/index.js';
import { logger } from '../../../src/utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.agentImports = 0;
  const profile = { contextPack: 'QA', languages: [], commands: {}, directories: {} };
  state.getProfile.mockResolvedValue(profile);
  state.refresh.mockResolvedValue(profile);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit requested'); });
});
afterEach(() => vi.restoreAllMocks());

describe('dev without a configured provider', () => {
  it.each([['plan', 'QA objective'], ['explain']])('reports prerequisites before importing the agent: %s', async (...args) => {
    const program = new Command();
    registerDevCommands(program);
    await expect(program.parseAsync(['node', 'buddy', 'dev', ...args])).rejects.toThrow('exit requested');
    expect(state.agentImports).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/buddy login.*Ollama/));
    if (args[0] === 'explain') expect(state.refresh).toHaveBeenCalledWith({ backgroundIndexing: false });
  });
});
