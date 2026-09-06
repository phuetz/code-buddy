import { afterEach, describe, expect, it, vi } from 'vitest';

const clientCtor = vi.fn();

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    constructor(apiKey: string, model?: string, baseURL?: string) {
      clientCtor(apiKey, model, baseURL);
    }
  },
}));

describe('TreeOfThoughtReasoner model default', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.GROK_MODEL;
  });

  it('uses GROK_MODEL instead of hard-coding grok-3-latest', async () => {
    process.env.GROK_MODEL = 'qwen3.8:27b';
    const { TreeOfThoughtReasoner } = await import('../../src/agent/reasoning/tree-of-thought.js');
    new TreeOfThoughtReasoner('test-key');
    expect(clientCtor).toHaveBeenCalledWith('test-key', 'qwen3.8:27b', undefined);
  });
});
