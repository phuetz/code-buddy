import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import { SERVER_CONFIG } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import type {
  CognitiveContextAck,
  CognitivePublishAck,
  CognitiveSnapshot,
  CognitiveSubscriptionEvent,
} from './cognitive-hub.js';
import {
  cognitiveContextAcquireRequestSchema,
  cognitiveDraftSchema,
  COGNITIVE_WIRE_VERSION,
  WORKSPACE_KINDS,
  WORKSPACE_PRIVACY,
  type CognitiveContextAcquireRequest,
  type CognitiveDraft,
} from './cognitive-wire-contract.js';
import type { WorkspaceItem, WorkspaceKind } from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SNAPSHOT_PAGE_SIZE = 128;
const DEFAULT_LIVE_BUFFER_CAPACITY = 512;
const DEFAULT_DEDUPE_CAPACITY = 4_096;
const DEFAULT_RECONNECT_INITIAL_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ])
);

const workspaceItemSchema: z.ZodType<WorkspaceItem> = z
  .object({
    id: z.string().min(1).max(160),
    kind: z.enum(WORKSPACE_KINDS),
    producerId: z.string().min(1).max(256),
    correlationId: z.string().min(1).max(128),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    salience: z.number().finite().min(0).max(1),
    confidence: z.number().finite().min(0).max(1),
    privacy: z.enum(WORKSPACE_PRIVACY),
    provenance: z
      .object({
        source: z.string().min(1).max(256),
        derivedFrom: z.array(z.string().min(1).max(160)).max(16).optional(),
      })
      .strict(),
    payload: jsonValueSchema,
    revision: z.number().int().positive(),
    depth: z.number().int().nonnegative(),
    dedupeKey: z.string().min(1).max(128).optional(),
  })
  .strict();

const publishAckSchema: z.ZodType<CognitivePublishAck> = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    revision: z.number().int().positive(),
    replayed: z.boolean(),
    item: workspaceItemSchema,
  })
  .strict();

const subscriptionAckSchema = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    afterRevision: z.number().int().nonnegative(),
  })
  .strict();

const subscriptionEventSchema: z.ZodType<CognitiveSubscriptionEvent> = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    revision: z.number().int().positive(),
    item: workspaceItemSchema,
  })
  .strict()
  .refine((event) => event.revision === event.item.revision, {
    message: 'event and item revisions differ',
  });

const snapshotSchema: z.ZodType<CognitiveSnapshot> = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    items: z.array(workspaceItemSchema).max(256),
  })
  .strict();

const contextAckSchema: z.ZodType<CognitiveContextAck> = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    leaseId: z.string().uuid().nullable(),
    turnContext: z.string(),
    evidence: z.string(),
    itemIds: z.array(z.string().min(1).max(160)).max(16),
  })
  .strict();

const leaseAckSchema = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    leaseId: z.string().uuid(),
  })
  .strict();

const cancelAckSchema = z
  .object({
    version: z.literal(COGNITIVE_WIRE_VERSION),
    serverEpoch: z.string().uuid(),
    cancelled: z.boolean(),
  })
  .strict();

interface GatewayFrame {
  type: string;
  requestId?: string;
  id?: string;
  payload?: unknown;
  error?: { code?: unknown; message?: unknown };
}

interface PendingRequest {
  expectedType: string;
  schema: z.ZodTypeAny;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CognitiveBusClientOptions {
  /** Gateway endpoint, for example ws://127.0.0.1:3000/ws. */
  wsUrl: string;
  /** Defaults to the HTTP origin beside wsUrl plus /api/cognition. */
  httpBaseUrl?: string;
  apiKey?: string;
  jwt?: string;
  kinds?: readonly WorkspaceKind[];
  requestTimeoutMs?: number;
  snapshotPageSize?: number;
  liveBufferCapacity?: number;
  dedupeCapacity?: number;
  autoReconnect?: boolean;
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface CognitiveContextHandle {
  readonly leaseId: string | null;
  readonly turnContext: string;
  readonly evidence: string;
  readonly itemIds: readonly string[];
  commit(): Promise<void>;
  release(): Promise<void>;
}

export type CognitiveEventListener = (event: CognitiveSubscriptionEvent) => void;

export class CognitiveBusClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CognitiveBusClientError';
  }
}

