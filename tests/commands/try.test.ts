import { describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../src/agent/types.js';
import {
  NO_TRY_PROVIDER_MESSAGE,
  TRY_DEMO_PROMPT,
  chooseOllamaModel,
  resolveTryProvider,
  runTryDemo,
  type TryProvider,
} from '../../src/commands/try.js';

const chatGptProvider: TryProvider = {
  kind: 'chatgpt',
  label: 'ChatGPT OAuth',
  apiKey: 'oauth-chatgpt',
  baseURL: 'https://chatgpt.com/backend-api/codex',
  model: 'gpt-5.6-sol',
};

describe('buddy try', () => {
  it('prefers a coding-oriented Ollama model while honoring an installed request', () => {
    const models = ['llama3.2:latest', 'qwen2.5-coder:7b', 'devstral:latest'];

    expect(chooseOllamaModel(models)).toBe('qwen2.5-coder:7b');
    expect(chooseOllamaModel(models, 'devstral:latest')).toBe('devstral:latest');
    expect(chooseOllamaModel([])).toBeNull();
  });

  it('uses ChatGPT OAuth before probing Ollama', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const provider = await resolveTryProvider({
      env: {},
      hasChatGptCredentials: () => true,
      fetchImpl,
    });

    expect(provider).toMatchObject(chatGptProvider);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('probes localhost and selects an installed Ollama model as the fallback', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      models: [{ name: 'llama3.2:latest' }, { name: 'qwen3-coder:30b' }],
    }), { status: 200 }));

    const provider = await resolveTryProvider({
      env: {},
      hasChatGptCredentials: () => false,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(provider).toMatchObject({
      kind: 'ollama',
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3-coder:30b',
    });
  });

  it('explains login first and Ollama second when neither free provider is ready', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const createAgent = vi.fn();

    const exitCode = await runTryDemo({
      resolveProvider: async () => null,
      createAgent,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([NO_TRY_PROVIDER_MESSAGE]);
    expect(stderr[0]!.indexOf('buddy login')).toBeLessThan(stderr[0]!.indexOf('Ollama'));
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('runs the scripted agent in an isolated workspace and verifies its test', async () => {
    const stdout: string[] = [];
    const dispose = vi.fn();
    const entries: ChatEntry[] = [
      {
        type: 'tool_call',
        content: 'write',
        timestamp: new Date(),
        toolCall: {
          id: 'call_1',
          type: 'function',
          function: { name: 'write_file', arguments: '{}' },
        },
      },
      {
        type: 'assistant',
        content: 'Two files created, tests green.',
        timestamp: new Date(),
      },
    ];
    const processUserMessage = vi.fn(async () => entries);
    const createAgent = vi.fn(async () => ({
      systemPromptReady: Promise.resolve(),
      processUserMessage,
      dispose,
    }));
    const verify = vi.fn(async () => ({ success: true, output: '# pass 4\n# fail 0' }));

    const exitCode = await runTryDemo({
      resolveProvider: async () => chatGptProvider,
      createWorkspace: async () => '/tmp/code-buddy-try-test',
      createAgent,
      verify,
      stdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(0);
    expect(createAgent).toHaveBeenCalledWith(chatGptProvider, '/tmp/code-buddy-try-test');
    expect(processUserMessage).toHaveBeenCalledWith(TRY_DEMO_PROMPT, { surface: 'cli' });
    expect(verify).toHaveBeenCalledWith('/tmp/code-buddy-try-test');
    expect(stdout.join('\n')).toContain('Tools used: write_file');
    expect(stdout.join('\n')).toContain('✅ Demo succeeded');
    expect(dispose).toHaveBeenCalledWith({ skipSessionLearning: true });
  });
});
