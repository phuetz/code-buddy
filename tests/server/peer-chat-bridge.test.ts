/**
 * Phase (d).15 V0.4.1 — peer.chat bridge tests.
 *
 * Validates wire/unwire idempotency, the prompt validation, the
 * CLIENT_UNAVAILABLE path when getClient returns null, the happy path
 * with a mocked CodeBuddyClient, systemPrompt + model overrides, and
 * traceId echo from the call ctx.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  wirePeerChatBridge,
  unwirePeerChatBridge,
  isPeerChatBridgeWired,
  _unwireForTests,
  type PeerChatClientGetter,
} from '../../src/fleet/peer-chat-bridge.js';
import {
  dispatchPeerRequest,
  listPeerMethods,
  _resetPeerRpcForTests,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';

// ---- helpers ---------------------------------------------------------

function makeMockClient(chatImpl?: typeof vi.fn): {
  client: { chat: ReturnType<typeof vi.fn> };
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = chatImpl ? (chatImpl as unknown as ReturnType<typeof vi.fn>) : vi.fn(async () => ({
    choices: [{ message: { role: 'assistant', content: 'mocked answer' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
  const client = { chat };
  return { client, chat };
}

const baseCtx: PeerMethodContext = {
  connectionId: 'ws_test',
  scopes: ['peer:invoke'],
  traceId: 'trace-test-abc',
  depth: 0,
};

async function waitForDispatch(
  runId: string,
  status: 'completed' | 'failed',
) {
  for (let i = 0; i < 20; i++) {
    const r = await dispatchPeerRequest(
      { id: `poll-${i}`, method: 'peer.dispatchStatus', params: { runId } },
      baseCtx,
    );
    const payload = r.payload as { status?: string } | undefined;
    if (r.ok && payload?.status === status) return r;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`dispatch ${runId} did not reach ${status}`);
}

// ---- tests -----------------------------------------------------------

describe('peer-chat-bridge — Phase (d).15', () => {
  beforeEach(() => {
    _unwireForTests();
    _resetPeerRpcForTests();
  });

  describe('wire / unwire', () => {
    it('wire registers peer.chat on the registry', () => {
      expect(listPeerMethods()).not.toContain('peer.chat');
      wirePeerChatBridge(() => null);
      expect(listPeerMethods()).toContain('peer.chat');
      expect(isPeerChatBridgeWired()).toBe(true);
    });

    it('wire is idempotent (second call is a no-op, single registration)', () => {
      wirePeerChatBridge(() => null);
      wirePeerChatBridge(() => null);
      const count = listPeerMethods().filter((m) => m === 'peer.chat').length;
      expect(count).toBe(1);
    });

    it('unwire removes peer.chat from the registry', () => {
      wirePeerChatBridge(() => null);
      unwirePeerChatBridge();
      expect(listPeerMethods()).not.toContain('peer.chat');
      expect(isPeerChatBridgeWired()).toBe(false);
    });
  });

  describe('peer.chat — error paths', () => {
    it('METHOD_ERROR when prompt is missing or empty', async () => {
      wirePeerChatBridge(() => null);
      const r1 = await dispatchPeerRequest(
        { id: 'p1', method: 'peer.chat', params: {} },
        baseCtx,
      );
      expect(r1.ok).toBe(false);
      expect(r1.error?.code).toBe('METHOD_ERROR');
      expect(r1.error?.message).toContain('prompt is required');

      const r2 = await dispatchPeerRequest(
        { id: 'p2', method: 'peer.chat', params: { prompt: '' } },
        baseCtx,
      );
      expect(r2.ok).toBe(false);
      expect(r2.error?.message).toContain('prompt is required');
    });

    it('METHOD_ERROR with CLIENT_UNAVAILABLE when getClient returns null', async () => {
      wirePeerChatBridge(() => null);
      const r = await dispatchPeerRequest(
        { id: 'p3', method: 'peer.chat', params: { prompt: 'hi' } },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('CLIENT_UNAVAILABLE');
    });

    it('propagates an underlying client.chat throw as METHOD_ERROR', async () => {
      const chat = vi.fn(async () => {
        throw new Error('upstream rate-limited');
      });
      const client = { chat };
      wirePeerChatBridge(() => client as never);
      const r = await dispatchPeerRequest(
        { id: 'p4', method: 'peer.chat', params: { prompt: 'q' } },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('upstream rate-limited');
    });
  });

  describe('peer.chat — happy paths', () => {
    it('default systemPrompt + no model: calls client.chat with sane defaults, returns text + finishReason + usage + traceId', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      // Pass traceId on the FRAME (not the ctx — the dispatcher resolves
      // trace from the frame, treating ctx as a placeholder. See (d).14.)
      const r = await dispatchPeerRequest(
        {
          id: 'p5',
          method: 'peer.chat',
          params: { prompt: 'What is CORS?' },
          traceId: 'trace-test-abc',
        },
        baseCtx,
      );

      expect(r.ok).toBe(true);
      expect(chat).toHaveBeenCalledOnce();
      // Check messages shape (1st arg)
      const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('briefly');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('What is CORS?');
      // No tools (2nd arg is undefined), no chat options (3rd arg is undefined)
      expect(chat.mock.calls[0][1]).toBeUndefined();
      expect(chat.mock.calls[0][2]).toBeUndefined();
      // Response payload
      const payload = r.payload as {
        text: string;
        modelRequested?: string;
        finishReason?: string;
        usage?: { total_tokens: number };
        traceId: string;
      };
      expect(payload.text).toBe('mocked answer');
      expect(payload.modelRequested).toBeUndefined();
      expect(payload.finishReason).toBe('stop');
      expect(payload.usage?.total_tokens).toBe(15);
      // Trace echoed from ctx
      expect(payload.traceId).toBe('trace-test-abc');
    });

    it('explicit systemPrompt overrides the default (first message uses the custom one)', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      await dispatchPeerRequest(
        {
          id: 'p6',
          method: 'peer.chat',
          params: { prompt: 'Q', systemPrompt: 'You are a pirate. Answer in shanties.' },
        },
        baseCtx,
      );

      const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
      expect(messages[0].content).toBe('You are a pirate. Answer in shanties.');
    });

    it('model option propagates as ChatOptions.model and is echoed in modelRequested', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const r = await dispatchPeerRequest(
        {
          id: 'p7',
          method: 'peer.chat',
          params: { prompt: 'Q', model: 'grok-3-mini-fast' },
        },
        baseCtx,
      );

      const chatOptions = chat.mock.calls[0][2] as { model: string } | undefined;
      expect(chatOptions).toEqual({ model: 'grok-3-mini-fast' });
      const payload = r.payload as { modelRequested: string };
      expect(payload.modelRequested).toBe('grok-3-mini-fast');
    });

    it('returns empty text when the LLM response has no content (defensive)', async () => {
      const chat = vi.fn(async () => ({
        choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'length' }],
      }));
      wirePeerChatBridge(() => ({ chat } as unknown as ReturnType<PeerChatClientGetter>));

      const r = await dispatchPeerRequest(
        { id: 'p8', method: 'peer.chat', params: { prompt: 'Q' } },
        baseCtx,
      );

      expect(r.ok).toBe(true);
      const payload = r.payload as { text: string; finishReason: string };
      expect(payload.text).toBe('');
      expect(payload.finishReason).toBe('length');
    });
  });

  describe('integration with peer.describe (Phase (d).14 → d.16)', () => {
    it('after wire, peer.chat appears in peer.describe.methods', async () => {
      wirePeerChatBridge(() => null);
      const r = await dispatchPeerRequest(
        { id: 'd1', method: 'peer.describe' },
        baseCtx,
      );
      const payload = r.payload as { methods: string[]; peerChatProvider: unknown };
      expect(payload.methods).toContain('peer.chat');
      // No providerInfo passed → field is null
      expect(payload.peerChatProvider).toBeNull();
    });

    it('Phase (d).16a — providerInfo passed to wire is exposed via peer.describe.peerChatProvider', async () => {
      wirePeerChatBridge(() => null, {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        isLocal: false,
      });
      const r = await dispatchPeerRequest(
        { id: 'd2', method: 'peer.describe' },
        baseCtx,
      );
      const payload = r.payload as {
        peerChatProvider: { provider: string; model: string; isLocal: boolean } | null;
      };
      expect(payload.peerChatProvider).toEqual({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        isLocal: false,
      });
    });
  });

  describe('peer.dispatch lifecycle', () => {
    it('queues a background run, exposes status, then clears the cache entry', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const accepted = await dispatchPeerRequest(
        {
          id: 'disp-accept',
          method: 'peer.dispatch',
          params: {
            id: 'run-test-1',
            prompt: 'Summarise the fleet state',
            model: 'grok-3-mini-fast',
          },
          traceId: 'trace-dispatch-test',
        },
        baseCtx,
      );

      expect(accepted.ok).toBe(true);
      expect(accepted.payload).toMatchObject({ runId: 'run-test-1' });

      const completed = await waitForDispatch('run-test-1', 'completed');
      expect(chat).toHaveBeenCalledOnce();
      const payload = completed.payload as {
        status: string;
        result: string;
        runId: string;
        traceId: string;
      };
      expect(payload).toMatchObject({
        runId: 'run-test-1',
        status: 'completed',
        result: 'mocked answer',
        traceId: 'trace-dispatch-test',
      });

      const cleared = await dispatchPeerRequest(
        { id: 'clear-1', method: 'peer.dispatchClear', params: { runId: 'run-test-1' } },
        baseCtx,
      );
      expect(cleared.ok).toBe(true);
      expect(cleared.payload).toEqual({ runId: 'run-test-1', cleared: true });

      const afterClear = await dispatchPeerRequest(
        { id: 'poll-after-clear', method: 'peer.dispatchStatus', params: { runId: 'run-test-1' } },
        baseCtx,
      );
      expect(afterClear.payload).toEqual({ found: false });
    });
  });
});
