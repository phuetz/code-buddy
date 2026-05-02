/**
 * Agents (MultiAgentSystem) slash command handler — `/agents`
 *
 * Wires user-facing activation of the MultiAgentSystem
 * (`src/agent/multi-agent/multi-agent-system.ts`). The system has
 * existed since the OpenClaw heritage import but had 0 callers in
 * `src/`, only tests. Top 4 audit OpenClaw 2026-05-02. 4 specialised
 * agents already defined (Orchestrator/Coder/Reviewer/Tester) with 5
 * collaboration strategies.
 *
 * Sub-actions:
 *   /agents enable                 — instantiate the singleton (idempotent)
 *   /agents disable                — dispose, stop active workflow if any
 *   /agents status                 — show enabled flag, active workflow, last result
 *   /agents run <goal>             — FIRE-AND-FORGET workflow (returns immediately)
 *   /agents plan <goal>            — SYNC: dryRun workflow to see the plan only
 *   /agents stop                   — interrupt active workflow
 *   /agents strategy <name>        — set default strategy for next run
 *
 * **V0.1 design decisions** (see plan idempotent-meandering-giraffe.md):
 * - apiKey from `process.env.GROK_API_KEY` (think-handlers.ts pattern).
 *   V0.2 = inject the configured Code Buddy client via `setAgentsClient`.
 * - Fire-and-forget for `run`: singleton + 1 workflow at a time. If user
 *   `run`s while one is active → refuse politely.
 * - Events forwarded to logger.info (visible in ~/.codebuddy/logs/).
 *   V0.2 = stream events live to terminal.
 * - No persistence: process exit kills the workflow. Acceptable V0.1.
 *
 * Slash name `/agents` (not `/team`, `/multi`, `/orchestrate`):
 * - `/team` is taken (Agent Teams lightweight, team-handlers.ts).
 * - `/agents` is libre (grep-confirmed) and matches naming of the
 *   directory `src/agent/multi-agent/agents/`.
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';
import type { CollaborationStrategy, WorkflowResult, WorkflowEvent, AgentTask, AgentExecutionResult } from '../../agent/multi-agent/types.js';
import type { PersistedWorkflow } from '../../agent/multi-agent/workflow-persistence.js';

const VALID_ACTIONS = new Set([
  'enable', 'disable', 'status', 'run', 'plan', 'stop', 'strategy',
  'metrics', 'conflicts', 'sessions',
  'resume',
  'help', '',
]);

const VALID_STRATEGIES: ReadonlySet<CollaborationStrategy> = new Set<CollaborationStrategy>([
  'sequential', 'parallel', 'hierarchical', 'peer_review', 'iterative',
]);

const HELP_TEXT = `Usage: /agents <action> [args]

Actions:
  enable                  Instantiate the multi-agent system singleton.
  disable                 Dispose; stop active workflow if running.
  status                  Show enabled flag, active workflow (if any), last result.
  run <goal>              FIRE-AND-FORGET: launch a full workflow asynchronously.
                          Returns immediately. Track with /agents status.
                          Stop with /agents stop. Process exit kills it (V0.1).
  plan <goal>             SYNC (~10s): create the execution plan WITHOUT running it.
                          Useful as a preview before /agents run.
  stop                    Interrupt the active workflow.
  strategy <name>         Set default strategy for the next run.
                          One of: sequential | parallel | hierarchical |
                          peer_review | iterative (default: hierarchical).

V0.2 Phase F (require [multi_agent_system.coordination|sessions].enabled):
  metrics                 Show agent performance report (success rate, avg duration,
                          specialties). Empty until at least one /agents run completes.
  conflicts               List detected file/resource conflicts between agents.
                          V0.1 honest note: MAS doesn't auto-detect — usually empty.
  sessions                Show SessionRegistry stats (active sessions, message counts).
                          Spawned via the sessions_spawn tool (Phase E) or directly.

V0.2 Phase G — workflow persistence:
  resume                  Re-launch the most recent interrupted workflow (kept on
                          disk in ~/.codebuddy/agents/current.json). Mid-tool death
                          may have left partial artifacts; review before resuming.

Configure defaults in TOML under [multi_agent_system]:
  enabled            = false                     # auto-instantiate at boot
  default_strategy   = "hierarchical"
  parallel_agents    = 3
  timeout_ms         = 600000                    # 10 minutes
  max_iterations     = 5

Cost note: a workflow runs 4 agents (orchestrator + coder + reviewer + tester)
with up to N iterations of LLM calls each. Use /agents plan first to preview.
Requires GROK_API_KEY env var.`;

let agentsEnabled = false;
let activeStrategy: CollaborationStrategy = 'hierarchical';
let coordinatorWired = false;  // Phase F: wire MAS events → Coordinator only once

interface ActiveWorkflow {
  goal: string;
  startedAt: Date;
  promise: Promise<WorkflowResult>;
}

interface LastResult {
  goal: string;
  success: boolean;
  summary: string;
  durationMs: number;
  finishedAt: Date;
}

let activeWorkflow: ActiveWorkflow | null = null;
let lastResult: LastResult | null = null;

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

/**
 * Phase F — Wire MAS workflow events into the EnhancedCoordinator so
 * /agents metrics shows real data after workflows run. Without this,
 * metrics stay empty (the MAS doesn't call coordinator methods itself).
 *
 * MAS emits `workflow:event` with type 'task_started' or 'task_completed'
 * and a `data` payload containing { task } or { task, result }.
 * Idempotent — only wires once per process via `coordinatorWired` flag.
 */
