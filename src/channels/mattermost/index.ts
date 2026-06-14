/**
 * Mattermost Channel Adapter
 *
 * Connects to Mattermost via its real-time WebSocket gateway
 * (`/api/v4/websocket`) for inbound events and the REST API
 * (`/api/v4/posts`) for outbound messages.
 *
 * Transport details:
 * - Auth: a personal-access / bot token (`config.token`) is sent both as a
 *   `Bearer` header on REST calls and via the WebSocket
 *   `authentication_challenge` action after the socket opens.
 * - Inbound: the WS pushes JSON events; `posted` events carry the new post as
 *   a nested JSON string which we parse into an `InboundMessage`.
 * - Outbound: `send()` POSTs `{channel_id, message}` to `/api/v4/posts`.
 * - Resilience: unintended socket drops are recovered through the shared
 *   `ReconnectionManager` (exponential backoff + jitter), the same idiom used
 *   by the discord / slack / imessage adapters. An explicit `disconnect()`
 *   sets a `closing` flag and cancels any pending reconnect so a deliberate
 *   close never spins the backoff loop.
 */

import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';
import {
  BaseChannel,
  ChannelConfig,
  DeliveryResult,
  InboundMessage,
  OutboundMessage,
} from '../core.js';
import { ReconnectionManager } from '../reconnection-manager.js';

