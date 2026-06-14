/**
 * Mattermost real-transport proof.
 *
 * Stands up a loopback `ws` server on an ephemeral port that speaks the
 * Mattermost WebSocket protocol (replies to `authentication_challenge` with a
 * `hello` event, then pushes a `posted` event). The adapter is pointed at it
 * via `config.url = http://127.0.0.1:<port>` so the http→ws transform lands on
 * the mock. This exercises the genuine `ws` client + REST `send()` paths — no
 * live Mattermost server is involved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressInfo } from 'net';
import { WebSocketServer, WebSocket as WsServerSocket } from 'ws';
import { MattermostChannel } from '../../src/channels/mattermost/index.js';
import type { InboundMessage } from '../../src/channels/core.js';
import { ReconnectionManager } from '../../src/channels/reconnection-manager.js';

interface MockServerOptions {
  /** If true, the server closes the client socket right after sending `posted`. */
  closeAfterPost?: boolean;
  /** If true, the server never sends `hello` (auth failure simulation). */
  withholdHello?: boolean;
}

interface MockServer {
  port: number;
  wss: WebSocketServer;
  /** Resolves with the token from the first authentication_challenge. */
  authToken: Promise<string>;
}

const POSTED_FRAME = {
  event: 'posted',
  data: {
    post: JSON.stringify({
      id: 'p1',
      user_id: 'u1',
      channel_id: 'c1',
      message: 'hello-mm',
    }),
    channel_name: 'town-square',
  },
  broadcast: { channel_id: 'c1' },
  seq: 2,
};

async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const port = (wss.address() as AddressInfo).port;

  let resolveToken: (t: string) => void;
  const authToken = new Promise<string>((r) => {
    resolveToken = r;
  });

  wss.on('connection', (socket: WsServerSocket) => {
    socket.on('message', (raw) => {
      let frame: { action?: string; seq?: number; data?: { token?: string } };
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.action === 'authentication_challenge') {
        resolveToken(frame.data?.token ?? '');

        if (!opts.withholdHello) {
          // Mattermost replies to a successful auth with a `hello` event.
          socket.send(
            JSON.stringify({ event: 'hello', data: { server_version: 'mock' }, seq: frame.seq }),
          );
          // Then push an inbound post.
          socket.send(JSON.stringify(POSTED_FRAME));

          if (opts.closeAfterPost) {
            // Give the client a tick to process the post, then drop the socket.
            setTimeout(() => socket.close(), 20);
          }
        }
      }
    });
  });

  return { port, wss, authToken };
}

function makeChannel(port: number): MattermostChannel {
  return new MattermostChannel({
    type: 'mattermost',
    enabled: true,
    url: `http://127.0.0.1:${port}`,
    token: 'mm-bot-token',
  });
}

