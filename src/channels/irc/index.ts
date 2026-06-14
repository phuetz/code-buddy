/**
 * IRC Channel Adapter
 *
 * Connects to IRC servers for sending/receiving messages over a real,
 * long-lived TCP (or TLS) socket implementing an RFC 1459/2812 subset.
 * Supports multiple channels, password auth, TLS, and auto-reconnect with
 * exponential backoff (shared ReconnectionManager idiom — same as
 * imessage/discord/slack).
 */

import { EventEmitter } from 'events';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { logger } from '../../utils/logger.js';
import {
  BaseChannel,
  ChannelConfig,
  ContentType,
  DeliveryResult,
  InboundMessage,
  OutboundMessage,
} from '../core.js';
import { ReconnectionManager } from '../reconnection-manager.js';

export interface IRCConfig {
  server: string;
  port?: number;
  nick: string;
  username?: string;
  realname?: string;
  password?: string;
  channels: string[];
  useTLS?: boolean;
  sasl?: boolean;
  /** Milliseconds to wait for the 001 welcome reply before failing connect (default 15000) */
  connectTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface IRCChannelConfig extends ChannelConfig {
  server: string;
  port?: number;
  nick: string;
  username?: string;
  realname?: string;
  password?: string;
  channels: string[];
  useTLS?: boolean;
  sasl?: boolean;
  connectTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * A single parsed IRC protocol line.
 *
 * IRC lines are either prefixed (`:<prefix> <command> <params...>`) or
 * unprefixed (`<command> <params...>`). The final parameter may be a
 * "trailing" param introduced by ` :` which can contain spaces.
 */
interface IRCMessage {
  prefix?: string;
  command: string;
  params: string[];
}

/**
 * Parse a raw IRC line (without the trailing CRLF) into prefix/command/params.
 *
 * Handles both prefixed and unprefixed lines — this distinction is
 * load-bearing: the welcome reply `001 <nick> :Welcome` has NO prefix while
 * `:nick!u@h PRIVMSG #cb :text` does. Treating tokens[0] as always-prefix (or
 * never-prefix) misparses one of them.
 */
export function parseIRCLine(line: string): IRCMessage | null {
  let rest = line;
  let prefix: string | undefined;

  if (rest.startsWith(':')) {
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return null;
    prefix = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1);
  }

  // Split off the trailing parameter (everything after " :") which may
  // contain spaces.
  let trailing: string | undefined;
  const trailingIdx = rest.indexOf(' :');
  if (rest.startsWith(':')) {
    // Whole remainder is the trailing param.
    trailing = rest.slice(1);
    rest = '';
  } else if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  const tokens = rest.length > 0 ? rest.split(' ').filter((t) => t.length > 0) : [];
  const command = tokens.shift();
  if (!command) {
    // Possible only if the line was entirely a trailing param — invalid.
    return null;
  }

  const params = tokens;
  if (trailing !== undefined) params.push(trailing);

  return { prefix, command: command.toUpperCase(), params };
}

/** Extract the nick portion of an IRC prefix (`nick!user@host` → `nick`). */
function nickFromPrefix(prefix?: string): string {
  if (!prefix) return '';
  const bang = prefix.indexOf('!');
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

type Socket = net.Socket | tls.TLSSocket;

export class IRCAdapter extends EventEmitter {
  private config: IRCConfig;
  private running = false;
  private joinedChannels: Set<string> = new Set();
  private socket: Socket | null = null;
  private recvBuffer = '';
  /** True while an intentional disconnect is in progress — suppresses reconnect. */
  private closing = false;
  /** True once a close/error for the current socket has been handled (de-dup). */
  private closeHandled = false;
  private reconnecting = false;
  private reconnectionManager: ReconnectionManager;

  constructor(config: IRCConfig) {
    super();
    this.config = {
      port: config.useTLS ? 6697 : 6667,
      username: config.nick,
      realname: config.nick,
      useTLS: false,
      sasl: false,
      connectTimeoutMs: 15000,
      maxRetries: 10,
      retryDelayMs: 2000,
      ...config,
    };
    // IRC is a genuinely persistent protocol (one long-lived TCP socket); a
    // dropped socket is recovered with the shared exponential-backoff manager,
    // same idiom as discord/imessage/slack.
    this.reconnectionManager = new ReconnectionManager('irc', {
      maxRetries: this.config.maxRetries ?? 10,
      initialDelayMs: this.config.retryDelayMs ?? 2000,
      maxDelayMs: 60000,
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('IRCAdapter is already running');
    }
    logger.debug('IRCAdapter: connecting', {
      server: this.config.server,
      port: this.config.port,
      nick: this.config.nick,
      tls: this.config.useTLS,
    });

    await this.connectInternal();

    // Connectivity confirmed for this session — reset any inherited backoff
    // state so a fresh start() never starts pre-exhausted.
    this.reconnectionManager.onConnected();
    this.running = true;
    this.emit('connected');
    logger.info('IRCAdapter: connected', { server: this.config.server, nick: this.config.nick });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    logger.debug('IRCAdapter: disconnecting');
    this.closing = true;
    this.reconnectionManager.cancel();
    this.reconnecting = false;

    const sock = this.socket;
    if (sock) {
      try {
        if (sock.writable) {
          sock.write('QUIT :Code Buddy signing off\r\n');
        }
      } catch {
        // best-effort QUIT
      }
      sock.removeAllListeners();
      sock.destroy();
    }
    this.socket = null;
    this.recvBuffer = '';
    this.joinedChannels.clear();
    this.running = false;
    this.emit('disconnected');
    logger.info('IRCAdapter: disconnected');
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): IRCConfig {
    return { ...this.config };
  }

  /**
   * Open the socket, perform the registration handshake, and resolve once the
   * server sends the 001 welcome numeric. Used by both start() and the
   * reconnect callback (so it deliberately omits the running-guard).
   */
  private connectInternal(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.closing = false;
      this.closeHandled = false;
      this.recvBuffer = '';

      const host = this.config.server;
      const port = this.config.port ?? (this.config.useTLS ? 6697 : 6667);

      let settled = false;
      let timeout: NodeJS.Timeout | null = null;

      const cleanupSettle = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
      };

      const onWelcome = () => {
        if (settled) return;
        settled = true;
        cleanupSettle();
        resolve();
      };

      const onFail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanupSettle();
        if (sock) {
          sock.removeAllListeners();
          sock.destroy();
        }
        if (this.socket === sock) this.socket = null;
        reject(err);
      };

      const onConnectTcp = () => {
        // TCP is up; perform the IRC registration handshake. The connection is
        // not "ready" until the server replies 001.
        try {
          if (this.config.password) {
            this.write(`PASS ${this.config.password}`);
          }
          this.write(`NICK ${this.config.nick}`);
          this.write(
            `USER ${this.config.username ?? this.config.nick} 0 * :${this.config.realname ?? this.config.nick}`,
          );
        } catch (err) {
          onFail(err instanceof Error ? err : new Error(String(err)));
        }
      };

      let sock: Socket;
      try {
        if (this.config.useTLS) {
          sock = tls.connect({ host, port, servername: host }, onConnectTcp);
        } else {
          sock = net.createConnection({ host, port }, onConnectTcp);
        }
      } catch (err) {
        onFail(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.socket = sock;
      sock.setEncoding('utf8');

      sock.on('data', (chunk: string) => {
        this.handleData(chunk, onWelcome);
      });

      sock.on('error', (err: Error) => {
        if (!settled) {
          onFail(err);
          return;
        }
        this.handleSocketClosed(sock, err);
      });

      sock.on('close', () => {
        if (!settled) {
          onFail(new Error('IRC socket closed before registration completed'));
          return;
        }
        this.handleSocketClosed(sock);
      });

      timeout = setTimeout(() => {
        onFail(new Error(`IRC registration timed out after ${this.config.connectTimeoutMs}ms`));
      }, this.config.connectTimeoutMs ?? 15000);
      timeout.unref?.();
    });
  }

  // ==========================================================================
  // Inbound handling
  // ==========================================================================

  /**
   * Buffer incoming bytes and dispatch complete CRLF-terminated lines.
   * `onWelcome` is invoked when the 001 numeric is seen (resolves connect()).
   */
  private handleData(chunk: string, onWelcome: () => void): void {
    this.recvBuffer += chunk;
    let idx: number;
    // IRC servers terminate lines with \r\n, but be lenient and split on \n.
    while ((idx = this.recvBuffer.indexOf('\n')) !== -1) {
      let line = this.recvBuffer.slice(0, idx);
      this.recvBuffer = this.recvBuffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length === 0) continue;
      this.handleLine(line, onWelcome);
    }
  }

