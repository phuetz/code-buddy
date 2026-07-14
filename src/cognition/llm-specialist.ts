import { sanitizeModelOutput } from '../utils/output-sanitizer.js';
import type { CognitiveBudgetLedger } from './budget-reservations.js';
import type {
  SpecialistDefinition,
  WorkspaceDraft,
  WorkspaceItem,
  WorkspaceKind,
  WorkspacePrivacy,
} from './types.js';

export interface CognitiveChatResult {
  content: string;
  promptTokens: number;
  totalTokens: number;
}

export interface CognitiveChatClient {
  chat(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options: { signal: AbortSignal; maxTokens: number; temperature: number },
  ): Promise<CognitiveChatResult>;
}

export interface LlmSpecialistOptions {
  id: string;
  role: string;
  model: string;
  providerGroup: string;
  privacyClearance: WorkspacePrivacy;
  subscriptions: WorkspaceKind[];
  systemPrompt: string;
  outputKind?: Extract<WorkspaceKind, 'hypothesis' | 'proposal' | 'alert'>;
  client: CognitiveChatClient;
  budget: CognitiveBudgetLedger;
  estimatedUsd?: number;
  maxTokens?: number;
  minInputChars?: number;
  ttlMs?: number;
}

function contentOf(item: WorkspaceItem | undefined): string {
  if (!item?.payload || typeof item.payload !== 'object') return '';
  const content = (item.payload as { content?: unknown }).content;
  return typeof content === 'string' ? content.trim().slice(0, 4_000) : '';
}

/** Persistent specialist: one reusable client plus bounded recent insights. */
export class LlmCognitiveSpecialist {
  private readonly recent: string[] = [];

  constructor(private readonly options: LlmSpecialistOptions) {}

  definition(): SpecialistDefinition {
    return {
      id: this.options.id,
      role: this.options.role,
      subscriptions: this.options.subscriptions,
      providerGroup: this.options.providerGroup,
      privacyClearance: this.options.privacyClearance,
      mailboxCapacity: 8,
      overflow: 'drop-lowest-salience',
      maxConcurrency: 1,
      deadlineMs: 20_000,
      activate: async ({ trigger, workspace, signal }) => {
        const assistant = contentOf(trigger);
        const user = contentOf(
          [...workspace]
            .reverse()
            .find((item) => item.kind === 'utterance' && item.correlationId === trigger.correlationId),
        );
        const combinedLength = user.length + assistant.length;
        if (combinedLength < (this.options.minInputChars ?? 40)) return [];

        const reservation = this.options.budget.reserve(
          this.options.id,
          this.options.estimatedUsd ?? 0,
        );
        if (!reservation) return [];
        try {
          const prior = this.recent.length
            ? `\nDerniers constats de ce spécialiste :\n${this.recent.map((item) => `- ${item}`).join('\n')}`
            : '';
          const response = await this.options.client.chat(
            [
              { role: 'system', content: `${this.options.systemPrompt}${prior}` },
              {
                role: 'user',
                content: `Énoncé humain : ${user || '(indisponible)'}\nRéponse de Lisa : ${assistant}`,
              },
            ],
            {
              signal,
              maxTokens: this.options.maxTokens ?? 160,
              temperature: 0.2,
            },
          );
          if (signal.aborted) {
            reservation.release();
            return [];
          }
          const summary = sanitizeModelOutput(response.content).replace(/\s+/g, ' ').trim().slice(0, 700);
          if (!summary) {
            reservation.release();
            return [];
          }
          reservation.commit(this.options.estimatedUsd ?? 0);
          this.recent.push(summary);
          while (this.recent.length > 4) this.recent.shift();
          const draft: WorkspaceDraft = {
            kind: this.options.outputKind ?? 'hypothesis',
            producerId: this.options.id,
            correlationId: trigger.correlationId,
            salience: 0.65,
            confidence: 0.65,
            privacy: trigger.privacy,
            provenance: { source: `llm-specialist:${this.options.model}` },
            ttlMs: this.options.ttlMs ?? 10 * 60_000,
            dedupeKey: `${this.options.id}:${trigger.correlationId}`,
            payload: {
              summary,
              role: this.options.role,
              model: this.options.model,
            },
          };
          return [draft];
        } catch (error) {
          reservation.release();
          if (signal.aborted) return [];
          throw error;
        }
      },
    };
  }
}
