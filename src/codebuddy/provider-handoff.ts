/**
 * Context handoff when switching LLM provider mid-conversation.
 *
 * The backup model receives the same system prompt (retruncated to ITS
 * budget), the conversation history (compacted if its window is smaller),
 * a resume note, and a repaired tool-call transcript.
 */
import { getModelToolConfig } from '../config/model-tools.js';
import { repairToolCallPairs } from '../context/transcript-repair.js';
import { truncatePromptBlocksByPriority } from '../services/prompt-builder.js';
import type { CodeBuddyMessage } from './client.js';

const RESUME_TAG = 'provider_resume';

export interface HandoffOptions {
  fromProvider: string;
  fromModel?: string;
  toProvider: string;
  toModel: string;
  kind?: string;
}

function messageText(message: CodeBuddyMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('\n');
  }
  return content == null ? '' : String(content);
}

function estimateTokens(messages: CodeBuddyMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += messageText(message).length;
    if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
      chars += JSON.stringify(message.tool_calls).length;
    }
  }
  return Math.ceil(chars / 4);
}

export function systemPromptBudgetChars(model: string): number {
  const cfg = getModelToolConfig(model);
  const contextWindow = cfg.contextWindow ?? 8192;
  const maxOutputTokens = cfg.maxOutputTokens ?? 2048;
  const leftover = contextWindow - maxOutputTokens;
  const rawBudget = leftover > 0 ? Math.floor(leftover * 0.5) : Math.floor(contextWindow * 0.25);
  const budgetTokens = leftover > 0
    ? Math.min(rawBudget, 32_000)
    : Math.max(256, Math.min(rawBudget, 32_000));
  return budgetTokens * 4;
}

export function buildResumeNote(options: HandoffOptions): string {
  const to = options.toModel ? `${options.toProvider}:${options.toModel}` : options.toProvider;
  const from = options.fromModel ? `${options.fromProvider}:${options.fromModel}` : options.fromProvider;
  return `<${RESUME_TAG}>conversation reprise par ${to} après indisponibilité de ${from}</${RESUME_TAG}>`;
}

function retruncateSystemPrompt(messages: CodeBuddyMessage[], toModel: string): CodeBuddyMessage[] {
  const budget = systemPromptBudgetChars(toModel);
  return messages.map((message) => {
    if (message.role !== 'system') return message;
    const text = messageText(message);
    if (text.length <= budget) return message;
    const truncated = truncatePromptBlocksByPriority(
      [{ id: 'system', content: text, priority: 0 }],
      budget,
    );
    let content = truncated.prompt;
    if (content.length > budget) {
      content = `${text.slice(0, Math.max(0, budget - 24))}\n[truncated]`;
    }
    return { ...message, content };
  });
}

function slidingWindowCompact(messages: CodeBuddyMessage[], tokenBudget: number): CodeBuddyMessage[] {
  const system = messages.filter((message) => message.role === 'system');
  const rest = messages.filter((message) => message.role !== 'system');
  const kept: CodeBuddyMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const candidate = rest[i];
    if (!candidate) continue;
    const trial = [...system, ...[candidate, ...kept]];
    if (estimateTokens(trial) > tokenBudget && kept.length > 0) break;
    kept.unshift(candidate);
  }
  return [...system, ...kept];
}

export function compactMessagesForModel(
  messages: CodeBuddyMessage[],
  toModel: string,
): CodeBuddyMessage[] {
  const cfg = getModelToolConfig(toModel);
  const window = cfg.contextWindow ?? 32768;
  if (estimateTokens(messages) <= window) return messages;
  return slidingWindowCompact(messages, Math.floor(window * 0.85));
}

export async function compactMessagesForModelAsync(
  messages: CodeBuddyMessage[],
  toModel: string,
): Promise<CodeBuddyMessage[]> {
  const cfg = getModelToolConfig(toModel);
  const window = cfg.contextWindow ?? 32768;
  if (estimateTokens(messages) <= window) return messages;
  try {
    const { ContextManagerV2 } = await import('../context/context-manager-v2.js');
    const mgr = new ContextManagerV2({
      maxContextTokens: window,
      model: toModel,
      enableWarnings: false,
      enableEnhancedCompression: false,
      autoCompactThreshold: Math.floor(window * 0.6),
      autoCompactPercent: 60,
    });
    try {
      return mgr.prepareMessagesRaw(messages, { reason: 'auto' });
    } finally {
      mgr.dispose();
    }
  } catch {
    return slidingWindowCompact(messages, Math.floor(window * 0.85));
  }
}

export async function prepareFailoverMessages(
  messages: CodeBuddyMessage[],
  options: HandoffOptions,
): Promise<CodeBuddyMessage[]> {
  const repaired = repairToolCallPairs(messages);
  const retruncated = retruncateSystemPrompt(repaired, options.toModel);
  const compacted = await compactMessagesForModelAsync(retruncated, options.toModel);
  const note: CodeBuddyMessage = { role: 'system', content: buildResumeNote(options) };
  const firstNonSystem = compacted.findIndex((message) => message.role !== 'system');
  if (firstNonSystem === -1) return [...compacted, note];
  return [...compacted.slice(0, firstNonSystem), note, ...compacted.slice(firstNonSystem)];
}
