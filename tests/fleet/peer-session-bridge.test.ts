/**
 * peer.chat-session.* tests — Phase (d).20 / Fleet V1.2.
 *
 * Validates the multi-turn conversation bridge:
 *   - start opens a session, returns sessionId + expiresAt
 *   - continue accumulates turn-by-turn history and feeds it to the LLM
 *   - end is idempotent
 *   - SESSION_NOT_FOUND / SESSION_EXPIRED / CLIENT_UNAVAILABLE error paths
 *   - concurrent continues serialise FIFO
 *   - opportunistic GC purges idle sessions on the next start/continue
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  dispatchPeerRequest,
  listPeerMethods,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import {
  _listSessionsForTests,
  _unwireForTests,
  isPeerSessionBridgeWired,
  unwirePeerSessionBridge,
  wirePeerSessionBridge,
  type PeerSessionClientResolver,
} from '../../src/fleet/peer-session-bridge.js';
import {
  PeerSessionStore,
  _setPeerSessionStoreForTests,
  resetPeerSessionStore,
} from '../../src/fleet/peer-session-store.js';

// Each test gets its own tmpdir-backed store so disk effects stay
// isolated and the real ~/.codebuddy/ is never touched.
let storeTmpDir: string;

beforeEach(() => {
  storeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-session-bridge-test-'));
  _setPeerSessionStoreForTests(new PeerSessionStore({ storeDir: storeTmpDir }));
});

afterEach(() => {
  resetPeerSessionStore();
  try {
    fs.rmSync(storeTmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// Mock the fleet-bridge broadcast helpers so tests can assert on calls
// without spinning up the WS server. Real broadcastFleetEvent silently
// no-ops when no server is running, so without the mock we'd just be
// asserting on undefined.
vi.mock('../../src/server/websocket/fleet-bridge.js', () => ({
  broadcastChatSessionStart: vi.fn(),
  broadcastChatSessionTurn: vi.fn(),
  broadcastChatSessionEnd: vi.fn(),
  broadcastChatSessionGoal: vi.fn(),
}));

import {
  broadcastChatSessionEnd,
  broadcastChatSessionStart,
  broadcastChatSessionTurn,
} from '../../src/server/websocket/fleet-bridge.js';

beforeEach(() => {
  vi.mocked(broadcastChatSessionStart).mockClear();
  vi.mocked(broadcastChatSessionTurn).mockClear();
  vi.mocked(broadcastChatSessionEnd).mockClear();
});

const baseCtx = (overrides: Partial<PeerMethodContext> = {}): PeerMethodContext => ({
  connectionId: 'test-conn',
  scopes: ['peer:invoke'],
  traceId: '',
  depth: 0,
  ...overrides,
});

interface CapturedCall {
  messages: unknown;
  tools: unknown;
  opts: unknown;
}

/** Minimal client mock — records calls, returns a configurable assistant text. */
function makeClient(responses: string[] | string = 'hello'): {
  client: { chat: (msgs: unknown, tools: unknown, opts?: unknown) => Promise<unknown> };
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let i = 0;
  const list = Array.isArray(responses) ? responses : [responses];
  return {
    calls,
    client: {
      chat: vi.fn(async (messages: unknown, tools: unknown, opts?: unknown) => {
        calls.push({ messages, tools, opts });
        const text = list[Math.min(i, list.length - 1)];
        i++;
        return {
          choices: [
            {
              message: { content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 5, prompt_tokens: 2, completion_tokens: 3 },
        };
      }),
    },
  };
}

async function dispatch(method: string, params: Record<string, unknown>, ctxOverrides: Partial<PeerMethodContext> = {}) {
  return dispatchPeerRequest(
    { id: `req-${Math.random().toString(36).slice(2, 10)}`, method, params, ...(ctxOverrides.traceId ? { traceId: ctxOverrides.traceId } : {}) },
    baseCtx(ctxOverrides),
  );
}

describe('peer-session-bridge — wiring', () => {
  beforeEach(() => {
    _unwireForTests();
  });
  afterEach(() => {
    _unwireForTests();
  });

  it('registers all peer.chat-session.* methods when wired', async () => {
    expect(isPeerSessionBridgeWired()).toBe(false);
    await wirePeerSessionBridge(() => null);
    expect(isPeerSessionBridgeWired()).toBe(true);
    const methods = listPeerMethods();
    expect(methods).toContain('peer.chat-session.start');
    expect(methods).toContain('peer.chat-session.continue');
    expect(methods).toContain('peer.chat-session.continue-stream');
    expect(methods).toContain('peer.chat-session.goal');
    expect(methods).toContain('peer.chat-session.list');
    expect(methods).toContain('peer.chat-session.end');
  });

  it('unregisters every peer.chat-session.* method when unwired', async () => {
    await wirePeerSessionBridge(() => null);

    unwirePeerSessionBridge();

    expect(isPeerSessionBridgeWired()).toBe(false);
    expect(listPeerMethods().filter((method) => method.startsWith('peer.chat-session.'))).toEqual([]);
  });

  it('second wire call is a no-op (idempotent)', async () => {
    const a = makeClient();
    const b = makeClient();
    await wirePeerSessionBridge(() => a.client as never);
    await wirePeerSessionBridge(() => b.client as never);
    expect(isPeerSessionBridgeWired()).toBe(true);
  });
});

describe('peer.chat-session.start', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('returns a sessionId matching /^sess_/ and expiresAt in the future', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const before = Date.now();
    const response = await dispatch('peer.chat-session.start', {});
    expect(response.ok).toBe(true);
    const payload = response.payload as { sessionId: string; expiresAt: number };
    expect(payload.sessionId).toMatch(/^sess_/);
    expect(payload.expiresAt).toBeGreaterThan(before);
  });

  it('echoes traceId in the response payload', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const response = await dispatch('peer.chat-session.start', {}, { traceId: 'trace-xyz' });
    expect(response.ok).toBe(true);
    const payload = response.payload as { traceId: string };
    expect(payload.traceId).toBe('trace-xyz');
  });

  it('pins an explicit provider for every turn, persists it, and reports provenance', async () => {
    const defaultClient = makeClient('wrong backend');
    const lemonadeClient = makeClient('local answer');
    const resolver = vi.fn((provider: string) => provider === 'lemonade'
      ? {
          client: lemonadeClient.client as never,
          info: { provider: 'lemonade' as const, model: 'qwen-local', isLocal: true },
        }
      : null) as PeerSessionClientResolver;
    await wirePeerSessionBridge(
      () => defaultClient.client as never,
      { provider: 'agy-cli', model: 'Gemini 3.1 Pro (High)', isLocal: false },
      resolver,
    );

    const started = await dispatch('peer.chat-session.start', {
      provider: 'lemonade',
      model: 'qwen-local',
    });
    expect(started.ok).toBe(true);
    expect(started.payload).toMatchObject({
      providerRequested: 'lemonade',
      providerResolved: 'lemonade',
    });
    const sessionId = (started.payload as { sessionId: string }).sessionId;

    const continued = await dispatch('peer.chat-session.continue', {
      sessionId,
      prompt: 'bonjour',
    });
    expect(continued.ok).toBe(true);
    expect(continued.payload).toMatchObject({
      text: 'local answer',
      providerRequested: 'lemonade',
      providerResolved: 'lemonade',
    });
    expect(defaultClient.calls).toHaveLength(0);
    expect(lemonadeClient.calls).toHaveLength(1);
    expect(lemonadeClient.calls[0]?.opts).toEqual({ model: 'qwen-local' });

    const listed = await dispatch('peer.chat-session.list', {});
    expect(listed.payload).toMatchObject({
      sessions: [expect.objectContaining({ sessionId, provider: 'lemonade' })],
    });
    expect((await new PeerSessionStore({ storeDir: storeTmpDir }).load(sessionId))?.provider)
      .toBe('lemonade');

    const mismatch = await dispatch('peer.chat-session.continue', {
      sessionId,
      prompt: 'suite',
      provider: 'openrouter',
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error?.message).toContain('does not match session provider');
    expect(lemonadeClient.calls).toHaveLength(1);
  });

  it('fails closed when an explicit provider is unknown or unavailable', async () => {
    await wirePeerSessionBridge(
      () => makeClient().client as never,
      null,
      (() => null) as PeerSessionClientResolver,
    );

    const unknown = await dispatch('peer.chat-session.start', { provider: 'bogus' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.message).toContain('unknown provider');

    const unavailable = await dispatch('peer.chat-session.start', { provider: 'openrouter' });
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error?.message).toContain('PROVIDER_UNAVAILABLE');
  });

  it('rejects unknown dispatchProfile values before creating a session', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const response = await dispatch('peer.chat-session.start', {
      dispatchProfile: 'chaos',
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('dispatchProfile must be one of');
    expect(_listSessionsForTests()).toHaveLength(0);
    expect(fs.readdirSync(storeTmpDir).filter((file) => file.endsWith('.json'))).toHaveLength(0);
    expect(broadcastChatSessionStart).not.toHaveBeenCalled();
  });

  it('applies dispatchProfile guidance and returns policy metadata', async () => {
    const { client, calls } = makeClient('review answer');
    await wirePeerSessionBridge(() => client as never);

    const startRes = await dispatch('peer.chat-session.start', {
      dispatchProfile: 'review',
    });

    expect(startRes.ok).toBe(true);
    const startPayload = startRes.payload as {
      sessionId: string;
      dispatchProfile?: string;
      toolPolicy?: { policyProfile?: string; defaultAction?: string };
      toolDecisions?: Array<{ tool: string; action: string }>;
      toolset?: { toolsetId: string; deniedTools: string[] };
    };
    expect(startPayload.dispatchProfile).toBe('review');
    expect(startPayload.toolPolicy).toMatchObject({
      policyProfile: 'minimal',
      defaultAction: 'confirm',
    });
    expect(startPayload.toolDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'view_file', action: 'allow' }),
        expect.objectContaining({ tool: 'create_file', action: 'deny' }),
        expect.objectContaining({ tool: 'bash', action: 'deny' }),
      ]),
    );
    expect(startPayload.toolset?.toolsetId).toBe('fleet.hermes.review');
    expect(startPayload.toolset?.deniedTools).toEqual(
      expect.arrayContaining(['create_file', 'bash']),
    );

    const continueRes = await dispatch('peer.chat-session.continue', {
      sessionId: startPayload.sessionId,
      prompt: 'Please review this patch',
    });
    const continuePayload = continueRes.payload as {
      dispatchProfile?: string;
      toolPolicy?: { policyProfile?: string; defaultAction?: string };
      toolDecisions?: Array<{ tool: string; action: string }>;
      toolset?: { toolsetId: string; deniedTools: string[] };
    };
    expect(continuePayload.dispatchProfile).toBe('review');
    expect(continuePayload.toolPolicy).toMatchObject({
      policyProfile: 'minimal',
      defaultAction: 'confirm',
    });
    expect(continuePayload.toolDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'view_file', action: 'allow' }),
        expect.objectContaining({ tool: 'create_file', action: 'deny' }),
      ]),
    );
    expect(continuePayload.toolset?.toolsetId).toBe('fleet.hermes.review');

    const sentMessages = calls[0].messages as Array<{ role: string; content: string }>;
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('Prioritize defects');
    expect(sentMessages[0].content).toContain('Tool policy hint:');

    const persisted = JSON.parse(
      fs.readFileSync(path.join(storeTmpDir, `${startPayload.sessionId}.json`), 'utf-8'),
    );
    expect(persisted.dispatchProfile).toBe('review');
    expect(persisted.toolPolicy).toMatchObject({ policyProfile: 'minimal' });

    const listRes = await dispatch('peer.chat-session.list', {});
    const listPayload = listRes.payload as {
      sessions: Array<{ sessionId: string; dispatchProfile?: string }>;
    };
    expect(listPayload.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: startPayload.sessionId,
          dispatchProfile: 'review',
        }),
      ]),
    );
  });

  it('keeps custom systemPrompt while appending dispatchProfile guidance', async () => {
    const { client, calls } = makeClient('safe answer');
    await wirePeerSessionBridge(() => client as never);

    const startRes = await dispatch('peer.chat-session.start', {
      systemPrompt: 'You are a private reviewer.',
      dispatchProfile: 'safe',
    });

    expect(startRes.ok).toBe(true);
    const startPayload = startRes.payload as { sessionId: string; dispatchProfile?: string };
    expect(startPayload.dispatchProfile).toBe('safe');

    await dispatch('peer.chat-session.continue', {
      sessionId: startPayload.sessionId,
      prompt: 'Inspect this change',
    });

    const sentMessages = calls[0].messages as Array<{ role: string; content: string }>;
    expect(sentMessages[0].content).toContain('You are a private reviewer.');
    expect(sentMessages[0].content).toContain('protect secrets');
    expect(sentMessages[0].content).toContain('Tool policy hint:');

    const persisted = JSON.parse(
      fs.readFileSync(path.join(storeTmpDir, `${startPayload.sessionId}.json`), 'utf-8'),
    );
    expect(persisted.systemPrompt).toContain('You are a private reviewer.');
    expect(persisted.systemPrompt).toContain('Tool policy hint:');
  });

  it('GC purges idle sessions on the next start', async () => {
    process.env.CODEBUDDY_PEER_SESSION_IDLE_MS = '50';
    try {
      await wirePeerSessionBridge(() => makeClient().client as never);
      const r1 = await dispatch('peer.chat-session.start', {});
      const session1 = (r1.payload as { sessionId: string }).sessionId;
      expect(_listSessionsForTests().some((s) => s.sessionId === session1)).toBe(true);

      // Wait past the idle window
      await new Promise((resolve) => setTimeout(resolve, 80));

      // A fresh start triggers purgeExpired
      await dispatch('peer.chat-session.start', {});
      const remaining = _listSessionsForTests().map((s) => s.sessionId);
      expect(remaining).not.toContain(session1);
    } finally {
      delete process.env.CODEBUDDY_PEER_SESSION_IDLE_MS;
    }
  });
});

