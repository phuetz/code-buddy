/**
 * Context handoff when switching LLM provider mid-conversation.
 *
 * The backup model receives the same system prompt (retruncated to ITS
 * budget), the conversation history (compacted if its window is smaller),
 * a pruned tool list when the full catalogue would overflow, a resume note,
 * and a repaired tool-call transcript.
 */
import { getModelToolConfig } from '../config/model-tools.js';
import { repairToolCallPairs } from '../context/transcript-repair.js';
import { truncatePromptBlocksByPriority } from '../services/prompt-builder.js';
import type { CodeBuddyMessage, CodeBuddyTool } from './client.js';
import { hasToolCalls } from './message-guards.js';

const RESUME_TAG = 'provider_resume';
/** Hard cap after RAG when the backup window cannot hold the full catalogue. */
export const HANDOFF_TOOL_CAP = 12;
const TOOL_SEARCH = 'tool_search';

export interface HandoffOptions {
  fromProvider: string;
  fromModel?: string;
  toProvider: string;
  toModel: string;
  kind?: string;
}

export interface FailoverHandoffResult {
  messages: CodeBuddyMessage[];
  tools: CodeBuddyTool[] | undefined;
  estimatedTokens: number;
  contextWindow: number;
  budgetTokens: number;
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

function estimateMessageTokens(messages: CodeBuddyMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += messageText(message).length;
    if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
      chars += JSON.stringify(message.tool_calls).length;
    }
  }
  return Math.ceil(chars / 4);
}

export function estimateToolsTokens(tools: CodeBuddyTool[] | undefined): number {
  if (!tools || tools.length === 0) return 0;
  let chars = 0;
  for (const tool of tools) {
    chars += JSON.stringify(tool).length;
  }
  return Math.ceil(chars / 4);
}

export function estimateHandoffTokens(
  messages: CodeBuddyMessage[],
  tools?: CodeBuddyTool[],
): number {
  return estimateMessageTokens(messages) + estimateToolsTokens(tools);
}

/**
 * Named `ctx32k` / `ctx8k` tags are a served-window hint and cap a family
 * declaration (qwen3.8* is 262k; `qwen3.8-ctx32k:latest` is 32k).
 */
export function resolveFailoverContextWindow(model: string): number {
  const cfg = getModelToolConfig(model);
  const declared = cfg.contextWindow ?? 32768;
  const hint = model.match(/ctx(\d+)k\b/i);
  if (hint?.[1]) {
    const named = Number(hint[1]) * 1024;
    if (Number.isFinite(named) && named > 0) return Math.min(declared, named);
  }
  return declared;
}

/** `contextWindow − maxOutputTokens − 10 %` margin. */
export function failoverPromptBudgetTokens(model: string): number {
  const cfg = getModelToolConfig(model);
  const window = resolveFailoverContextWindow(model);
  const maxOutput = cfg.maxOutputTokens ?? 2048;
  const leftover = Math.max(256, window - maxOutput);
  return Math.floor(leftover * 0.9);
}

export function formatContextTokensK(tokens: number): string {
  return `${Math.floor(Math.max(0, tokens) / 1000)} k`;
}

export function formatSkippedFailoverTargetLog(
  target: string,
  contextWindow: number,
  estimatedTokens: number,
): string {
  return `[fallback] ${target} ignorée (contexte ${formatContextTokensK(contextWindow)} < ${formatContextTokensK(estimatedTokens)})`;
}

export function isFailoverTargetTooSmall(
  estimatedTokens: number,
  contextWindow: number,
): boolean {
  return estimatedTokens > contextWindow;
}

function lastUserQuery(messages: CodeBuddyMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user') return messageText(message);
  }
  return '';
}

