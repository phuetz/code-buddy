import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(), read: vi.fn(), stream: vi.fn(), dispose: vi.fn(),
  profile: { detectedAt: '2026-09-30', languages: ['JavaScript'], packageManager: 'npm' as const, commands: { test: 'npm test' }, directories: {}, conventions: {}, contextPack: 'Entry point: index.js', entryPoints: ['index.js', 'index.js'] },
}));
vi.mock('../../../src/agent/repo-profiler.js', () => ({ getRepoProfiler: () => ({ inspect: async () => mocks.profile }) }));
vi.mock('../../../src/commands/llm-provider-resolution.js', () => ({ resolveCommandProvider: () => ({ apiKey: 'ollama', model: 'fixture-model', providerLabel: 'ollama' }) }));
vi.mock('../../../src/agent/codebuddy-agent.js', () => ({ CodeBuddyAgent: class {
  systemPromptReady = Promise.resolve();
  getClient() { return { chat: mocks.chat, getCurrentModel: () => 'fixture-model', getProviderName: () => 'ollama' }; }
  executeToolByName = mocks.read;
  processUserMessageStream = mocks.stream;
  dispose = mocks.dispose;
} }));
vi.mock('../../../src/skills/registry.js', () => ({ resetSkillRegistry: vi.fn() }));
vi.mock('../../../src/mcp/mcp-client.js', () => ({ resetMCPClient: vi.fn() }));
vi.mock('../../../src/observability/run-store.js', () => ({ getActiveRunStore: () => undefined }));
import { registerDevCommands } from '../../../src/commands/dev/index.js';
import { collectOrientationContext } from '../../../src/commands/dev/orientation-context.js';

describe('dev explain bounded orientation', () => {
  let root: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), 'dev-explain-bounded-'));
    await writeFile(join(root, 'package.json'), '{"main":"index.js"}');
    await writeFile(join(root, 'README.md'), 'A real project');
    await writeFile(join(root, 'index.js'), 'export const value = 1;');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.chat.mockResolvedValue({ choices: [{ message: { content: 'Observed index.js.' } }] });
    mocks.read.mockResolvedValue({ success: true, output: '1: Observed file content' });
    mocks.stream.mockImplementation(async function* () {
      for (let i = 0; i < 20; i++) yield { type: 'content', content: 'view_file loop' };
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); process.exitCode = 0; await rm(root, { recursive: true, force: true }); });
  const run = async () => { const program = new Command(); registerDevCommands(program); await program.parseAsync(['dev', 'explain'], { from: 'user' }); };
  it.each([1, 2, 3, 4, 5])('makes one synthesis with no autonomous read loop, replay %i', async () => {
    await run();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.chat.mock.calls[0]?.[1]).toEqual([]);
    const paths = mocks.read.mock.calls.map(call => call[1].path);
    expect(paths.length).toBeLessThanOrEqual(6);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it('grounds declared test commands in the running Node features without executing project tests', async () => {
    await run();
    const messages = mocks.chat.mock.calls[0]?.[0];
    expect(messages[1].content).toContain(`Node.js ${process.versions.node}`);
    expect(messages[1].content).toContain('node --test is supported by this CLI runtime');
    expect(messages[0].content).toContain('Never call a declared command invalid or unsupported merely because it was not executed');
    expect(mocks.read.mock.calls.every(call => call[0] === 'view_file')).toBe(true);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('explains that npm script invocations expand to the package script body rather than conflict with it', async () => {
    await run();
    const text = mocks.chat.mock.calls[0]?.[0][1].content;
    expect(text).toContain('npm run <script> invokes package.json scripts[<script>]');
    expect(text).toContain('invocation and script body are not competing commands');
    expect(text).toContain('commandInvocations');
    expect(mocks.read.mock.calls.every(call => call[0] === 'view_file')).toBe(true);
  });

  it('bounds dense Unicode and code by bytes, not a chars/4 guess', async () => {
    mocks.read.mockResolvedValue({ success: true, output: '漢🙂'.repeat(10000) });
    const context = await collectOrientationContext(root, mocks.profile, 2000, mocks.read, 2);
    expect(context.files).toHaveLength(2);
    expect(Buffer.byteLength(context.text)).toBeLessThanOrEqual(2000);
    expect(context.notices.join(' ')).toContain('truncated');
  });
  it('reports an empty synthesis honestly and disposes the agent', async () => {
    mocks.chat.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    await run();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Orientation incomplete'));
    expect(mocks.dispose).toHaveBeenCalled();
  });
});
