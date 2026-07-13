import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ClientEvent, ServerEvent } from '../src/renderer/types';

// Avoid pulling in Electron's `app` via the real logger.
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// Mock the `ws` module with a controllable fake WebSocket.
class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  static lastInstance: FakeWebSocket | null = null;

  public readyState = 0;
  public sent: string[] = [];
  public closed = false;

  constructor(public url: string) {
    super();
    FakeWebSocket.lastInstance = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  simulateMessage(obj: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(obj)));
  }
}

vi.mock('ws', () => ({
  WebSocket: FakeWebSocket,
}));

// Mock the encrypted config store (avoids electron-store + electron import).
const fakeConfig = { url: '', token: '', autoConnect: false };
vi.mock('../src/main/remote-backend/remote-backend-config-store', () => ({
  remoteBackendConfigStore: {
    getConfig: () => ({ ...fakeConfig }),
    setConfig: (c: Partial<typeof fakeConfig>) => Object.assign(fakeConfig, c),
    clear: () => {},
  },
}));

// Import after mocks are registered.
const { RemoteBackend, buildDesktopUrl, isForwardableToRemote } = await import(
  '../src/main/remote-backend/remote-backend'
);
const { remoteBackendManager } = await import(
  '../src/main/remote-backend/remote-backend-manager'
);

describe('buildDesktopUrl', () => {
  it('appends /desktop and the token query', () => {
    const url = buildDesktopUrl('ws://host:3001', 'abc');
    expect(url).toBe('ws://host:3001/desktop?token=abc');
  });

  it('rewrites http(s) to ws(s)', () => {
    expect(buildDesktopUrl('http://h:3000', 't')).toBe('ws://h:3000/desktop?token=t');
    expect(buildDesktopUrl('https://h', 't')).toBe('wss://h/desktop?token=t');
  });

  it('defaults bare host to ws://', () => {
    expect(buildDesktopUrl('h:3001', 't')).toBe('ws://h:3001/desktop?token=t');
  });

  it('does not double-append /desktop', () => {
    expect(buildDesktopUrl('ws://h/desktop', 't')).toBe('ws://h/desktop?token=t');
  });

  it('url-encodes the token', () => {
    expect(buildDesktopUrl('ws://h', 'a/b+c')).toBe('ws://h/desktop?token=a%2Fb%2Bc');
  });
});

describe('isForwardableToRemote', () => {
  it('accepts the four contract events', () => {
    expect(isForwardableToRemote({ type: 'session.start' } as ClientEvent)).toBe(true);
    expect(isForwardableToRemote({ type: 'session.continue' } as ClientEvent)).toBe(true);
    expect(isForwardableToRemote({ type: 'session.stop' } as ClientEvent)).toBe(true);
    expect(isForwardableToRemote({ type: 'session.list' } as ClientEvent)).toBe(true);
  });

  it('rejects non-contract events', () => {
    expect(isForwardableToRemote({ type: 'session.delete' } as ClientEvent)).toBe(false);
    expect(isForwardableToRemote({ type: 'permission.response' } as ClientEvent)).toBe(false);
    expect(isForwardableToRemote({ type: 'session.getMessages' } as ClientEvent)).toBe(false);
  });
});

