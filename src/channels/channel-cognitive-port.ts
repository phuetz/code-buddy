import { createHash } from 'node:crypto';
import {
  CognitiveBusClient,
  type CognitiveContextHandle,
} from '../cognition/cognitive-bus-client.js';
import type { ModelEgress } from '../providers/model-egress.js';
import { logger } from '../utils/logger.js';

export interface ChannelCognitiveTurn {
  readonly correlationId: string;
  readonly turnContext: string;
  readonly evidence: string;
  complete(deliveredContent: string, options?: { cancelAfter?: boolean }): Promise<void>;
  fail(): Promise<void>;
  cancel(): Promise<void>;
}

export interface ChannelCognitivePort {
  begin(input: {
    channelType: string;
    sessionKey: string;
    messageId: string;
    content: string;
    egress: ModelEgress;
  }): Promise<ChannelCognitiveTurn | null>;
  close(): Promise<void>;
}

type CognitiveBusConnection = Pick<
  CognitiveBusClient,
  'on' | 'isReady' | 'connect' | 'disconnect' | 'publish' | 'acquireContext' | 'cancel'
>;

function deterministicUuid(value: string): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = createHash('sha1').update(`codebuddy-cognition:${value}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeSurface(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.:@/-]/g, '-')
      .slice(0, 64) || 'channel'
  );
}

function maxPrivacyFor(egress: ModelEgress): 'local-only' | 'trusted-lan' | 'cloud-ok' {
  if (egress === 'local') return 'local-only';
  if (egress === 'lan') return 'trusted-lan';
  return 'cloud-ok';
}

function defaultCognitiveWsUrl(): string {
  return process.env.CODEBUDDY_COGNITIVE_WS_URL?.trim() || 'ws://127.0.0.1:3055/ws';
}

/**
 * Cross-process channel adapter. Conversation delivery remains fail-soft when
 * the cognitive service is absent; a lease is nevertheless settled exactly
 * once whenever the service accepted it.
 */
export class WebSocketChannelCognitivePort implements ChannelCognitivePort {
  private readonly client: CognitiveBusConnection;
  private connectPromise: Promise<void> | null = null;

  constructor(client?: CognitiveBusConnection) {
    this.client =
      client ??
      new CognitiveBusClient({
        wsUrl: defaultCognitiveWsUrl(),
        ...(process.env.CODEBUDDY_COGNITIVE_HTTP_URL?.trim()
          ? { httpBaseUrl: process.env.CODEBUDDY_COGNITIVE_HTTP_URL.trim() }
          : {}),
        ...(process.env.CODEBUDDY_COGNITIVE_API_KEY?.trim()
          ? { apiKey: process.env.CODEBUDDY_COGNITIVE_API_KEY.trim() }
          : {}),
        ...(process.env.CODEBUDDY_COGNITIVE_JWT?.trim()
          ? { jwt: process.env.CODEBUDDY_COGNITIVE_JWT.trim() }
          : {}),
        autoReconnect: true,
        requestTimeoutMs: 3_000,
      });
    this.client.on('error', (error: unknown) => {
      logger.debug('[channel-cognition] background client error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async begin(input: {
    channelType: string;
    sessionKey: string;
    messageId: string;
    content: string;
    egress: ModelEgress;
  }): Promise<ChannelCognitiveTurn | null> {
    if (process.env.CODEBUDDY_COGNITION_ENABLED !== 'true') return null;
    const surface = safeSurface(input.channelType);
    const turnFingerprint = createHash('sha256')
      .update(`${surface}\0${input.sessionKey}\0${input.messageId}`)
      .digest('hex')
      .slice(0, 40);
    const correlationId = `channel:${surface}:${turnFingerprint}`;
    let userPublished = false;
    let context: CognitiveContextHandle | null = null;
    try {
      await this.ensureConnected();
      await this.client.publish(
        {
          kind: 'utterance',
          correlationId,
          salience: 0.8,
          confidence: 1,
          privacy: 'local-only',
          dedupeKey: `channel-user-${turnFingerprint}`,
          payload: {
            role: 'user',
            content: input.content.slice(0, 8_000),
            surface,
          },
        },
        deterministicUuid(`user:${correlationId}`)
      );
      userPublished = true;
      context = await this.client.acquireContext({
        query: input.content.slice(0, 4_000),
        excludeCorrelationId: correlationId,
        maxPrivacy: maxPrivacyFor(input.egress),
        maxItems: 6,
        maxChars: 2_200,
      });
      return this.createTurn(correlationId, turnFingerprint, surface, context);
    } catch (error) {
      await context?.release().catch(() => undefined);
      if (userPublished) await this.client.cancel(correlationId).catch(() => false);
      logger.debug('[channel-cognition] turn context unavailable', {
        channelType: surface,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async close(): Promise<void> {
    await this.client.disconnect();
  }

  private createTurn(
    correlationId: string,
    turnFingerprint: string,
    surface: string,
    context: CognitiveContextHandle
  ): ChannelCognitiveTurn {
    let settled = false;
    const fail = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      try {
        await context.release();
      } finally {
        await this.client.cancel(correlationId).catch(() => false);
      }
    };
    return {
      correlationId,
      turnContext: context.turnContext,
      evidence: context.evidence,
      complete: async (deliveredContent, options = {}): Promise<void> => {
        if (settled) return;
        settled = true;
        // Delivery has already succeeded. Never release after an uncertain
        // publish/commit because that could inject context a second time.
        try {
          if (deliveredContent.trim()) {
            await this.client.publish(
              {
                kind: 'result',
                correlationId,
                salience: 0.75,
                confidence: 1,
                privacy: 'local-only',
                payload: {
                  role: 'assistant',
                  content: deliveredContent.slice(0, 8_000),
                  surface,
                },
              },
              deterministicUuid(`assistant:${turnFingerprint}`)
            );
          }
        } finally {
          await context.commit();
          if (options.cancelAfter) await this.client.cancel(correlationId).catch(() => false);
        }
      },
      fail,
      cancel: fail,
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.connectPromise) {
      const attempt = this.client.connect();
      this.connectPromise = attempt;
      void attempt
        .finally(() => {
          if (this.connectPromise === attempt) this.connectPromise = null;
        })
        .catch(() => undefined);
    }
    await this.connectPromise;
  }
}

let singleton: ChannelCognitivePort | null = null;

export function getChannelCognitivePort(): ChannelCognitivePort {
  singleton ??= new WebSocketChannelCognitivePort();
  return singleton;
}

export async function resetChannelCognitivePortForTests(
  replacement?: ChannelCognitivePort
): Promise<void> {
  await singleton?.close().catch(() => undefined);
  singleton = replacement ?? null;
}
