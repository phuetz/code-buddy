import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import { GeminiNativeProvider } from '../../../src/codebuddy/providers/provider-gemini-native.js';

function createProvider(): GeminiNativeProvider {
  return new GeminiNativeProvider({
    apiKey: 'test-key',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    defaultMaxTokens: 8192,
    geminiRequestTimeoutMs: 60_000,
  });
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'continue' }];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeminiNativeProvider cancellation', () => {
  it('propagates caller cancellation to a non-streaming fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    });
    const controller = new AbortController();
    const request = createProvider().chat(messages, [], { signal: controller.signal });
    await Promise.resolve();

    const startedAt = Date.now();
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - startedAt).toBeLessThan(100);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.signal?.aborted).toBe(true);
  });

  it('cancels a stalled SSE reader without falling back to another request', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start() { /* intentionally idle */ },
      cancel,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    const controller = new AbortController();
    const generator = createProvider().chatStream(messages, [], { signal: controller.signal });
    const pending = generator.next();
    await Promise.resolve();
    await Promise.resolve();

    const startedAt = Date.now();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
