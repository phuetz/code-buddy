/**
 * Webhook Server
 *
 * Shared webhook server for handling incoming webhooks from
 * Telegram, Discord, Slack, and other platforms.
 */

import { EventEmitter } from 'events';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { SERVER_CONFIG, TIMEOUT_CONFIG, LIMIT_CONFIG } from '../config/constants.js';
import { enqueueMessage } from './index.js';
import { getPeerRouter } from './peer-routing.js';
import type { ResolvedRoute } from './peer-routing.js';
import type { InboundMessage, ChannelType } from './index.js';
import type { TelegramChannel } from './telegram/index.js';
import type { TelegramUpdate } from './telegram/types.js';
import type { SlackChannel } from './slack/index.js';
import type { SlackEventCallback } from './slack/types.js';

/** Slack webhook body union matching SlackChannel.handleWebhook signature */
type SlackWebhookBody = SlackEventCallback | { type: 'url_verification'; challenge: string };

/**
 * Webhook server configuration
 */
export interface WebhookServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host?: string;
  /** Path prefix for webhooks */
  pathPrefix?: string;
  /** Use HTTPS */
  https?: boolean;
  /** SSL certificate for HTTPS */
  sslCert?: string;
  /** SSL key for HTTPS */
  sslKey?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Maximum request body size in bytes */
  maxBodySize?: number;
}

/**
 * Registered webhook handler
 */
interface WebhookHandler {
  path: string;
  handler: (req: WebhookRequest) => Promise<WebhookResponse>;
}

/**
 * Webhook request
 */
export interface WebhookRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  rawBody: string;
}

/**
 * Webhook response
 */
export interface WebhookResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | object;
}

const DEFAULT_CONFIG: WebhookServerConfig = {
  port: SERVER_CONFIG.DEFAULT_PORT,
  host: SERVER_CONFIG.DEFAULT_HOST,
  pathPrefix: '/webhook',
  timeout: TIMEOUT_CONFIG.DEFAULT_WEBHOOK_TIMEOUT,
  maxBodySize: LIMIT_CONFIG.DEFAULT_WEBHOOK_MAX_BODY_SIZE,
};

/**
 * Webhook server for handling incoming webhooks
 */
export class WebhookServer extends EventEmitter {
  private config: WebhookServerConfig;
  private server: http.Server | https.Server | null = null;
  private handlers: Map<string, WebhookHandler> = new Map();
  private running = false;

  constructor(config: Partial<WebhookServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Webhook server is already running');
    }

