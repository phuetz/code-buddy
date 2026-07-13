/**
 * Central policy for reducing tool observations before they enter an LLM
 * context. The raw observation remains owned by the caller and is addressed by
 * the exact tool call ID supplied as `rawRef`.
 *
 * This module deliberately does not execute tools and does not persist their
 * output. It only decides whether an already-produced observation is worth
 * sending to lm-resizer and enforces a final no-growth guarantee after adding
 * the recovery note.
 */

import {
  isLmResizerEnabled,
  optimizeToolOutputWithLmResizer,
  type LmResizerClientOptions,
  type LmResizerToolOutputRequest,
  type LmResizerToolOutputResult,
} from './lm-resizer-compressor.js';
import { estimateTokens } from '../utils/token-counter.js';

const DEFAULT_SEMANTIC_THRESHOLD_BYTES = 1_024;
const DEFAULT_GENERIC_THRESHOLD_BYTES = 4_096;
const DEFAULT_MIN_BUDGET_TOKENS = 256;
const DEFAULT_MAX_BUDGET_TOKENS = 8_192;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MIN_SAVINGS_BYTES = 256;
const DEFAULT_MIN_SAVINGS_RATIO = 0.10;

const SEMANTIC_TOOL_NAMES = new Set([
  'bash',
  'shell',
  'shell_exec',
  'terminal',
  'run_command',
  'execute_command',
  'git',
  'git_diff',
  'git_status',
  'grep',
  'ripgrep',
  'search',
  'search_files',
  'list_directory',
  'web_fetch',
  'browser_search',
  'test',
  'tests',
  'npm_test',
  'pytest',
  'cargo_test',
]);

// Source reads are fidelity-sensitive: a command filter cannot know which
// imports, comments or neighbouring lines a later edit will need. Only reduce
// them when they are genuinely large (or context pressure lowers the gate).
const FIDELITY_TOOL_NAMES = new Set(['view_file', 'read_file', 'file_read']);

export type ToolObservationOptimizationReason =
  | 'optimized'
  | 'disabled'
  | 'empty'
  | 'error-raw'
  | 'restore-context'
  | 'already-optimized'
  | 'below-threshold'
  | 'lm-resizer-unavailable'
  | 'lm-resizer-rejected'
  | 'no-net-savings';

export interface ToolObservationInput {
  toolName: string;
  /** Must be the exact ID used by the caller's raw observation store. */
  toolCallId: string;
  /** Exact current agent-facing observation. Preferred over output/error. */
  content?: string;
  output?: string;
  error?: string;
  success?: boolean;
  exitCode?: number;
  command?: string;
  query?: string;
  workspaceRoot?: string;
  contextWindow?: number;
  currentInputTokens?: number;
  responseReserveTokens?: number;
  compressErrors?: boolean;
  alreadyOptimized?: boolean;
  signal?: AbortSignal;
}

export interface ToolObservationOptimizationResult {
  /** Observation to place in the model context. */
  content: string;
  /** The untouched input observation. */
  rawContent: string;
  /** Exact toolCallId supplied by the caller; never synthesized or prefixed. */
  rawRef: string;
  optimized: boolean;
  reason: ToolObservationOptimizationReason;
  semantic: boolean;
  thresholdBytes: number;
  tokenBudget?: number;
  originalBytes: number;
  finalBytes: number;
  bytesSaved: number;
  originalTokens: number;
  finalTokens: number;
  tokensSaved: number;
  transport?: 'http' | 'cli';
  recoveryHash?: string;
  report?: LmResizerToolOutputResult;
}

export type LmResizerToolOutputRunner = (
  request: LmResizerToolOutputRequest,
  options?: LmResizerClientOptions,
) => Promise<LmResizerToolOutputResult | null>;

export interface ToolObservationOptimizerOptions {
  /** Defaults to CODEBUDDY_LM_RESIZER=true. */
  enabled?: boolean;
  semanticThresholdBytes?: number;
  genericThresholdBytes?: number;
  minimumBudgetTokens?: number;
  maximumBudgetTokens?: number;
  defaultContextWindow?: number;
  minSavingsBytes?: number;
  minSavingsRatio?: number;
  clientOptions?: LmResizerClientOptions;
  lmResizer?: LmResizerToolOutputRunner;
}

export interface DynamicObservationBudget {
  tokenBudget: number;
  remainingTokens: number;
  pressure: number;
}