describe('peer.chat-session.continue', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('happy path — accumulates history across two turns', async () => {
    const { client, calls } = makeClient(['Bonjour Patrice', 'Bien sûr, voici le code']);
    await wirePeerSessionBridge(() => client as never);

    const startRes = await dispatch('peer.chat-session.start', { systemPrompt: 'Tu es un assistant FR' });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r1 = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'Salut' });
    expect(r1.ok).toBe(true);
    expect((r1.payload as { text: string }).text).toBe('Bonjour Patrice');

    const r2 = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'Tu peux écrire du Rust ?' });
    expect(r2.ok).toBe(true);
    expect((r2.payload as { text: string }).text).toBe('Bien sûr, voici le code');

    // Second LLM call should have seen system + first turn (user+assistant) + second user
    expect(calls).toHaveLength(2);
    const secondMessages = calls[1].messages as Array<{ role: string; content: string }>;
    expect(secondMessages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(secondMessages[0].content).toBe('Tu es un assistant FR');
    expect(secondMessages[1].content).toBe('Salut');
    expect(secondMessages[2].content).toBe('Bonjour Patrice');
    expect(secondMessages[3].content).toBe('Tu peux écrire du Rust ?');
  });

  it('uses the default system prompt when none is provided at start', async () => {
    const { client, calls } = makeClient();
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'q' });
    const sentMessages = calls[0].messages as Array<{ role: string; content: string }>;
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content.length).toBeGreaterThan(0);
  });

  it('passes the model option to client.chat on every continue', async () => {
    const { client, calls } = makeClient();
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', { model: 'qwen2.5-coder:7b' });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'a' });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'b' });
    expect(calls[0].opts).toMatchObject({ model: 'qwen2.5-coder:7b' });
    expect(calls[1].opts).toMatchObject({ model: 'qwen2.5-coder:7b' });
  });

  it('returns SESSION_NOT_FOUND when sessionId is unknown', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const response = await dispatch('peer.chat-session.continue', {
      sessionId: 'sess_does_not_exist',
      prompt: 'hi',
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('SESSION_NOT_FOUND');
  });

  it('returns SESSION_EXPIRED and purges the entry when idle window elapsed', async () => {
    process.env.CODEBUDDY_PEER_SESSION_IDLE_MS = '50';
    try {
      await wirePeerSessionBridge(() => makeClient().client as never);
      const startRes = await dispatch('peer.chat-session.start', {});
      const sessionId = (startRes.payload as { sessionId: string }).sessionId;

      await new Promise((resolve) => setTimeout(resolve, 80));

      const response = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'hi' });
      expect(response.ok).toBe(false);
      // After idle, GC at the top of continue purges the session, so the
      // visible error becomes SESSION_NOT_FOUND.
      expect(response.error?.message).toMatch(/SESSION_(EXPIRED|NOT_FOUND)/);
      expect(_listSessionsForTests().find((s) => s.sessionId === sessionId)).toBeUndefined();
    } finally {
      delete process.env.CODEBUDDY_PEER_SESSION_IDLE_MS;
    }
  });

  it('returns CLIENT_UNAVAILABLE when no client is wired', async () => {
    await wirePeerSessionBridge(() => null);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    const response = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'hi' });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('CLIENT_UNAVAILABLE');
  });

  it('rejects missing sessionId or prompt', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const r1 = await dispatch('peer.chat-session.continue', { prompt: 'hi' });
    expect(r1.ok).toBe(false);
    expect(r1.error?.message).toContain('sessionId is required');

    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    const r2 = await dispatch('peer.chat-session.continue', { sessionId });
    expect(r2.ok).toBe(false);
    expect(r2.error?.message).toContain('prompt is required');
  });

  it('rejects dispatchProfile changes on continue before calling the client', async () => {
    const { client } = makeClient();
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', { dispatchProfile: 'review' });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const response = await dispatch('peer.chat-session.continue', {
      sessionId,
      prompt: 'please mutate this profile',
      dispatchProfile: 'safe',
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('does not match session profile "review"');
    expect(client.chat).not.toHaveBeenCalled();
    expect(_listSessionsForTests().find((s) => s.sessionId === sessionId)?.messageCount).toBe(0);
  });

  it('rejects dispatchProfile on continue when the session was started without one', async () => {
    const { client } = makeClient();
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const response = await dispatch('peer.chat-session.continue', {
      sessionId,
      prompt: 'add a profile late',
      dispatchProfile: 'review',
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('cannot be set on continue');
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('serialises concurrent continues FIFO', async () => {
    // Hand-rolled client that resolves in a controlled order so we can
    // observe whether messages.push interleaves.
    const calls: Array<{ promptFromHistory: string; resolve: (text: string) => void }> = [];
    const slowClient = {
      chat: (messages: unknown) => {
        const msgs = messages as Array<{ role: string; content: string }>;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        return new Promise((resolve) => {
          calls.push({
            promptFromHistory: lastUser?.content ?? '',
            resolve: (text: string) =>
              resolve({
                choices: [{ message: { content: text }, finish_reason: 'stop' }],
                usage: {},
              }),
          });
        });
      },
    };
    await wirePeerSessionBridge(() => slowClient as never);

    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const p1 = dispatch('peer.chat-session.continue', { sessionId, prompt: 'first' });
    const p2 = dispatch('peer.chat-session.continue', { sessionId, prompt: 'second' });
    const p3 = dispatch('peer.chat-session.continue', { sessionId, prompt: 'third' });

    // Drain calls one at a time and assert ordering.
    while (calls.length === 0) await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(1);
    expect(calls[0].promptFromHistory).toBe('first');
    calls[0].resolve('A1');

    await p1;
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    expect(calls[1].promptFromHistory).toBe('second');
    calls[1].resolve('A2');

    await p2;
    while (calls.length < 3) await new Promise((r) => setTimeout(r, 5));
    expect(calls[2].promptFromHistory).toBe('third');
    calls[2].resolve('A3');

    const r3 = await p3;
    expect((r3.payload as { text: string }).text).toBe('A3');
  });

  it('rolls back the user message when client.chat throws (so retry stays consistent)', async () => {
    let throwOnce = true;
    const client = {
      chat: vi.fn(async () => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('rate limited');
        }
        return {
          choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          usage: {},
        };
      }),
    };
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r1 = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'try' });
    expect(r1.ok).toBe(false);
    expect(r1.error?.message).toContain('rate limited');

    // Snapshot — failed turn must not leave a dangling user message.
    const live = _listSessionsForTests().find((s) => s.sessionId === sessionId);
    expect(live?.messageCount).toBe(0);

    // Retry with the same session — should now succeed.
    const r2 = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'try again' });
    expect(r2.ok).toBe(true);
    expect((r2.payload as { text: string }).text).toBe('recovered');
  });

  it('echoes traceId in continue responses', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    const response = await dispatch(
      'peer.chat-session.continue',
      { sessionId, prompt: 'hi' },
      { traceId: 'trace-abc' },
    );
    expect(response.ok).toBe(true);
    expect((response.payload as { traceId: string }).traceId).toBe('trace-abc');
  });
});

