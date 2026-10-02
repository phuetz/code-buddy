import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeBuddyClient, type ChatOptions } from '@/codebuddy/client.js';
import type { ChatCompletionChunk } from 'openai/resources/chat';

/**
 * Tests for `CodeBuddyClient.chatStream` opt-in mid-stream retry wirage.
 *
 * The `withStreamRetry` helper itself is fully covered by
 * `tests/codebuddy/stream-retry.test.ts` — these tests focus only on:
 * - opt-in resolution (env var vs per-call vs default off)
 * - that the dispatcher correctly wraps its provider via a factory
 *   the helper can re-invoke
 * - that errors propagate as before when retry is off (backward compat)
 *
 * Strategy: instantiate a real CodeBuddyClient with an OpenAI-compat
 * baseURL (no Gemini), then overwrite its private `openaiCompatProvider`
 * with a fake whose `chatStream` is a controllable generator factory.
 */
describe('CodeBuddyClient.chatStream — withStreamRetry opt-in wirage', () => {
  type ProviderLike = {
    chatStream: (...args: unknown[]) => AsyncGenerator<ChatCompletionChunk, void, unknown>;
  };

  function buildClient(provider: ProviderLike): CodeBuddyClient {
    const client = new CodeBuddyClient('test-api-key', 'grok-3', 'https://api.x.ai/v1');
    // Inject the fake provider, replacing whatever the constructor wired up.
    (client as unknown as { openaiCompatProvider: ProviderLike; geminiProvider: null }).openaiCompatProvider = provider;
    (client as unknown as { geminiProvider: null }).geminiProvider = null;
    return client;
  }

  function chunk(content: string): ChatCompletionChunk {
    return {
      id: 'test-id',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'grok-3',
      choices: [
        { index: 0, delta: { content }, finish_reason: null },
      ],
    } as unknown as ChatCompletionChunk;
  }

  function networkError(): Error {
    const err = new Error('socket reset') as Error & { code?: string };
    err.code = 'ECONNRESET';
    return err;
  }

  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.CODEBUDDY_STREAM_RETRY;
    delete process.env.CODEBUDDY_STREAM_RETRY;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CODEBUDDY_STREAM_RETRY;
    else process.env.CODEBUDDY_STREAM_RETRY = originalEnv;
    vi.useRealTimers();
  });

  it('default (no opt-in): network error propagates immediately, no retry', async () => {
    let calls = 0;
    const provider: ProviderLike = {
      chatStream: async function* () {
        calls++;
        yield chunk('a');
        throw networkError();
      },
    };
    const client = buildClient(provider);

    const collected: string[] = [];
    await expect(async () => {
      for await (const c of client.chatStream([{ role: 'user', content: 'hi' }])) {
        collected.push(c.choices[0].delta.content ?? '');
      }
    }).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(calls).toBe(1);
    expect(collected).toEqual(['a']);
  });

  it('per-call opts.streamRetry=true: stops after a partial response with the original cause', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provider: ProviderLike = {
      chatStream: async function* () {
        calls++;
        if (calls === 1) {
          yield chunk('partial');
          throw networkError();
        }
        yield chunk('full');
      },
    };
    const client = buildClient(provider);

    const collected: string[] = [];
    const promise = (async () => {
      for await (const c of client.chatStream(
        [{ role: 'user', content: 'hi' }],
        undefined,
        { streamRetry: true } as ChatOptions,
      )) {
        collected.push(c.choices[0].delta.content ?? '');
      }
    })();
    const rejection = expect(promise).rejects.toMatchObject({ code: 'PARTIAL_STREAM', cause: expect.objectContaining({ code: 'ECONNRESET' }) });
    await vi.runAllTimersAsync();
    await rejection;

    expect(calls).toBe(1);
    // The rendered prefix is retained; a second response never gets appended.
    expect(collected).toEqual(['partial']);
  });

  it('env var CODEBUDDY_STREAM_RETRY=1: retries on ECONNRESET then succeeds', async () => {
    vi.useFakeTimers();
    process.env.CODEBUDDY_STREAM_RETRY = '1';
    let calls = 0;
    const provider: ProviderLike = {
      chatStream: async function* () {
        calls++;
        if (calls === 1) throw networkError();
        yield chunk('ok');
      },
    };
    const client = buildClient(provider);

    const collected: string[] = [];
    const promise = (async () => {
      for await (const c of client.chatStream([{ role: 'user', content: 'hi' }])) {
        collected.push(c.choices[0].delta.content ?? '');
      }
    })();
    await vi.runAllTimersAsync();
    await promise;

    expect(calls).toBe(2);
    expect(collected).toEqual(['ok']);
  });

  it('per-call streamRetry=false overrides env var (forces no retry)', async () => {
    process.env.CODEBUDDY_STREAM_RETRY = '1';
    let calls = 0;
    const provider: ProviderLike = {
      chatStream: async function* () {
        calls++;
        throw networkError();
        // eslint-disable-next-line no-unreachable
        yield chunk('x');
      },
    };
    const client = buildClient(provider);

    await expect(async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hi' }],
        undefined,
        { streamRetry: false } as ChatOptions,
      )) {
        // drain
      }
    }).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(calls).toBe(1);
  });

  it('granular override streamRetry={maxAttempts:2}: exhausts after 2 attempts', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provider: ProviderLike = {
      chatStream: async function* () {
        calls++;
        throw networkError();
        // eslint-disable-next-line no-unreachable
        yield chunk('x');
      },
    };
    const client = buildClient(provider);

    const promise = (async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hi' }],
        undefined,
        { streamRetry: { maxAttempts: 2, initialDelayMs: 10 } } as ChatOptions,
      )) {
        // drain
      }
    })();
    const expectation = expect(promise).rejects.toMatchObject({ code: 'ECONNRESET' });
    await vi.runAllTimersAsync();
    await expectation;

    expect(calls).toBe(2);
  });

  it('non-retryable error (auth) propagates immediately even with retry on', async () => {
    let calls = 0;
    const provider: ProviderLike = {
      chatStream: async function* () {
        calls++;
        throw new Error('Invalid API key');
        // eslint-disable-next-line no-unreachable
        yield chunk('x');
      },
    };
    const client = buildClient(provider);

    await expect(async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hi' }],
        undefined,
        { streamRetry: true } as ChatOptions,
      )) {
        // drain
      }
    }).rejects.toThrow('Invalid API key');

    expect(calls).toBe(1);
  });
});
