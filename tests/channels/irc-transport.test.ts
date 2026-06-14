/**
 * IRC Transport Tests
 *
 * Proves the real TCP IRC transport against a local loopback mock IRC server
 * (no live IRC network/account required). Asserts the full registration
 * handshake, inbound PRIVMSG delivery, PING/PONG keepalive, outbound PRIVMSG,
 * and that an unexpected socket drop drives a reconnect via the shared
 * ReconnectionManager.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import { IRCChannel, IRCAdapter, parseIRCLine } from '../../src/channels/irc/index.js';
import type { IRCChannelConfig } from '../../src/channels/irc/index.js';
import type { InboundMessage } from '../../src/channels/core.js';
import { ReconnectionManager } from '../../src/channels/reconnection-manager.js';

/**
 * A minimal loopback IRC server speaking just enough of RFC 1459 to register a
 * client. On NICK/USER it replies with the 001 welcome and then pushes a
 * PRIVMSG. It records lines received from the client so the test can assert
 * PONG and outbound PRIVMSG.
 */
interface MockServerHandle {
  port: number;
  server: net.Server;
  /** Lines received from the (first) connected client, e.g. ['NICK cbbot', 'PONG :keepalive']. */
  received: string[];
  /** The currently-connected client socket (last accepted). */
  clientSocket(): net.Socket | null;
  /** Force-close the active client connection to simulate an unexpected drop. */
  dropClient(): void;
  /** Send a raw line (CRLF appended) to the connected client. */
  sendToClient(line: string): void;
}

function startMockIrcServer(
  opts: { sendWelcomeMessage?: boolean; withhold001?: boolean } = {},
): Promise<MockServerHandle> {
  const sendWelcomeMessage = opts.sendWelcomeMessage ?? true;
  const withhold001 = opts.withhold001 ?? false;
  return new Promise((resolve, reject) => {
    const received: string[] = [];
    let activeClient: net.Socket | null = null;

    const server = net.createServer((socket) => {
      activeClient = socket;
      socket.setEncoding('utf8');
      let nick = 'guest';
      let buffer = '';

      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.length === 0) continue;
          received.push(line);

          if (line.startsWith('NICK ')) {
            nick = line.slice('NICK '.length).trim();
          }
          // Complete the registration once USER arrives (NICK already seen).
          if (line.startsWith('USER ')) {
            if (withhold001) {
              // Deliberately never send 001: TCP is connected but IRC is not
              // "ready". Proves connect() gates on 001, not the TCP connect.
              continue;
            }
            socket.write(`:mock.server 001 ${nick} :Welcome to the mock IRC network ${nick}\r\n`);
            if (sendWelcomeMessage) {
              // Push an inbound channel message from another user.
              socket.write(`:tester!u@h PRIVMSG #cb :hello-irc\r\n`);
            }
          }
        }
      });

      socket.on('error', () => {
        /* ignore client reset during forced drop */
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock IRC server'));
        return;
      }
      resolve({
        port: addr.port,
        server,
        received,
        clientSocket: () => activeClient,
        dropClient: () => {
          if (activeClient) {
            activeClient.destroy();
            activeClient = null;
          }
        },
        sendToClient: (line: string) => {
          if (activeClient && activeClient.writable) {
            activeClient.write(`${line}\r\n`);
          }
        },
      });
    });
  });
}

/** Poll until `pred()` is true or the timeout elapses. */
async function waitFor(pred: () => boolean, timeoutMs = 3000, intervalMs = 10): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe('IRC line parser', () => {
  it('parses an unprefixed numeric (001 welcome)', () => {
    const msg = parseIRCLine('001 cbbot :Welcome');
    expect(msg).not.toBeNull();
    expect(msg!.prefix).toBeUndefined();
    expect(msg!.command).toBe('001');
    expect(msg!.params).toEqual(['cbbot', 'Welcome']);
  });

  it('parses a prefixed PRIVMSG with a trailing param containing spaces', () => {
    const msg = parseIRCLine(':tester!u@h PRIVMSG #cb :hello there world');
    expect(msg!.prefix).toBe('tester!u@h');
    expect(msg!.command).toBe('PRIVMSG');
    expect(msg!.params).toEqual(['#cb', 'hello there world']);
  });

  it('parses a PING with a trailing token', () => {
    const msg = parseIRCLine('PING :keepalive');
    expect(msg!.command).toBe('PING');
    expect(msg!.params).toEqual(['keepalive']);
  });
});