/** True when lm-resizer has a command-aware or host-tool-aware filter. */
export function isSemanticLmResizerTool(toolName: string, command = ''): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (FIDELITY_TOOL_NAMES.has(normalized)) return false;
  if (SEMANTIC_TOOL_NAMES.has(normalized)) return true;
  if (command.trim()) return true;
  return /(?:bash|shell|terminal|command|search|grep|git|test|fetch|file|directory)/i.test(normalized);
}

/**
 * Allocate only a fraction of the context still available after reserving the
 * answer. The source size is also considered so small observations are not
 * assigned a needlessly large budget.
 */
export function calculateObservationBudget(
  input: Pick<
    ToolObservationInput,
    'contextWindow' | 'currentInputTokens' | 'responseReserveTokens'
  >,
  sourceBytes: number,
  options: Pick<
    ToolObservationOptimizerOptions,
    'minimumBudgetTokens' | 'maximumBudgetTokens' | 'defaultContextWindow'
  > = {},
): DynamicObservationBudget {
  const contextWindow = Math.max(1, Math.floor(
    input.contextWindow ?? options.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
  ));
  const currentInputTokens = Math.max(0, Math.floor(input.currentInputTokens ?? 0));
  const defaultReserve = Math.min(16_384, Math.max(1_024, Math.floor(contextWindow * 0.15)));
  const responseReserve = Math.max(0, Math.floor(input.responseReserveTokens ?? defaultReserve));
  const remainingTokens = Math.max(0, contextWindow - currentInputTokens - responseReserve);
  const sourceTokens = Math.max(1, Math.ceil(sourceBytes / 4));
  const minBudget = Math.max(1, Math.floor(
    options.minimumBudgetTokens ?? DEFAULT_MIN_BUDGET_TOKENS,
  ));
  const maxBudget = Math.max(minBudget, Math.floor(
    options.maximumBudgetTokens ?? DEFAULT_MAX_BUDGET_TOKENS,
  ));
  const desired = Math.min(
    Math.ceil(sourceTokens * 0.45),
    Math.max(minBudget, Math.floor(remainingTokens * 0.2)),
  );
  const tokenBudget = Math.min(maxBudget, Math.max(minBudget, desired));
  return {
    tokenBudget,
    remainingTokens,
    pressure: 1 - Math.min(1, remainingTokens / contextWindow),
  };
}

function rawObservation(input: ToolObservationInput): string {
  if (input.content !== undefined) return input.content;
  const failed = input.success === false || input.error !== undefined;
  if (failed && input.error !== undefined && input.output !== undefined) {
    return `${input.error}\n\n[partial tool output]\n${input.output}`;
  }
  if (failed) return input.error ?? input.output ?? '';
  return input.output ?? input.error ?? '';
}

function thresholdFor(
  toolName: string,
  semantic: boolean,
  pressure: number,
  options: ToolObservationOptimizerOptions,
): number {
  if (FIDELITY_TOOL_NAMES.has(toolName.trim().toLowerCase())) {
    const pressureFactor = pressure >= 0.9 ? 0.25 : pressure >= 0.75 ? 0.5 : 1;
    return Math.max(4_096, Math.floor(20_000 * pressureFactor));
  }
  const base = semantic
    ? options.semanticThresholdBytes ?? DEFAULT_SEMANTIC_THRESHOLD_BYTES
    : options.genericThresholdBytes ?? DEFAULT_GENERIC_THRESHOLD_BYTES;
  const pressureFactor = pressure >= 0.9 ? 0.25 : pressure >= 0.75 ? 0.5 : 1;
  const floor = semantic ? 512 : 2_000;
  return Math.max(floor, Math.floor(base * pressureFactor));
}

function recoveryNote(rawRef: string, report: LmResizerToolOutputResult): string {
  const hash = report.hash ? `; lm-resizer CCR ${report.hash}` : '';
  return `\n\n[lm-resizer: raw observation available with restore_context(identifier=${JSON.stringify(rawRef)})${hash}]`;
}

function baseResult(
  input: ToolObservationInput,
  rawContent: string,
  semantic: boolean,
  thresholdBytes: number,
  reason: ToolObservationOptimizationReason,
  tokenBudget?: number,
): ToolObservationOptimizationResult {
  const originalBytes = Buffer.byteLength(rawContent);
  const originalTokens = estimateTokens(rawContent);
  return {
    content: rawContent,
    rawContent,
    rawRef: input.toolCallId,
    optimized: false,
    reason,
    semantic,
    thresholdBytes,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    originalBytes,
    finalBytes: originalBytes,
    bytesSaved: 0,
    originalTokens,
    finalTokens: originalTokens,
    tokensSaved: 0,
  };
}