export interface MattermostConfig {
  url: string;
  token: string;
  teamId?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export interface MattermostChannelConfig extends ChannelConfig {
  url: string;
  token: string;
  teamId?: string;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Legacy in-process adapter.
 *
 * @deprecated The real transport now lives in {@link MattermostChannel}, which
 * opens a genuine WebSocket and POSTs through the REST API. This class is kept
 * only for backward-compatible imports (`channels/index.ts` re-export and the
 * `new-channels.test.ts` lifecycle suite) and performs no network I/O.
 */
export class MattermostAdapter {
  private config: MattermostConfig;
  private running = false;

  constructor(config: MattermostConfig) {
    this.config = { ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('MattermostAdapter is already running');
    }
    logger.debug('MattermostAdapter: starting (in-process compatibility shim)', { url: this.config.url });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    logger.debug('MattermostAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(channelId: string, text: string): Promise<{ success: boolean; postId: string }> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    logger.debug('MattermostAdapter: sending message', { channelId, textLength: text.length });
    return { success: true, postId: `mm_${Date.now()}` };
  }

  async sendReply(channelId: string, rootId: string, text: string): Promise<{ success: boolean; postId: string }> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    logger.debug('MattermostAdapter: sending reply', { channelId, rootId, textLength: text.length });
    return { success: true, postId: `mm_reply_${Date.now()}` };
  }

  async getChannels(): Promise<Array<{ id: string; name: string; type: string }>> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    return [];
  }

  getConfig(): MattermostConfig {
    return { ...this.config };
  }
}

/** Shape of a Mattermost post (the nested JSON inside a `posted` event). */
interface MattermostPost {
  id: string;
  user_id: string;
  channel_id: string;
  message: string;
  create_at?: number;
  root_id?: string;
  type?: string;
}

/** Shape of a top-level Mattermost WebSocket event frame. */
interface MattermostWsEvent {
  event?: string;
  seq?: number;
  seq_reply?: number;
  status?: string;
  data?: Record<string, unknown>;
  broadcast?: Record<string, unknown>;
}

/**
 * Convert an `http(s)://host[:port]` base URL into the WebSocket gateway URL.
 *
 * The `^http` anchor maps `https → wss` and `http → ws` cleanly without
 * accidentally rewriting an `http` that appears later in the string.
 */
function toWebSocketUrl(baseUrl: string): string {
  const wsBase = baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${wsBase}/api/v4/websocket`;
}

export class MattermostChannel extends BaseChannel {
  private readonly mmConfig: MattermostConfig;
  private ws: WebSocket | null = null;
  private readonly reconnectionManager: ReconnectionManager;

  /** Monotonic sequence number for outbound WS actions. */
  private seq = 1;
  /** True once `disconnect()` is in progress so drops aren't treated as faults. */
  private closing = false;
  /** Guards against resolving the connect() promise more than once. */
  private connectSettled = false;

  constructor(config: MattermostChannelConfig) {
    super('mattermost', {
      type: 'mattermost',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });

    this.mmConfig = {
      url: config.url,
      token: config.token,
      teamId: config.teamId,
      maxRetries: config.maxRetries,
      retryDelay: config.retryDelay,
    };

    // Persistent WS connection — drops are recovered with shared exponential
    // backoff (same idiom as discord / slack / imessage).
    this.reconnectionManager = new ReconnectionManager('mattermost', {
      maxRetries: this.mmConfig.maxRetries ?? 10,
      initialDelayMs: this.mmConfig.retryDelay ?? 1000,
      maxDelayMs: 60000,
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async connect(): Promise<void> {
    this.closing = false;
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected && !this.ws) return;

    // Mark intentional so the 'close'/'error' handlers don't schedule a
    // reconnect, then cancel any reconnect already pending.
    this.closing = true;
    this.reconnectionManager.cancel();

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (error) {
        logger.debug('MattermostChannel: error closing socket', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.ws = null;
    }

    this.status.connected = false;
    this.status.authenticated = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const url = `${this.mmConfig.url.replace(/\/+$/, '')}/api/v4/posts`;
      const body: Record<string, unknown> = {
        channel_id: message.channelId,
        message: message.content,
      };
      if (message.replyTo) {
        body.root_id = message.replyTo;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.mmConfig.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Mattermost API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
        );
      }

      const post = (await response.json()) as MattermostPost;
      this.status.lastActivity = new Date();
      return {
        success: true,
        messageId: post.id,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  // ==========================================================================
  // WebSocket transport
  // ==========================================================================

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectSettled = false;
      const wsUrl = toWebSocketUrl(this.mmConfig.url);
      logger.debug('MattermostChannel: opening WebSocket', { wsUrl });

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.ws = ws;

      ws.on('open', () => {
        // Mattermost expects the auth challenge as the first frame after open.
        this.sendAction('authentication_challenge', { token: this.mmConfig.token });
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString()) as MattermostWsEvent;
          this.handleWsEvent(event, resolve);
        } catch (error) {
          logger.warn('MattermostChannel: failed to parse WS frame', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      ws.on('close', () => {
        this.handleDrop();
      });

      ws.on('error', (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (this.listenerCount('error') > 0) {
          this.emit('error', this.type, err);
        }
        if (!this.connectSettled) {
          this.connectSettled = true;
          reject(err);
        }
        this.handleDrop();
      });
    });
  }

  private handleWsEvent(event: MattermostWsEvent, resolveConnect: () => void): void {
    // The `hello` event (or a successful auth reply) confirms the session.
    const authedReply = event.seq_reply !== undefined && event.status === 'OK';
    if (event.event === 'hello' || authedReply) {
      this.onAuthenticated();
      if (!this.connectSettled) {
        this.connectSettled = true;
        resolveConnect();
      }
      return;
    }

    if (event.event === 'posted') {
      this.handlePostedEvent(event);
      return;
    }

    // Respond to a server-side ping with a pong when applicable.
    if (event.event === 'ping') {
      this.sendAction('pong', {});
    }
  }

  private onAuthenticated(): void {
    // Connectivity confirmed — reset the shared backoff state so a future drop
    // starts from delay 0 rather than inheriting a stale retryCount.
    this.reconnectionManager.onConnected();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.emit('connected', this.type);
    logger.debug('MattermostChannel: authenticated and connected');
  }

  private handlePostedEvent(event: MattermostWsEvent): void {
    const rawPost = event.data?.['post'];
    if (typeof rawPost !== 'string') return;

    let post: MattermostPost;
    try {
      post = JSON.parse(rawPost) as MattermostPost;
    } catch (error) {
      logger.warn('MattermostChannel: failed to parse nested post JSON', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // System posts (joins, header changes, …) have a non-empty `type` — skip.
    if (post.type) return;

    const channelName =
      typeof event.data?.['channel_name'] === 'string'
        ? (event.data['channel_name'] as string)
        : undefined;

    const inbound: InboundMessage = {
      id: post.id,
      channel: {
        id: post.channel_id,
        type: 'mattermost',
        name: channelName,
      },
      sender: {
        id: post.user_id,
      },
      content: post.message,
      contentType: 'text',
      timestamp: post.create_at ? new Date(post.create_at) : new Date(),
      threadId: post.root_id || undefined,
      replyTo: post.root_id || undefined,
      raw: { event, post },
    };

    this.status.lastActivity = new Date();
    const parsed = this.parseCommand(inbound);
    this.emit('message', parsed);
    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Handle a socket drop. If the close was intentional (`disconnect()`), do
   * nothing. Otherwise schedule a reconnect through the shared manager.
   */
  private handleDrop(): void {
    if (this.closing) return;

    const wasConnected = this.status.connected;
    this.status.connected = false;
    this.status.authenticated = false;

    // Tear down the dead socket so we don't double-handle further events.
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    if (wasConnected) {
      this.emit('disconnected', this.type);
    }

    logger.debug('MattermostChannel: connection dropped, scheduling reconnect');
    this.reconnectionManager.scheduleReconnect(async () => {
      await this.openSocket();
      // onConnected() is called from onAuthenticated() once `hello` arrives.
    });
  }

  private sendAction(action: string, data: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        seq: this.seq++,
        action,
        data,
      }),
    );
  }

  /** Expose the resolved WS gateway URL (handy for diagnostics / tests). */
  getWebSocketUrl(): string {
    return toWebSocketUrl(this.mmConfig.url);
  }

  getConfig(): MattermostConfig {
    return { ...this.mmConfig };
  }
}

export default MattermostChannel;