describe('peer.chat-session.end', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('returns { closed: true } the first time, { closed: false } the second', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r1 = await dispatch('peer.chat-session.end', { sessionId });
    expect(r1.ok).toBe(true);
    expect((r1.payload as { closed: boolean }).closed).toBe(true);

    const r2 = await dispatch('peer.chat-session.end', { sessionId });
    expect(r2.ok).toBe(true);
    expect((r2.payload as { closed: boolean }).closed).toBe(false);
  });

  it('rejects missing sessionId', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const response = await dispatch('peer.chat-session.end', {});
    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('sessionId is required');
  });
});

// ──────────────────────────────────────────────────────────────────
// V1.2-saga / Phase d.22 — durabilité + observabilité
// ──────────────────────────────────────────────────────────────────

describe('V1.2-saga — disk persistence', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('start writes a session file to disk', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const startRes = await dispatch('peer.chat-session.start', {
      systemPrompt: 'persist me',
      model: 'qwen3:4b',
    });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const file = path.join(storeTmpDir, `${sessionId}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const record = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(record.sessionId).toBe(sessionId);
    expect(record.systemPrompt).toBe('persist me');
    expect(record.model).toBe('qwen3:4b');
    expect(record.messages).toEqual([]);
  });

  it('continue updates the disk file with the new turn', async () => {
    const { client } = makeClient(['A1', 'A2']);
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'q1' });
    let record = JSON.parse(fs.readFileSync(path.join(storeTmpDir, `${sessionId}.json`), 'utf-8'));
    expect(record.messages).toHaveLength(2);

    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'q2' });
    record = JSON.parse(fs.readFileSync(path.join(storeTmpDir, `${sessionId}.json`), 'utf-8'));
    expect(record.messages).toHaveLength(4);
    expect(record.messages.map((m: { content: string }) => m.content)).toEqual(['q1', 'A1', 'q2', 'A2']);
  });

  it('end deletes the disk file', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    const file = path.join(storeTmpDir, `${sessionId}.json`);
    expect(fs.existsSync(file)).toBe(true);
    await dispatch('peer.chat-session.end', { sessionId });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('hydrates fresh sessions from disk at wire time, drops expired ones', async () => {
    // Pre-populate the disk-backed store with a fresh + an expired session.
    process.env.CODEBUDDY_PEER_SESSION_IDLE_MS = '100';
    try {
      const now = Date.now();
      const fresh = {
        sessionId: 'sess_fresh',
        systemPrompt: 'sys',
        model: 'qwen3:4b',
        messages: [
          { role: 'user' as const, content: 'q1' },
          { role: 'assistant' as const, content: 'a1' },
        ],
        createdAt: now - 50,
        lastUsedAt: now - 50,
      };
      const stale = {
        ...fresh,
        sessionId: 'sess_stale',
        lastUsedAt: now - 10_000,
      };
      fs.writeFileSync(path.join(storeTmpDir, 'sess_fresh.json'), JSON.stringify(fresh));
      fs.writeFileSync(path.join(storeTmpDir, 'sess_stale.json'), JSON.stringify(stale));

      await wirePeerSessionBridge(() => makeClient().client as never);

      const live = _listSessionsForTests().map((s) => s.sessionId);
      expect(live).toContain('sess_fresh');
      expect(live).not.toContain('sess_stale');

      // The stale one should have been purged from disk too.
      expect(fs.existsSync(path.join(storeTmpDir, 'sess_stale.json'))).toBe(false);
    } finally {
      delete process.env.CODEBUDDY_PEER_SESSION_IDLE_MS;
    }
  });

  it('hydrated session can immediately accept a continue (history replayed)', async () => {
    const now = Date.now();
    fs.writeFileSync(
      path.join(storeTmpDir, 'sess_replay.json'),
      JSON.stringify({
        sessionId: 'sess_replay',
        systemPrompt: 'system',
        model: undefined,
        messages: [
          { role: 'user', content: 'historic q' },
          { role: 'assistant', content: 'historic a' },
        ],
        createdAt: now,
        lastUsedAt: now,
      }),
    );

    const { client, calls } = makeClient(['follow up answer']);
    await wirePeerSessionBridge(() => client as never);

    const r = await dispatch('peer.chat-session.continue', {
      sessionId: 'sess_replay',
      prompt: 'follow up q',
    });
    expect(r.ok).toBe(true);

    // The LLM saw system + 2 historic + 1 new user = 4 messages.
    expect(calls).toHaveLength(1);
    const sentMessages = calls[0].messages as Array<{ role: string; content: string }>;
    expect(sentMessages).toHaveLength(4);
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[1].content).toBe('historic q');
    expect(sentMessages[2].content).toBe('historic a');
    expect(sentMessages[3].content).toBe('follow up q');
  });
});

describe('V1.2-saga — observability events', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('emits fleet:chat-session:start on start', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const r = await dispatch('peer.chat-session.start', { model: 'qwen3:4b' });
    const sessionId = (r.payload as { sessionId: string }).sessionId;
    expect(broadcastChatSessionStart).toHaveBeenCalledTimes(1);
    expect(broadcastChatSessionStart).toHaveBeenCalledWith({
      sessionId,
      model: 'qwen3:4b',
    });
  });

  it('emits fleet:chat-session:turn on each successful continue', async () => {
    await wirePeerSessionBridge(() => makeClient(['A1', 'A2']).client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'q1' });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'q2' });

    expect(broadcastChatSessionTurn).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(broadcastChatSessionTurn).mock.calls[0][0];
    expect(firstCall.sessionId).toBe(sessionId);
    expect(firstCall.turnCount).toBe(1);
    expect(typeof firstCall.elapsedMs).toBe('number');

    const secondCall = vi.mocked(broadcastChatSessionTurn).mock.calls[1][0];
    expect(secondCall.turnCount).toBe(2);
  });

  it('emits fleet:chat-session:end with reason="end" on explicit close', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    await dispatch('peer.chat-session.end', { sessionId });
    expect(broadcastChatSessionEnd).toHaveBeenCalledWith({ sessionId, reason: 'end' });
  });

  it('emits fleet:chat-session:end with reason="expired" when GC purges', async () => {
    process.env.CODEBUDDY_PEER_SESSION_IDLE_MS = '50';
    try {
      await wirePeerSessionBridge(() => makeClient().client as never);
      const startRes = await dispatch('peer.chat-session.start', {});
      const sessionId = (startRes.payload as { sessionId: string }).sessionId;

      await new Promise((resolve) => setTimeout(resolve, 80));
      vi.mocked(broadcastChatSessionEnd).mockClear();

      // Trigger GC by starting a new session.
      await dispatch('peer.chat-session.start', {});

      expect(broadcastChatSessionEnd).toHaveBeenCalledWith({ sessionId, reason: 'expired' });
    } finally {
      delete process.env.CODEBUDDY_PEER_SESSION_IDLE_MS;
    }
  });

  it('does NOT emit content (prompt / text / messages) in any payload', async () => {
    await wirePeerSessionBridge(() => makeClient(['secret answer']).client as never);
    const startRes = await dispatch('peer.chat-session.start', {
      systemPrompt: 'private system prompt',
    });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'secret question' });
    await dispatch('peer.chat-session.end', { sessionId });

    const allPayloads = [
      ...vi.mocked(broadcastChatSessionStart).mock.calls.map((c) => c[0]),
      ...vi.mocked(broadcastChatSessionTurn).mock.calls.map((c) => c[0]),
      ...vi.mocked(broadcastChatSessionEnd).mock.calls.map((c) => c[0]),
    ];
    const blob = JSON.stringify(allPayloads);
    expect(blob).not.toContain('secret answer');
    expect(blob).not.toContain('secret question');
    expect(blob).not.toContain('private system prompt');
    expect(blob).not.toMatch(/\bprompt\b/);
    expect(blob).not.toMatch(/\bmessages\b/);
    expect(blob).not.toMatch(/\bcontent\b/);
  });
});

// ──────────────────────────────────────────────────────────────────
// peer.chat-session.continue-stream (variant streaming, mirror d.19)
// ──────────────────────────────────────────────────────────────────

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: unknown;
}

/** Streaming client mock — yields the configured chunks then ends. */
function makeStreamingClient(chunks: string[], usage?: unknown, finishReason = 'stop') {
  const captured: Array<{ messages: unknown; opts: unknown }> = [];
  return {
    captured,
    client: {
      chat: vi.fn(),
      async *chatStream(messages: unknown, _tools: unknown, opts?: unknown): AsyncGenerator<StreamChunk> {
        captured.push({ messages, opts });
        for (const c of chunks) {
          yield { choices: [{ delta: { content: c } }] };
        }
        yield { choices: [{ delta: {}, finish_reason: finishReason }], usage };
      },
    },
  };
}

describe('peer.chat-session.continue-stream', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('emits per-chunk deltas and returns aggregated text', async () => {
    const { client } = makeStreamingClient(['Hel', 'lo, ', 'world!'], {
      total_tokens: 9,
      prompt_tokens: 2,
      completion_tokens: 7,
    });
    await wirePeerSessionBridge(() => client as never);

    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const emitted: string[] = [];
    const r = await dispatchPeerRequest(
      {
        id: 'r1',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'say hi' },
      },
      baseCtx({ emitChunk: (delta) => emitted.push(delta) }),
    );
    expect(r.ok).toBe(true);
    expect(emitted).toEqual(['Hel', 'lo, ', 'world!']);
    const payload = r.payload as { text: string; usage?: { total_tokens?: number }; finishReason?: string };
    expect(payload.text).toBe('Hello, world!');
    expect(payload.finishReason).toBe('stop');
    expect(payload.usage?.total_tokens).toBe(9);
  });

  it('keeps an explicit provider pinned on streamed turns', async () => {
    const defaultClient = makeStreamingClient(['wrong']);
    const openRouterClient = makeStreamingClient(['right ', 'backend']);
    const resolver = vi.fn((provider: string) => provider === 'openrouter'
      ? {
          client: openRouterClient.client as never,
          info: { provider: 'openrouter' as const, model: 'openrouter/free', isLocal: false },
        }
      : null) as PeerSessionClientResolver;
    await wirePeerSessionBridge(
      () => defaultClient.client as never,
      { provider: 'agy-cli', model: 'Gemini 3.1 Pro (High)', isLocal: false },
      resolver,
    );
    const startRes = await dispatch('peer.chat-session.start', {
      provider: 'openrouter',
      model: 'openrouter/free',
    });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const response = await dispatch('peer.chat-session.continue-stream', {
      sessionId,
      prompt: 'answer',
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      text: 'right backend',
      providerRequested: 'openrouter',
      providerResolved: 'openrouter',
    });
    expect(defaultClient.captured).toHaveLength(0);
    expect(openRouterClient.captured[0]?.opts).toEqual({ model: 'openrouter/free' });
  });

  it('returns session dispatchProfile policy metadata on streamed turns', async () => {
    const { client } = makeStreamingClient(['safe answer']);
    await wirePeerSessionBridge(() => client as never);

    const startRes = await dispatch('peer.chat-session.start', { dispatchProfile: 'safe' });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r = await dispatchPeerRequest(
      {
        id: 'r1b',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'check this safely' },
      },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(r.ok).toBe(true);
    const payload = r.payload as {
      dispatchProfile?: string;
      toolPolicy?: { policyProfile?: string; defaultAction?: string };
      toolDecisions?: Array<{ tool: string; action: string }>;
    };
    expect(payload.dispatchProfile).toBe('safe');
    expect(payload.toolPolicy).toMatchObject({
      policyProfile: 'minimal',
      defaultAction: 'deny',
    });
    expect(payload.toolDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'view_file', action: 'allow' }),
        expect.objectContaining({ tool: 'bash', action: 'deny' }),
      ]),
    );
  });

  it('works without an emitChunk transport (aggregates locally)', async () => {
    const { client } = makeStreamingClient(['part', '1', 'part2']);
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r = await dispatchPeerRequest(
      {
        id: 'r2',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'q' },
      },
      baseCtx(),
    );
    expect(r.ok).toBe(true);
    expect((r.payload as { text: string }).text).toBe('part1part2');
  });

  it('accumulates assistant text in the session for next turn', async () => {
    const { client, captured } = makeStreamingClient(['stream', ' answer']);
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    await dispatchPeerRequest(
      {
        id: 'r3',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'first' },
      },
      baseCtx({ emitChunk: () => undefined }),
    );

    // Second turn — the LLM sees system + user1 + assistant1 + user2.
    await dispatchPeerRequest(
      {
        id: 'r4',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'second' },
      },
      baseCtx({ emitChunk: () => undefined }),
    );

    expect(captured).toHaveLength(2);
    const second = captured[1].messages as Array<{ role: string; content: string }>;
    expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(second[2].content).toBe('stream answer');
    expect(second[3].content).toBe('second');
  });

  it('rejects unknown sessionId with SESSION_NOT_FOUND', async () => {
    await wirePeerSessionBridge(() => makeStreamingClient(['x']).client as never);
    const r = await dispatchPeerRequest(
      {
        id: 'r5',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId: 'sess_nope', prompt: 'hi' },
      },
      baseCtx(),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('SESSION_NOT_FOUND');
  });

  it('returns CLIENT_UNAVAILABLE when no client is wired', async () => {
    await wirePeerSessionBridge(() => null);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    const r = await dispatchPeerRequest(
      {
        id: 'r6',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'hi' },
      },
      baseCtx(),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('CLIENT_UNAVAILABLE');
  });

  it('rejects empty prompt / missing sessionId', async () => {
    await wirePeerSessionBridge(() => makeStreamingClient(['x']).client as never);
    const r1 = await dispatchPeerRequest(
      { id: 'r7', method: 'peer.chat-session.continue-stream', params: {} },
      baseCtx(),
    );
    expect(r1.ok).toBe(false);
    expect(r1.error?.message).toContain('sessionId is required');

    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;
    const r2 = await dispatchPeerRequest(
      {
        id: 'r8',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId },
      },
      baseCtx(),
    );
    expect(r2.ok).toBe(false);
    expect(r2.error?.message).toContain('prompt is required');
  });

  it('rejects dispatchProfile changes on streamed continue before streaming', async () => {
    const emitted: string[] = [];
    const { client } = makeStreamingClient(['should not stream']);
    await wirePeerSessionBridge(() => client as never);
    const startRes = await dispatch('peer.chat-session.start', { dispatchProfile: 'safe' });
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const response = await dispatchPeerRequest(
      {
        id: 'r8b',
        method: 'peer.chat-session.continue-stream',
        params: {
          sessionId,
          prompt: 'change posture',
          dispatchProfile: 'code',
        },
      },
      baseCtx({ emitChunk: (delta) => emitted.push(delta) }),
    );

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('does not match session profile "safe"');
    expect(emitted).toEqual([]);
  });

  it('emits fleet:chat-session:turn after a successful stream', async () => {
    await wirePeerSessionBridge(() => makeStreamingClient(['ok']).client as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    await dispatchPeerRequest(
      {
        id: 'r9',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'hi' },
      },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(broadcastChatSessionTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, turnCount: 1 }),
    );
  });

  it('rolls back the user message when chatStream throws with zero deltas', async () => {
    const flakyClient = {
      chat: vi.fn(),
      chatStream: async function* (): AsyncGenerator<StreamChunk> {
        yield* [] as StreamChunk[];
        throw new Error('upstream gateway 502');
      },
    };
    await wirePeerSessionBridge(() => flakyClient as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r = await dispatchPeerRequest(
      {
        id: 'r10',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'q1' },
      },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('upstream gateway 502');

    // No partial state — next turn starts fresh.
    const live = _listSessionsForTests().find((s) => s.sessionId === sessionId);
    expect(live?.messageCount).toBe(0);
  });

  it('persists partial answer when the stream errors after some deltas', async () => {
    const partialClient = {
      chat: vi.fn(),
      async *chatStream(): AsyncGenerator<StreamChunk> {
        yield { choices: [{ delta: { content: 'half ' } }] };
        yield { choices: [{ delta: { content: 'an answer' } }] };
        throw new Error('connection lost mid-stream');
      },
    };
    await wirePeerSessionBridge(() => partialClient as never);
    const startRes = await dispatch('peer.chat-session.start', {});
    const sessionId = (startRes.payload as { sessionId: string }).sessionId;

    const r = await dispatchPeerRequest(
      {
        id: 'r11',
        method: 'peer.chat-session.continue-stream',
        params: { sessionId, prompt: 'tell me' },
      },
      baseCtx({ emitChunk: () => undefined }),
    );
    expect(r.ok).toBe(false);

    // The partial assistant text is saved so the next turn sees what
    // the model already said before the failure.
    const live = _listSessionsForTests().find((s) => s.sessionId === sessionId);
    expect(live?.messageCount).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────
// peer.chat-session.list — read-only snapshot (V1.2.x)
// ──────────────────────────────────────────────────────────────────

describe('peer.chat-session.list', () => {
  beforeEach(() => _unwireForTests());
  afterEach(() => _unwireForTests());

  it('returns count=0 + empty array when no sessions are open', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const r = await dispatch('peer.chat-session.list', {});
    expect(r.ok).toBe(true);
    expect((r.payload as { count: number }).count).toBe(0);
    expect((r.payload as { sessions: unknown[] }).sessions).toEqual([]);
  });

  it('lists open sessions with metadata only (sessionId, turnCount, model, age)', async () => {
    const { client } = makeClient(['A1', 'A2']);
    await wirePeerSessionBridge(() => client as never);
    const s1 = await dispatch('peer.chat-session.start', {
      systemPrompt: 'private prompt',
      model: 'qwen3:4b',
    });
    const sid1 = (s1.payload as { sessionId: string }).sessionId;
    await dispatch('peer.chat-session.continue', { sessionId: sid1, prompt: 'first turn' });

    const s2 = await dispatch('peer.chat-session.start', { model: 'gpt-4o' });
    const sid2 = (s2.payload as { sessionId: string }).sessionId;

    const r = await dispatch('peer.chat-session.list', {});
    expect(r.ok).toBe(true);
    const payload = r.payload as {
      count: number;
      sessions: Array<{
        sessionId: string;
        turnCount: number;
        model?: string;
        ageMs: number;
        idleMs: number;
        expiresInMs: number;
      }>;
    };
    expect(payload.count).toBe(2);
    const byId = new Map(payload.sessions.map((s) => [s.sessionId, s]));
    expect(byId.get(sid1)?.turnCount).toBe(1);
    expect(byId.get(sid1)?.model).toBe('qwen3:4b');
    expect(byId.get(sid2)?.turnCount).toBe(0);
    expect(byId.get(sid2)?.model).toBe('gpt-4o');
    expect(byId.get(sid1)?.ageMs).toBeGreaterThanOrEqual(0);
    expect(byId.get(sid1)?.expiresInMs).toBeGreaterThan(0);
  });

  it('NEVER exposes systemPrompt, prompts or assistant text', async () => {
    const { client } = makeClient(['secret assistant text']);
    await wirePeerSessionBridge(() => client as never);
    const s = await dispatch('peer.chat-session.start', {
      systemPrompt: 'CONFIDENTIAL_SYSTEM_PROMPT_HEAD',
    });
    const sid = (s.payload as { sessionId: string }).sessionId;
    await dispatch('peer.chat-session.continue', {
      sessionId: sid,
      prompt: 'CONFIDENTIAL_USER_QUESTION',
    });

    const r = await dispatch('peer.chat-session.list', {});
    const blob = JSON.stringify(r.payload);
    expect(blob).not.toContain('CONFIDENTIAL_SYSTEM_PROMPT_HEAD');
    expect(blob).not.toContain('CONFIDENTIAL_USER_QUESTION');
    expect(blob).not.toContain('secret assistant text');
    expect(blob).not.toMatch(/\bsystemPrompt\b/);
    expect(blob).not.toMatch(/\bmessages\b/);
    expect(blob).not.toMatch(/\bcontent\b/);
  });

  it('purges expired sessions before returning, so callers never see ghosts', async () => {
    process.env.CODEBUDDY_PEER_SESSION_IDLE_MS = '50';
    try {
      await wirePeerSessionBridge(() => makeClient().client as never);
      const s = await dispatch('peer.chat-session.start', {});
      const sid = (s.payload as { sessionId: string }).sessionId;
      // Wait past the idle window.
      await new Promise((resolve) => setTimeout(resolve, 80));
      const r = await dispatch('peer.chat-session.list', {});
      expect((r.payload as { count: number }).count).toBe(0);
      expect(_listSessionsForTests().find((x) => x.sessionId === sid)).toBeUndefined();
    } finally {
      delete process.env.CODEBUDDY_PEER_SESSION_IDLE_MS;
    }
  });

  it('echoes traceId', async () => {
    await wirePeerSessionBridge(() => makeClient().client as never);
    const r = await dispatch('peer.chat-session.list', {}, { traceId: 'trace-list' });
    expect((r.payload as { traceId: string }).traceId).toBe('trace-list');
  });
});
