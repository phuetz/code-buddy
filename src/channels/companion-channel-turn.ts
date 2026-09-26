/**
 * Companion channel generation: single chat() call when without tools,
 * or bounded tool loop (<= 3 rounds) when the speaker is identified.
 *
 * Failover seam: this goes through CodeBuddyClient.chat so
 * feat/provider-fallback-2026-09-06 (`CODEBUDDY_PROVIDER_FALLBACK`) takes
 * over when that lane is merged. Do not reimplement a fallback chain here.
 *
 * @module channels/companion-channel-turn
 */

import { CodeBuddyClient, type CodeBuddyMessage, type CodeBuddyResponse, type CodeBuddyTool } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import type { CompanionIdentity } from '../companion/companion-identity.js';
import {
  companionHistorySessionKey,
  rememberCompanionChannelTurn,
} from '../companion/channel-history.js';
import { channelCompanionSessionKey } from './channel-companion-session.js';
import {
  isCompanionToolsEnabled,
  getCompanionToolDefinitions,
  getCompanionToolWaitingWord,
  executeCompanionTool,
  extractImagePathFromToolResult,
  type CompanionToolExecutionContext,
} from '../companion/companion-toolset.js';
import type { ToolResult } from '../types/index.js';
import type { FormalToolRegistry } from '../tools/registry/tool-registry.js';
import type { ConfirmationService } from '../utils/confirmation-service.js';
import {
  futureCommitmentsEnabled,
  guardFutureCommitments,
  type RegisteredReminderProof,
} from '../companion/future-commitments.js';

export const COMPANION_CHANNEL_FAILOVER_SEAM = 'CodeBuddyClient.chat';
export const MAX_COMPANION_TOOL_ROUNDS = 3;

export interface CompanionChannelMedia {
  type: 'image';
  imagePath: string;
  caption?: string;
}

export interface CompanionExecutedTool {
  name: string;
  success: boolean;
  output?: string;
  imagePath?: string;
}

export interface CompanionChannelTurnInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: CodeBuddyMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
  chat?: (
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[],
    opts: {
      model: string;
      maxTokens?: number;
      signal?: AbortSignal;
      tool_choice: 'none' | 'auto' | 'required';
    },
  ) => Promise<CodeBuddyResponse>;
  identity?: CompanionIdentity;
  surface?: string;
  env?: NodeJS.ProcessEnv;
  onWaitingWord?: (word: string) => Promise<void> | void;
  deliverMedia?: (media: CompanionChannelMedia) => Promise<void>;
  executeTool?: (
    toolName: string,
    args: Record<string, unknown>,
    context: CompanionToolExecutionContext,
  ) => Promise<ToolResult>;
  registry?: FormalToolRegistry;
  confirmationService?: ConfirmationService;
  timeoutMs?: number;
  cwd?: string;
  sessionKey?: string;
}

export interface CompanionChannelTurnResult {
  text: string;
  model: string;
  promptTokens?: number;
  media?: CompanionChannelMedia[];
  executedTools?: CompanionExecutedTool[];
  historySuffix?: string;
}

function lastUserText(messages: CodeBuddyMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }
  }
  return '';
}

function resolveTurnSessionKey(input: CompanionChannelTurnInput): string {
  return channelCompanionSessionKey({
    channelType: input.surface,
    chatId: input.identity?.chatId,
    senderId: input.identity?.userId,
    sessionKey: input.sessionKey,
    env: input.env ?? process.env,
  });
}

function persistCompanionTurn(input: CompanionChannelTurnInput, assistantText: string): void {
  const userText = lastUserText(input.messages);
  if (!userText || !assistantText.trim()) return;
  const env = input.env ?? process.env;
  rememberCompanionChannelTurn(
    companionHistorySessionKey({
      sessionKey: resolveTurnSessionKey(input),
      userId: input.identity?.userId,
      chatId: input.identity?.chatId,
      env,
    }),
    userText,
    assistantText,
    env,
  );
}