function calledToolNames(messages: CodeBuddyMessage[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (!hasToolCalls(message)) continue;
    for (const call of message.tool_calls) {
      const name = call.function?.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function shrinkToolsToBudget(
  tools: CodeBuddyTool[],
  alwaysInclude: Set<string>,
  budgetTokens: number,
): CodeBuddyTool[] {
  let current = tools;
  while (current.length > alwaysInclude.size && estimateToolsTokens(current) > budgetTokens) {
    let dropAt = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      const name = current[i]?.function.name;
      if (name && !alwaysInclude.has(name)) {
        dropAt = i;
        break;
      }
    }
    if (dropAt < 0) break;
    current = current.filter((_, index) => index !== dropAt);
  }
  return current;
}

async function ragSelectTools(
  query: string,
  tools: CodeBuddyTool[],
  maxTools: number,
  alwaysInclude: string[],
): Promise<CodeBuddyTool[]> {
  try {
    const { selectRelevantTools } = await import('../tools/tool-selector.js');
    const result = selectRelevantTools(query, tools, maxTools, alwaysInclude);
    return result.selectedTools.slice(0, maxTools);
  } catch {
    const keep = new Set(alwaysInclude);
    const selected: CodeBuddyTool[] = [];
    for (const tool of tools) {
      if (keep.has(tool.function.name)) selected.push(tool);
    }
    for (const tool of tools) {
      if (selected.length >= maxTools) break;
      if (!keep.has(tool.function.name)) selected.push(tool);
    }
    return selected.slice(0, maxTools);
  }
}

async function pruneToolsForHandoff(
  tools: CodeBuddyTool[] | undefined,
  messages: CodeBuddyMessage[],
  budgetTokens: number,
): Promise<CodeBuddyTool[] | undefined> {
  if (!tools || tools.length === 0) return tools;
  const messageTokens = estimateMessageTokens(messages);
  const combined = messageTokens + estimateToolsTokens(tools);
  if (combined <= budgetTokens) return tools;

  const always = [...calledToolNames(messages), TOOL_SEARCH].filter(
    (name, index, all) => all.indexOf(name) === index && tools.some((tool) => tool.function.name === name),
  );
  const alwaysSet = new Set(always);
  const query = lastUserQuery(messages);
  const selected = await ragSelectTools(query, tools, HANDOFF_TOOL_CAP, always);
  const remainingForTools = Math.max(256, budgetTokens - messageTokens);
  return shrinkToolsToBudget(selected, alwaysSet, remainingForTools);
}

export function systemPromptBudgetChars(model: string): number {
  const cfg = getModelToolConfig(model);
  const contextWindow = resolveFailoverContextWindow(model);
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
    if (estimateMessageTokens(trial) > tokenBudget && kept.length > 0) break;
    kept.unshift(candidate);
  }
  return [...system, ...kept];
}

export function compactMessagesForModel(
  messages: CodeBuddyMessage[],
  toModel: string,
  tokenBudget?: number,
): CodeBuddyMessage[] {
  const budget = tokenBudget ?? resolveFailoverContextWindow(toModel);
  if (estimateMessageTokens(messages) <= budget) return messages;
  return slidingWindowCompact(messages, Math.floor(budget * 0.85));
}

export async function compactMessagesForModelAsync(
  messages: CodeBuddyMessage[],
  toModel: string,
  tokenBudget?: number,
): Promise<CodeBuddyMessage[]> {
  const window = resolveFailoverContextWindow(toModel);
  const budget = tokenBudget ?? window;
  if (estimateMessageTokens(messages) <= budget) return messages;
  try {
    const { ContextManagerV2 } = await import('../context/context-manager-v2.js');
    const mgr = new ContextManagerV2({
      maxContextTokens: budget,
      model: toModel,
      enableWarnings: false,
      enableEnhancedCompression: false,
      autoCompactThreshold: Math.floor(budget * 0.6),
      autoCompactPercent: 60,
    });
    try {
      return mgr.prepareMessagesRaw(messages, { reason: 'auto' });
    } finally {
      mgr.dispose();
    }
  } catch {
    return slidingWindowCompact(messages, Math.floor(budget * 0.85));
  }
}

function injectResumeNote(messages: CodeBuddyMessage[], options: HandoffOptions): CodeBuddyMessage[] {
  const note: CodeBuddyMessage = { role: 'system', content: buildResumeNote(options) };
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
  if (firstNonSystem === -1) return [...messages, note];
  return [...messages.slice(0, firstNonSystem), note, ...messages.slice(firstNonSystem)];
}

export async function prepareFailoverHandoff(
  messages: CodeBuddyMessage[],
  tools: CodeBuddyTool[] | undefined,
  options: HandoffOptions,
): Promise<FailoverHandoffResult> {
  const contextWindow = resolveFailoverContextWindow(options.toModel);
  const budgetTokens = failoverPromptBudgetTokens(options.toModel);
  const repaired = repairToolCallPairs(messages);
  const retruncated = retruncateSystemPrompt(repaired, options.toModel);
  const prunedTools = await pruneToolsForHandoff(tools, retruncated, budgetTokens);
  const remainingForMessages = Math.max(
    256,
    budgetTokens - estimateToolsTokens(prunedTools) - 128,
  );
  const compacted = await compactMessagesForModelAsync(
    retruncated,
    options.toModel,
    remainingForMessages,
  );
  const closed = repairToolCallPairs(compacted);
  const withNote = injectResumeNote(closed, options);
  return {
    messages: withNote,
    tools: prunedTools,
    estimatedTokens: estimateHandoffTokens(withNote, prunedTools),
    contextWindow,
    budgetTokens,
  };
}

export async function prepareFailoverMessages(
  messages: CodeBuddyMessage[],
  options: HandoffOptions,
): Promise<CodeBuddyMessage[]> {
  const handoff = await prepareFailoverHandoff(messages, undefined, options);
  return handoff.messages;
}
