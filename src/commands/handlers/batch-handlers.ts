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

import { logger } from '../../utils/logger.js';

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
      return { goal, units: [{ label: 'main', instruction: goal }] };
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

  for (let i = 0; i < plan.units.length; i++) {
    const unit = plan.units[i];
    lines.push(`  ${i + 1}. [${unit.label}]`);
    lines.push(`     ${unit.instruction.slice(0, 100)}${unit.instruction.length > 100 ? '...' : ''}`);
    if (unit.filePatterns?.length) {
      lines.push(`     Files: ${unit.filePatterns.join(', ')}`);
    }
    if (unit.dependsOn?.length) {
      lines.push(`     Depends on: ${unit.dependsOn.join(', ')}`);
    }
  }

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
  spawnFn: (label: string, instruction: string) => Promise<BatchResult>,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  const succeeded = new Set<string>();
  const failed = new Set<string>();

  // Topological sort: execute units respecting dependencies
  const remaining = [...plan.units];

  while (remaining.length > 0) {
    const blocked = remaining.filter(u =>
      u.dependsOn?.some(dep => failed.has(dep))
    );

    for (const unit of blocked) {
      const failedDeps = unit.dependsOn?.filter(dep => failed.has(dep)) ?? [];
      results.push({
        label: unit.label,
        success: false,
        summary: `Skipped: failed dependency ${failedDeps.join(', ')}`,
        durationMs: 0,
      });
      failed.add(unit.label);
      const idx = remaining.indexOf(unit);
      if (idx >= 0) remaining.splice(idx, 1);
    }

    if (remaining.length === 0) {
      break;
    }

    // Find units whose dependencies are satisfied
    const ready = remaining.filter(u =>
      !u.dependsOn?.length || u.dependsOn.every(dep => succeeded.has(dep))
    );

    if (ready.length === 0) {
      // Circular or missing dependencies cannot be executed honestly.
      logger.debug('Batch: unresolvable dependencies, skipping remaining units');
      for (const unit of remaining) {
        const missingDeps = unit.dependsOn?.filter(dep => !succeeded.has(dep)) ?? [];
        results.push({
          label: unit.label,
          success: false,
          summary: `Skipped: unresolved dependencies ${missingDeps.join(', ') || '(unknown)'}`,
          durationMs: 0,
        });
        failed.add(unit.label);
      }
      remaining.length = 0;
      break;
    }

    // Remove ready units from remaining
    for (const unit of ready) {
      const idx = remaining.indexOf(unit);
      if (idx >= 0) remaining.splice(idx, 1);
    }

    // Execute ready units in parallel
    const batchResults = await Promise.allSettled(
      ready.map(unit => spawnFn(unit.label, unit.instruction))
    );

    for (let i = 0; i < batchResults.length; i++) {
      const unit = ready[i];
      const settled = batchResults[i];

      if (settled.status === 'fulfilled') {
        results.push(settled.value);
        if (settled.value.success) {
          succeeded.add(unit.label);
        } else {
          failed.add(unit.label);
        }
      } else {
        results.push({
          label: unit.label,
          success: false,
          summary: `Error: ${settled.reason}`,
          durationMs: 0,
        });
        failed.add(unit.label);
      }
    }
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
    if (result.summary) {
      const preview = result.summary.split('\n')[0].slice(0, 80);
      lines.push(`      ${preview}`);
    }
  }

  lines.push(`${'─'.repeat(60)}`);
  return lines.join('\n');
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
  spawnFn?: (label: string, instruction: string) => Promise<BatchResult>,
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