export async function runCompanionChannelTurn(
  input: CompanionChannelTurnInput,
): Promise<CompanionChannelTurnResult> {
  const env = input.env ?? process.env;
  if (!input.sessionKey) {
    input.sessionKey = resolveTurnSessionKey(input);
  }
  const identity = input.identity;
  const toolsEnabled = isCompanionToolsEnabled(env) && Boolean(identity && identity.role !== 'guest');

  const chat =
    input.chat ??
    (async (messages, tools, opts) => {
      const client = new CodeBuddyClient(input.apiKey, input.model, input.baseUrl);
      return client.chat(messages, tools, opts);
    });

  let toolDefs: CodeBuddyTool[] = [];
  if (toolsEnabled && identity) {
    try {
      toolDefs = await getCompanionToolDefinitions(identity, {
        env,
        registry: input.registry,
      });
    } catch (err) {
      logger.warn('[companion-channel-turn] Failed to resolve companion tool definitions', {
        error: err instanceof Error ? err.message : String(err),
      });
      toolDefs = [];
    }
  }

  if (!toolsEnabled || toolDefs.length === 0) {
    const response = await chat(input.messages, [], {
      model: input.model,
      maxTokens: input.maxTokens ?? 512,
      ...(input.signal ? { signal: input.signal } : {}),
      tool_choice: 'none',
    });
    const rawText = response.choices[0]?.message?.content?.trim() ?? '';
    const text = futureCommitmentsEnabled(env) ? guardFutureCommitments(rawText).text : rawText;
    if (!text) {
      logger.warn('Companion channel turn returned empty content', {
        model: input.model,
        seam: COMPANION_CHANNEL_FAILOVER_SEAM,
      });
    }
    persistCompanionTurn(input, text);
    return {
      text,
      model: response.model ?? input.model,
      ...(response.usage?.prompt_tokens !== undefined
        ? { promptTokens: response.usage.prompt_tokens }
        : {}),
    };
  }

  const defaultTimeout = env.CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS
    ? parseInt(env.CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS, 10)
    : 120_000;
  const effectiveTimeout = input.timeoutMs ?? defaultTimeout;

  let combinedSignal = input.signal;
  let timeoutId: NodeJS.Timeout | undefined;
  if (!combinedSignal && effectiveTimeout > 0) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
    combinedSignal = controller.signal;
  }

  const activeMessages: CodeBuddyMessage[] = [...input.messages];
  const mediaProduced: CompanionChannelMedia[] = [];
  const executedTools: CompanionExecutedTool[] = [];
  const historyNotes: string[] = [];
  const registeredReminders: RegisteredReminderProof[] = [];

  let finalText = '';
  let finalModel = input.model;
  let totalPromptTokens: number | undefined;

  try {
    for (let round = 0; round < MAX_COMPANION_TOOL_ROUNDS; round += 1) {
      const response = await chat(activeMessages, toolDefs, {
        model: input.model,
        maxTokens: input.maxTokens ?? 512,
        ...(combinedSignal ? { signal: combinedSignal } : {}),
        tool_choice: 'auto',
      });

      finalModel = response.model ?? finalModel;
      if (response.usage?.prompt_tokens !== undefined) {
        totalPromptTokens = (totalPromptTokens ?? 0) + response.usage.prompt_tokens;
      }

      const assistantMsg = response.choices[0]?.message;
      if (!assistantMsg) {
        break;
      }

      const content = assistantMsg.content?.trim() ?? '';
      const toolCalls = assistantMsg.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        finalText = content;
        break;
      }

      activeMessages.push(assistantMsg as CodeBuddyMessage);

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }

        const waitingWord = getCompanionToolWaitingWord(toolName);
        if (waitingWord && input.onWaitingWord) {
          try {
            await input.onWaitingWord(waitingWord);
          } catch (waitErr) {
            logger.debug('[companion-channel-turn] onWaitingWord error', { error: String(waitErr) });
          }
        }

        const execFn = input.executeTool ?? executeCompanionTool;
        let toolRes: ToolResult;
        try {
          toolRes = await execFn(toolName, args, {
            identity: identity!,
            env,
            cwd: input.cwd,
            signal: combinedSignal,
            registry: input.registry,
            confirmationService: input.confirmationService,
          });
        } catch (toolErr) {
          toolRes = {
            success: false,
            error: toolErr instanceof Error ? toolErr.message : String(toolErr),
          };
        }

        const imagePath = extractImagePathFromToolResult(toolRes, input.cwd);
        if (imagePath) {
          mediaProduced.push({ type: 'image', imagePath });
          historyNotes.push(`[Image générée : ${imagePath}]`);
        }

        if (toolName === 'remind' && toolRes.success) {
          const label = typeof args.label === 'string' ? args.label.trim() : 'rappel';
          const time = typeof args.time === 'string' ? args.time.trim() : '';
          const verifiedBefore = registeredReminders.length;
          if (futureCommitmentsEnabled(env)) {
            const data = toolRes.data as { id?: unknown; label?: unknown } | undefined;
            if (typeof data?.id === 'string' && typeof data.label === 'string') {
              try {
                const { loadReminders } = await import('../companion/reminders.js');
                const stored = (await loadReminders()).find((r) =>
                  r.id === data.id && r.label === data.label && r.enabled,
                );
                if (stored) {
                  registeredReminders.push({
                    kind: 'reminder', id: stored.id, label: stored.label, mechanism: 'remind',
                  });
                }
              } catch (error) {
                logger.warn('[companion-channel-turn] Reminder readback failed', {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }
          if (!futureCommitmentsEnabled(env) || registeredReminders.length > verifiedBefore) {
            historyNotes.push(`[Rappel créé : ${label}${time ? ` à ${time}` : ''}]`);
          }
        }

        executedTools.push({
          name: toolName,
          success: toolRes.success,
          output: toolRes.output ?? toolRes.error,
          ...(imagePath ? { imagePath } : {}),
        });

        activeMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolRes.success
            ? (toolRes.output ?? 'Succès')
            : `Erreur outil ${toolName} : ${toolRes.error ?? 'inconnue'}`,
        });
      }
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!finalText && executedTools.length > 0) {
    const hasImage = mediaProduced.length > 0;
    if (hasImage) {
      finalText = 'Voilà, j’ai créé l’image pour toi !';
    } else if (
      futureCommitmentsEnabled(env)
      && executedTools.filter((tool) => tool.name === 'remind').length > registeredReminders.length
    ) {
      finalText = "Je n'ai pas pu confirmer le rappel.";
    } else {
      finalText = 'C’est fait !';
    }
  }

  if (futureCommitmentsEnabled(env)) {
    finalText = guardFutureCommitments(finalText, registeredReminders).text;
  }

  if (mediaProduced.length > 0) {
    const surface = (input.surface ?? '').toLowerCase();
    for (const media of mediaProduced) {
      media.caption = finalText;

      if (input.deliverMedia) {
        try {
          await input.deliverMedia(media);
        } catch (delivErr) {
          logger.warn('[companion-channel-turn] deliverMedia failed', {
            error: delivErr instanceof Error ? delivErr.message : String(delivErr),
          });
        }
      } else if (surface === 'voice') {
        try {
          const { sendTelegramAlert } = await import('../sensory/alert.js');
          await sendTelegramAlert(finalText, media.imagePath);
          if (!/téléphone|telegram|envoie/i.test(finalText)) {
            finalText = `${finalText} Je te l'envoie sur ton téléphone.`.trim();
          }
        } catch (voiceSendErr) {
          logger.warn('[companion-channel-turn] Voice media telegram delivery skipped', {
            error: voiceSendErr instanceof Error ? voiceSendErr.message : String(voiceSendErr),
          });
        }
      }
    }
  }

  const historySuffix = historyNotes.length > 0 ? `\n${historyNotes.join('\n')}` : undefined;
  persistCompanionTurn(input, historySuffix ? `${finalText}${historySuffix}` : finalText);

  return {
    text: finalText,
    model: finalModel,
    ...(totalPromptTokens !== undefined ? { promptTokens: totalPromptTokens } : {}),
    ...(mediaProduced.length > 0 ? { media: mediaProduced } : {}),
    ...(executedTools.length > 0 ? { executedTools } : {}),
    ...(historySuffix ? { historySuffix } : {}),
  };
}
