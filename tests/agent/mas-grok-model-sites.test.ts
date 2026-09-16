import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const clientCtor = vi.fn();

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    constructor(apiKey: string, model?: string, baseURL?: string) {
      clientCtor(apiKey, model, baseURL);
    }
  },
}));

describe('GROK_MODEL at MAS twin sites', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.GROK_MODEL;
  });

  it('subagent presets and constructors prefer GROK_MODEL over grok-3-latest', async () => {
    process.env.GROK_MODEL = 'qwen3.8:27b';
    const { SubagentManager } = await import('../../src/agent/subagents.js');
    const manager = new SubagentManager('test-key');
    const reviewer = manager.createSubagent('code-reviewer');
    expect(reviewer).not.toBeNull();
    expect(clientCtor).toHaveBeenCalledWith('test-key', 'qwen3.8:27b', undefined);
    clientCtor.mockClear();
    const refactorer = manager.createSubagent('refactorer');
    expect(refactorer).not.toBeNull();
    expect(clientCtor).toHaveBeenCalledWith('test-key', 'qwen3.8:27b', undefined);
    clientCtor.mockClear();
    const documenter = manager.createSubagent('documenter');
    expect(documenter).not.toBeNull();
    expect(clientCtor).toHaveBeenCalledWith('test-key', 'qwen3.8:27b', undefined);
  });

  it('architect-mode, repair-engine and extended-thinking prefer GROK_MODEL', async () => {
    process.env.GROK_MODEL = 'qwen3.8:27b';
    const { ArchitectMode } = await import('../../src/agent/architect-mode.js');
    new ArchitectMode('test-key');
    expect(clientCtor.mock.calls.some((call) => call[1] === 'qwen3.8:27b')).toBe(true);
    clientCtor.mockClear();

    const { RepairEngine } = await import('../../src/agent/repair/repair-engine.js');
    new RepairEngine({}, 'test-key');
    expect(clientCtor).toHaveBeenCalledWith('test-key', 'qwen3.8:27b', undefined);
    clientCtor.mockClear();

    const { ExtendedThinkingEngine } = await import('../../src/agent/thinking/extended-thinking.js');
    new ExtendedThinkingEngine('test-key');
    expect(clientCtor).toHaveBeenCalledWith('test-key', 'qwen3.8:27b', undefined);
  });

  it('code-review and LSP default model prefer GROK_MODEL', () => {
    const review = readFileSync(new URL('../../src/tools/code-review.ts', import.meta.url), 'utf8');
    const lsp = readFileSync(new URL('../../src/lsp/server.ts', import.meta.url), 'utf8');
    expect(review).toContain('process.env.GROK_MODEL');
    expect(lsp).toContain('process.env.GROK_MODEL');
  });

  it('CodeReviewTool constructor prefers GROK_MODEL over grok-3-latest', async () => {
    process.env.GROK_MODEL = 'qwen3.8:27b';
    const { CodeReviewTool } = await import('../../src/tools/code-review.js');
    const tool = new CodeReviewTool();
    (tool as unknown as { ensureClient: () => unknown }).ensureClient();
    expect(clientCtor.mock.calls.some((call) => call[1] === 'qwen3.8:27b')).toBe(true);
  });
});