describe('MattermostChannel real transport (loopback mock)', () => {
  let channel: MattermostChannel | null = null;
  let server: MockServer | null = null;

  afterEach(async () => {
    if (channel) {
      await channel.disconnect().catch(() => {});
      channel = null;
    }
    if (server) {
      await new Promise<void>((resolve) => server!.wss.close(() => resolve()));
      server = null;
    }
    vi.restoreAllMocks();
  });

  it('maps http→ws and targets the /api/v4/websocket gateway', () => {
    const c = new MattermostChannel({
      type: 'mattermost',
      enabled: true,
      url: 'https://mm.example.com',
      token: 't',
    });
    expect(c.getWebSocketUrl()).toBe('wss://mm.example.com/api/v4/websocket');

    const c2 = new MattermostChannel({
      type: 'mattermost',
      enabled: true,
      url: 'http://127.0.0.1:8065/',
      token: 't',
    });
    expect(c2.getWebSocketUrl()).toBe('ws://127.0.0.1:8065/api/v4/websocket');
  });

  it('authenticates with the bearer token over the WS challenge', async () => {
    server = await startMockServer();
    channel = makeChannel(server.port);

    await channel.connect();

    const token = await server.authToken;
    expect(token).toBe('mm-bot-token');
    expect(channel.getStatus().connected).toBe(true);
    expect(channel.getStatus().authenticated).toBe(true);
  });

  it('emits "connected" after the hello event', async () => {
    server = await startMockServer();
    channel = makeChannel(server.port);

    const connectedSpy = vi.fn();
    channel.on('connected', connectedSpy);

    await channel.connect();

    expect(connectedSpy).toHaveBeenCalledWith('mattermost');
  });

  it('parses a "posted" event into an InboundMessage and emits "message"', async () => {
    server = await startMockServer();
    channel = makeChannel(server.port);

    // Register the listener BEFORE connect() — the mock pushes `posted`
    // immediately after `hello`, so a late listener could miss it.
    const received = new Promise<InboundMessage>((resolve) => {
      channel!.once('message', (m: InboundMessage) => resolve(m));
    });

    await channel.connect();

    const msg = await received;
    expect(msg.content).toBe('hello-mm');
    expect(msg.sender.id).toBe('u1');
    expect(msg.channel.id).toBe('c1');
    expect(msg.channel.type).toBe('mattermost');
    expect(msg.channel.name).toBe('town-square');
    expect(msg.id).toBe('p1');
    expect(msg.contentType).toBe('text');
  });

  it('schedules a reconnect when the server closes the socket (unintended drop)', async () => {
    // Spy with a no-op so we can assert the call without leaking a real backoff
    // attempt against the (about-to-be-closed) port.
    const scheduleSpy = vi
      .spyOn(ReconnectionManager.prototype, 'scheduleReconnect')
      .mockImplementation(() => {});

    server = await startMockServer({ closeAfterPost: true });
    channel = makeChannel(server.port);

    await channel.connect();

    await vi.waitFor(() => {
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });
    expect(scheduleSpy.mock.calls[0]?.[0]).toBeInstanceOf(Function);
  });

  it('does NOT schedule a reconnect on an intentional disconnect()', async () => {
    const scheduleSpy = vi
      .spyOn(ReconnectionManager.prototype, 'scheduleReconnect')
      .mockImplementation(() => {});

    server = await startMockServer();
    channel = makeChannel(server.port);

    await channel.connect();
    await channel.disconnect();

    // Give any stray close handler a chance to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(scheduleSpy).not.toHaveBeenCalled();
    channel = null; // already disconnected
  });

  it('emits "disconnected" on disconnect()', async () => {
    server = await startMockServer();
    channel = makeChannel(server.port);

    const disconnectedSpy = vi.fn();
    channel.on('disconnected', disconnectedSpy);

    await channel.connect();
    await channel.disconnect();

    expect(disconnectedSpy).toHaveBeenCalledWith('mattermost');
    channel = null;
  });
});

describe('MattermostChannel.send() REST shape', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs {channel_id, message} to /api/v4/posts with a Bearer header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'posted-id-1', channel_id: 'c9', message: 'hi' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channel = new MattermostChannel({
      type: 'mattermost',
      enabled: true,
      url: 'https://mm.example.com',
      token: 'mm-bot-token',
    });

    const result = await channel.send({ channelId: 'c9', content: 'hi there' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mm.example.com/api/v4/posts');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mm-bot-token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ channel_id: 'c9', message: 'hi there' });

    // DeliveryResult.messageId comes from the response post id.
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('posted-id-1');
  });

  it('includes root_id for threaded replies', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply-id', channel_id: 'c9', message: 'r' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channel = new MattermostChannel({
      type: 'mattermost',
      enabled: true,
      url: 'https://mm.example.com',
      token: 'tok',
    });

    await channel.send({ channelId: 'c9', content: 'reply', replyTo: 'root-1' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      channel_id: 'c9',
      message: 'reply',
      root_id: 'root-1',
    });
  });

  it('returns a failed DeliveryResult when the REST call errors', async () => {
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const channel = new MattermostChannel({
      type: 'mattermost',
      enabled: true,
      url: 'https://mm.example.com',
      token: 'tok',
    });

    const result = await channel.send({ channelId: 'c9', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });
});
