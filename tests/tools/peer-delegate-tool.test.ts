/**
 * peer_delegate tool tests — Phase (d).17.
 *
 * Mocks the FleetRegistry singleton to avoid real WebSocket traffic.
 * Verifies guards (leaf role, no peers, unknown peer), happy path with
 * usage echo, error code mapping, and per-turn cap.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executePeerDelegate,
  _resetCallCounterForTests,
} from '../../src/tools/peer-delegate-tool.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';
import {
  resetActiveCustomAgentRuntime,
  setActiveCustomAgentRuntime,
} from '../../src/agent/custom/custom-agent-runtime.js';

const ORIGINAL_ENV = process.env;

function makeStubListener(
  request: FleetListenerPublicAPI['request'],
): FleetListenerPublicAPI {
  return {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request,
    getLastSeen: () => ({ at: null, reason: null, ageMs: null }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };
}

function registerPeer(
  id: string,
  request: FleetListenerPublicAPI['request'],
): ActiveListenerEntry {
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(request),
  };
  getFleetRegistry().register(entry);
  return entry;
}

describe('peer_delegate tool', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CODEBUDDY_PEER_ROLE;
    delete process.env.CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN;
    _resetFleetRegistryForTests();
    _resetCallCounterForTests();
    resetActiveCustomAgentRuntime();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('guards', () => {
    it('refuses when CODEBUDDY_PEER_ROLE=leaf', async () => {
      process.env.CODEBUDDY_PEER_ROLE = 'leaf';
      const result = await executePeerDelegate({ peer: 'x', prompt: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('leaf peer');
      expect(result.error).toContain('CODEBUDDY_PEER_ROLE=leaf');
    });

    it('errors when no peers connected', async () => {
      const result = await executePeerDelegate({ peer: 'darkstar', prompt: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No fleet peers connected');
      expect(result.error).toContain('/fleet listen');
    });

    it('errors when peer name is unknown — lists available peers', async () => {
      registerPeer('alpha', vi.fn());
      registerPeer('beta', vi.fn());
      const result = await executePeerDelegate({ peer: 'gamma', prompt: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('"gamma" not found');
      expect(result.error).toContain('alpha, beta');
    });

    it('rejects empty peer or prompt', async () => {
      registerPeer('alpha', vi.fn());
      let r = await executePeerDelegate({ peer: '', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('"peer"');
      r = await executePeerDelegate({ peer: 'alpha', prompt: '' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('"prompt"');
    });

    it('rejects unknown dispatchProfile values before contacting peers', async () => {
      const request = vi.fn();
      registerPeer('alpha', request);

      const result = await executePeerDelegate({
        peer: 'alpha',
        prompt: 'review this',
        dispatchProfile: 'chaos',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('dispatchProfile must be one of');
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('calls peer.chat with default timeout and returns formatted output', async () => {
      const request = vi.fn().mockResolvedValue({
        text: 'hello from darkstar',
        modelRequested: 'grok-3',
        finishReason: 'stop',
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        traceId: 'tr-abc',
      });
      registerPeer('darkstar', request);

      const result = await executePeerDelegate({
        peer: 'darkstar',
        prompt: 'say hi',
      });

      expect(result.success).toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
      const [method, params, options] = request.mock.calls[0];
      expect(method).toBe('peer.chat');
      expect(params).toEqual({ prompt: 'say hi' });
      expect(options).toMatchObject({ timeoutMs: 60_000 });

      expect(result.output).toContain('[peer: darkstar]');
      expect(result.output).toContain('hello from darkstar');
      expect(result.output).toContain('[tokens: 12 in / 5 out | total: 17]');
      expect(result.output).toContain('[model: grok-3]');

      const data = result.data as { text: string; peer: string; traceId: string };
      expect(data.text).toBe('hello from darkstar');
      expect(data.peer).toBe('darkstar');
      expect(data.traceId).toBe('tr-abc');
    });

    it('forwards provider, systemPrompt and model when provided', async () => {
      const request = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
      registerPeer('alpha', request);
      await executePeerDelegate({
        peer: 'alpha',
        prompt: 'hi',
        provider: 'anthropic',
        systemPrompt: 'be brief',
        model: 'claude-opus-4-5',
        timeoutMs: 30_000,
      });
      const [, params, options] = request.mock.calls[0];
      expect(params).toMatchObject({
        prompt: 'hi',
        provider: 'anthropic',
        systemPrompt: 'be brief',
        model: 'claude-opus-4-5',
      });
      expect(options).toMatchObject({ timeoutMs: 30_000 });
    });

    it('uses dispatchProfile guidance when no systemPrompt override is provided', async () => {
      const request = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
      registerPeer('alpha', request);

      await executePeerDelegate({
        peer: 'alpha',
        prompt: 'review this patch',
        dispatchProfile: 'review',
      });

      const [, params] = request.mock.calls[0];
      expect(params).toMatchObject({
        prompt: 'review this patch',
      });
      expect((params as { systemPrompt: string }).systemPrompt).toContain('Prioritize defects');
      expect((params as { systemPrompt: string }).systemPrompt).toContain('Tool policy hint:');
      expect((params as { dispatchProfile: string }).dispatchProfile).toBe('review');
    });

    it('uses the active agent dispatch profile when caller omits dispatchProfile', async () => {
      setActiveCustomAgentRuntime({
        id: 'hermes',
        name: 'Hermes Agent',
        description: '',
        systemPrompt: 'prompt',
        fleetDispatchProfile: 'safe',
        requireExplicitDispatchProfile: true,
      });
      const request = vi.fn().mockResolvedValue({ text: 'ok', usage: undefined });
      registerPeer('alpha', request);

      const result = await executePeerDelegate({
        peer: 'alpha',
        prompt: 'inspect this risky change',
      });

      expect(result.success).toBe(true);
      const [, params] = request.mock.calls[0];
      expect((params as { dispatchProfile: string }).dispatchProfile).toBe('safe');
      expect((params as { systemPrompt: string }).systemPrompt).toContain('Be conservative');
      expect(result.output).toContain('[profile: safe | source: agent-default');
      expect(result.data).toMatchObject({
        dispatchProfile: 'safe',
        dispatchProfileSource: 'agent-default',
        dispatchProfileAgent: 'hermes',
      });
    });

    it('returns peer-side dispatch policy metadata when the peer echoes it', async () => {
      const request = vi.fn().mockResolvedValue({
        text: 'reviewed',
        usage: undefined,
        dispatchProfile: 'review',
        toolPolicy: {
          policyProfile: 'minimal',
          defaultAction: 'confirm',
          summary: 'Review posture',
        },
        toolDecisions: [
          { tool: 'view_file', action: 'allow' },
          { tool: 'create_file', action: 'deny' },
        ],
        toolset: {
          toolsetId: 'fleet.hermes.review',
          deniedTools: ['create_file'],
        },
      });
      registerPeer('alpha', request);

      const result = await executePeerDelegate({
        peer: 'alpha',
        prompt: 'review this patch',
        dispatchProfile: 'review',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('[profile: review | policy: minimal / confirm]');
      expect(result.data).toMatchObject({
        dispatchProfile: 'review',
        toolPolicy: {
          policyProfile: 'minimal',
          defaultAction: 'confirm',
        },
        toolDecisions: [
          { tool: 'view_file', action: 'allow' },
          { tool: 'create_file', action: 'deny' },
        ],
        toolset: {
          toolsetId: 'fleet.hermes.review',
          deniedTools: ['create_file'],
        },
      });
    });
  });

  describe('error code mapping', () => {
    function makeErr(code: string, message = code): Error {
      const e: Error & { code?: string } = new Error(message);
      e.code = code;
      return e;
    }

    it('DISCONNECTED', async () => {
      registerPeer('alpha', vi.fn().mockRejectedValue(makeErr('DISCONNECTED')));
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('disconnected during the call');
    });

    it('REQUEST_TIMEOUT echoes the timeout value', async () => {
      registerPeer('alpha', vi.fn().mockRejectedValue(makeErr('REQUEST_TIMEOUT')));
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi', timeoutMs: 1234 });
      expect(r.success).toBe(false);
      expect(r.error).toContain('1234ms');
    });

    it('ROLE_LEAF (peer-side)', async () => {
      registerPeer('alpha', vi.fn().mockRejectedValue(makeErr('ROLE_LEAF')));
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('leaf peer');
    });

    it('MAX_DEPTH_EXCEEDED', async () => {
      registerPeer('alpha', vi.fn().mockRejectedValue(makeErr('MAX_DEPTH_EXCEEDED')));
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('chain depth exceeded');
    });

    it('NOT_AUTHENTICATED', async () => {
      registerPeer('alpha', vi.fn().mockRejectedValue(makeErr('NOT_AUTHENTICATED')));
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('not currently connected');
    });

    it('CLIENT_UNAVAILABLE (substring match)', async () => {
      registerPeer(
        'alpha',
        vi.fn().mockRejectedValue(new Error('peer.chat: CLIENT_UNAVAILABLE — no LLM wired')),
      );
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('no LLM client wired');
    });

    it('generic error fallthrough', async () => {
      registerPeer('alpha', vi.fn().mockRejectedValue(new Error('something exploded')));
      const r = await executePeerDelegate({ peer: 'alpha', prompt: 'hi' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('something exploded');
    });
  });

  describe('per-turn cap', () => {
    it('returns cap error after reaching the limit', async () => {
      // The MAX_PER_TURN constant is read at module load (default 5), so we
      // exercise the default cap. The 6th call should hit the cap.
      registerPeer('alpha', vi.fn().mockResolvedValue({ text: 'ok' }));

      for (let i = 0; i < 5; i++) {
        const r = await executePeerDelegate({ peer: 'alpha', prompt: `q${i}` });
        expect(r.success).toBe(true);
      }
      const overflow = await executePeerDelegate({ peer: 'alpha', prompt: 'q6' });
      expect(overflow.success).toBe(false);
      expect(overflow.error).toContain('cap reached');
      expect(overflow.error).toContain('5/5');
    });

    it('reset counter allows further calls', async () => {
      registerPeer('alpha', vi.fn().mockResolvedValue({ text: 'ok' }));
      const r1 = await executePeerDelegate({ peer: 'alpha', prompt: 'q' });
      _resetCallCounterForTests();
      const r2 = await executePeerDelegate({ peer: 'alpha', prompt: 'q' });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });
});