  private handleLine(line: string, onWelcome: () => void): void {
    const msg = parseIRCLine(line);
    if (!msg) return;

    switch (msg.command) {
      case 'PING': {
        // Reply with the same token so the server keeps the link alive.
        const token = msg.params[msg.params.length - 1] ?? '';
        this.write(`PONG :${token}`);
        return;
      }
      case '001': {
        // Welcome numeric — registration succeeded. Join configured channels.
        for (const ch of this.config.channels) {
          this.write(`JOIN ${ch}`);
          this.joinedChannels.add(ch);
        }
        onWelcome();
        return;
      }
      case 'PRIVMSG': {
        this.handlePrivmsg(msg);
        return;
      }
      case 'ERROR': {
        logger.debug('IRCAdapter: server ERROR', { text: msg.params.join(' ') });
        return;
      }
      default:
        // Other numerics / commands are ignored for this subset.
        return;
    }
  }

  private handlePrivmsg(msg: IRCMessage): void {
    const target = msg.params[0] ?? '';
    const text = msg.params[1] ?? '';
    const senderNick = nickFromPrefix(msg.prefix);

    // CTCP ACTION (/me) arrives wrapped in \x01ACTION ... \x01.
    let content = text;
    let contentType: ContentType = 'text';
    if (text.startsWith('ACTION ') && text.endsWith('')) {
      content = text.slice('ACTION '.length, -1);
    }

    const isCommand = content.startsWith('/');
    if (isCommand) contentType = 'command';

    const message: InboundMessage = {
      id: `irc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel: {
        id: target,
        type: 'irc',
        name: target,
        isDM: !target.startsWith('#') && !target.startsWith('&'),
        isGroup: target.startsWith('#') || target.startsWith('&'),
      },
      sender: {
        id: senderNick,
        username: senderNick,
        displayName: senderNick,
      },
      content,
      contentType,
      timestamp: new Date(),
      raw: { prefix: msg.prefix, command: msg.command, params: msg.params },
    };

    if (isCommand) {
      const parts = content.slice(1).split(/\s+/);
      message.isCommand = true;
      message.commandName = parts[0];
      message.commandArgs = parts.slice(1);
    }

    this.emit('message', message);
    if (isCommand) {
      this.emit('command', message);
    }
  }

  // ==========================================================================
  // Reconnection
  // ==========================================================================

  /**
   * Handle a socket 'close' or 'error' that was NOT triggered by an
   * intentional disconnect. De-dupes the error→close pair (ECONNRESET fires
   * 'error' then 'close') and drives a single reconnect via the shared
   * ReconnectionManager.
   */
  private handleSocketClosed(sock: Socket, err?: Error): void {
    // Only act on the socket we currently own and only once per drop.
    if (sock !== this.socket || this.closeHandled) return;
    this.closeHandled = true;

    if (err) {
      logger.warn('IRCAdapter: socket error', { error: err.message });
    }

    sock.removeAllListeners();
    this.socket = null;

    // Intentional disconnect — do not reconnect.
    if (this.closing || !this.running) {
      return;
    }

    logger.warn('IRCAdapter: connection dropped, scheduling reconnect');
    this.emit('disconnected', err ?? new Error('IRC connection dropped'));
    this.reconnect();
  }

  /**
   * Recover a dropped connection via the shared ReconnectionManager
   * (exponential backoff + jitter + exhaustion). `scheduleReconnect` is
   * single-shot, so a failed attempt re-drives it (deferred past the manager's
   * internal active-guard) until recovery or exhaustion.
   */
  private reconnect(): void {
    if (this.reconnecting) return;

    if (this.reconnectionManager.listenerCount('exhausted') === 0) {
      this.reconnectionManager.on('exhausted', () => {
        this.reconnecting = false;
        this.running = false;
        this.emit('disconnected', new Error('IRC reconnection failed after all retries'));
        logger.error('IRCAdapter: reconnection failed permanently');
      });
    }

    this.reconnecting = true;
    this.reconnectionManager.scheduleReconnect(async () => {
      try {
        await this.connectInternal();
        this.reconnecting = false;
        this.reconnectionManager.onConnected();
        this.emit('reconnected');
        this.emit('connected');
        logger.info('IRCAdapter: reconnected successfully');
      } catch (error) {
        // Re-drive after the manager clears its internal active-flag (it does
        // so in its own finally once this closure settles).
        if (this.running && !this.closing) {
          setTimeout(() => {
            if (this.running && this.reconnecting && !this.closing) {
              this.reconnecting = false;
              this.reconnect();
            }
          }, 0).unref?.();
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  }

  // ==========================================================================
  // Outbound / API
  // ==========================================================================

  private write(line: string): void {
    const sock = this.socket;
    if (!sock || !sock.writable) {
      throw new Error('IRCAdapter: socket is not writable');
    }
    sock.write(`${line}\r\n`);
  }

  async sendMessage(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    // Split on newlines: IRC PRIVMSG is one line per message.
    for (const line of text.split(/\r?\n/)) {
      this.write(`PRIVMSG ${target} :${line}`);
    }
    logger.debug('IRCAdapter: PRIVMSG', { target, textLength: text.length });
    return { success: true };
  }

  async sendNotice(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    for (const line of text.split(/\r?\n/)) {
      this.write(`NOTICE ${target} :${line}`);
    }
    logger.debug('IRCAdapter: NOTICE', { target, textLength: text.length });
    return { success: true };
  }

  async sendAction(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.write(`PRIVMSG ${target} :ACTION ${text}`);
    logger.debug('IRCAdapter: ACTION', { target, textLength: text.length });
    return { success: true };
  }

  async joinChannel(channel: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.write(`JOIN ${channel}`);
    this.joinedChannels.add(channel);
    logger.debug('IRCAdapter: JOIN', { channel });
  }

  async partChannel(channel: string, reason?: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.write(reason ? `PART ${channel} :${reason}` : `PART ${channel}`);
    this.joinedChannels.delete(channel);
    logger.debug('IRCAdapter: PART', { channel, reason });
  }

  getJoinedChannels(): string[] {
    return Array.from(this.joinedChannels);
  }

  getNick(): string {
    return this.config.nick;
  }

  async setNick(nick: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.write(`NICK ${nick}`);
    this.config.nick = nick;
    logger.debug('IRCAdapter: NICK', { nick });
  }
}

export class IRCChannel extends BaseChannel {
  private adapter: IRCAdapter | null = null;

  constructor(config: IRCChannelConfig) {
    super('irc', config);
  }

  async connect(): Promise<void> {
    const cfg = this.config as IRCChannelConfig;
    this.adapter = new IRCAdapter({
      server: cfg.server,
      port: cfg.port,
      nick: cfg.nick,
      username: cfg.username,
      realname: cfg.realname,
      password: cfg.password,
      channels: cfg.channels || [],
      useTLS: cfg.useTLS,
      sasl: cfg.sasl,
      connectTimeoutMs: cfg.connectTimeoutMs,
      maxRetries: cfg.maxRetries,
      retryDelayMs: cfg.retryDelayMs,
    });

    // Forward adapter events onto the BaseChannel event surface.
    this.adapter.on('message', (message: InboundMessage) => {
      this.status.lastActivity = new Date();
      this.emit('message', message);
    });
    this.adapter.on('command', (message: InboundMessage) => {
      this.emit('command', message);
    });
    this.adapter.on('reconnected', () => {
      this.status.connected = true;
      this.status.lastActivity = new Date();
    });
    this.adapter.on('disconnected', (err?: Error) => {
      this.status.connected = false;
      // A mid-session 'disconnected' from the adapter means an unexpected drop
      // (the adapter is now reconnecting); surface it without tearing down.
      this.emit('disconnected', this.type, err);
    });
    this.adapter.on('error', (err: Error) => {
      this.status.error = err.message;
      this.emit('error', this.type, err);
    });

    await this.adapter.start();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.emit('connected', this.type);
  }

  async disconnect(): Promise<void> {
    if (this.adapter) {
      if (this.adapter.isRunning()) {
        await this.adapter.stop();
      }
      this.adapter.removeAllListeners();
      this.adapter = null;
    }
    this.status.connected = false;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.adapter || !this.adapter.isRunning()) {
      return { success: false, error: 'Not connected', timestamp: new Date() };
    }
    const target = message.channelId || (this.config as IRCChannelConfig).channels?.[0] || '';
    try {
      const result = await this.adapter.sendMessage(target, message.content);
      this.status.lastActivity = new Date();
      return { success: result.success, timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }
}

export default IRCAdapter;
