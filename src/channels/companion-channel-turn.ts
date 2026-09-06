/**
 * Companion channel generation: a single no-tools chat() call.
 *
 * Failover seam: this goes through CodeBuddyClient.chat so
 * feat/provider-fallback-2026-09-06 (`CODEBUDDY_PROVIDER_FALLBACK`) takes
 * over when that lane is merged. Do not reimplement a fallback chain here.
 */

import { CodeBuddyClient, type CodeBuddyMessage, type CodeBuddyResponse } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';

export const COMPANION_CHANNEL_FAILOVER_SEAM = 'CodeBuddyClient.chat';

export interface CompanionChannelTurnInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: CodeBuddyMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
  /** Injectable chat for tests. Production uses CodeBuddyClient. */
  chat?: (
    messages: CodeBuddyMessage[],
    tools: [],
    opts: { model: string; maxTokens?: number; signal?: AbortSignal; tool_choice: 'none' },
  ) => Promise<CodeBuddyResponse>;
}

export interface CompanionChannelTurnResult {
  text: string;
  model: string;
  promptTokens?: number;
}

export async function runCompanionChannelTurn(
  input: CompanionChannelTurnInput,
): Promise<CompanionChannelTurnResult> {
  const chat =
    input.chat ??
    (async (messages, tools, opts) => {
      const client = new CodeBuddyClient(input.apiKey, input.model, input.baseUrl);
      return client.chat(messages, tools, opts);
    });
  const response = await chat(input.messages, [], {
    model: input.model,
    maxTokens: input.maxTokens ?? 512,
    ...(input.signal ? { signal: input.signal } : {}),
    tool_choice: 'none',
  });
  const text = response.choices[0]?.message?.content?.trim() ?? '';
  if (!text) {
    logger.warn('Companion channel turn returned empty content', {
      model: input.model,
      seam: COMPANION_CHANNEL_FAILOVER_SEAM,
    });
  }
  return {
    text,
    model: response.model ?? input.model,
    ...(response.usage?.prompt_tokens !== undefined
      ? { promptTokens: response.usage.prompt_tokens }
      : {}),
  };
}