describe('RemoteBackend proxy round-trip', () => {
  beforeEach(() => {
    FakeWebSocket.lastInstance = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connect → forward session.start → repipe ServerEvent', async () => {
    const serverEvents: ServerEvent[] = [];
    const statuses: string[] = [];

    const backend = new RemoteBackend({
      onServerEvent: (e) => serverEvents.push(e),
      onStatus: (e) => statuses.push(e.status),
    });

    const connectPromise = backend.connect('ws://host:3001', 'jwt-token');
    const ws = FakeWebSocket.lastInstance!;
    expect(ws).toBeTruthy();
    expect(ws.url).toBe('ws://host:3001/desktop?token=jwt-token');

    ws.simulateOpen();
    await connectPromise;

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');
    expect(backend.isConnected()).toBe(true);

    // Forward a session.start — it should be serialised onto the socket.
    const startEvent: ClientEvent = {
      type: 'session.start',
      payload: { title: 'T', prompt: 'hello' },
    };
    const forwarded = backend.forward(startEvent);
    expect(forwarded).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual(startEvent);

    // A non-forwardable event must NOT be sent over the socket.
    const del: ClientEvent = { type: 'session.delete', payload: { sessionId: 's1' } };
    expect(backend.forward(del)).toBe(false);
    expect(ws.sent).toHaveLength(1);

    // Simulate a ServerEvent coming back from the remote backend.
    const incoming: ServerEvent = {
      type: 'stream.partial',
      payload: { sessionId: 's-remote', delta: 'hi' },
    };
    ws.simulateMessage(incoming);
    expect(serverEvents).toHaveLength(1);
    expect(serverEvents[0]).toEqual(incoming);

    // status() reflects the host (no token).
    expect(backend.status()).toMatchObject({ status: 'connected', host: 'host:3001' });
  });

  it('disconnect tears down the socket and reports disconnected', async () => {
    const statuses: string[] = [];
    const backend = new RemoteBackend({
      onServerEvent: () => {},
      onStatus: (e) => statuses.push(e.status),
    });
    const p = backend.connect('ws://host', 't');
    FakeWebSocket.lastInstance!.simulateOpen();
    await p;

    backend.disconnect();
    expect(backend.isConnected()).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('disconnected');
    // Forwarding after disconnect is a no-op.
    expect(backend.forward({ type: 'session.list', payload: {} } as ClientEvent)).toBe(false);
  });

  it('negotiates capability-scoped control requests without leaking them into chat events', async () => {
    const serverEvents: ServerEvent[] = [];
    const backend = new RemoteBackend({ onServerEvent: (event) => serverEvents.push(event), onStatus: () => {} });
    const connected = backend.connect('ws://host', 't');
    const ws = FakeWebSocket.lastInstance!;
    ws.simulateOpen();
    await connected;

    const request = backend.requestControl('describe');
    const frame = JSON.parse(ws.sent.at(-1)!);
    expect(frame.type).toBe('control.describe');
    expect(frame.requestId).toMatch(/^control_/);
    ws.simulateMessage({
      type: 'control.result',
      payload: { requestId: frame.requestId, ok: true, result: { capabilities: ['system.snapshot'] } },
    });

    await expect(request).resolves.toEqual({ capabilities: ['system.snapshot'] });
    expect(serverEvents).toEqual([]);
    backend.disconnect();
  });

  it('rejects connect without url or token', async () => {
    const backend = new RemoteBackend({ onServerEvent: () => {}, onStatus: () => {} });
    await expect(backend.connect('', 't')).rejects.toThrow(/URL is required/);
    await expect(backend.connect('ws://h', '')).rejects.toThrow(/token is required/);
  });
});

describe('RemoteBackendManager.forwardStart', () => {
  beforeEach(() => {
    FakeWebSocket.lastInstance = null;
  });

  it('resolves the start invoke with the canonical Session from session.update', async () => {
    const repiped: ServerEvent[] = [];
    remoteBackendManager.init({
      sendServerEvent: (e) => repiped.push(e),
      sendStatus: () => {},
    });

    const connectResult = remoteBackendManager.connect('ws://host:3001', 'jwt');
    FakeWebSocket.lastInstance!.simulateOpen();
    await connectResult;
    expect(remoteBackendManager.isConnected()).toBe(true);

    const startEvent = {
      type: 'session.start' as const,
      payload: { title: 'T', prompt: 'hi' },
    };
    const startPromise = remoteBackendManager.forwardStart(startEvent);

    // Verify the event went on the wire.
    const ws = FakeWebSocket.lastInstance!;
    expect(JSON.parse(ws.sent[0])).toEqual(startEvent);

    // Remote answers with the canonical session.
    const remoteSession = {
      id: 'remote-uuid-1',
      title: 'T',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      createdAt: 1,
      updatedAt: 1,
    };
    ws.simulateMessage({
      type: 'session.update',
      payload: { sessionId: 'remote-uuid-1', updates: remoteSession },
    });

    const resolved = await startPromise;
    expect(resolved).toMatchObject({ id: 'remote-uuid-1', title: 'T' });
    // The session.update was still repiped to the renderer (idempotent upsert).
    expect(repiped.some((e) => e.type === 'session.update')).toBe(true);

    remoteBackendManager.disconnect();
  });

  it('resolves null when forwardStart has no live connection', async () => {
    remoteBackendManager.init({ sendServerEvent: () => {}, sendStatus: () => {} });
    remoteBackendManager.disconnect();
    const result = await remoteBackendManager.forwardStart({
      type: 'session.start',
      payload: { title: 'T', prompt: 'x' },
    });
    expect(result).toBeNull();
  });
});
