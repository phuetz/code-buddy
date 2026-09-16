/**
 * Tests for the Gemini CLI subprocess provider.
 *
 * The `child_process.spawn` import is mocked so each test feeds the
 * provider deterministic stdout/stderr/exit-code without ever touching
 * the real `gemini` binary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Hoisted mock state — accessible inside vi.mock factory.
const state = vi.hoisted(() => {
  return {
    spawnCalls: [] as Array<{ command: string; args: string[] }>,
    spawnedChildren: [] as Array<{
      killed: boolean;
      kill: ReturnType<typeof vi.fn>;
    }>,
    nextRun: {
      stdout: '',
      stderr: '',
      exitCode: 0 as number | null,
      killExitCode: null as number | null,
      streamLines: [] as string[],
      delayMs: 0,
    },
  };
});

vi.mock('node:child_process', async () => {
  return {
    spawn: vi.fn((command: string, args: string[]) => {
      state.spawnCalls.push({ command, args });

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: (sig?: string) => boolean;
        killed: boolean;
        exitCode: number | null;
      };
      child.stdout = stdout;
      child.stderr = stderr;
      child.killed = false;
      child.exitCode = null;
      let completionTimer: ReturnType<typeof setTimeout> | undefined;
      child.kill = vi.fn((_sig?: string) => {
        child.killed = true;
        if (completionTimer) clearTimeout(completionTimer);
        setImmediate(() => {
          stdout.end();
          stderr.end();
          child.exitCode = state.nextRun.killExitCode;
          child.emit('close', state.nextRun.killExitCode);
        });
        return true;
      });
      state.spawnedChildren.push(child);

      // Defer until after the provider has wired up listeners.
      completionTimer = setTimeout(() => {
        if (state.nextRun.stderr) stderr.write(state.nextRun.stderr);
        stderr.end();

        if (state.nextRun.streamLines.length > 0) {
          for (const line of state.nextRun.streamLines) {
            stdout.write(line + '\n');
          }
        } else if (state.nextRun.stdout) {
          stdout.write(state.nextRun.stdout);
        }
        stdout.end();

        // Wait one more tick so the readable side flushes 'end' before close.
        setImmediate(() => {
          child.exitCode = state.nextRun.exitCode;
          child.emit('close', state.nextRun.exitCode);
        });
      }, state.nextRun.delayMs);
      completionTimer.unref?.();

      return child;
    }),
  };
});

import { GeminiCliProvider, formatMessagesForCli } from '../../../src/codebuddy/providers/provider-gemini-cli.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

beforeEach(() => {
  state.spawnCalls.length = 0;
  state.spawnedChildren.length = 0;
  state.nextRun = {
    stdout: '',
    stderr: '',
    exitCode: 0,
    killExitCode: null,
    streamLines: [],
    delayMs: 0,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('formatMessagesForCli', () => {
  it('serialises a system + user pair with role headers', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello' },
    ];
    const out = formatMessagesForCli(messages);
    expect(out).toContain('# System');
    expect(out).toContain('Be concise.');
    expect(out).toContain('# User');
    expect(out).toContain('Hello');
  });

  it('handles assistant turns', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    const out = formatMessagesForCli(messages);
    expect(out).toMatch(/# User\nq1.*# Assistant\na1.*# User\nq2/s);
  });

  it('skips empty messages defensively', () => {
    const messages = [
      { role: 'user', content: '' },
      { role: 'user', content: 'real' },
    ] as CodeBuddyMessage[];
    const out = formatMessagesForCli(messages);
    expect(out).toBe('# User\nreal');
  });
});

describe('GeminiCliProvider — chat() (non-streaming)', () => {
  it('spawns gemini with the documented headless flags', async () => {
    state.nextRun.stdout = JSON.stringify({
      response: 'hello world',
      stats: { input: 4, output: 2 },
    });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const result = await provider.chat([{ role: 'user', content: 'hi' }]);

    expect(state.spawnCalls).toHaveLength(1);
    const call = state.spawnCalls[0];
    expect(call.command).toBe('/fake/gemini');
    expect(call.args).toContain('-p');
    expect(call.args).toContain('-m');
    expect(call.args).toContain('gemini-2.5-pro');
    expect(call.args).toContain('-o');
    expect(call.args).toContain('json');
    expect(call.args).toContain('--approval-mode');
    expect(call.args).toContain('plan');
    expect(result.choices[0].message.content).toBe('hello world');
    expect(result.usage?.prompt_tokens).toBe(4);
    expect(result.usage?.completion_tokens).toBe(2);
  });

  it('per-call ChatOptions.model overrides the default', async () => {
    state.nextRun.stdout = JSON.stringify({ response: 'ok' });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    await provider.chat([{ role: 'user', content: 'x' }], undefined, { model: 'gemini-2.5-flash' });
    expect(state.spawnCalls[0].args).toContain('gemini-2.5-flash');
    expect(state.spawnCalls[0].args).not.toContain('gemini-2.5-pro');
  });

  it('throws TURN_LIMIT_EXCEEDED on exit code 53', async () => {
    state.nextRun.exitCode = 53;
    state.nextRun.stderr = 'Turn limit reached.';
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/TURN_LIMIT_EXCEEDED/);
  });

  it('throws INPUT_ERROR on exit code 42', async () => {
    state.nextRun.exitCode = 42;
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/INPUT_ERROR/);
  });

  it('throws API_FAILURE on exit code 1', async () => {
    state.nextRun.exitCode = 1;
    state.nextRun.stderr = 'quota exceeded';
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/API_FAILURE/);
  });

  it('throws when stdout is not valid JSON', async () => {
    state.nextRun.stdout = 'not json at all';
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/invalid JSON/);
  });

  it('throws when the JSON envelope carries an error field', async () => {
    state.nextRun.stdout = JSON.stringify({ error: { message: 'oh no' } });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/oh no/);
  });

  it('handles missing stats gracefully (usage undefined)', async () => {
    state.nextRun.stdout = JSON.stringify({ response: 'plain' });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const result = await provider.chat([{ role: 'user', content: 'x' }]);
    expect(result.choices[0].message.content).toBe('plain');
    expect(result.usage).toBeUndefined();
  });

  it('does not spawn when the caller signal is already aborted', async () => {
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });

    await expect(provider.chat(
      [{ role: 'user', content: 'x' }],
      undefined,
      { signal: AbortSignal.abort() },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.spawnCalls).toHaveLength(0);
  });

  it('kills a running child and removes the abort listener', async () => {
    state.nextRun.delayMs = 60_000;
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const pending = provider.chat(
      [{ role: 'user', content: 'x' }],
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(state.spawnedChildren).toHaveLength(1));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.spawnedChildren[0]?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects a timeout even when the killed process closes with code 0', async () => {
    state.nextRun.delayMs = 60_000;
    state.nextRun.killExitCode = 0;
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
      requestTimeoutMs: 5,
    });

    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/timeout after 5ms/);
  });

  it('rejects stdout truncation even when the killed process closes with code 0', async () => {
    state.nextRun.stdout = 'x'.repeat(10 * 1024 * 1024 + 1);
    state.nextRun.killExitCode = 0;
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });

    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/stdout exceeded/);
  });

  it('parses the nested stats.models[name].tokens shape (Gemini 3 era)', async () => {
    // Real gemini-cli >= v0.11 emits stats nested per model.
    state.nextRun.stdout = JSON.stringify({
      response: 'hi',
      stats: {
        models: {
          'gemini-3.1-pro-preview': {
            tokens: { input: 9340, candidates: 35, total: 9583, thoughts: 208 },
          },
        },
      },
    });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-3-pro-preview',
      defaultMaxTokens: 1024,
    });
    const result = await provider.chat([{ role: 'user', content: 'x' }]);
    expect(result.usage?.prompt_tokens).toBe(9340);
    expect(result.usage?.completion_tokens).toBe(35);
    expect(result.usage?.total_tokens).toBe(9375);
  });

  it('sums tokens across multiple models in stats.models (sub-agents)', async () => {
    state.nextRun.stdout = JSON.stringify({
      response: 'ok',
      stats: {
        models: {
          'gemini-3.1-pro-preview': { tokens: { input: 100, candidates: 20 } },
          'gemini-2.5-flash': { tokens: { input: 50, candidates: 10 } },
        },
      },
    });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-3-pro-preview',
      defaultMaxTokens: 1024,
    });
    const result = await provider.chat([{ role: 'user', content: 'x' }]);
    expect(result.usage?.prompt_tokens).toBe(150);
    expect(result.usage?.completion_tokens).toBe(30);
  });
});

describe('GeminiCliProvider — chatStream() (JSONL events)', () => {
  it('yields chunks for each "message" event and a finish chunk on "result"', async () => {
    state.nextRun.streamLines = [
      JSON.stringify({ type: 'init', sessionId: 'abc' }),
      JSON.stringify({ type: 'message', role: 'assistant', delta: 'hello ' }),
      JSON.stringify({ type: 'message', role: 'assistant', delta: 'world' }),
      JSON.stringify({ type: 'result', stats: { input: 5, output: 2 } }),
    ];
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const chunks: string[] = [];
    let finishSeen = false;
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      const delta = chunk.choices[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) chunks.push(delta);
      if (chunk.choices[0]?.finish_reason === 'stop') finishSeen = true;
    }
    expect(chunks.join('')).toBe('hello world');
    expect(finishSeen).toBe(true);
    expect(state.spawnCalls[0].args).toContain('stream-json');
  });

  it('ignores tool_use / tool_result events in v1', async () => {
    state.nextRun.streamLines = [
      JSON.stringify({ type: 'tool_use', name: 'search', args: { q: 'x' }, id: 't1' }),
      JSON.stringify({ type: 'tool_result', id: 't1', content: 'res' }),
      JSON.stringify({ type: 'message', role: 'assistant', delta: 'final' }),
      JSON.stringify({ type: 'result', stats: {} }),
    ];
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const chunks: string[] = [];
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'q' }])) {
      const delta = chunk.choices[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) chunks.push(delta);
    }
    // Only the message event produced content — tool events were no-ops.
    expect(chunks.join('')).toBe('final');
  });

  it('throws on non-zero exit code at end of stream', async () => {
    state.nextRun.streamLines = [
      JSON.stringify({ type: 'message', role: 'assistant', delta: 'partial' }),
    ];
    state.nextRun.exitCode = 1;
    state.nextRun.stderr = 'rate limited';
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const drain = async () => {
      for await (const _ of provider.chatStream([{ role: 'user', content: 'x' }])) {
        /* consume */
      }
    };
    await expect(drain()).rejects.toThrow(/API_FAILURE/);
  });

  it('propagates a stream error event instead of emitting a successful stop', async () => {
    state.nextRun.streamLines = [
      JSON.stringify({ type: 'error', error: { message: 'quota exceeded' } }),
      JSON.stringify({ type: 'result' }),
    ];
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const finishReasons: Array<string | null> = [];
    const drain = async (): Promise<void> => {
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'x' }])) {
        finishReasons.push(chunk.choices[0]?.finish_reason ?? null);
      }
    };

    await expect(drain()).rejects.toThrow(/quota exceeded/);
    expect(finishReasons).not.toContain('stop');
  });

  it('kills the streaming child and rejects instead of waiting for output', async () => {
    state.nextRun.delayMs = 60_000;
    const controller = new AbortController();
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    const drain = async (): Promise<void> => {
      for await (const _chunk of provider.chatStream(
        [{ role: 'user', content: 'x' }],
        undefined,
        { signal: controller.signal },
      )) {
        // The child deliberately never writes before cancellation.
      }
    };
    const pending = drain();
    await vi.waitFor(() => expect(state.spawnedChildren).toHaveLength(1));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.spawnedChildren[0]?.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('GeminiCliProvider — model + provider name', () => {
  it('setModel updates the active model', async () => {
    state.nextRun.stdout = JSON.stringify({ response: 'ok' });
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    provider.setModel('gemini-2.5-flash');
    await provider.chat([{ role: 'user', content: 'x' }]);
    expect(state.spawnCalls[0].args).toContain('gemini-2.5-flash');
  });

  it('getProviderName reports gemini-cli', () => {
    const provider = new GeminiCliProvider({
      binaryPath: '/fake/gemini',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    });
    expect(provider.getProviderName()).toBe('gemini-cli');
  });

  it('constructor throws when binaryPath is empty', () => {
    expect(() => new GeminiCliProvider({
      binaryPath: '',
      model: 'gemini-2.5-pro',
      defaultMaxTokens: 1024,
    })).toThrow(/binaryPath is required/);
  });
});
