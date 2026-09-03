/**
 * /batch Command Handler (CC13)
 *
 * Parallel task decomposition: decomposes a goal into 5-30 units,
 * presents the plan for approval, then spawns parallel agents.
 *
 * Advanced enterprise architecture for /batch command.
 *
 * Usage: /batch <instruction>
 */

import { execFileSync } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import { CodeBuddyClient } from '../../codebuddy/client.js';
import type { StreamingChunk } from '../../agent/types.js';
import {
  ThreadDelegation,
  type ThreadDelegateAgent,
  type ThreadDelegateAgentFactory,
  type ThreadDelegationEvent,
  type ThreadParentBudget,
} from '../../agent/delegation/thread-delegation.js';
import { getModelToolConfig } from '../../config/model-tools.js';
import { getPermissionModeManager } from '../../security/permission-modes.js';

// ============================================================================
// Types
// ============================================================================

export interface BatchUnit {
  /** Short label for the unit */
  label: string;
  /** Detailed instruction for the agent */
  instruction: string;
  /** File patterns this unit will touch */
  filePatterns?: string[];
  /** Dependencies (labels of units that must complete first) */
  dependsOn?: string[];
}

export interface BatchPlan {
  /** The original goal */
  goal: string;
  /** Decomposed units */
  units: BatchUnit[];
  /** Estimated total duration */
  estimatedMinutes?: number;
}

export interface BatchResult {
  /** Unit label */
  label: string;
  /** Whether the unit succeeded */
  success: boolean;
  /** Output summary */
  summary: string;
  /** Duration in ms */
  durationMs: number;
  /** Paths the spawn actually changed (empty ⇒ not a successful coding unit) */
  filesChanged?: string[];
}

export interface BatchSpawnFn {
  (label: string, instruction: string): Promise<BatchResult>;
  /** Release the shared thread scheduler after the complete batch plan. */
  close?: () => Promise<void>;
}

const SOURCE_FILE_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'md', 'json', 'py', 'go', 'rs', 'css', 'html', 'txt', 'yml', 'yaml',
]);

/**
 * Pull file paths out of an instruction so overlapping writers can be serialised.
 */
