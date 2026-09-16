import { describe, expect, it, vi } from 'vitest';
import { parseCollaborationConfig, runCollaboration } from '../../src/fleet/collaboration.js';

const raw = { version: 1, peers: [
  { id: 'one', url: 'ws://localhost:3101', tokenEnv: 'ONE' },
  { id: 'two', url: 'ws://localhost:3102/ws', tokenEnv: 'TWO', role: 'Review tests' },
] };
const env = { ONE: 'secret-one', TWO: 'secret-two' };
function fixture(fail?: string) {
  const connections: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }> = [];
  const createListener = vi.fn(() => {
    const index = connections.length;
    const connection = {
      connect: vi.fn(async () => { if (fail === 'auth' && index === 1) throw new Error('invalid secret-two'); }),
      disconnect: vi.fn(async () => {}),
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'peer.describe') return { hostname: 'fixture', pid: index + 100, methods: ['peer.chat'], peerChatProvider: fail === 'provider' ? null : { model: 'test' } };
        if (fail === 'empty' && index === 1) return { text: '' };
        if (fail === 'synthesis' && params?.systemPrompt) throw new Error('REQUEST_TIMEOUT secret-one');
        return { text: params?.systemPrompt ? 'joint synthesis' : `contribution-${index}` };
      }),
    };
    connections.push(connection);
    return connection;
  });
  return { connections, createListener };
}