describe('IRCChannel real TCP transport', () => {
  let mock: MockServerHandle;
  let channel: IRCChannel | null = null;

  beforeEach(async () => {
    mock = await startMockIrcServer();
  });

  afterEach(async () => {
    if (channel) {
      try {
        await channel.disconnect();
      } catch {
        /* ignore */
      }
      channel = null;
    }
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  function makeConfig(): IRCChannelConfig {
    return {
      type: 'irc',
      enabled: true,
      server: '127.0.0.1',
      port: mock.port,
      nick: 'cbbot',
      username: 'cbbot',
      realname: 'Code Buddy',
      channels: ['#cb'],
      useTLS: false,
      connectTimeoutMs: 3000,
    };
  }

  it('reaches connected after the 001 welcome and receives an inbound message', async () => {
    channel = new IRCChannel(makeConfig());

    const messages: InboundMessage[] = [];
    let connectedFired = false;
    channel.on('message', (m: InboundMessage) => messages.push(m));
    channel.on('connected', () => {
      connectedFired = true;
    });
    // Unhandled 'error' on an EventEmitter throws — always attach a listener.
    channel.on('error', () => {});

    await channel.connect();

    // (1) Adapter reached connected only after 001 (connect() resolves on 001).
    expect(channel.getStatus().connected).toBe(true);
    expect(connectedFired).toBe(true);

    // (2) A 'message' event fired with content 'hello-irc'.
    await waitFor(() => messages.length > 0);
    expect(messages[0]?.content).toBe('hello-irc');
    expect(messages[0]?.channel.id).toBe('#cb');
    expect(messages[0]?.sender.id).toBe('tester');

    // The handshake actually went over the wire: server saw NICK + USER + JOIN.
    // JOIN is written by the adapter when it processes 001, which may flush a
    // tick after the inbound message is dispatched — wait for it.
    expect(mock.received.some((l) => l === 'NICK cbbot')).toBe(true);
    expect(mock.received.some((l) => l.startsWith('USER cbbot '))).toBe(true);
    await waitFor(() => mock.received.some((l) => l === 'JOIN #cb'));
    expect(mock.received.some((l) => l === 'JOIN #cb')).toBe(true);
  });

  it('gates connect() on the 001 welcome — does NOT resolve on TCP connect alone', async () => {
    // Server accepts the TCP connection and the handshake but never sends 001.
    // If connect() resolved on the TCP 'connect' event it would succeed here;
    // because it gates on 001 it must time out instead.
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    mock = await startMockIrcServer({ withhold001: true });

    channel = new IRCChannel({ ...makeConfig(), connectTimeoutMs: 300 });
    channel.on('error', () => {});

    await expect(channel.connect()).rejects.toThrow(/timed out/i);
    expect(channel.getStatus().connected).toBe(false);
    // The TCP handshake still reached the server (proves it was a real socket).
    expect(mock.received.some((l) => l === 'NICK cbbot')).toBe(true);
  });

  it('responds to PING with a matching PONG', async () => {
    channel = new IRCChannel(makeConfig());
    channel.on('error', () => {});
    await channel.connect();

    mock.sendToClient('PING :keepalive-token');

    // (3) PING -> PONG works.
    await waitFor(() => mock.received.some((l) => l === 'PONG :keepalive-token'));
    expect(mock.received.some((l) => l === 'PONG :keepalive-token')).toBe(true);
  });

  it('sends an outbound PRIVMSG over the socket', async () => {
    channel = new IRCChannel(makeConfig());
    channel.on('error', () => {});
    await channel.connect();

    const result = await channel.send({ channelId: '#cb', content: 'outbound-hello' });
    expect(result.success).toBe(true);

    await waitFor(() => mock.received.some((l) => l === 'PRIVMSG #cb :outbound-hello'));
    expect(mock.received.some((l) => l === 'PRIVMSG #cb :outbound-hello')).toBe(true);
  });

  it('schedules a reconnect when the server force-closes the socket', async () => {
    // Spy on the shared manager BEFORE the adapter is constructed; no-op impl
    // keeps the test hermetic (no real backoff timer leaks) while still letting
    // us assert the reconnect path was driven.
    const scheduleSpy = vi
      .spyOn(ReconnectionManager.prototype, 'scheduleReconnect')
      .mockImplementation(() => {});

    channel = new IRCChannel(makeConfig());
    channel.on('error', () => {});
    let disconnectFired = false;
    channel.on('disconnected', () => {
      disconnectFired = true;
    });

    await channel.connect();
    expect(channel.getStatus().connected).toBe(true);

    // Force-close the server side of the socket — an unexpected drop.
    mock.dropClient();

    // (4) The drop drives scheduleReconnect (synchronously on the close handler).
    await waitFor(() => scheduleSpy.mock.calls.length > 0);
    expect(scheduleSpy).toHaveBeenCalled();
    // The adapter surfaced the drop to the channel as a 'disconnected' event.
    await waitFor(() => disconnectFired);
    expect(disconnectFired).toBe(true);
  });
});

describe('IRCAdapter intentional disconnect', () => {
  let mock: MockServerHandle;

  beforeEach(async () => {
    mock = await startMockIrcServer({ sendWelcomeMessage: false });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('does NOT reconnect after an explicit stop()', async () => {
    const scheduleSpy = vi
      .spyOn(ReconnectionManager.prototype, 'scheduleReconnect')
      .mockImplementation(() => {});

    const adapter = new IRCAdapter({
      server: '127.0.0.1',
      port: mock.port,
      nick: 'cbbot',
      channels: ['#cb'],
      connectTimeoutMs: 3000,
    });
    adapter.on('error', () => {});

    await adapter.start();
    expect(adapter.isRunning()).toBe(true);

    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);

    // Give any erroneous close-driven reconnect a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});
