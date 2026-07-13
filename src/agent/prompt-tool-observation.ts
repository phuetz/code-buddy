/**
 * Lossless boundary for tool observations that are about to enter an LLM
 * prompt outside the primary AgentExecutor loop.
 *
 * Tool APIs keep returning their untouched result. Callers invoke this helper
 * only for the model-facing copy: the exact observation is persisted first,
 * then lm-resizer may produce a smaller representation. Any persistence or
 * optimization failure falls back to the original text.
 */

import { getModelToolConfig } from '../config/model-tools.js';
import { getRestorableCompressor } from '../context/restorable-compression.js';
import {
  optimizeToolObservation,
  type ToolObservationOptimizationReason,
} from '../context/tool-observation-optimizer.js';
import { logger } from '../utils/logger.js';
import { estimateTokens } from '../utils/token-counter.js';

export interface PromptMessageLike {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
}

export interface PromptToolObservationInput {
  toolName: string;
  /** Exact provider tool-call ID used by the matching tool-role message. */
  toolCallId: string;
  /** Exact text that would otherwise be inserted into the LLM prompt. */
  content: string;
  /** Optional bounded/legacy model view used when optimization is unavailable. */
  fallbackContent?: string;
  success?: boolean;
  error?: string;
  exitCode?: number;
  command?: string;
  query?: string;
  workspaceRoot?: string;
  model?: string;
  messages?: ReadonlyArray<PromptMessageLike>;
  contextWindow?: number;
  responseReserveTokens?: number;
  signal?: AbortSignal;
  /** Set false when the current LLM tool surface cannot restore by callId. */
  allowOptimization?: boolean;
}

export interface PromptToolObservationResult {
  content: string;
  rawContent: string;
  optimized: boolean;
  reason: ToolObservationOptimizationReason | 'boundary-fallback' | 'recovery-unavailable';
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Fast prompt-size estimate used only to allocate lm-resizer's budget. */
export function estimatePromptInputTokens(messages: ReadonlyArray<PromptMessageLike>): number {
  let total = 0;
  for (const message of messages) {
    total += 3;
    total += estimateTokens(message.role ?? '');
    total += estimateTokens(messageText(message.content));
    if (message.tool_calls !== undefined) {
      try {
        total += estimateTokens(JSON.stringify(message.tool_calls));
      } catch {
        // A malformed/cyclic diagnostic value must not break an agent loop.
      }
    }
  }
  return total + 3;
}

/** Extract a shell-like command when tool arguments make one available. */
export function commandFromToolArguments(args: unknown): string | undefined {
  let record: Record<string, unknown> | undefined;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  } else if (args && typeof args === 'object' && !Array.isArray(args)) {
    record = args as Record<string, unknown>;
  }

  const command = record?.command ?? record?.cmd;
  return typeof command === 'string' && command.trim() ? command : undefined;
}

/**
 * Persist the raw observation and return the model-facing representation.
 * `restore_context` is deliberately left untouched to avoid recursive
 * compression and duplicate storage of restored payloads.
 */
export async function prepareToolObservationForPrompt(
  input: PromptToolObservationInput,
): Promise<PromptToolObservationResult> {
  let rawContent = input.content;
  if (input.toolName === 'restore_context' || input.toolName === 'context_restore') {
    return {
      content: rawContent,
      rawContent,
      optimized: false,
      reason: 'restore-context',
    };
  }

  const workspaceRoot = input.workspaceRoot?.trim() || process.cwd();
  try {
    const compressor = getRestorableCompressor();
    const existing = compressor.restore(input.toolCallId, workspaceRoot);
    if (existing.found) {
      // ToolHandler may already have persisted a more native pre-hook result.
      // Never overwrite it with a later provider/model-facing representation.
      rawContent = existing.content;
    } else {
      compressor.writeToolResult(input.toolCallId, rawContent, workspaceRoot);
    }
  } catch (error) {
    logger.debug('[tool-observation] raw persistence failed; continuing with original output', {
      tool: input.toolName,
      callId: input.toolCallId,
      error,
    });
  }

  // Some legacy/custom callers pass an executor without exposing the
  // restore_context schema to their model. Persist for observability, but do
  // not send a representation the model cannot recover from.
  if (input.allowOptimization === false) {
    return {
      content: input.fallbackContent ?? rawContent,
      rawContent,
      optimized: false,
      reason: 'recovery-unavailable',
    };
  }

  try {
    const modelConfig = input.model ? getModelToolConfig(input.model) : undefined;
    const contextWindow = input.contextWindow ?? modelConfig?.contextWindow;
    const responseReserveTokens =
      input.responseReserveTokens ?? modelConfig?.maxOutputTokens;
    const optimized = await optimizeToolObservation({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      content: rawContent,
      success: input.success,
      ...(input.error === undefined ? {} : { error: input.error }),
      ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.query === undefined ? {} : { query: input.query }),
      workspaceRoot,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(input.messages
        ? { currentInputTokens: estimatePromptInputTokens(input.messages) }
        : {}),
      ...(responseReserveTokens === undefined ? {} : { responseReserveTokens }),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return {
      content: optimized.optimized
        ? optimized.content
        : input.fallbackContent ?? optimized.content,
      rawContent,
      optimized: optimized.optimized,
      reason: optimized.reason,
    };
  } catch (error) {
    logger.debug('[tool-observation] optimization failed; continuing with original output', {
      tool: input.toolName,
      callId: input.toolCallId,
      error,
    });
    return {
      content: input.fallbackContent ?? rawContent,
      rawContent,
      optimized: false,
      reason: 'boundary-fallback',
    };
  }
}