    return new Promise((resolve, reject) => {
      const requestHandler = (
        req: http.IncomingMessage,
        res: http.ServerResponse
      ) => {
        this.handleRequest(req, res).catch((error) => {
          this.emit('error', error);
        });
      };

      if (this.config.https && this.config.sslCert && this.config.sslKey) {
        this.server = https.createServer(
          {
            cert: this.config.sslCert,
            key: this.config.sslKey,
          },
          requestHandler
        );
      } else {
        this.server = http.createServer(requestHandler);
      }

      this.server.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.emit('listening', {
          port: this.config.port,
          host: this.config.host,
        });
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.server = null;
        this.emit('closed');
        resolve();
      });
    });
  }

  /**
   * Register a webhook handler
   */
  registerHandler(
    path: string,
    handler: (req: WebhookRequest) => Promise<WebhookResponse>
  ): void {
    const fullPath = `${this.config.pathPrefix}${path}`;
    this.handlers.set(fullPath, { path: fullPath, handler });
  }

  /**
   * Unregister a webhook handler
   */
  unregisterHandler(path: string): void {
    const fullPath = `${this.config.pathPrefix}${path}`;
    this.handlers.delete(fullPath);
  }

  /**
   * Register Telegram webhook handler
   */
  registerTelegram(channel: TelegramChannel, path = '/telegram'): void {
    this.registerHandler(path, async (req) => {
      const secret = req.headers['x-telegram-bot-api-secret-token'] as
        | string
        | undefined;

      const handled = await channel.handleWebhook(req.body as TelegramUpdate, secret);

      return {
        status: handled ? 200 : 401,
        body: { ok: handled },
      };
    });
  }

  /**
   * Register Slack webhook handler
   */
  registerSlack(channel: SlackChannel, path = '/slack'): void {
    this.registerHandler(`${path}/events`, async (req) => {
      const signature = req.headers['x-slack-signature'] as string | undefined;
      const timestamp = req.headers['x-slack-request-timestamp'] as
        | string
        | undefined;

      const result = await channel.handleWebhook(
        req.body as SlackWebhookBody,
        signature,
        timestamp
      );

      return {
        status: 200,
        body: result ? { challenge: result } : { ok: true },
      };
    });

    // Interaction endpoint
    this.registerHandler(`${path}/interactions`, async (req) => {
      const signature = req.headers['x-slack-signature'] as string | undefined;
      const timestamp = req.headers['x-slack-request-timestamp'] as
        | string
        | undefined;

      // Slack sends interactions as form-urlencoded with payload field
      let payload = req.body;
      if (
        typeof req.body === 'object' &&
        'payload' in (req.body as Record<string, unknown>)
      ) {
        payload = JSON.parse((req.body as Record<string, unknown>).payload as string);
      }

      await channel.handleWebhook(payload as SlackWebhookBody, signature, timestamp);

      return { status: 200, body: { ok: true } };
    });

    // Slash commands endpoint
    this.registerHandler(`${path}/commands`, async (req) => {
      const signature = req.headers['x-slack-signature'] as string | undefined;
      const timestamp = req.headers['x-slack-request-timestamp'] as
        | string
        | undefined;

      // Command data comes as form-urlencoded
      const command = req.body;

      // Emit command event - channel will handle it
      await channel.handleWebhook(
        { type: 'slash_command', ...(command as object) } as unknown as SlackWebhookBody,
        signature,
        timestamp
      );

      return { status: 200, body: '' };
    });
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Set timeout
    req.setTimeout(this.config.timeout!);
    res.setTimeout(this.config.timeout!);

    try {
      // Parse URL
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const path = url.pathname;

      // Check for handler
      const handler = this.handlers.get(path);

      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      // Parse body
      const { body, rawBody } = await this.parseBody(req);

      // Create request object
      const webhookRequest: WebhookRequest = {
        method: req.method ?? 'POST',
        path,
        query: url.searchParams,
        headers: req.headers,
        body,
        rawBody,
      };

      // Derive a session key from the webhook path and optional session/chat ID
      // This serializes messages for the same session while allowing parallel
      // processing of different sessions.
      const sessionKey = this.deriveSessionKey(webhookRequest);

      // Attempt peer route resolution from the webhook body
      const resolvedRoute = this.resolveWebhookRoute(webhookRequest);
      if (resolvedRoute) {
        this.emit('route:resolved', resolvedRoute, webhookRequest);
        logger.debug(`Webhook peer route resolved: ${resolvedRoute.matchType} -> agent=${resolvedRoute.agent.agentId || 'default'}`, {
          routeId: resolvedRoute.route.id,
          matchType: resolvedRoute.matchType,
        });
      }

      // Enqueue handler execution through the lane queue for session serialization
      const response = await enqueueMessage(sessionKey, () => handler.handler(webhookRequest));

      // Send response
      const status = response.status ?? 200;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...response.headers,
      };

      res.writeHead(status, headers);

      if (response.body !== undefined) {
        const bodyStr =
          typeof response.body === 'string'
            ? response.body
            : JSON.stringify(response.body);
        res.end(bodyStr);
      } else {
        res.end();
      }

      this.emit('request', {
        path,
        method: req.method,
        status,
      });
    } catch (error) {
      this.emit('error', error);

      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal server error',
        })
      );
    }
  }

  /**
   * Derive a session key from a webhook request.
   *
   * Extracts a chat/channel ID from the request body when possible
   * (e.g. Telegram chat.id, Slack channel), falling back to the
   * webhook path so that all requests for the same endpoint are
   * serialized together.
   */
  private deriveSessionKey(req: WebhookRequest): string {
    const base = `webhook:${req.path}`;

    // Try to extract a session-level identifier from the body
    if (typeof req.body === 'object' && req.body !== null) {
      const body = req.body as Record<string, unknown>;

      // Telegram: message.chat.id or callback_query.message.chat.id
      const message = body.message as Record<string, unknown> | undefined;
      const chatId = (message?.chat as Record<string, unknown> | undefined)?.id;
      if (chatId !== undefined) {
        return `${base}:chat:${chatId}`;
      }

      // Slack: event.channel or channel
      const event = body.event as Record<string, unknown> | undefined;
      const slackChannel = event?.channel ?? body.channel;
      if (slackChannel !== undefined) {
        return `${base}:channel:${slackChannel}`;
      }

      // Generic session_id or sessionId field
      const sessionId = body.session_id ?? body.sessionId;
      if (sessionId !== undefined) {
        return `${base}:session:${sessionId}`;
      }
    }

    return base;
  }

  /**
   * Attempt to resolve a peer route from a webhook request body.
   *
   * Builds a minimal InboundMessage from the webhook payload and
   * runs it through the PeerRouter. Returns null if no route matches
   * or if the body lacks the necessary fields.
   */
  private resolveWebhookRoute(req: WebhookRequest): ResolvedRoute | null {
    try {
      if (typeof req.body !== 'object' || req.body === null) {
        return null;
      }

      const body = req.body as Record<string, unknown>;

      // Try to extract enough info for an InboundMessage
      let channelType: ChannelType = 'api';
      let senderId = 'unknown';
      let channelId = 'unknown';
      let content = '';

      // Telegram webhook body
      const telegramMsg = body.message as Record<string, unknown> | undefined;
      if (telegramMsg) {
        channelType = 'telegram';
        const from = telegramMsg.from as Record<string, unknown> | undefined;
        senderId = String(from?.id ?? 'unknown');
        const chat = telegramMsg.chat as Record<string, unknown> | undefined;
        channelId = String(chat?.id ?? 'unknown');
        content = String(telegramMsg.text ?? '');
      }

      // Slack webhook body
      const slackEvent = body.event as Record<string, unknown> | undefined;
      if (slackEvent && !telegramMsg) {
        channelType = 'slack';
        senderId = String(slackEvent.user ?? 'unknown');
        channelId = String(slackEvent.channel ?? 'unknown');
        content = String(slackEvent.text ?? '');
      }

      const message: InboundMessage = {
        id: `webhook-${Date.now()}`,
        channel: { id: channelId, type: channelType },
        sender: { id: senderId },
        content,
        contentType: 'text',
        timestamp: new Date(),
      };

      const router = getPeerRouter();
      return router.resolve(message);
    } catch {
      return null;
    }
  }

  /**
   * Parse request body
   */
  private async parseBody(
    req: http.IncomingMessage
  ): Promise<{ body: unknown; rawBody: string }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.config.maxBodySize!) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const contentType = req.headers['content-type'] ?? '';

        let body: unknown;

        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          body = Object.fromEntries(new URLSearchParams(rawBody));
        } else {
          body = rawBody;
        }

        resolve({ body, rawBody });
      });

      req.on('error', reject);
    });
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    const protocol = this.config.https ? 'https' : 'http';
    const host =
      this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
    return `${protocol}://${host}:${this.config.port}`;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// Singleton instance
let serverInstance: WebhookServer | null = null;

/**
 * Get webhook server instance
 */
export function getWebhookServer(
  config?: Partial<WebhookServerConfig>
): WebhookServer {
  if (!serverInstance) {
    serverInstance = new WebhookServer(config);
  }
  return serverInstance;
}

/**
 * Reset webhook server
 */
export function resetWebhookServer(): void {
  if (serverInstance) {
    serverInstance.stop().catch((err) => {
      logger.debug('Webhook server stop error (ignored)', { error: err instanceof Error ? err.message : String(err) });
    });
    serverInstance = null;
  }
}

export default WebhookServer;
