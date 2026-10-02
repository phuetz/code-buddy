import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFleetRegistry } from '../../src/fleet/fleet-registry.js';
import { executePeerDelegate, _resetCallCounterForTests } from '../../src/tools/peer-delegate-tool.js';
import { executeRoutePeer } from '../../src/tools/route-peer-tool.js';
import { executePeerToolInvoke } from '../../src/tools/peer-tool-invoke-tool.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { dispatchPeerRequest, registerPeerMethod, unregisterPeerMethod, type PeerRequestFrame } from '../../src/server/websocket/peer-rpc.js';

const ctx = { connectionId: 'test-peer', scopes: ['peer:invoke'], traceId: '', depth: 0 };

// Exercise the actual listener frame builder and dispatcher without opening a port.
function transport(receive: (frame: PeerRequestFrame) => ReturnType<typeof dispatchPeerRequest>) {
  const listener = new FleetListener({ url: 'ws://example.invalid/ws', jwt: 'fixture' });
  const frames: PeerRequestFrame[] = [];
  const internal = listener as unknown as {
    authenticated: boolean;
    ws: { readyState: number; send: (raw: string) => void };
    pendingRequests: Map<string, { resolve: (payload: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  };
  internal.authenticated = true;
  internal.ws = { readyState: 1, send(raw) {
    const frame = JSON.parse(raw).payload as PeerRequestFrame;
    frames.push(frame);
    void receive(frame).then(response => {
      const pending = internal.pendingRequests.get(frame.id)!;
      clearTimeout(pending.timer);
      internal.pendingRequests.delete(frame.id);
      if (response.ok) pending.resolve(response.payload);
      else pending.reject(Object.assign(new Error(response.error?.message), { code: response.error?.code }));
    });
  } };
  return { listener, frames };
}

afterEach(() => {
  vi.unstubAllEnvs();
  getFleetRegistry().clear();
  _resetCallCounterForTests();
  for (const name of ['test.forward', 'test.origin', 'test.stream', 'test.leaf']) unregisterPeerMethod(name);
});

describe('inbound peer call-chain guards', () => {
  it('propagates trace and increments on A→B→A until the receiver refuses', async () => {
    vi.stubEnv('CODEBUDDY_PEER_MAX_DEPTH', '1');
    const { listener, frames } = transport(frame => dispatchPeerRequest(frame, ctx));
    let calls = 0;
    registerPeerMethod('test.forward', async () => {
      if (++calls > 4) return 'unguarded'; // bounded red test, never leave a loop running
      return listener.request('test.forward');
    });
    const result = await dispatchPeerRequest({ id: 'origin', method: 'test.forward', traceId: 'chain-A-B-A' }, ctx);
    expect(frames.map(f => f.depth)).toEqual([1, 2]);
    expect(frames.every(f => f.traceId === 'chain-A-B-A')).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('depth 2 > max 1');
    expect(calls).toBe(2);
  });

  it('covers requestStream, invokeTool and explicit attempts to reset depth', async () => {
    const { listener, frames } = transport(frame => dispatchPeerRequest({ ...frame, method: 'peer.echo' }, ctx));
    registerPeerMethod('test.origin', async () => {
      await listener.requestStream('peer.chat-stream', {}, () => {}, { traceId: 'reset', depth: 0 });
      await listener.invokeTool('view_file', {});
      await listener.request('peer.chat', {}, { depth: 0, traceId: 'reset' });
    });
    await dispatchPeerRequest({ id: 'origin', method: 'test.origin', depth: 1, traceId: 'inherited' }, ctx);
    expect(frames.map(f => [f.depth, f.traceId])).toEqual([[2, 'inherited'], [2, 'inherited'], [2, 'inherited']]);
  });

  it('keeps parallel incoming contexts separate and external calls unchanged', async () => {
    const { listener, frames } = transport(frame => dispatchPeerRequest({ ...frame, method: 'peer.echo' }, ctx));
    registerPeerMethod('test.origin', async () => {
      await new Promise(resolve => setImmediate(resolve));
      return listener.request('peer.chat');
    });
    await Promise.all(['one', 'two'].map(traceId => dispatchPeerRequest({ id: traceId, method: 'test.origin', traceId }, ctx)));
    expect(frames.map(f => [f.traceId, f.depth])).toEqual([['one', 1], ['two', 1]]);
    await listener.request('peer.echo');
    expect(frames.at(-1)).not.toHaveProperty('depth');
    expect(frames.at(-1)).not.toHaveProperty('traceId');
  });

  it('inherits context through peer_delegate, route_peer and peer_tool_invoke tools', async () => {
    const { listener, frames } = transport(async frame => ({ id: frame.id, ok: true, payload:
      frame.method === 'peer.describe'
        ? { capabilities: { egress: 'local', machineLabel: 'fixture', models: [{ id: 'fixture', provider: 'ollama', contextWindow: 32000, strengths: ['reasoning', 'coding'] }] } }
        : frame.method === 'peer.chat' ? { text: 'fixture' } : { tool: 'view_file', output: 'fixture', durationMs: 1 },
    }));
    getFleetRegistry().register({ id: 'fixture', url: 'ws://example.invalid/ws', startedAt: new Date(), eventCount: 0, autoReconnect: false, maxAttempts: 0, listener });
    registerPeerMethod('test.origin', async () => {
      expect((await executePeerDelegate({ peer: 'fixture', prompt: 'review' })).success).toBe(true);
      expect((await executeRoutePeer({ prompt: 'review code', privacyTag: 'public' })).success).toBe(true);
      expect((await executePeerToolInvoke({ peer: 'fixture', tool: 'view_file', args: { path: 'fixture.txt' } })).success).toBe(true);
    });
    const result = await dispatchPeerRequest({ id: 'tools', method: 'test.origin', traceId: 'tool-trace', depth: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(frames.map(frame => frame.method)).toEqual(['peer.chat', 'peer.describe', 'peer.tool.invoke']);
    expect(frames.every(frame => frame.traceId === 'tool-trace' && frame.depth === 2)).toBe(true);
  });

  it('retains the receiver leaf restriction across async work even if env changes', async () => {
    const { listener, frames } = transport(frame => dispatchPeerRequest(frame, ctx));
    vi.stubEnv('CODEBUDDY_PEER_ROLE', 'leaf');
    registerPeerMethod('test.leaf', async () => {
      vi.stubEnv('CODEBUDDY_PEER_ROLE', 'main');
      await new Promise(resolve => setImmediate(resolve));
      return listener.request('peer.echo');
    });
    const result = await dispatchPeerRequest({ id: 'leaf-async', method: 'test.leaf' }, ctx);
    expect(result.error?.code).toBe('ROLE_LEAF');
    expect(frames).toHaveLength(0);
  });

  it('receiver leaf refuses dispatch even when caller does not enforce leaf', async () => {
    const handler = vi.fn(async () => 'started');
    registerPeerMethod('test.leaf', handler);
    // Override dispatch to prove the receiver gate precedes the handler.
    const original = (await import('../../src/server/websocket/peer-rpc.js')).getPeerMethodHandler('peer.dispatch')!;
    registerPeerMethod('peer.dispatch', handler);
    vi.stubEnv('CODEBUDDY_PEER_ROLE', 'leaf');
    try {
      const result = await dispatchPeerRequest({ id: 'leaf', method: 'peer.dispatch', params: { prompt: 'forward' } }, ctx);
      expect(result.error?.code).toBe('ROLE_LEAF');
      expect(handler).not.toHaveBeenCalled();
      expect((await dispatchPeerRequest({ id: 'read', method: 'peer.echo' }, ctx)).ok).toBe(true);
    } finally { registerPeerMethod('peer.dispatch', original); }
  });
});