async function wireCoordinatorIfPresent(system: { on: (e: string, h: (...a: unknown[]) => void) => void; listenerCount: (e: string) => number }): Promise<void> {
  if (coordinatorWired) return;
  try {
    const { getEnhancedCoordinator } = await import('../../agent/multi-agent/enhanced-coordination.js');
    const coordinator = getEnhancedCoordinator();
    system.on('workflow:event', ((event: WorkflowEvent) => {
      if (!event.data) return;
      if (event.type === 'task_started') {
        const data = event.data as { task?: AgentTask };
        if (data.task?.assignedTo) {
          coordinator.markTaskStarted(data.task, data.task.assignedTo);
        }
      } else if (event.type === 'task_completed') {
        const data = event.data as { task?: AgentTask; result?: AgentExecutionResult };
        if (data.task && data.result) {
          coordinator.recordTaskCompletion(data.task, data.result);
        }
      }
    }) as (...a: unknown[]) => void);
    coordinatorWired = true;
    logger.debug('EnhancedCoordinator wired to MAS workflow events');
  } catch (err) {
    logger.debug('EnhancedCoordinator wiring skipped (optional)', { error: String(err) });
  }
}

function formatStatus(): string {
  const lines: string[] = [];
  lines.push('Multi-Agent System Status');
  lines.push('═'.repeat(40));
  lines.push(`Enabled:           ${agentsEnabled ? 'yes' : 'no'}`);
  lines.push(`Default strategy:  ${activeStrategy}`);
  lines.push('');

  if (activeWorkflow) {
    const elapsed = Math.round((Date.now() - activeWorkflow.startedAt.getTime()) / 1000);
    lines.push(`ACTIVE WORKFLOW (running):`);
    lines.push(`  Goal:      ${activeWorkflow.goal}`);
    lines.push(`  Started:   ${activeWorkflow.startedAt.toISOString()} (${elapsed}s ago)`);
    lines.push(`  Stop with: /agents stop`);
  } else {
    lines.push('Active workflow:   (none)');
  }

  if (lastResult) {
    lines.push('');
    lines.push(`LAST RESULT:`);
    lines.push(`  Goal:     ${lastResult.goal}`);
    lines.push(`  Success:  ${lastResult.success ? 'yes' : 'no'}`);
    lines.push(`  Duration: ${Math.round(lastResult.durationMs / 1000)}s`);
    lines.push(`  Summary:  ${lastResult.summary.slice(0, 200)}${lastResult.summary.length > 200 ? '…' : ''}`);
  }

  return lines.join('\n');
}

/**
 * /agents <action> [args]
 */
