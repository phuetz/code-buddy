import { v5 as uuidv5 } from 'uuid';
import type { ModelEgress } from '@codebuddy/providers/model-egress';
import type { CoreCognitionPort } from '../server/server-bridge';
import { logWarn } from '../utils/logger';

const COWORK_COGNITION_NAMESPACE = '0eb9f6f7-c76c-5d3a-a830-65c531e44e17';

export interface CoworkCognitiveTurn {
  readonly correlationId: string;
  readonly turnContext: string;
  readonly evidence: string;
  complete(deliveredContent: string): Promise<void>;
  fail(): Promise<void>;
  cancel(): Promise<void>;
}

export interface CoworkCognitionPort {
  begin(input: {
    sessionId: string;
    messageId: string;
    query: string;
    egress: ModelEgress;
  }): Promise<CoworkCognitiveTurn | null>;
}

export type CoreCognitionPortResolver = () => CoreCognitionPort | null;

function boundedIdentifier(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_.:@/-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 52) || 'unknown'
  );
}

function maxPrivacyFor(egress: ModelEgress): 'local-only' | 'trusted-lan' | 'cloud-ok' {
  if (egress === 'local') return 'local-only';
  if (egress === 'lan') return 'trusted-lan';
  return 'cloud-ok';
}

/**
 * Cowork's narrow main-process adapter. It publishes only bounded utterances
 * and projections; WorkspaceItems and raw subscriptions never cross Electron
 * IPC or enter the renderer.
 */
export class InProcessCoworkCognition implements CoworkCognitionPort {
  constructor(private readonly resolvePort: CoreCognitionPortResolver) {}

  async begin(input: {
    sessionId: string;
    messageId: string;
    query: string;
    egress: ModelEgress;
  }): Promise<CoworkCognitiveTurn | null> {
    const port = this.resolvePort();
    if (!port || !input.query.trim()) return null;
    const correlationId = [
      'cowork',
      boundedIdentifier(input.sessionId),
      boundedIdentifier(input.messageId),
    ].join(':');
    const userEventId = uuidv5(`user:${correlationId}`, COWORK_COGNITION_NAMESPACE);
    let userPublished = false;
    try {
      await port.publish(
        {
          kind: 'utterance',
          correlationId,
          salience: 0.8,
          confidence: 1,
          privacy: 'local-only',
          dedupeKey: `cowork-user-${boundedIdentifier(input.messageId)}`,
          payload: {
            role: 'user',
            content: input.query.slice(0, 8_000),
            surface: 'cowork',
          },
        },
        userEventId
      );
      userPublished = true;
      const context = await port.acquireContext({
        query: input.query.slice(0, 4_000),
        excludeCorrelationId: correlationId,
        maxPrivacy: maxPrivacyFor(input.egress),
        maxItems: 6,
        maxChars: 2_200,
      });
      let settled = false;
      const fail = async (): Promise<void> => {
        if (settled) return;
        settled = true;
        try {
          await context.release();
        } finally {
          await port.cancel(correlationId).catch(() => false);
        }
      };
      return {
        correlationId,
        turnContext: context.turnContext,
        evidence: context.evidence,
        complete: async (deliveredContent: string): Promise<void> => {
          if (settled) return;
          settled = true;
          // The response is already durably accepted by Cowork at this point.
          // A commit failure is uncertain and must never be followed by release.
          try {
            if (deliveredContent.trim()) {
              await port.publish(
                {
                  kind: 'result',
                  correlationId,
                  salience: 0.75,
                  confidence: 1,
                  privacy: 'local-only',
                  payload: {
                    role: 'assistant',
                    content: deliveredContent.slice(0, 8_000),
                    surface: 'cowork',
                  },
                },
                uuidv5(`assistant:${correlationId}`, COWORK_COGNITION_NAMESPACE)
              );
            }
          } finally {
            await context.commit();
          }
        },
        fail,
        cancel: fail,
      };
    } catch (error) {
      if (userPublished) await port.cancel(correlationId).catch(() => false);
      logWarn(
        '[CoworkCognition] cognitive context unavailable:',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }
}

/** Unknown and subscription CLI routes fail closed to cloud egress. */
export function resolveCoworkModelEgress(
  routeEgress: ModelEgress | undefined,
  baseURL: string | undefined
): ModelEgress {
  if (routeEgress) return routeEgress;
  if (!baseURL) return 'cloud';
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '0:0:0:0:0:0:0:1' ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    )
      return 'local';
  } catch {
    return 'cloud';
  }
  return 'cloud';
}
