/**
 * peer.chat-stream tests — Phase (d).19.
 *
 * Validates the streaming wire path:
 *   - dispatcher forwards `emitChunk` from ctx
 *   - peer.chat-stream method on the bridge calls emitChunk per delta
 *     and returns the aggregated text in the final response
 *   - falls back gracefully when no LLM client is wired
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerPeerMethod,
  unregisterPeerMethod,
  dispatchPeerRequest,
  listPeerMethods,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import {
  wirePeerChatBridge,
  _unwireForTests,
  isPeerChatBridgeWired,
} from '../../src/fleet/peer-chat-bridge.js';

/** Minimal client mock that yields the configured chunks then ends. */
function makeStreamingClient(chunks: string[], usage?: unknown, finishReason = 'stop'): {
  chatStream: (msgs: unknown, tools: unknown, opts?: unknown) => AsyncGenerator<unknown, void, unknown>;
} {
  return {
    async *chatStream() {
      for (const c of chunks) {
        yield { choices: [{ delta: { content: c } }] };
      }
      yield { choices: [{ delta: {}, finish_reason: finishReason }], usage };
    },
  };
}

const baseCtx = (overrides: Partial<PeerMethodContext> = {}): PeerMethodContext => ({
  connectionId: 'test-conn',
  scopes: ['peer:invoke'],
  traceId: '',
  depth: 0,
  ...overrides,
});

describe('peer-rpc dispatcher — emitChunk forwarding', () => {
  beforeEach(() => {
    _unwireForTests();
  });

  afterEach(() => {
    _unwireForTests();
    try {
      unregisterPeerMethod('test.streaming');
    } catch {
      /* ignore */
    }
  });

  it('passes ctx.emitChunk through to the handler', async () => {
    const received: string[] = [];
    registerPeerMethod('test.streaming', async (_params, ctx) => {
      ctx.emitChunk?.('hello ');
      ctx.emitChunk?.('world');
      return { ok: true };
    });

    const emitted: string[] = [];
    const response = await dispatchPeerRequest(
      { id: 'req-1', method: 'test.streaming', params: {} },
      baseCtx({ emitChunk: (delta) => emitted.push(delta) }),
    );
    received.push(...emitted);

    expect(response.ok).toBe(true);
    expect(emitted).toEqual(['hello ', 'world']);
  });

  it('handler without emitChunk usage still works (chunks are optional)', async () => {
    registerPeerMethod('test.streaming', async () => ({ ok: true }));
    const emitted: string[] = [];
    const response = await dispatchPeerRequest(
      { id: 'req-2', method: 'test.streaming', params: {} },
      baseCtx({ emitChunk: (delta) => emitted.push(delta) }),
    );
    expect(response.ok).toBe(true);
    expect(emitted).toEqual([]);
  });
});

describe('peer.chat-stream method', () => {
  beforeEach(() => {
    _unwireForTests();
  });
  afterEach(() => {
    _unwireForTests();
  });

  it('registers both peer.chat and peer.chat-stream when wired', () => {
    expect(isPeerChatBridgeWired()).toBe(false);
    wirePeerChatBridge(() => null);
    expect(isPeerChatBridgeWired()).toBe(true);
    const methods = listPeerMethods();
    expect(methods).toContain('peer.chat');
    expect(methods).toContain('peer.chat-stream');
  });

  it('emits per-chunk deltas + returns aggregated text in final response', async () => {
    const fakeClient = makeStreamingClient(['Hel', 'lo, ', 'world!'], {
      total_tokens: 7,
      prompt_tokens: 2,
      completion_tokens: 5,
    });
    wirePeerChatBridge(() => fakeClient as never);

    const emitted: string[] = [];
    const response = await dispatchPeerRequest(
      { id: 'req-3', method: 'peer.chat-stream', params: { prompt: 'say hi' } },
      baseCtx({ emitChunk: (delta) => emitted.push(delta) }),
    );

    expect(response.ok).toBe(true);
    expect(emitted).toEqual(['Hel', 'lo, ', 'world!']);
    const payload = response.payload as { text: string; usage?: { total_tokens?: number }; finishReason?: string };
    expect(payload.text).toBe('Hello, world!');
    expect(payload.finishReason).toBe('stop');
    expect(payload.usage?.total_tokens).toBe(7);
  });

  it('returns CLIENT_UNAVAILABLE when no client is wired', async () => {
    wirePeerChatBridge(() => null);
    const response = await dispatchPeerRequest(
      { id: 'req-4', method: 'peer.chat-stream', params: { prompt: 'hi' } },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('CLIENT_UNAVAILABLE');
  });

  it('rejects empty prompt', async () => {
    const fakeClient = makeStreamingClient(['x']);
    wirePeerChatBridge(() => fakeClient as never);
    const response = await dispatchPeerRequest(
      { id: 'req-5', method: 'peer.chat-stream', params: {} },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('prompt is required');
  });

  it('works WITHOUT a streaming transport — aggregates locally and returns full text', async () => {
    const fakeClient = makeStreamingClient(['hi', ' there']);
    wirePeerChatBridge(() => fakeClient as never);
    // No emitChunk on ctx — simulates a transport that doesn't support streaming
    const response = await dispatchPeerRequest(
      { id: 'req-6', method: 'peer.chat-stream', params: { prompt: 'say hi' } },
      baseCtx(),
    );
    expect(response.ok).toBe(true);
    const payload = response.payload as { text: string };
    expect(payload.text).toBe('hi there');
  });

  it('fails when the stream completes without content', async () => {
    const fakeClient = makeStreamingClient([]);
    wirePeerChatBridge(() => fakeClient as never);
    const response = await dispatchPeerRequest(
      { id: 'req-empty-stream', method: 'peer.chat-stream', params: { prompt: 'say hi' } },
      baseCtx({ emitChunk: () => undefined }),
    );

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('LLM returned empty content');
  });

  it('echoes traceId in the response payload', async () => {
    const fakeClient = makeStreamingClient(['ok']);
    wirePeerChatBridge(() => fakeClient as never);
    const response = await dispatchPeerRequest(
      { id: 'req-7', method: 'peer.chat-stream', params: { prompt: 'q' }, traceId: 'tr-xyz' },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(response.ok).toBe(true);
    const payload = response.payload as { traceId?: string };
    expect(payload.traceId).toBe('tr-xyz');
  });

  it('honours model override in params', async () => {
    let capturedOpts: unknown = null;
    const fakeClient = {
      async *chatStream(_msgs: unknown, _tools: unknown, opts?: unknown) {
        capturedOpts = opts;
        yield { choices: [{ delta: { content: 'hi' } }] };
      },
    };
    wirePeerChatBridge(() => fakeClient as never);
    await dispatchPeerRequest(
      { id: 'req-8', method: 'peer.chat-stream', params: { prompt: 'q', model: 'grok-3' } },
      baseCtx(),
    );
    expect(capturedOpts).toMatchObject({ model: 'grok-3' });
  });
});