export async function handleAgents(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (!VALID_ACTIONS.has(action)) {
    return textResult(`Unknown agents action: ${args[0]}\n\n${HELP_TEXT}`);
  }

  if (action === 'help' || action === '') {
    return textResult(HELP_TEXT);
  }

  // Status is read-only — no side effects, no LLM, no instantiation
  if (action === 'status') {
    return textResult(formatStatus());
  }

  // Disable doesn't need apiKey either — just dispose
  if (action === 'disable') {
    if (!agentsEnabled) {
      return textResult('Multi-agent system is not enabled.');
    }
    if (activeWorkflow) {
      const { resetMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');
      // System.stop() inside dispose path will signal the running workflow;
      // the promise itself races to completion in the background.
      resetMultiAgentSystem();
      activeWorkflow = null;
    } else {
      const { resetMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');
      resetMultiAgentSystem();
    }
    agentsEnabled = false;
    logger.info('MultiAgentSystem disabled via /agents slash command');
    return textResult('Multi-agent system stopped.');
  }

  // Strategy is also a no-op on the singleton — just changes our local default
  if (action === 'strategy') {
    const name = rest[0]?.trim().toLowerCase() as CollaborationStrategy | undefined;
    if (!name) {
      return textResult(`Usage: /agents strategy <name>\nValid: ${[...VALID_STRATEGIES].join(' | ')}`);
    }
    if (!VALID_STRATEGIES.has(name)) {
      return textResult(`Unknown strategy: ${name}\nValid: ${[...VALID_STRATEGIES].join(' | ')}`);
    }
    activeStrategy = name;
    return textResult(`Default strategy set to: ${name}`);
  }

  // Stop interrupts the active workflow
  if (action === 'stop') {
    if (!activeWorkflow) {
      return textResult('No active workflow to stop.');
    }
    const { getMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');
    const apiKey = process.env.GROK_API_KEY ?? '';
    const baseURL = process.env.GROK_BASE_URL;
    if (apiKey) {
      const system = getMultiAgentSystem(apiKey, baseURL);
      system.stop();
    }
    const stoppedGoal = activeWorkflow.goal;
    activeWorkflow = null;
    logger.info(`MultiAgentSystem workflow stopped via /agents slash`, { goal: stoppedGoal });
    return textResult(`Workflow stopped: ${stoppedGoal}`);
  }

  // Phase F read-only actions — no apiKey needed, no MAS instantiation.
  if (action === 'metrics') {
    try {
      const { getEnhancedCoordinator } = await import('../../agent/multi-agent/enhanced-coordination.js');
      const coordinator = getEnhancedCoordinator();
      const report = coordinator.getPerformanceReport();

      // Phase L (V0.4) — append cost breakdown if any agent has totalCostUsd > 0
      const roles = ['orchestrator', 'coder', 'reviewer', 'tester'] as const;
      const costRows: string[] = [];
      let totalCostUsd = 0;
      for (const role of roles) {
        const m = coordinator.getAgentMetrics(role);
        if (m && m.totalCostUsd > 0) {
          costRows.push(`  ${role.padEnd(13)} $${m.totalCostUsd.toFixed(4)} total  $${m.avgCostPerTask.toFixed(4)} avg/task  (${m.totalTasks} tasks)`);
          totalCostUsd += m.totalCostUsd;
        }
      }
      let withCost = report;
      if (costRows.length > 0) {
        withCost += `\n\nCost Breakdown (V0.4 Phase L) — total $${totalCostUsd.toFixed(4)}\n${'─'.repeat(50)}\n${costRows.join('\n')}`;
      } else {
        withCost += `\n\nCost Breakdown: (no cost recorded yet — set [multi_agent_system].max_workflow_cost_usd to track)`;
      }

      // Phase N (V0.4.1) — surface persistence state.
      if (coordinator.isPersistenceEnabled()) {
        const savedAt = coordinator.getMetricsSavedAt();
        withCost += savedAt
          ? `\n\nMetrics Persistence (V0.4.1 Phase N): enabled, last save ${savedAt.toISOString()}`
          : `\n\nMetrics Persistence (V0.4.1 Phase N): enabled, no save yet`;
      }
      return textResult(withCost);
    } catch (err) {
      return textResult(`Could not load EnhancedCoordinator: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (action === 'conflicts') {
    try {
      const { getEnhancedCoordinator } = await import('../../agent/multi-agent/enhanced-coordination.js');
      const coordinator = getEnhancedCoordinator();
      const conflicts = coordinator.getConflicts();
      if (conflicts.length === 0) {
        return textResult(
          'No conflicts detected.\n\n' +
          'V0.3 (Phase H): MAS now calls coordinator.detectConflicts() after every phase\n' +
          'when [multi_agent_system.coordination].enable_conflict_resolution = true.\n' +
          'If you see no conflicts after a workflow, either none were detected (good), or\n' +
          'the flag is disabled — check `/config show multi_agent_system.coordination`.'
        );
      }
      const lines = conflicts.map((c, i) => {
        const head = `${i + 1}. [${c.type}] severity=${c.severity}\n   agents: ${c.agents.join(', ')}\n   ${c.description}`;
        // Phase M (V0.4.1) — show resolution + auto-resolve outcome if present.
        if (c.resolution) {
          return `${head}\n   → resolved (${c.resolution.strategy}): ${c.resolution.decision}`;
        }
        return head;
      });
      const resolved = conflicts.filter((c) => c.resolution).length;
      const header = resolved > 0
        ? `Detected conflicts (${conflicts.length}) — ${resolved} resolved:`
        : `Detected conflicts (${conflicts.length}):`;
      return textResult(`${header}\n\n${lines.join('\n\n')}`);
    } catch (err) {
      return textResult(`Could not load EnhancedCoordinator: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (action === 'sessions') {
    try {
      const { getSessionRegistry } = await import('../../agent/multi-agent/session-registry.js');
      const registry = getSessionRegistry();
      const stats = registry.getStats();
      const lines: string[] = [];
      lines.push('Session Registry Stats');
      lines.push('═'.repeat(40));
      lines.push(`Total sessions:   ${stats.totalSessions}`);
      lines.push(`Active sessions:  ${stats.activeSessions}`);
      lines.push(`Total messages:   ${stats.totalMessages}`);
      lines.push('');
      lines.push('By kind:');
      for (const [kind, count] of Object.entries(stats.byKind)) {
        if (count > 0) lines.push(`  ${kind.padEnd(10)} ${count}`);
      }
      lines.push('');
      lines.push('Spawn sub-agents via the sessions_spawn LLM tool (Phase E).');
      return textResult(lines.join('\n'));
    } catch (err) {
      return textResult(`Could not load SessionRegistry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // From here on (enable/run/plan), apiKey is needed — pattern from think-handlers.ts L210
  const apiKey = process.env.GROK_API_KEY ?? '';
  const baseURL = process.env.GROK_BASE_URL;
  if (!apiKey) {
    return textResult('Error: GROK_API_KEY is not set. Cannot run multi-agent workflow.');
  }

  const { getMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');

  if (action === 'enable') {
    const wasEnabled = agentsEnabled;
    const system = getMultiAgentSystem(apiKey, baseURL); // instantiate singleton
    await wireCoordinatorIfPresent(system as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void; listenerCount: (e: string) => number });
    agentsEnabled = true;
    if (wasEnabled) {
      return textResult('Multi-agent system already enabled. Use /agents status to check state.');
    }
    logger.info('MultiAgentSystem enabled via /agents slash command');
    return textResult(
      'Multi-agent system started.\n' +
      `Default strategy: ${activeStrategy}\n` +
      'Use /agents run <goal> to launch a workflow, /agents plan <goal> to preview only.'
    );
  }

  if (action === 'plan') {
    const goal = rest.join(' ').trim();
    if (!goal) {
      return textResult('Usage: /agents plan <goal>');
    }
    if (!agentsEnabled) {
      getMultiAgentSystem(apiKey, baseURL);
      agentsEnabled = true;
    }
    const system = getMultiAgentSystem(apiKey, baseURL);
    await wireCoordinatorIfPresent(system as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void; listenerCount: (e: string) => number });
    try {
      const result = await system.runWorkflow(goal, { strategy: activeStrategy, dryRun: true });
      const planText = result.plan?.phases?.length
        ? result.plan.phases
            .map((p, i) => `Phase ${i + 1}: ${p.name}\n  ${(p.tasks || []).map((t) => `- ${t.description}`).join('\n  ')}`)
            .join('\n\n')
        : '(no phases parsed — orchestrator returned an empty or unparseable plan)';
      return textResult(`Plan for: ${goal}\n\n${planText}`);
    } catch (err) {
      return textResult(`Planning failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (action === 'run') {
    const goal = rest.join(' ').trim();
    if (!goal) {
      return textResult('Usage: /agents run <goal>');
    }
    if (activeWorkflow) {
      return textResult(
        `Workflow already in progress: ${activeWorkflow.goal}\n` +
        'Stop it first with /agents stop, then re-run.'
      );
    }
    if (!agentsEnabled) {
      getMultiAgentSystem(apiKey, baseURL);
      agentsEnabled = true;
    }
    const system = getMultiAgentSystem(apiKey, baseURL);
    await wireCoordinatorIfPresent(system as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void; listenerCount: (e: string) => number });

    // Phase G — persistence. Save initial state + on every workflow:event
    // (debounced) + on completion. Mid-tool death = inevitable; the persisted
    // state is best-effort up to the last event captured.
    const persistence = await import('../../agent/multi-agent/workflow-persistence.js');
    let liveState: PersistedWorkflow = {
      goal,
      startedAt: new Date().toISOString(),
      strategy: activeStrategy,
      status: 'running',
      plan: null,
      results: [],
      artifacts: [],
      timeline: [],
      errors: [],
    };
    await persistence.saveWorkflow(liveState);

    let saveTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      // Fire-and-forget — never block on persistence.
      persistence.saveWorkflow(liveState).catch(() => { /* logged inside */ });
    };
    const debouncedSave = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 500);
    };

    const eventListener = (event: WorkflowEvent) => {
      liveState.timeline.push(event);
      if (event.type === 'task_completed' && event.data) {
        const data = event.data as { task?: AgentTask; result?: AgentExecutionResult };
        if (data.task && data.result) {
          liveState.results.push([data.task.id, data.result]);
          if (data.result.artifacts?.length) {
            liveState.artifacts.push(...data.result.artifacts);
          }
        }
      }
      debouncedSave();
    };
    (system as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void }).on(
      'workflow:event',
      eventListener as (...a: unknown[]) => void
    );

    // Phase D — live event streaming to the terminal via process.stdout.write
    // (pattern from /docs in enhanced-command-handler.ts L228). Streamer
    // detaches in the .then/.catch below to avoid listener leaks across runs.
    const { attachStreamer } = await import('../../agent/multi-agent/workflow-event-streamer.js');
    const streamerHandle = attachStreamer(system as unknown as Parameters<typeof attachStreamer>[0]);

    const startedAt = new Date();
    const promise = system.runWorkflow(goal, { strategy: activeStrategy }).then(
      (result) => {
        streamerHandle.detach();
        lastResult = {
          goal,
          success: result.success,
          summary: result.summary || '(no summary)',
          durationMs: result.totalDuration,
          finishedAt: new Date(),
        };
        activeWorkflow = null;
        liveState = {
          ...liveState,
          status: result.success ? 'completed' : 'failed',
          plan: result.plan ?? null,
          finishedAt: new Date().toISOString(),
          summary: result.summary,
          errors: result.errors ?? [],
        };
        flush();
        // Clear on success — interrupted workflows are kept; clean ones are not.
        if (result.success) {
          persistence.clearWorkflow().catch(() => { /* logged inside */ });
        }
        logger.info('MultiAgentSystem workflow completed', { goal, success: result.success });
        return result;
      },
      (err: unknown) => {
        streamerHandle.detach();
        lastResult = {
          goal,
          success: false,
          summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startedAt.getTime(),
          finishedAt: new Date(),
        };
        activeWorkflow = null;
        liveState = {
          ...liveState,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          errors: [err instanceof Error ? err.message : String(err)],
        };
        flush();
        logger.error('MultiAgentSystem workflow failed', { goal, error: String(err) });
        throw err;
      }
    );
    activeWorkflow = { goal, startedAt, promise };
    logger.info(`MultiAgentSystem workflow started`, { goal, strategy: activeStrategy });
    return textResult(
      `Workflow started for: ${goal}\n` +
      `Strategy: ${activeStrategy}\n` +
      `Monitor with: /agents status\n` +
      `Stop with:    /agents stop\n` +
      `(Persisted to ~/.codebuddy/agents/current.json — /agents resume on next boot.)`
    );
  }

  if (action === 'resume') {
    const persistence = await import('../../agent/multi-agent/workflow-persistence.js');
    const persisted = await persistence.loadWorkflow();
    if (!persisted) {
      return textResult('No interrupted workflow on disk to resume.');
    }
    if (persisted.status === 'completed' || persisted.status === 'failed') {
      return textResult(
        `Persisted workflow already finished (status: ${persisted.status}).\n` +
        `Goal: ${persisted.goal}\n` +
        `Summary: ${persisted.summary ?? '(none)'}\n` +
        `\nUse /agents run <new-goal> for a fresh workflow, or delete current.json to clear.`
      );
    }
    if (activeWorkflow) {
      return textResult(
        `Cannot resume — another workflow is in progress: ${activeWorkflow.goal}\n` +
        'Stop it first with /agents stop.'
      );
    }

    // Phase J (V0.3) — true per-task checkpoint resume.
    // schemaVersion v0.3 = saved by Phase J-aware code with completedTaskIds.
    // schemaVersion v0.1 = pre-Phase-J save migrated on load (completedTaskIds derived from results).
    // Both paths now actually resume by re-launching runWorkflow with resumeFrom.
    if (!agentsEnabled) {
      getMultiAgentSystem(apiKey, baseURL);
      agentsEnabled = true;
    }
    const system = getMultiAgentSystem(apiKey, baseURL);
    await wireCoordinatorIfPresent(system as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void; listenerCount: (e: string) => number });

    const completedTaskIds = persisted.completedTaskIds ?? persisted.results.map(([id]) => id);
    const startedAt = new Date();
    const resumeOpts = {
      strategy: persisted.strategy,
      resumeFrom: {
        completedTaskIds,
        results: persisted.results,
      },
    };

    const promise = system.runWorkflow(persisted.goal, resumeOpts).then(
      (result) => {
        lastResult = {
          goal: persisted.goal,
          success: result.success,
          summary: result.summary || '(no summary)',
          durationMs: result.totalDuration,
          finishedAt: new Date(),
        };
        activeWorkflow = null;
        if (result.success) {
          persistence.clearWorkflow().catch(() => { /* logged inside */ });
        }
        logger.info('MultiAgentSystem workflow resumed + completed', { goal: persisted.goal, success: result.success, skipped: completedTaskIds.length });
        return result;
      },
      (err: unknown) => {
        lastResult = {
          goal: persisted.goal,
          success: false,
          summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startedAt.getTime(),
          finishedAt: new Date(),
        };
        activeWorkflow = null;
        logger.error('MultiAgentSystem workflow resume failed', { goal: persisted.goal, error: String(err) });
        throw err;
      }
    );
    activeWorkflow = { goal: persisted.goal, startedAt, promise };

    return textResult(
      `Resuming interrupted workflow (V0.3 per-task checkpoint):\n` +
      `  Goal:              ${persisted.goal}\n` +
      `  Strategy:          ${persisted.strategy}\n` +
      `  Originally started: ${persisted.startedAt}\n` +
      `  Schema version:    ${persisted.schemaVersion ?? 'v0.1'}\n` +
      `  Tasks to skip:     ${completedTaskIds.length} (already completed)\n` +
      `  Artifacts saved:   ${persisted.artifacts.length}\n` +
      `\n` +
      `Workflow restarted in background. Monitor with /agents status, stop with /agents stop.\n` +
      `Note: tasks marked completed are skipped, results re-injected. LLM non-determinism\n` +
      `means re-running pending tasks may produce slightly different output than the original run.`
    );
  }

  // Defensive fallback (should never hit due to VALID_ACTIONS gate above)
  return textResult(HELP_TEXT);
}

/**
 * Test hook — reset module state so tests stay isolated.
 * Call alongside resetMultiAgentSystem() in beforeEach/afterEach.
 */
export function _resetAgentsHandlerForTests(): void {
  agentsEnabled = false;
  activeStrategy = 'hierarchical';
  activeWorkflow = null;
  lastResult = null;
  coordinatorWired = false;
}
