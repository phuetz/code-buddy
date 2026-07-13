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
  getDispatchState,
  type PeerChatClientGetter,
} from '../../src/fleet/peer-chat-bridge.js';
import {
  dispatchPeerRequest,
  listPeerMethods,
  _resetPeerRpcForTests,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import { _resetFleetLoadForTests } from '../../src/fleet/fleet-load.js';

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

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

// ---- tests -----------------------------------------------------------

describe('peer-chat-bridge — Phase (d).15', () => {
  beforeEach(() => {
    _unwireForTests();
    _resetPeerRpcForTests();
    _resetFleetLoadForTests();
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
    it('rejects chat, stream, and dispatch with SATURATED while capacity is full', async () => {
      const previousCapacity = process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY;
      process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY = '1';
      let release: (() => void) | undefined;
      const chat = vi.fn(() => new Promise((resolve) => {
        release = () => resolve({
          choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        });
      }));
      wirePeerChatBridge(() => ({ chat } as never));

      try {
        const inFlight = dispatchPeerRequest(
          { id: 'saturation-holder', method: 'peer.chat', params: { prompt: 'hold' } },
          baseCtx,
        );
        await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce());

        for (const [method, params] of [
          ['peer.chat', { prompt: 'second' }],
          ['peer.chat-stream', { prompt: 'stream' }],
          ['peer.dispatch', { id: 'saturated-dispatch', prompt: 'dispatch' }],
        ] as const) {
          const response = await dispatchPeerRequest(
            { id: `blocked-${method}`, method, params },
            baseCtx,
          );
          expect(response).toMatchObject({
            ok: false,
            error: { code: 'SATURATED' },
          });
        }

        expect(getDispatchState('saturated-dispatch')).toBeNull();
        release?.();
        await expect(inFlight).resolves.toMatchObject({ ok: true });
      } finally {
        if (previousCapacity === undefined) {
          delete process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY;
        } else {
          process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY = previousCapacity;
        }
        _resetFleetLoadForTests();
      }
    });

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

    it('rejects unknown dispatchProfile values before calling the client', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const r = await dispatchPeerRequest(
        {
          id: 'p4-profile',
          method: 'peer.chat',
          params: { prompt: 'q', dispatchProfile: 'chaos' },
        },
        baseCtx,
      );

      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('dispatchProfile must be one of');
      expect(chat).not.toHaveBeenCalled();
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

    it('appends dispatchProfile policy guidance to explicit systemPrompt', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      await dispatchPeerRequest(
        {
          id: 'p6-profile-prompt',
          method: 'peer.chat',
          params: {
            prompt: 'Q',
            systemPrompt: 'You are a pirate. Answer in shanties.',
            dispatchProfile: 'safe',
          },
        },
        baseCtx,
      );

      const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
      expect(messages[0].content).toContain('You are a pirate. Answer in shanties.');
      expect(messages[0].content).toContain('protect secrets');
      expect(messages[0].content).toContain('Tool policy hint:');
    });

    it('dispatchProfile applies profile guidance and returns policy metadata', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const r = await dispatchPeerRequest(
        {
          id: 'p6-profile',
          method: 'peer.chat',
          params: { prompt: 'Review this patch', dispatchProfile: 'review' },
        },
        baseCtx,
      );

      expect(r.ok).toBe(true);
      const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
      expect(messages[0].content).toContain('Prioritize defects');
      expect(messages[0].content).toContain('Tool policy hint:');

      const payload = r.payload as {
        dispatchProfile?: string;
        toolPolicy?: { policyProfile?: string; defaultAction?: string };
        toolDecisions?: Array<{ tool: string; action: string }>;
        toolset?: { toolsetId: string; deniedTools: string[] };
      };
      expect(payload.dispatchProfile).toBe('review');
      expect(payload.toolPolicy).toMatchObject({
        policyProfile: 'minimal',
        defaultAction: 'confirm',
      });
      expect(payload.toolDecisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: 'view_file', action: 'allow' }),
          expect.objectContaining({ tool: 'create_file', action: 'deny' }),
          expect.objectContaining({ tool: 'bash', action: 'deny' }),
        ]),
      );
      expect(payload.toolset?.toolsetId).toBe('fleet.hermes.review');
      expect(payload.toolset?.deniedTools).toEqual(
        expect.arrayContaining(['create_file', 'bash']),
      );
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

  describe('peer.dispatch — profile metadata', () => {
    it('rejects unknown dispatchProfile values before queuing a dispatch', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const accepted = await dispatchPeerRequest(
        {
          id: 'dispatch-invalid-profile',
          method: 'peer.dispatch',
          params: {
            id: 'run-invalid-profile',
            prompt: 'Review this patch',
            dispatchProfile: 'chaos',
          },
        },
        baseCtx,
      );

      expect(accepted.ok).toBe(false);
      expect(accepted.error?.message).toContain('dispatchProfile must be one of');
      expect(getDispatchState('run-invalid-profile')).toBeNull();
      expect(chat).not.toHaveBeenCalled();
    });

    it('stores dispatchProfile and applies profile-specific system guidance', async () => {
      const { client, chat } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const accepted = await dispatchPeerRequest(
        {
          id: 'dispatch-1',
          method: 'peer.dispatch',
          params: {
            id: 'run-review',
            prompt: 'Review this patch',
            model: 'm-review',
            dispatchProfile: 'review',
            traceId: 'trace-child',
            parentRunId: 'parent-run',
          },
        },
        baseCtx,
      );

      expect(accepted.ok).toBe(true);
      await waitFor(() => getDispatchState('run-review')?.status === 'completed');

      const state = getDispatchState('run-review');
      expect(state).toMatchObject({
        runId: 'run-review',
        prompt: 'Review this patch',
        model: 'm-review',
        dispatchProfile: 'review',
        toolPolicy: expect.objectContaining({
          policyProfile: 'minimal',
          denyGroups: expect.arrayContaining(['group:fs:write', 'group:runtime']),
        }),
        toolDecisions: expect.arrayContaining([
          expect.objectContaining({ tool: 'view_file', action: 'allow' }),
          expect.objectContaining({ tool: 'create_file', action: 'deny' }),
          expect.objectContaining({ tool: 'bash', action: 'deny' }),
        ]),
        traceId: 'trace-child',
        parentRunId: 'parent-run',
        status: 'completed',
      });

      const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
      expect(messages[0].content).toContain('Prioritize defects');
      expect(messages[0].content).toContain('Tool policy hint:');
      expect(chat.mock.calls[0][2]).toEqual({ model: 'm-review' });

      const status = await dispatchPeerRequest(
        {
          id: 'dispatch-status-1',
          method: 'peer.dispatchStatus',
          params: { runId: 'run-review' },
        },
        baseCtx,
      );
      expect(status.ok).toBe(true);
      expect(status.payload).toMatchObject({
        found: true,
        runId: 'run-review',
        status: 'completed',
        dispatchProfile: 'review',
        toolPolicy: expect.objectContaining({
          policyProfile: 'minimal',
        }),
        toolDecisions: expect.arrayContaining([
          expect.objectContaining({ tool: 'create_file', action: 'deny' }),
        ]),
        result: 'mocked answer',
      });
    });

    it('returns accepted dispatch policy metadata and preserves frame traceId', async () => {
      const { client } = makeMockClient();
      wirePeerChatBridge(() => client as never);

      const accepted = await dispatchPeerRequest(
        {
          id: 'dispatch-safe-accepted',
          method: 'peer.dispatch',
          traceId: 'trace-from-frame',
          params: {
            id: 'run-safe-accepted',
            prompt: 'Inspect this risky change',
            dispatchProfile: 'safe',
          },
        },
        baseCtx,
      );

      expect(accepted.ok).toBe(true);
      expect(accepted.payload).toMatchObject({
        runId: 'run-safe-accepted',
        traceId: 'trace-from-frame',
        dispatchProfile: 'safe',
        toolPolicy: expect.objectContaining({
          policyProfile: 'minimal',
          defaultAction: 'deny',
        }),
        toolDecisions: expect.arrayContaining([
          expect.objectContaining({ tool: 'view_file', action: 'allow' }),
          expect.objectContaining({ tool: 'create_file', action: 'deny' }),
          expect.objectContaining({ tool: 'bash', action: 'deny' }),
        ]),
        toolset: expect.objectContaining({
          toolsetId: 'fleet.hermes.safe',
          deniedTools: expect.arrayContaining(['create_file', 'bash', 'git_push']),
        }),
      });

      await waitFor(() => getDispatchState('run-safe-accepted')?.status === 'completed');
      expect(getDispatchState('run-safe-accepted')?.traceId).toBe('trace-from-frame');
    });
  });
});