function asGatewayFrame(value: unknown): GatewayFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string') return null;
  const error =
    record.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? (record.error as { code?: unknown; message?: unknown })
      : undefined;
  return {
    type: record.type,
    ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...('payload' in record ? { payload: record.payload } : {}),
    ...(error ? { error } : {}),
  };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function inferHttpBaseUrl(wsUrl: URL): string {
  const url = new URL(wsUrl.toString());
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = url.pathname.replace(/\/ws\/?$/, '').replace(/\/$/, '') + '/api/cognition';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Resumable cross-process cognitive bus client.
 *
 * It subscribes before taking an HTTP snapshot, buffers live events during
 * recovery, and only then drains the buffer. This closes the otherwise subtle
 * subscribe/snapshot race without pretending WebSocket delivery is durable.
 */
export class CognitiveBusClient extends EventEmitter {
  private readonly options: CognitiveBusClientOptions;
  private readonly wsUrl: URL;
  private readonly httpBaseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly snapshotPageSize: number;
  private readonly liveBufferCapacity: number;
  private readonly dedupeCapacity: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly kinds?: readonly WorkspaceKind[];
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private seen = new Map<string, true>();
  private liveBuffer: CognitiveSubscriptionEvent[] = [];
  private cursor = 0;
  private serverEpoch: string | null = null;
  private desiredConnected = false;
  private ready = false;
  private recovering = false;
  private recoveryRequested = false;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private generation = 0;
  private hasEverBeenReady = false;

  constructor(options: CognitiveBusClientOptions) {
    super();
    this.options = options;
    this.wsUrl = new URL(options.wsUrl);
    if (!['ws:', 'wss:'].includes(this.wsUrl.protocol)) {
      throw new CognitiveBusClientError('COGNITION_INVALID_URL', 'wsUrl must use ws: or wss:');
    }
    if (this.wsUrl.protocol === 'ws:' && !isLoopbackHostname(this.wsUrl.hostname)) {
      throw new CognitiveBusClientError(
        'COGNITION_INSECURE_TRANSPORT',
        'non-loopback cognitive connections require wss'
      );
    }
    const inferredHttp = options.httpBaseUrl ?? inferHttpBaseUrl(this.wsUrl);
    const httpUrl = new URL(inferredHttp);
    if (httpUrl.protocol === 'http:' && !isLoopbackHostname(httpUrl.hostname)) {
      throw new CognitiveBusClientError(
        'COGNITION_INSECURE_TRANSPORT',
        'non-loopback cognitive snapshot recovery requires https'
      );
    }
    this.httpBaseUrl = httpUrl.toString().replace(/\/$/, '');
    this.requestTimeoutMs = clampInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      100,
      120_000
    );
    this.snapshotPageSize = clampInteger(
      options.snapshotPageSize,
      DEFAULT_SNAPSHOT_PAGE_SIZE,
      1,
      256
    );
    this.liveBufferCapacity = clampInteger(
      options.liveBufferCapacity,
      DEFAULT_LIVE_BUFFER_CAPACITY,
      1,
      4_096
    );
    this.dedupeCapacity = clampInteger(options.dedupeCapacity, DEFAULT_DEDUPE_CAPACITY, 16, 65_536);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.kinds = options.kinds ? [...new Set(options.kinds)] : undefined;
    this.on('error', () => undefined);
  }

  get isReady(): boolean {
    return this.ready;
  }

  get currentRevision(): number {
    return this.cursor;
  }

  get currentServerEpoch(): string | null {
    return this.serverEpoch;
  }

  async connect(): Promise<void> {
    this.desiredConnected = true;
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.clearReconnectTimer();
    const attempt = this.openConnection();
    this.connecting = attempt;
    try {
      await attempt;
    } catch (error) {
      if (!this.hasEverBeenReady) this.desiredConnected = false;
      throw error;
    } finally {
      if (this.connecting === attempt) this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    this.desiredConnected = false;
    this.clearReconnectTimer();
    this.ready = false;
    this.recovering = false;
    this.recoveryRequested = false;
    this.liveBuffer.length = 0;
    this.generation++;
    this.rejectPending(
      new CognitiveBusClientError('COGNITION_DISCONNECTED', 'client disconnected')
    );
    const socket = this.ws;
    this.ws = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, 'client disconnect');
    });
  }

  subscribe(listener: CognitiveEventListener): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }

  async publish(draft: CognitiveDraft, clientEventId = randomUUID()): Promise<CognitivePublishAck> {
    const parsedDraft = cognitiveDraftSchema.parse(draft);
    return this.request(
      'cognition.publish',
      { version: COGNITIVE_WIRE_VERSION, clientEventId, draft: parsedDraft },
      'cognition.published',
      publishAckSchema
    );
  }

  async cancel(correlationId: string): Promise<boolean> {
    const ack = await this.request(
      'cognition.cancel',
      { version: COGNITIVE_WIRE_VERSION, correlationId },
      'cognition.cancelled',
      cancelAckSchema
    );
    return ack.cancelled;
  }

  async acquireContext(
    options: Omit<CognitiveContextAcquireRequest, 'version'> = {}
  ): Promise<CognitiveContextHandle> {
    const request = cognitiveContextAcquireRequestSchema.parse({
      version: COGNITIVE_WIRE_VERSION,
      ...options,
    });
    const ack = await this.request(
      'cognition.context.acquire',
      request,
      'cognition.context.acquired',
      contextAckSchema
    );
    const leaseGeneration = this.generation;
    let settlement: Promise<void> | null = ack.leaseId === null ? Promise.resolve() : null;
    const settle = (operation: 'commit' | 'release'): Promise<void> => {
      if (settlement) return settlement;
      if (leaseGeneration !== this.generation || !this.ready) {
        settlement = Promise.reject(
          new CognitiveBusClientError(
            'COGNITION_LEASE_LOST',
            'context lease was released when the cognitive connection changed'
          )
        );
        return settlement;
      }
      if (!ack.leaseId) {
        settlement = Promise.resolve();
        return settlement;
      }
      const responseType =
        operation === 'commit' ? 'cognition.context.committed' : 'cognition.context.released';
      // Claim settlement synchronously. Concurrent commit/release callers must
      // share one wire operation; retrying an uncertain lease is unsafe.
      settlement = this.request(
        `cognition.context.${operation}`,
        { version: COGNITIVE_WIRE_VERSION, leaseId: ack.leaseId },
        responseType,
        leaseAckSchema
      ).then(() => undefined);
      return settlement;
    };
    return {
      leaseId: ack.leaseId,
      turnContext: ack.turnContext,
      evidence: ack.evidence,
      itemIds: ack.itemIds,
      commit: () => settle('commit'),
      release: () => settle('release'),
    };
  }

  private async openConnection(): Promise<void> {
    const socket = new WebSocket(this.wsUrl, {
      maxPayload: SERVER_CONFIG.WS_MAX_PAYLOAD_BYTES,
    });
    this.ws = socket;
    let settled = false;
    let sessionStarted = false;
    let closeHandled = false;

    return new Promise<void>((resolve, reject) => {
      const connectTimer = setTimeout(() => {
        fail(
          new CognitiveBusClientError('COGNITION_CONNECT_TIMEOUT', 'cognitive gateway timed out')
        );
      }, this.requestTimeoutMs);

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve();
      };

      const fail = (error: Error): void => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(error);
        } else {
          this.emit('error', error);
        }
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1011, 'cognitive session failed');
        }
      };

      const startSession = (): void => {
        if (sessionStarted) return;
        sessionStarted = true;
        void this.initializeSession(socket)
          .then(finish)
          .catch((error: unknown) => fail(this.asClientError(error)));
      };

      socket.on('message', (data: RawData) => {
        try {
          const parsed: unknown = JSON.parse(data.toString());
          const frame = asGatewayFrame(parsed);
          if (!frame)
            throw new CognitiveBusClientError(
              'COGNITION_PROTOCOL_ERROR',
              'gateway sent an invalid frame'
            );
          if (frame.type === 'connected') {
            const payload = frame.payload as Record<string, unknown> | undefined;
            if (payload?.authRequired === true) {
              if (!this.options.apiKey && !this.options.jwt) {
                throw new CognitiveBusClientError(
                  'COGNITION_AUTH_REQUIRED',
                  'gateway requires apiKey or jwt'
                );
              }
              socket.send(
                JSON.stringify({
                  type: 'authenticate',
                  payload: {
                    ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
                    ...(this.options.jwt ? { token: this.options.jwt } : {}),
                  },
                })
              );
            } else {
              startSession();
            }
            return;
          }
          if (frame.type === 'authenticated') {
            startSession();
            return;
          }
          this.handleFrame(frame, socket);
        } catch (error) {
          fail(this.asClientError(error));
        }
      });

      socket.once('error', (error) => {
        fail(
          new CognitiveBusClientError(
            'COGNITION_SOCKET_ERROR',
            `cognitive gateway socket failed: ${error.message}`,
            error
          )
        );
      });

      socket.once('close', () => {
        if (closeHandled) return;
        closeHandled = true;
        clearTimeout(connectTimer);
        if (!settled) {
          settled = true;
          reject(
            new CognitiveBusClientError(
              'COGNITION_DISCONNECTED',
              'cognitive gateway disconnected before recovery completed'
            )
          );
        }
        this.handleSocketClosed(socket);
      });
    });
  }

  private async initializeSession(socket: WebSocket): Promise<void> {
    if (socket !== this.ws || socket.readyState !== WebSocket.OPEN) {
      throw new CognitiveBusClientError('COGNITION_DISCONNECTED', 'cognitive socket is not open');
    }
    this.recovering = true;
    this.recoveryRequested = false;
    const previousEpoch = this.serverEpoch;
    const requestedCursor = this.cursor;
    let ack = await this.request(
      'cognition.subscribe',
      {
        version: COGNITIVE_WIRE_VERSION,
        afterRevision: requestedCursor,
        ...(this.kinds ? { kinds: this.kinds } : {}),
      },
      'cognition.subscribed',
      subscriptionAckSchema
    );
    if (previousEpoch && ack.serverEpoch !== previousEpoch) {
      this.resetForEpoch(ack.serverEpoch);
      ack = await this.request(
        'cognition.subscribe',
        {
          version: COGNITIVE_WIRE_VERSION,
          afterRevision: 0,
          ...(this.kinds ? { kinds: this.kinds } : {}),
        },
        'cognition.subscribed',
        subscriptionAckSchema
      );
    } else {
      this.serverEpoch = ack.serverEpoch;
    }
    await this.recoverUntilStable(socket);
    if (socket !== this.ws || socket.readyState !== WebSocket.OPEN) {
      throw new CognitiveBusClientError('COGNITION_DISCONNECTED', 'socket changed during recovery');
    }
    this.recovering = false;
    this.drainLiveBuffer();
    this.ready = true;
    this.hasEverBeenReady = true;
    this.reconnectAttempt = 0;
    this.generation++;
    this.emit('ready', {
      serverEpoch: this.serverEpoch,
      revision: this.cursor,
    });
  }

  private handleFrame(frame: GatewayFrame, socket: WebSocket): void {
    if (frame.type === 'cognition.event') {
      const event = subscriptionEventSchema.parse(frame.payload);
      this.handleLiveEvent(event, socket);
      return;
    }
    if (frame.type === 'cognition.gap') {
      this.recoveryRequested = true;
      if (!this.recovering) {
        this.recovering = true;
        void this.recoverUntilStable(socket)
          .then(() => {
            if (socket !== this.ws || socket.readyState !== WebSocket.OPEN) return;
            this.recovering = false;
            this.drainLiveBuffer();
            this.emit('recovered', { serverEpoch: this.serverEpoch, revision: this.cursor });
          })
          .catch((error: unknown) => {
            this.emit('error', this.asClientError(error));
            socket.close(1013, 'snapshot recovery failed');
          });
      }
      return;
    }

    const requestId = frame.requestId ?? frame.id;
    if (frame.type === 'error' && !requestId) {
      throw new CognitiveBusClientError(
        typeof frame.error?.code === 'string' ? frame.error.code : 'COGNITION_GATEWAY_ERROR',
        typeof frame.error?.message === 'string' ? frame.error.message : 'gateway rejected request'
      );
    }
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (frame.type === 'cognition.error' || frame.type === 'error') {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(
        new CognitiveBusClientError(
          typeof frame.error?.code === 'string' ? frame.error.code : 'COGNITION_REQUEST_FAILED',
          typeof frame.error?.message === 'string'
            ? frame.error.message
            : 'cognitive request failed'
        )
      );
      return;
    }
    if (frame.type !== pending.expectedType) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    try {
      pending.resolve(pending.schema.parse(frame.payload));
    } catch (error) {
      pending.reject(
        new CognitiveBusClientError(
          'COGNITION_PROTOCOL_ERROR',
          `invalid ${frame.type} response`,
          error
        )
      );
    }
  }

  private handleLiveEvent(event: CognitiveSubscriptionEvent, socket: WebSocket): void {
    if (socket !== this.ws) return;
    if (this.serverEpoch && event.serverEpoch !== this.serverEpoch) {
      this.recoveryRequested = true;
      this.recovering = true;
    }
    if (this.recovering || !this.ready) {
      if (this.liveBuffer.length >= this.liveBufferCapacity) {
        socket.close(1013, 'cognitive live buffer overflow');
        return;
      }
      this.liveBuffer.push(event);
      return;
    }
    this.deliver(event);
  }

  private async recoverUntilStable(socket: WebSocket): Promise<void> {
    do {
      this.recoveryRequested = false;
      await this.recoverSnapshot(socket);
    } while (this.recoveryRequested && socket === this.ws && socket.readyState === WebSocket.OPEN);
  }

  private async recoverSnapshot(socket: WebSocket): Promise<void> {
    let afterRevision = this.cursor;
    for (let page = 0; page < 100_000; page++) {
      if (socket !== this.ws || socket.readyState !== WebSocket.OPEN) {
        throw new CognitiveBusClientError(
          'COGNITION_DISCONNECTED',
          'socket closed during recovery'
        );
      }
      const snapshot = await this.fetchSnapshot(afterRevision);
      if (this.serverEpoch && snapshot.serverEpoch !== this.serverEpoch) {
        throw new CognitiveBusClientError(
          'COGNITION_EPOCH_CHANGED',
          'cognitive server restarted during snapshot recovery'
        );
      }
      this.serverEpoch = snapshot.serverEpoch;
      const items = [...snapshot.items].sort((left, right) => left.revision - right.revision);
      for (const item of items) {
        this.deliver({
          version: COGNITIVE_WIRE_VERSION,
          serverEpoch: snapshot.serverEpoch,
          revision: item.revision,
          item,
        });
      }
      const last = items.at(-1);
      if (items.length < this.snapshotPageSize) {
        this.cursor = Math.max(this.cursor, snapshot.revision);
        return;
      }
      if (!last || last.revision <= afterRevision) {
        throw new CognitiveBusClientError(
          'COGNITION_PROTOCOL_ERROR',
          'snapshot pagination did not advance'
        );
      }
      afterRevision = last.revision;
      this.cursor = Math.max(this.cursor, afterRevision);
    }
    throw new CognitiveBusClientError(
      'COGNITION_RECOVERY_LIMIT',
      'snapshot recovery page limit exceeded'
    );
  }

  private async fetchSnapshot(afterRevision: number): Promise<CognitiveSnapshot> {
    const url = new URL(`${this.httpBaseUrl}/snapshot`);
    url.searchParams.set('afterRevision', String(afterRevision));
    url.searchParams.set('limit', String(this.snapshotPageSize));
    if (this.kinds?.length) url.searchParams.set('kinds', this.kinds.join(','));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(this.options.apiKey ? { 'x-api-key': this.options.apiKey } : {}),
          ...(this.options.jwt ? { authorization: `Bearer ${this.options.jwt}` } : {}),
        },
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        const error =
          record.error && typeof record.error === 'object'
            ? (record.error as Record<string, unknown>)
            : {};
        throw new CognitiveBusClientError(
          typeof error.code === 'string' ? error.code : 'COGNITION_SNAPSHOT_FAILED',
          typeof error.message === 'string'
            ? error.message
            : `snapshot failed with HTTP ${response.status}`
        );
      }
      return snapshotSchema.parse(body);
    } catch (error) {
      if (error instanceof CognitiveBusClientError) throw error;
      throw new CognitiveBusClientError(
        'COGNITION_SNAPSHOT_FAILED',
        'cognitive snapshot recovery failed',
        error
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private drainLiveBuffer(): void {
    const buffered = this.liveBuffer
      .splice(0)
      .filter((event) => event.serverEpoch === this.serverEpoch)
      .sort((left, right) => left.revision - right.revision);
    for (const event of buffered) this.deliver(event);
  }

  private deliver(event: CognitiveSubscriptionEvent): void {
    if (event.serverEpoch !== this.serverEpoch) return;
    const key = `${event.item.id}:${event.revision}`;
    if (this.seen.has(key)) return;
    this.seen.set(key, true);
    while (this.seen.size > this.dedupeCapacity) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (!oldest) break;
      this.seen.delete(oldest);
    }
    this.cursor = Math.max(this.cursor, event.revision);
    this.emit('event', event);
  }

  private resetForEpoch(serverEpoch: string): void {
    this.serverEpoch = serverEpoch;
    this.cursor = 0;
    this.seen.clear();
    this.liveBuffer = this.liveBuffer.filter((event) => event.serverEpoch === serverEpoch);
    this.emit('epoch', { serverEpoch });
  }

  private request<T>(
    type: string,
    payload: unknown,
    expectedType: string,
    schema: z.ZodType<T>
  ): Promise<T> {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new CognitiveBusClientError('COGNITION_DISCONNECTED', 'cognitive gateway is not connected')
      );
    }
    const requestId = randomUUID();
    const encoded = JSON.stringify({ type, requestId, payload });
    if (Buffer.byteLength(encoded) > SERVER_CONFIG.WS_MAX_PAYLOAD_BYTES) {
      return Promise.reject(
        new CognitiveBusClientError(
          'COGNITION_PAYLOAD_TOO_LARGE',
          'cognitive request exceeds the WebSocket payload limit'
        )
      );
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new CognitiveBusClientError('COGNITION_REQUEST_TIMEOUT', `${type} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        expectedType,
        schema,
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timer,
      });
      socket.send(encoded, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.reject(
          new CognitiveBusClientError('COGNITION_SEND_FAILED', `${type} could not be sent`, error)
        );
      });
    });
  }

  private handleSocketClosed(socket: WebSocket): void {
    if (this.ws !== socket) return;
    this.ws = null;
    const wasReady = this.ready;
    this.ready = false;
    this.recovering = false;
    this.recoveryRequested = false;
    this.liveBuffer.length = 0;
    this.generation++;
    this.rejectPending(
      new CognitiveBusClientError('COGNITION_DISCONNECTED', 'cognitive gateway disconnected')
    );
    this.emit('disconnected', { revision: this.cursor, serverEpoch: this.serverEpoch });
    if (
      this.desiredConnected &&
      this.options.autoReconnect !== false &&
      (wasReady || this.hasEverBeenReady)
    ) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.desiredConnected) return;
    const initial = clampInteger(
      this.options.reconnectInitialMs,
      DEFAULT_RECONNECT_INITIAL_MS,
      50,
      60_000
    );
    const maximum = clampInteger(
      this.options.reconnectMaxMs,
      DEFAULT_RECONNECT_MAX_MS,
      initial,
      300_000
    );
    const delay = Math.min(maximum, initial * 2 ** Math.min(this.reconnectAttempt, 20));
    const jittered = Math.max(10, Math.round(delay * (0.8 + Math.random() * 0.4)));
    this.reconnectAttempt++;
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs: jittered });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.desiredConnected || this.connecting) return;
      const attempt = this.openConnection();
      this.connecting = attempt;
      void attempt
        .then(() =>
          this.emit('reconnected', {
            attempt: this.reconnectAttempt,
            revision: this.cursor,
            serverEpoch: this.serverEpoch,
          })
        )
        .catch((error: unknown) => {
          logger.debug('[cognition-client] reconnect failed', {
            error: error instanceof Error ? error.message : String(error),
            attempt: this.reconnectAttempt,
          });
          this.scheduleReconnect();
        })
        .finally(() => {
          if (this.connecting === attempt) this.connecting = null;
        });
    }, jittered);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private asClientError(error: unknown): CognitiveBusClientError {
    if (error instanceof CognitiveBusClientError) return error;
    if (error instanceof z.ZodError) {
      return new CognitiveBusClientError(
        'COGNITION_PROTOCOL_ERROR',
        'cognitive gateway sent data outside the wire contract',
        error
      );
    }
    return new CognitiveBusClientError(
      'COGNITION_CLIENT_ERROR',
      error instanceof Error ? error.message : String(error),
      error
    );
  }
}