export function extractBatchFilePatterns(instruction: string): string[] {
  const onlyTouch = [...instruction.matchAll(/only touch\s+((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]*)/gi)]
    .map((m) => (m[1] ?? '').replace(/^\.\//, ''))
    .filter(Boolean);
  if (onlyTouch.length > 0) {
    return [...new Set(onlyTouch)];
  }
  const found: string[] = [];
  const re = /(?:^|[\s`"'=(:])((?:[\w.-]+\/)*[\w.-]+\.([A-Za-z][A-Za-z0-9]*))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(instruction)) !== null) {
    const rel = match[1];
    const ext = match[2]?.toLowerCase();
    if (!rel || !ext || !SOURCE_FILE_EXT.has(ext)) continue;
    if (rel.includes('://')) continue;
    const normalised = rel.replace(/^\.\//, '');
    if (!found.includes(normalised)) found.push(normalised);
  }
  return found;
}

function labelFromInstruction(instruction: string, index: number, files: string[]): string {
  const fromFile = files[0]?.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '');
  if (fromFile) return fromFile.slice(0, 30);
  const words = instruction.replace(/[^\w\s-]/g, ' ').trim().split(/\s+/).slice(0, 3).join('-');
  return (words || `unit-${index + 1}`).toLowerCase().slice(0, 30);
}

/**
 * Split a numbered list (`1. … 2. …`) into independent batch units.
 * Returns null when the goal is not a list of at least two items.
 */
export function parseNumberedBatchUnits(goal: string): BatchUnit[] | null {
  // Only split at line starts. Splitting on any `N)` would break
  // `add(2, 3) returns 5` into a fake unit named "returns".
  const parts = goal.split(/(?:^|\n)(?=\s*\d+[.)]\s+)/);
  const instructions: string[] = [];
  for (const part of parts) {
    const match = part.trim().match(/^\d+[.)]\s+([\s\S]+)/);
    const text = match?.[1]?.trim();
    if (text) instructions.push(text);
  }
  if (instructions.length < 2) return null;

  const used = new Set<string>();
  const units: BatchUnit[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i] ?? '';
    const filePatterns = extractBatchFilePatterns(instruction);
    let label = labelFromInstruction(instruction, i, filePatterns);
    if (used.has(label)) label = `${label}-${i + 1}`;
    used.add(label);
    units.push({
      label,
      instruction,
      filePatterns: filePatterns.length ? filePatterns : undefined,
    });
  }
  return units;
}

function normalizeBatchFile(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(pattern: string): RegExp {
  const escaped = normalizeBatchFile(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DS::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DS::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * True when two units may write the same path. Missing filePatterns is
 * treated as "could touch anything" so we serialise rather than race.
 */
export function unitsShareFiles(a: BatchUnit, b: BatchUnit): boolean {
  const fa = (a.filePatterns ?? []).map(normalizeBatchFile);
  const fb = (b.filePatterns ?? []).map(normalizeBatchFile);
  if (fa.length === 0 || fb.length === 0) return true;
  for (const left of fa) {
    for (const right of fb) {
      if (left === right) return true;
      if (left.includes('*') && globToRegExp(left).test(right)) return true;
      if (right.includes('*') && globToRegExp(right).test(left)) return true;
    }
  }
  return false;
}

function withFileOverlapDeps(units: BatchUnit[]): BatchUnit[] {
  return units.map((unit, i) => {
    const extra: string[] = [];
    for (let j = 0; j < i; j++) {
      const prev = units[j];
      if (prev && unitsShareFiles(unit, prev)) extra.push(prev.label);
    }
    const dependsOn = [...new Set([...(unit.dependsOn ?? []), ...extra])];
    return dependsOn.length ? { ...unit, dependsOn } : { ...unit, dependsOn: undefined };
  });
}

// ============================================================================
// Plan Decomposition
// ============================================================================

/**
 * Decompose a goal into batch units using LLM analysis.
 * Falls back to a simple single-unit plan if LLM is unavailable.
 */
export async function decomposeBatchGoal(
  goal: string,
  chatFn?: (prompt: string) => Promise<string>,
): Promise<BatchPlan> {
  const numbered = parseNumberedBatchUnits(goal);
  if (numbered) {
    return { goal, units: numbered };
  }

  if (!chatFn) {
    // Fallback: single unit
    return {
      goal,
      units: [{ label: 'main', instruction: goal }],
    };
  }

  const decompositionPrompt = `You are a task decomposition engine. Given a goal, break it into 5-30 independent work units that can be executed in parallel by separate agents.

Goal: "${goal}"

Respond with a JSON array of objects, each with:
- "label": short unique name (kebab-case, max 30 chars)
- "instruction": detailed instruction for one agent
- "filePatterns": array of file glob patterns this unit will modify (optional)
- "dependsOn": array of labels this unit depends on (optional)

Rules:
1. Each unit should be independently executable where possible
2. Minimize dependencies between units
3. Each unit should be focused on a specific file or component
4. Include clear, actionable instructions

Respond with ONLY the JSON array, no other text.`;

  try {
    const response = await chatFn(decompositionPrompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.debug('Batch decomposition: could not parse LLM response');
      return numbered ?? { goal, units: [{ label: 'main', instruction: goal }] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as BatchUnit[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { goal, units: [{ label: 'main', instruction: goal }] };
    }

    // Validate and sanitize
    const units = parsed
      .filter(u => u.label && u.instruction)
      .map(u => ({
        label: String(u.label).slice(0, 30),
        instruction: String(u.instruction),
        filePatterns: Array.isArray(u.filePatterns) ? u.filePatterns : undefined,
        dependsOn: Array.isArray(u.dependsOn) ? u.dependsOn : undefined,
      }));

    return { goal, units };
  } catch (err) {
    logger.debug(`Batch decomposition failed: ${err}`);
    return { goal, units: [{ label: 'main', instruction: goal }] };
  }
}

// ============================================================================
// Plan Formatting
// ============================================================================

/**
 * Format a batch plan for display to the user.
 */
export function formatBatchPlan(plan: BatchPlan): string {
  const lines: string[] = [
    `Batch Plan: ${plan.goal}`,
    `${'─'.repeat(60)}`,
    `Units: ${plan.units.length}`,
    '',
  ];

  plan.units.forEach((unit, i) => {
    lines.push(`  ${i + 1}. [${unit.label}]`);
    lines.push(`     ${unit.instruction.slice(0, 100)}${unit.instruction.length > 100 ? '...' : ''}`);
    if (unit.filePatterns?.length) {
      lines.push(`     Files: ${unit.filePatterns.join(', ')}`);
    }
    if (unit.dependsOn?.length) {
      lines.push(`     Depends on: ${unit.dependsOn.join(', ')}`);
    }
  });

  lines.push('');
  lines.push(`${'─'.repeat(60)}`);
  return lines.join('\n');
}

// ============================================================================
// Batch Execution
// ============================================================================

/**
 * Execute a batch plan by spawning parallel agents.
 * Returns results for each unit.
 */
export async function executeBatchPlan(
  plan: BatchPlan,
  spawnFn: BatchSpawnFn,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  const completed = new Set<string>();

  // Topological sort: explicit dependsOn + implicit file-overlap edges so
  // two agents never write the same path in the same Promise.all wave.
  const remaining = withFileOverlapDeps(plan.units);

  try {
    while (remaining.length > 0) {
      // Find units whose dependencies are satisfied
      const ready = remaining.filter(u =>
        !u.dependsOn?.length || u.dependsOn.every(dep => completed.has(dep))
      );

      if (ready.length === 0) {
        // Circular dependency or unresolvable — execute all remaining
        logger.debug('Batch: unresolvable dependencies, executing remaining units');
        for (const unit of remaining) {
          ready.push(unit);
        }
        remaining.length = 0;
      }

      // Remove ready units from remaining
      for (const unit of ready) {
        const idx = remaining.indexOf(unit);
        if (idx >= 0) remaining.splice(idx, 1);
      }

      // Execute ready units in parallel. The spawn function owns the bounded
      // thread scheduler; Promise.allSettled only submits this dependency wave.
      const batchResults = await Promise.allSettled(
        ready.map((unit) => {
          const instruction = unit.filePatterns?.length
            ? [
              unit.instruction,
              '',
              `Only create or modify these files: ${unit.filePatterns.join(', ')}. Do not touch any other file.`,
              'You are explicitly authorized to create any named target that does not exist.',
              'If a target is absent, use create_file or apply_patch; absence is expected and does not require confirmation.',
            ].join('\n')
            : unit.instruction;
          return spawnFn(unit.label, instruction);
        }),
      );

      for (let i = 0; i < batchResults.length; i++) {
        const unit = ready[i];
        const settled = batchResults[i];
        if (unit === undefined || settled === undefined) continue;

        if (settled.status === 'fulfilled') {
          const value = settled.value;
          if (value.success && value.filesChanged && value.filesChanged.length === 0) {
            results.push({
              ...value,
              success: false,
              summary: value.summary?.trim() ? value.summary : 'No files changed',
            });
          } else {
            results.push(value);
          }
          completed.add(unit.label);
        } else {
          results.push({
            label: unit.label,
            success: false,
            summary: `Error: ${settled.reason}`,
            durationMs: 0,
          });
          completed.add(unit.label); // Mark as done even on failure
        }
      }
    }
  } finally {
    await spawnFn.close?.();
  }

  return results;
}

// ============================================================================
// Results Formatting
// ============================================================================

/**
 * Format batch results for display.
 */
export function formatBatchResults(results: BatchResult[]): string {
  const succeeded = results.filter(r => r.success).length;
  const failed = results.length - succeeded;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  const lines: string[] = [
    `Batch Results`,
    `${'─'.repeat(60)}`,
    `Completed: ${succeeded}/${results.length} (${failed} failed)`,
    `Total time: ${(totalMs / 1000).toFixed(1)}s`,
    '',
  ];

  for (const result of results) {
    const status = result.success ? '[OK]' : '[FAIL]';
    const time = `${(result.durationMs / 1000).toFixed(1)}s`;
    lines.push(`  ${status} ${result.label} (${time})`);
    if (result.filesChanged?.length) {
      lines.push(`      Files: ${result.filesChanged.join(', ')}`);
    }
    if (result.summary) {
      const preview = (result.summary.split('\n')[0] ?? '').slice(0, 80);
      lines.push(`      ${preview}`);
    }
  }

  lines.push(`${'─'.repeat(60)}`);
  return lines.join('\n');
}

// ============================================================================
// Default chat / spawn (wired by EnhancedCommandHandler)
// ============================================================================

export function createBatchChatFn(
  client: CodeBuddyClient | null | undefined,
): ((prompt: string) => Promise<string>) | undefined {
  if (!client) return undefined;
  return async (prompt: string) => {
    const response = await client.chat([{ role: 'user', content: prompt }]);
    return response.choices[0]?.message?.content ?? '';
  };
}

export interface BatchSpawnOptions {
  cwd?: string;
  apiKey: string;
  baseURL?: string;
  model?: string;
  maxToolRounds?: number;
  /** Max concurrent Code Buddy agents (default 1 — local Ollama cannot prefill two large contexts). */
  concurrency?: number;
  /** @deprecated Regression seam only: production spawning never calls chat directly. */
  chatFn?: (prompt: string) => Promise<string>;
  /** Inject a complete streaming agent for tests or embedding hosts. */
  agentFactory?: ThreadDelegateAgentFactory<StreamingChunk>;
  /** Receive every tagged multiplexed event. Defaults to JSON lines on stdout. */
  eventSink?: (event: ThreadDelegationEvent<StreamingChunk>) => void;
  /** Abort all child agents when the owning parent turn is cancelled. */
  parentSignal?: AbortSignal;
  /** Override the inherited parent allowance before DELEG1 reduces it. */
  parentBudget?: Partial<ThreadParentBudget>;
}

function gitPorcelain(cwd: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function porcelainPaths(status: string): string[] {
  return status
    .split('\n')
    .map((line) => line.slice(3).trim().replace(/ -> /g, ' ').split(' ').pop() ?? '')
    .filter(Boolean);
}

function listChangedFiles(cwd: string, before: string): string[] {
  const after = gitPorcelain(cwd);
  const beforeSet = new Set(porcelainPaths(before));
  const afterPaths = porcelainPaths(after);
  const added = afterPaths.filter((p) => !beforeSet.has(p));
  const statusChanged = afterPaths.filter((p) => {
    const beforeLine = before.split('\n').find((l) => l.slice(3).trim() === p);
    const afterLine = after.split('\n').find((l) => l.slice(3).trim() === p);
    return beforeLine !== afterLine;
  });
  const unique = [...new Set([...added, ...statusChanged])];
  if (unique.length > 0) return unique;
  try {
    const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return diff.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function* streamWithSubagentPermissionMode<TOutput>(
  agent: ThreadDelegateAgent<TOutput>,
  input: string,
): AsyncGenerator<TOutput> {
  const permissionManager = getPermissionModeManager();
  const mode = permissionManager.getSubagentMode();
  const iterator = agent.processUserMessageStream(input)[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      const next = await permissionManager.withModeAsync(mode, () => iterator.next());
      if (next.done) {
        completed = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!completed && iterator.return) {
      await permissionManager.withModeAsync(mode, () => iterator.return!());
    }
  }
}

/**
 * Spawn one Code Buddy agent per unit. Success requires a real file diff.
 */
export function createDefaultBatchSpawnFn(opts: BatchSpawnOptions): BatchSpawnFn {
  const envConcurrency = Number(process.env.CODEBUDDY_BATCH_CONCURRENCY || 1);
  const concurrency = Math.max(
    1,
    Number.isFinite(opts.concurrency ?? envConcurrency)
      ? Math.floor(opts.concurrency ?? envConcurrency)
      : ThreadDelegation.DEFAULT_CONCURRENCY,
  );
  const configuredChildRounds = opts.maxToolRounds
    ?? Number(process.env.CODEBUDDY_BATCH_MAX_ROUNDS || 6);
  const childRounds = Number.isFinite(configuredChildRounds) && configuredChildRounds > 0
    ? Math.floor(configuredChildRounds)
    : 6;
  const envCost = Number(process.env.MAX_COST);
  const modelContext = opts.model
    ? getModelToolConfig(opts.model).contextWindow
    : undefined;
  const envContext = Number(process.env.CODEBUDDY_MAX_CONTEXT);
  const parentBudget: ThreadParentBudget = {
    // Preserve the historical /batch child ceiling (6) while expressing it as
    // a reduced allowance inherited from a finite parent ceiling (12).
    maxTurns: opts.parentBudget?.maxTurns ?? childRounds * 2,
    maxCostUsd: opts.parentBudget?.maxCostUsd
      ?? (Number.isFinite(envCost) && envCost > 0 ? envCost : 10),
    maxContextTokens: opts.parentBudget?.maxContextTokens
      ?? (Number.isFinite(envContext) && envContext > 0
        ? envContext
        : modelContext ?? 128_000),
  };
  const rawCreateAgent: ThreadDelegateAgentFactory<StreamingChunk> = opts.agentFactory
    ?? (async ({ budget }) => {
      const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
      const { ConfirmationService } = await import('../../utils/confirmation-service.js');
      ConfirmationService.getInstance().setSessionFlag('allOperations', true);
      ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
      const agent = new CodeBuddyAgent(
        opts.apiKey,
        opts.baseURL,
        opts.model,
        budget.maxTurns,
        true,
        undefined,
        opts.cwd ?? process.cwd(),
      );
      agent.updateContextConfig({
        maxContextTokens: budget.maxContextTokens,
        responseReserveTokens: Math.max(256, Math.floor(budget.maxContextTokens * 0.125)),
      });
      agent.setSessionCostLimit(budget.maxCostUsd);
      // Delegates keep their own bounded turn history and must not pull or write
      // cross-session persistent memory behind the parent's back.
      agent.setMemoryEnabled(false);
      await agent.systemPromptReady;
      return {
        processUserMessageStream: (input: string) =>
          agent.processUserMessageStream(input, { surface: 'cli' }),
        abortCurrentOperation: () => agent.abortCurrentOperation(),
        dispose: () => agent.dispose({ skipSessionLearning: true }),
        getSessionCost: () => agent.getSessionCost(),
      };
    });
  const createAgent: ThreadDelegateAgentFactory<StreamingChunk> = async (context) => {
    const agent = await rawCreateAgent(context);
    return {
      processUserMessageStream: (input) => streamWithSubagentPermissionMode(agent, input),
      abortCurrentOperation: () => agent.abortCurrentOperation(),
      dispose: () => agent.dispose(),
      getSessionCost: agent.getSessionCost ? () => agent.getSessionCost!() : undefined,
    };
  };
  const delegation = new ThreadDelegation<StreamingChunk>({
    createAgent,
    parentBudget,
    concurrency,
    parentSignal: opts.parentSignal,
  });
  const eventPump = (async () => {
    for await (const event of delegation.events()) {
      if (opts.eventSink) {
        opts.eventSink(event);
        continue;
      }
      process.stdout.write(
        `[batch:${event.agentId}:${event.kind}] ${formatBatchEventPayload(event.payload)}\n`,
      );
    }
  })();

  const spawn: BatchSpawnFn = async (label, instruction) => {
    const started = Date.now();
    const cwd = opts.cwd ?? process.cwd();
    const before = gitPorcelain(cwd);
    let child: ReturnType<typeof delegation.spawn> | null = null;
    try {
      child = delegation.spawn(label);
      const turn = child.submit(instruction);
      child.closeInput();
      const outcome = await turn;
      await child.done;
      if (!outcome.success) {
        throw new Error(outcome.message ?? outcome.reason ?? 'Delegate failed');
      }

      const filesChanged = listChangedFiles(cwd, before);
      if (filesChanged.length === 0) {
        return {
          label,
          success: false,
          summary: 'No files changed',
          durationMs: Date.now() - started,
          filesChanged,
        };
      }
      return {
        label,
        success: true,
        summary: `Updated ${filesChanged.join(', ')}`,
        durationMs: Date.now() - started,
        filesChanged,
      };
    } catch (err) {
      return {
        label,
        success: false,
        summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
        filesChanged: listChangedFiles(cwd, before),
      };
    }
  };
  spawn.close = async () => {
    await delegation.close();
    await eventPump;
  };
  return spawn;
}

function formatBatchEventPayload(payload: unknown): string {
  try {
    const encoded = JSON.stringify(payload);
    if (encoded !== undefined) return encoded.slice(0, 2_000);
  } catch {
    // Fall through to a safe string conversion.
  }
  return String(payload).replace(/\r?\n/g, '\\n').slice(0, 2_000);
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Handle the /batch slash command.
 * Returns the formatted output to display to the user.
 */
export async function handleBatchCommand(
  args: string,
  chatFn?: (prompt: string) => Promise<string>,
  spawnFn?: BatchSpawnFn,
): Promise<string> {
  if (!args.trim()) {
    return 'Usage: /batch <instruction>\n\nDecomposes a goal into parallel units and executes them with separate agents.';
  }

  // Step 1: Decompose
  const plan = await decomposeBatchGoal(args, chatFn);

  // Step 2: Show plan
  const planDisplay = formatBatchPlan(plan);

  if (!spawnFn) {
    return `${planDisplay}\n\n(No agent spawn function available — plan only)`;
  }

  // Step 3: Execute
  const results = await executeBatchPlan(plan, spawnFn);

  // Step 4: Format results
  const resultsDisplay = formatBatchResults(results);

  return `${planDisplay}\n\n${resultsDisplay}`;
}

/**
 * Slash `/batch` entry: always await the plan (and optional spawn) and
 * return that text. The TUI used to show "Batch command initiated..." while
 * parking the real work on an `asyncAction` field nobody consumed.
 */
export async function handleBatchSlashCommand(
  args: string[],
  chatFn?: (prompt: string) => Promise<string>,
  spawnFn?: BatchSpawnFn,
): Promise<{ handled: true; entry: { type: 'assistant'; content: string; timestamp: Date } }> {
  const content = await handleBatchCommand(args.join(' '), chatFn, spawnFn);
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}