export class ToolObservationOptimizer {
  private readonly options: ToolObservationOptimizerOptions;
  private readonly runLmResizer: LmResizerToolOutputRunner;

  constructor(options: ToolObservationOptimizerOptions = {}) {
    this.options = options;
    this.runLmResizer = options.lmResizer ?? optimizeToolOutputWithLmResizer;
  }

  async optimize(input: ToolObservationInput): Promise<ToolObservationOptimizationResult> {
    const rawContent = rawObservation(input);
    const originalBytes = Buffer.byteLength(rawContent);
    const semantic = isSemanticLmResizerTool(input.toolName, input.command);
    const budget = calculateObservationBudget(input, originalBytes, this.options);
    const thresholdBytes = thresholdFor(input.toolName, semantic, budget.pressure, this.options);
    const plain = (reason: ToolObservationOptimizationReason): ToolObservationOptimizationResult =>
      baseResult(input, rawContent, semantic, thresholdBytes, reason, budget.tokenBudget);

    if (rawContent.length === 0) return plain('empty');

    const normalizedToolName = input.toolName.trim().toLowerCase();
    if (normalizedToolName === 'restore_context' || normalizedToolName === 'context_restore') {
      return plain('restore-context');
    }

    const failed = input.success === false || input.error !== undefined || (input.exitCode ?? 0) !== 0;
    if (failed && input.compressErrors !== true) return plain('error-raw');

    if (input.alreadyOptimized || rawContent.includes('[lm-resizer:')) {
      return plain('already-optimized');
    }

    const enabled = this.options.enabled ?? isLmResizerEnabled();
    if (!enabled) return plain('disabled');
    if (originalBytes < thresholdBytes) return plain('below-threshold');

    const report = await this.runLmResizer({
      content: rawContent,
      toolName: input.toolName,
      command: input.command,
      workspaceRoot: input.workspaceRoot,
      query: input.query,
      exitCode: input.exitCode ?? (failed ? 1 : 0),
      tokenBudget: budget.tokenBudget,
      rawOnFailure: failed && input.compressErrors !== true,
      minSavingsBytes: this.options.minSavingsBytes ?? DEFAULT_MIN_SAVINGS_BYTES,
      minSavingsRatio: this.options.minSavingsRatio ?? DEFAULT_MIN_SAVINGS_RATIO,
    }, {
      ...this.options.clientOptions,
      ...(input.workspaceRoot ? { cwd: input.workspaceRoot } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (!report) return plain('lm-resizer-unavailable');
    if (!report.accepted) {
      return {
        ...plain('lm-resizer-rejected'),
        report,
        transport: report.transport,
        ...(report.hash ? { recoveryHash: report.hash } : {}),
      };
    }

    const content = `${report.compressed}${recoveryNote(input.toolCallId, report)}`;
    const finalBytes = Buffer.byteLength(content);
    const originalTokens = estimateTokens(rawContent);
    const finalTokens = estimateTokens(content);
    // lm-resizer protects its own candidate from growth; this second check is
    // intentionally performed after Code Buddy's recovery note is present.
    if (finalBytes >= originalBytes || finalTokens >= originalTokens) {
      return {
        ...plain('no-net-savings'),
        report,
        transport: report.transport,
        ...(report.hash ? { recoveryHash: report.hash } : {}),
      };
    }

    return {
      content,
      rawContent,
      rawRef: input.toolCallId,
      optimized: true,
      reason: 'optimized',
      semantic,
      thresholdBytes,
      tokenBudget: budget.tokenBudget,
      originalBytes,
      finalBytes,
      bytesSaved: originalBytes - finalBytes,
      originalTokens,
      finalTokens,
      tokensSaved: originalTokens - finalTokens,
      transport: report.transport,
      ...(report.hash ? { recoveryHash: report.hash } : {}),
      report,
    };
  }
}

let defaultOptimizer: ToolObservationOptimizer | null = null;

export function getToolObservationOptimizer(): ToolObservationOptimizer {
  if (!defaultOptimizer) defaultOptimizer = new ToolObservationOptimizer();
  return defaultOptimizer;
}

export function resetToolObservationOptimizer(): void {
  defaultOptimizer = null;
}

export async function optimizeToolObservation(
  input: ToolObservationInput,
): Promise<ToolObservationOptimizationResult> {
  return getToolObservationOptimizer().optimize(input);
}
