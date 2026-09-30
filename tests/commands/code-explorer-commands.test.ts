import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerCodeExplorerCommands } from '../../src/commands/cli/code-explorer-commands.js';

const bridge = vi.hoisted(() => ({ connected: false, dispose: vi.fn(), fail: false }));
vi.mock('../../src/codebuddy/tools.js', () => ({
  initializeMCPServers: async () => { bridge.connected = true; },
  getMCPManager: () => ({ dispose: bridge.dispose }),
}));
vi.mock('../../src/tools/code-explorer-tool.js', () => ({
  CodeExplorerTool: class {
    async ask() {
      if (!bridge.connected) return { notes: 'CodeExplorer is not configured (missing endpoint).' };
      if (bridge.fail) throw new Error('Graph query failed');
      return { notes: 'Definition: fixture.ts:add' };
    }
  },
}));

beforeEach(() => {
  bridge.connected = false;
  bridge.fail = false;
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

function program() {
  const cli = new Command();
  cli.exitOverride();
  registerCodeExplorerCommands(cli);
  return cli;
}

it('queries the configured graph on a cold CLI invocation and closes its transport', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await program().parseAsync(['node', 'buddy', 'code-explorer', 'ask', 'add']);
  expect(output.mock.calls.flat().join('')).toContain('fixture.ts:add');
  expect(bridge.dispose).toHaveBeenCalledOnce();
});

it('closes the transport even when the graph query fails', async () => {
  bridge.fail = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const previous = process.exitCode;
  try {
    await program().parseAsync(['node', 'buddy', 'code-explorer', 'ask', 'add']);
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
  }
});