describe('explicit fleet collaboration', () => {
  it.each([
    { ...raw, version: 2 }, { version: 1, peers: [] },
    { version: 1, peers: Array(9).fill(raw.peers[0]) },
    { version: 1, peers: [raw.peers[0], raw.peers[0]] },
    { version: 1, peers: [{ ...raw.peers[0], url: 'https://example.org' }] },
    { version: 1, peers: [{ ...raw.peers[0], url: 'ws://user:secret@localhost/ws' }] },
    { version: 1, peers: [{ ...raw.peers[0], url: 'ws://localhost/ws?token=secret' }] },
    { version: 1, peers: [{ ...raw.peers[0], token: 'secret' }] },
    { version: 1, peers: [{ ...raw.peers[0], tokenEnv: 'BAD-NAME' }] },
    { version: 1, peers: [{ ...raw.peers[0], role: '' }] },
  ])('rejects malformed or secret-bearing configuration %#', config => {
    expect(() => parseCollaborationConfig(config)).toThrow();
  });
  it('normalizes the WebSocket path and rejects duplicate normalized endpoints', () => {
    expect(parseCollaborationConfig(raw).peers[0].url).toBe('ws://localhost:3101/ws');
    expect(() => parseCollaborationConfig({ version: 1, peers: [raw.peers[0], { id: 'other', url: 'ws://localhost:3101/ws' }] })).toThrow('distinct');
  });
  it('validates all credentials before any connection', async () => {
    const f = fixture();
    await expect(runCollaboration(parseCollaborationConfig(raw), { env: { ONE: env.ONE }, ...f })).rejects.toThrow('TWO');
    expect(f.createListener).not.toHaveBeenCalled();
  });
  it.each([NaN, 0, 999, 300001, 1000.5])('rejects invalid timeout %s', async timeoutMs => {
    await expect(runCollaboration(parseCollaborationConfig(raw), { env, timeoutMs })).rejects.toThrow('Timeout');
  });
  it('checks readiness without spending model calls', async () => {
    const f = fixture();
    const report = await runCollaboration(parseCollaborationConfig(raw), { env, ...f });
    expect(report.status).toBe('complete');
    expect(report.peers.map(peer => peer.pid)).toEqual([100, 101]);
    for (const connection of f.connections) {
      expect(connection.request).toHaveBeenCalledTimes(1);
      expect(connection.disconnect).toHaveBeenCalledTimes(1);
    }
  });
  it('collects both contributions before a single attributed synthesis', async () => {
    const f = fixture();
    const report = await runCollaboration(parseCollaborationConfig(raw), { env, goal: 'Improve the fleet', ...f });
    expect(report.status).toBe('complete');
    expect(report.synthesis).toEqual({ peer: 'one', text: 'joint synthesis' });
    const synthesis = f.connections[0].request.mock.calls[2][1];
    expect(synthesis?.prompt).toContain('contribution-0');
    expect(synthesis?.prompt).toContain('contribution-1');
    expect(f.connections[1].request.mock.calls[1][1]?.prompt).toContain('Review tests');
    expect(f.connections.every(c => c.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it.each(['auth', 'empty', 'synthesis'])('reports %s failures without false success or secret leakage', async fail => {
    const f = fixture(fail);
    const report = await runCollaboration(parseCollaborationConfig(raw), { env, goal: 'Review', ...f });
    expect(report.status).toBe('partial');
    expect(JSON.stringify(report)).not.toContain('secret-');
    if (fail === 'synthesis') expect(report.synthesisError).toContain('REQUEST_TIMEOUT');
    else expect(report.peers[1].status).toBe('failed');
    expect(f.connections.every(c => c.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it('reports all unavailable providers and skips synthesis', async () => {
    const f = fixture('provider');
    const report = await runCollaboration(parseCollaborationConfig(raw), { env, goal: 'Review', ...f });
    expect(report.status).toBe('failed');
    expect(report.synthesis).toBeUndefined();
    expect(f.connections.every(c => c.request.mock.calls.length === 1)).toBe(true);
  });
  it('does not connect after cancellation', async () => {
    const f = fixture();
    await expect(runCollaboration(parseCollaborationConfig(raw), { env, signal: AbortSignal.abort(), ...f })).rejects.toThrow('cancelled');
    expect(f.createListener).not.toHaveBeenCalled();
  });
  it('starts both reviews concurrently and waits for both before synthesis', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.createListener.getMockImplementation()!;
    f.createListener.mockImplementation(() => {
      const connection = original();
      const request = connection.request.getMockImplementation()!;
      connection.request.mockImplementation(async (method, params) => {
        if (method === 'peer.chat' && !params?.systemPrompt) await gate;
        return request(method, params);
      });
      return connection;
    });
    const pending = runCollaboration(parseCollaborationConfig(raw), { env, goal: 'Review', ...f });
    await vi.waitFor(() => expect(f.connections.every(c => c.request.mock.calls.length === 2)).toBe(true));
    expect(f.connections).toHaveLength(2);
    release();
    expect((await pending).status).toBe('complete');
  });
  it('redacts credentials and terminal controls from peer contributions', async () => {
    const f = fixture();
    const original = f.createListener.getMockImplementation()!;
    f.createListener.mockImplementation(() => {
      const connection = original();
      const request = connection.request.getMockImplementation()!;
      connection.request.mockImplementation(async (method, params) => method === 'peer.chat'
        ? { text: '\x1b[31msecret-two visible' } : request(method, params));
      return connection;
    });
    const report = await runCollaboration(parseCollaborationConfig(raw), { env, goal: 'Review', ...f });
    expect(JSON.stringify(report)).not.toContain('secret-two');
    expect(report.peers[0]?.text).not.toContain('\x1b');
    expect(report.synthesis?.text).toContain('[REDACTED]');
  });

  it('cancels active requests, closes every connection and skips synthesis', async () => {
    const f = fixture();
    const controller = new AbortController();
    const original = f.createListener.getMockImplementation()!;
    f.createListener.mockImplementation(() => {
      const connection = original();
      const request = connection.request.getMockImplementation()!;
      let rejectPending: ((error: Error) => void) | undefined;
      connection.request.mockImplementation(async (method, params) => {
        if (method === 'peer.chat') return new Promise((_resolve, reject) => { rejectPending = reject; });
        return request(method, params);
      });
      connection.disconnect.mockImplementation(async () => { rejectPending?.(new Error('DISCONNECTED')); });
      return connection;
    });
    const pending = runCollaboration(parseCollaborationConfig(raw), { env, goal: 'Review', signal: controller.signal, ...f });
    await vi.waitFor(() => expect(f.connections.every(c => c.request.mock.calls.length === 2)).toBe(true));
    controller.abort();
    const report = await pending;
    expect(report.status).toBe('failed');
    expect(report.synthesis).toBeUndefined();
    expect(report.synthesisError).toContain('cancelled');
    expect(f.connections.every(c => c.disconnect.mock.calls.length >= 1)).toBe(true);
  });

  // Suggested by the real Qwen coordination review; prove the claimed bugs absent.
  it.each(['', '   ', 'x'.repeat(16001)])('rejects invalid goals before opening connections %#', async goal => {
    const f = fixture();
    await expect(runCollaboration(parseCollaborationConfig(raw), { env, goal, ...f })).rejects.toThrow('goal');
    expect(f.createListener).not.toHaveBeenCalled();
  });
  it('accepts secure and reverse-proxied WebSocket endpoints', () => {
    const config = parseCollaborationConfig({ version: 1, peers: [
      { id: 'proxy', url: 'wss://example.org/buddy/ws' },
      { id: 'local', url: 'ws://localhost:8080/' },
    ] });
    expect(config.peers.map(peer => peer.url)).toEqual(['wss://example.org/buddy/ws', 'ws://localhost:8080/ws']);
  });
  it('keeps the full model timeout separate from connection and authentication deadlines', async () => {
    const f = fixture();
    await runCollaboration(parseCollaborationConfig(raw), { env, goal: 'x'.repeat(16000), timeoutMs: 300000, ...f });
    expect(f.createListener).toHaveBeenCalledWith(expect.objectContaining({ connectTimeoutMs: 10000, authTimeoutMs: 5000 }));
    for (const connection of f.connections) {
      expect(connection.request).toHaveBeenCalledWith('peer.chat', expect.any(Object), { timeoutMs: 300000 });
    }
  });

});
