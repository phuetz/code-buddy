/**
 * RunViewer — terminal display helpers for RunStore runs.
 *
 * Provides:
 *   showRun()    — display complete timeline + metrics + artifacts
 *   tailRun()    — stream events in real-time (follow mode)
 *   replayRun()  — show timeline then re-execute test steps
 */

import { RunStore, RunEvent, RunSummary, RunMetrics, ArtifactIndexRepairResult, RunLineageNode } from './run-store.js';
import { buildRunRecallPack, buildRunRecallPackAsync } from './run-recall-pack.js';
import {
  buildRunTrajectoryExport,
  renderRunTrajectoryExport,
} from './run-trajectory-export.js';
import {
  buildProofLedgerForRun,
  renderProofLedger,
} from './proof-ledger.js';
import {
  buildGoldenWorkflowEvalManifest,
  evaluateGoldenWorkflowRun,
  getGoldenWorkflowEvalFixture,
  renderGoldenWorkflowEvalManifest,
  renderGoldenWorkflowEvalResult,
} from './golden-workflow-evals.js';
import {
  buildPolicyEvalManifest,
  evaluatePolicyEvalRun,
  getPolicyEval,
  renderPolicyEvalManifest,
  renderPolicyEvalResult,
} from './policy-evals.js';
import {
  buildMobileSupervisionSnapshot,
  renderMobileSupervisionSnapshot,
} from './mobile-supervision-snapshot.js';
import {
  buildMobileSupervisionGatewayContract,
  renderMobileSupervisionGatewayContract,
} from './mobile-supervision-gateway-contract.js';
import {
  buildMobileSupervisionGatewayListenerShell,
  renderMobileSupervisionGatewayListenerShell,
} from './mobile-supervision-gateway-listener-shell.js';
import {
  buildMobileSupervisionGatewayReviewDraft,
  evaluateMobileSupervisionGatewayRequest,
  renderMobileSupervisionGatewayReviewDraft,
  renderMobileSupervisionGatewayRequestDecision,
  type MobileSupervisionGatewayRequest,
} from './mobile-supervision-gateway-policy.js';
import {
  buildMobileSupervisionPairingState,
  renderMobileSupervisionPairingState,
} from './mobile-supervision-pairing-state.js';
import {
  buildMobileSupervisionPairingAcceptancePlan,
  renderMobileSupervisionPairingAcceptancePlan,
} from './mobile-supervision-pairing-acceptance-plan.js';
import {
  buildMobileSupervisionApprovalQueue,
  renderMobileSupervisionApprovalQueue,
} from './mobile-supervision-approval-queue.js';
import {
  buildLearningRetrospective,
  renderLearningRetrospective,
  runLearningRetrospective,
} from '../agent/learning-agent.js';

export const RUN_SEARCH_JSON_SCHEMA_VERSION = 1;

// ──────────────────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  run_start: '[>]',
  run_end: '[=]',
  step_start: '[+]',
  step_end: '[-]',
  tool_call: '[T]',
  tool_result: '[.]',
  patch_created: '[P]',
  patch_applied: '[A]',
  decision: '[D]',
  error: '[!]',
  metric: '[M]',
  skill_selected: '[S]',
};

function eventIcon(type: string): string {
  return EVENT_ICONS[type] || '[?]';
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

function statusLabel(status: RunSummary['status']): string {
  switch (status) {
    case 'running': return '[RUNNING]';
    case 'completed': return '[DONE]';
    case 'failed': return '[FAIL]';
    case 'cancelled': return '[STOP]';
  }
}

/**
 * Format a single event as a timeline line.
 */
function formatEvent(event: RunEvent, relativeMs?: number): string {
  const icon = eventIcon(event.type);
  const time = relativeMs !== undefined ? `+${(relativeMs / 1000).toFixed(2)}s` : formatTs(event.ts);
  const data = event.data;

  let detail = '';
  if (event.type === 'tool_call') {
    detail = `${data.toolName || ''}`;
    if (data.args && typeof data.args === 'object') {
      const args = data.args as Record<string, unknown>;
      if (typeof args.command === 'string') {
        detail += ` command="${args.command.slice(0, 60)}"`;
      } else if (typeof args.path === 'string') {
        detail += ` path=${args.path}`;
      }
    }
  } else if (event.type === 'tool_result') {
    const success = data.success ? 'ok' : 'fail';
    const dur = data.durationMs ? ` ${data.durationMs}ms` : '';
    detail = `${data.toolName || ''} ${success}${dur}`;
    if (!data.success && data.error) {
      detail += ` error="${String(data.error).slice(0, 60)}"`;
    }
  } else if (event.type === 'patch_created') {
    detail = `artifact=${data.artifact}`;
  } else if (event.type === 'patch_applied') {
    detail = `files=${data.filesApplied}`;
  } else if (event.type === 'run_start') {
    detail = `objective="${data.objective}"`;
  } else if (event.type === 'run_end') {
    detail = `status=${data.status}`;
  } else if (event.type === 'error') {
    detail = String(data.message || data.error || '').slice(0, 80);
  } else if (event.type === 'decision') {
    detail = String(data.description || '').slice(0, 80);
  } else if (event.type === 'skill_selected') {
    detail = String(data.skillName || '').slice(0, 80);
  }

  return `  ${icon} ${time}  ${event.type.padEnd(14)} ${detail}`;
}

/**
 * Build a full timeline string from a list of events.
 */
export function prettyTimeline(events: RunEvent[]): string {
  const first = events[0];
  if (first === undefined) return '  (no events)';
  const startTs = first.ts;
  return events
    .map((e) => formatEvent(e, e.ts - startTs))
    .join('\n');
}

/**
 * Format metrics for display.
 */
export function showMetrics(metrics: Partial<RunMetrics>): string {
  const lines: string[] = [];
  if (metrics.durationMs !== undefined) lines.push(`  Duration:    ${formatDuration(metrics.durationMs)}`);
  if (metrics.totalTokens !== undefined) lines.push(`  Tokens:      ${metrics.totalTokens.toLocaleString()}`);
  if (metrics.totalCost !== undefined) lines.push(`  Cost:        $${metrics.totalCost.toFixed(6)}`);
  if (metrics.toolCallCount !== undefined) lines.push(`  Tool calls:  ${metrics.toolCallCount}`);
  if (metrics.failoverCount !== undefined && metrics.failoverCount > 0) {
    lines.push(`  Failovers:   ${metrics.failoverCount}`);
  }
  return lines.join('\n') || '  (no metrics)';
}

// ──────────────────────────────────────────────────────────────────
// Public display functions
// ──────────────────────────────────────────────────────────────────

/**
 * Print a complete run record to stdout.
 */
export async function showRun(runId: string): Promise<void> {
  const store = RunStore.getInstance();
  const record = store.getRun(runId);

  if (!record) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  const { summary, metrics, artifacts } = record;

  console.log('');
  console.log(`Run: ${runId}`);
  console.log(`Status: ${statusLabel(summary.status)}`);
  console.log(`Objective: ${summary.objective}`);
  if (summary.startedAt) {
    console.log(`Started: ${formatTs(summary.startedAt)}`);
  }
  if (summary.endedAt) {
    const dur = summary.endedAt - summary.startedAt;
    console.log(`Ended:   ${formatTs(summary.endedAt)} (${formatDuration(dur)})`);
  }

  console.log('');
  console.log('── Metrics ─────────────────────────────');
  console.log(showMetrics(metrics));

  if (artifacts.length > 0) {
    console.log('');
    console.log('── Artifacts ───────────────────────────');
    for (const artifact of artifacts) {
      console.log(`  ${artifact}`);
    }
  }

  const events = store.getEvents(runId);
  if (events.length > 0) {
    console.log('');
    console.log('── Timeline ────────────────────────────');
    console.log(prettyTimeline(events));
  }

  console.log('');
}

/**
 * Tail a run's event stream live.
 */
export async function tailRun(runId: string): Promise<void> {
  const store = RunStore.getInstance();
  const record = store.getRun(runId);

  if (!record) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  console.log(`Tailing run ${runId} (Ctrl-C to stop)…`);
  console.log('');

  let lastTs: number | null = null;

  for await (const event of store.streamEvents(runId)) {
    const relMs = lastTs !== null ? event.ts - lastTs : 0;
    console.log(formatEvent(event, relMs));
    lastTs = event.ts;
  }

  console.log('');
  console.log('[Stream ended]');
}

/**
 * Replay: show timeline then list test steps that can be re-run.
 */
export async function replayRun(runId: string, rerun = true): Promise<void> {
  const store = RunStore.getInstance();

  await showRun(runId);

  const events = store.getEvents(runId);
  const testCalls = events.filter(
    (e) =>
      e.type === 'tool_call' &&
      typeof e.data.toolName === 'string' &&
      e.data.toolName === 'bash' &&
      typeof e.data.args === 'object' &&
      typeof (e.data.args as Record<string, unknown>)?.command === 'string' &&
      /\b(test|jest|pytest|mocha|vitest|npm\s+test|cargo\s+test|go\s+test)\b/i.test(
        String((e.data.args as Record<string, unknown>)?.command)
      )
  );

  if (testCalls.length === 0) {
    console.log('No test steps found in this run.');
    return;
  }

  console.log('── Test steps ──────────────────────────');
  for (const tc of testCalls) {
    const cmd = (tc.data.args as Record<string, unknown>)?.command;
    console.log(`  $ ${cmd}`);
  }

  if (rerun) {
    console.log('');
    console.log('Re-running test steps…');
    const { execSync } = await import('child_process');
    for (const tc of testCalls) {
      const cmd = String((tc.data.args as Record<string, unknown>)?.command);
      console.log(`\n$ ${cmd}`);
      try {
        const out = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
        console.log(out);
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        if (e.stdout) console.log(e.stdout);
        if (e.stderr) console.error(e.stderr);
        console.error(`Command failed: ${cmd}`);
      }
    }
  }
}

/**
 * List runs summary to stdout.
 */
export function listRuns(limit = 20): void {
  const store = RunStore.getInstance();
  const runs = store.listRuns(limit);

  if (runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  console.log('');
  console.log(`Recent runs (${runs.length})`);
  console.log('');
  for (const r of runs) {
    const dur = r.endedAt ? formatDuration(r.endedAt - r.startedAt) : 'running';
    const obj = r.objective.slice(0, 50);
    console.log(`  ${statusLabel(r.status)} ${r.runId}  ${formatTs(r.startedAt)}  (${dur})  ${obj}`);
  }
  console.log('');
}

/**
 * Search run summaries, events, and text artifacts.
 */
export function searchRuns(query: string, limit = 20, sources: string[] = [], json = false): void {
  const store = RunStore.getInstance();
  const results = store.searchRuns(query, { limit, sources });

  if (json) {
    console.log(JSON.stringify({
      schemaVersion: RUN_SEARCH_JSON_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      query,
      filters: {
        limit,
        sources,
      },
      count: results.length,
      results,
    }, null, 2));
    return;
  }

  if (results.length === 0) {
    const sourceText = sources.length > 0 ? ` in sources: ${sources.join(', ')}` : '';
    console.log(`No runs found matching: ${query}${sourceText}`);
    return;
  }

  const sourceText = sources.length > 0 ? ` sources=${sources.join(',')}` : '';
  console.log(`Run search results for "${query}"${sourceText} (${results.length}):`);
  console.log('');
  for (const result of results) {
    const matched = result.artifact
      ? `${result.matched}:${result.artifact}`
      : result.eventType
        ? `${result.matched}:${result.eventType}`
        : result.matched;
    const source = result.source ? ` source:${result.source}` : '';
    console.log(`  ${result.runId} ${statusLabel(result.status)} ${matched}${source}`);
    console.log(`    ${result.objective}`);
    console.log(`    ${result.snippet}`);
  }
}

/**
 * Backfill the durable artifact search index for historical run folders.
 */
export function indexRunArtifacts(limit = 100, sources: string[] = [], json = false): void {
  const store = RunStore.getInstance();
  const result = store.backfillArtifactIndex({ limit, sources });
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    filters: {
      limit: result.limit,
      sources: result.sources,
    },
    ...result,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const sourceText = result.sources.length > 0 ? ` sources=${result.sources.join(',')}` : '';
  if (result.unavailable) {
    console.log(`Artifact index unavailable${sourceText}; skipped ${result.skippedCount} artifacts from ${result.runCount} runs.`);
    return;
  }

  console.log(`Artifact index backfill${sourceText}: indexed ${result.indexedCount}/${result.artifactCount} artifacts from ${result.runCount} runs.`);
  if (result.failedCount > 0) {
    console.log(`Failed artifacts: ${result.failedCount}`);
  }
}

/**
 * Report (and optionally repair) stale rows in the durable artifact FTS index.
 *
 * Stale rows accumulate when run folders are pruned (the 30-run cap) or moved,
 * leaving search hits that point at nothing. This is the operator-facing
 * health/repair surface for that drift.
 */
export function runIndexDoctor(
  options: { repair?: boolean; includeOrphans?: boolean; json?: boolean } = {},
): void {
  const store = RunStore.getInstance();
  const repair = options.repair === true;
  const includeOrphans = options.includeOrphans === true;

  const report = repair
    ? store.repairArtifactIndex({ includeOrphans })
    : store.checkArtifactIndexHealth();

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: repair ? 'repair' : 'check',
    includeOrphans,
    ...report,
  };

  if (options.json === true) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (report.unavailable) {
    console.log('Artifact index unavailable (SQLite/FTS layer could not be opened); nothing to inspect.');
    return;
  }

  console.log('');
  console.log(`Artifact index doctor (${repair ? 'repair' : 'check'})`);
  console.log(`  indexed rows : ${report.totalRows}`);
  console.log(`  healthy      : ${report.healthyRows}`);
  console.log(`  stale (run gone)      : ${report.staleRows}`);
  console.log(`  orphaned (file gone)  : ${report.orphanedRows}`);

  if ('removedRows' in report) {
    const repairResult = report as ArtifactIndexRepairResult;
    const scope = repairResult.includedOrphans ? 'stale + orphaned' : 'stale';
    console.log(`  removed (${scope}) : ${repairResult.removedRows}`);
  } else if (report.staleRows > 0 || report.orphanedRows > 0) {
    console.log('');
    console.log('  Run with --repair to remove stale rows (add --include-orphans for missing files).');
  }

  if (!repair && report.rows.length > 0) {
    console.log('');
    const shown = report.rows.slice(0, 20);
    for (const row of shown) {
      console.log(`  - ${row.runId}/${row.artifact} (${row.reason})`);
    }
    if (report.rows.length > shown.length) {
      console.log(`  … and ${report.rows.length - shown.length} more`);
    }
  }
  console.log('');
}

/**
 * Show the fork family tree of a run: ancestor chain plus descendant subtree.
 */
export function runLineage(runId: string, json = false): void {
  const store = RunStore.getInstance();
  const lineage = store.getRunLineage(runId);

  if (json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ...lineage,
    }, null, 2));
    return;
  }

  if (!lineage.found) {
    console.log(`Run not found: ${runId}`);
    return;
  }

  console.log('');
  console.log(`Run lineage for ${runId} (family of ${lineage.familySize})`);
  console.log('');

  if (lineage.ancestors.length > 0) {
    console.log('Ancestors (root → parent):');
    lineage.ancestors.forEach((ancestor, depth) => {
      const reason = ancestor.forkReason ? ` [${ancestor.forkReason}]` : '';
      console.log(`  ${'  '.repeat(depth)}↳ ${ancestor.runId}${reason}  ${ancestor.objective.slice(0, 50)}`);
    });
    console.log('');
  } else {
    console.log('Ancestors: none (this is a root run)');
    console.log('');
  }

  console.log('Subtree:');
  const printNode = (node: RunLineageNode, depth: number): void => {
    const reason = node.forkReason ? ` [${node.forkReason}]` : '';
    const marker = depth === 0 ? '●' : '↳';
    console.log(`  ${'  '.repeat(depth)}${marker} ${node.runId}${reason}  ${statusLabel(node.status)}  ${node.objective.slice(0, 50)}`);
    for (const child of node.children) {
      printNode(child, depth + 1);
    }
  };
  if (lineage.tree) {
    printNode(lineage.tree, 0);
  }
  console.log('');
}

/**
 * Build a compact recall pack for feeding relevant run evidence back into an
 * agent or UI handoff.
 */
export async function showRunRecallPack(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
): Promise<void> {
  const options = {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  };
  const pack = includeSessions
    ? await buildRunRecallPackAsync(query, options)
    : buildRunRecallPack(query, options);
  if (json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }
  console.log(pack.promptContext);
}

/**
 * Export a redacted run trajectory for debugging, evals, or operator review.
 * This is read-only: it does not replay tools or mutate local state.
 */
export async function showRunTrajectoryExport(
  runId: string,
  json = false,
  includeArtifactContent = false,
  maxArtifactBytes = 4_000,
): Promise<void> {
  const exported = buildRunTrajectoryExport(runId, {
    includeArtifactContent,
    maxArtifactBytes,
  });

  if (!exported) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(exported, null, 2));
    return;
  }

  console.log(renderRunTrajectoryExport(exported));
}

/**
 * Show the automatic proof ledger card for a run.
 */
export function showRunProofLedger(runId: string, json = false): void {
  const store = RunStore.getInstance();
  const entry = buildProofLedgerForRun(store, runId);

  if (!entry) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  console.log(renderProofLedger(entry));
}

/**
 * Run the Learning Agent retrospective over a durable, redacted trajectory.
 * By default this is a real write path: it stores the retrospective artifact,
 * updates the learning pattern library, and materializes review-gated lesson /
 * skill candidates. `dryRun` keeps it read-only for inspection.
 */
export async function showLearningRetrospective(
  runId: string,
  options: { dryRun?: boolean; force?: boolean; json?: boolean } = {},
): Promise<void> {
  const store = RunStore.getInstance();
  if (options.dryRun === true) {
    const retrospective = buildLearningRetrospective(runId, { store, workDir: process.cwd() });
    if (!retrospective) {
      console.error(`Run not found: ${runId}`);
      process.exit(1);
    }
    if (options.json === true) {
      console.log(JSON.stringify({ skipped: false, dryRun: true, retrospective }, null, 2));
      return;
    }
    console.log(renderLearningRetrospective(retrospective));
    return;
  }

  const result = await runLearningRetrospective(store, runId, {
    force: options.force === true,
    workDir: process.cwd(),
  });

  if (result.skipped) {
    if (options.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Learning Agent skipped: ${result.skippedReason}`);
    return;
  }

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.retrospective) {
    console.log(renderLearningRetrospective(result.retrospective));
  }
  console.log('');
  console.log(`Learning artifacts: ${result.retrospectiveArtifact ?? 'none'}`);
  console.log(`Lesson candidates proposed: ${result.lessonCandidateCount}`);
  console.log(`Skill candidates materialized: ${result.skillCandidateCount}`);
  console.log(`Skill usages recorded: ${result.skillUsageCount}`);
  if (result.patternLibraryPath) {
    console.log(`Pattern library: ${result.patternLibraryPath}`);
  }
}

/**
 * Print the golden workflow eval manifest, or evaluate one run against one
 * fixture. This is read-only and uses the redacted trajectory export as the
 * evidence boundary.
 */
export async function showGoldenWorkflowEvals(
  fixtureId?: string,
  runId?: string,
  json = false,
): Promise<void> {
  if (!fixtureId || !runId) {
    const manifest = buildGoldenWorkflowEvalManifest();
    if (json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    console.log(renderGoldenWorkflowEvalManifest(manifest));
    return;
  }

  if (!getGoldenWorkflowEvalFixture(fixtureId)) {
    console.error(`Golden workflow fixture not found: ${fixtureId}`);
    process.exit(1);
  }

  const result = evaluateGoldenWorkflowRun(fixtureId, runId);
  if (!result) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderGoldenWorkflowEvalResult(result));
}

/**
 * Print trajectory policy evals, or evaluate one run against one policy.
 * This is read-only and converts supervision safety expectations into
 * repeatable assertions over the redacted trajectory envelope.
 */
export async function showPolicyEvals(
  policyId?: string,
  runId?: string,
  json = false,
): Promise<void> {
  if (!policyId || !runId) {
    const manifest = buildPolicyEvalManifest();
    if (json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    console.log(renderPolicyEvalManifest(manifest));
    return;
  }

  if (!getPolicyEval(policyId)) {
    console.error(`Policy eval not found: ${policyId}`);
    process.exit(1);
  }

  const result = evaluatePolicyEvalRun(policyId, runId);
  if (!result) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderPolicyEvalResult(result));
}

/**
 * Build a review-only, redacted snapshot suitable for a future mobile
 * supervision surface. This does not expose a server or execute actions.
 */
export async function showMobileSupervisionSnapshot(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
): Promise<void> {
  const snapshot = await buildMobileSupervisionSnapshot(query, {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  });

  if (json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(renderMobileSupervisionSnapshot(snapshot));
}

/**
 * Build the review-only gateway contract for a future mobile supervision
 * surface. This intentionally describes safe routes without opening a server.
 */
export async function showMobileSupervisionGatewayContract(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
  includeSnapshot = true,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    includeSnapshot,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  });

  if (json) {
    console.log(JSON.stringify(contract, null, 2));
    return;
  }

  console.log(renderMobileSupervisionGatewayContract(contract));
}

/**
 * Evaluate a hypothetical mobile gateway request against the review-only
 * contract. This gives future server/mobile work a tested policy boundary
 * before any listener exists.
 */
export async function showMobileSupervisionGatewayDecision(
  query: string,
  request: MobileSupervisionGatewayRequest,
  json = false,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    includeSnapshot: false,
    limit: 1,
  });
  const decision = evaluateMobileSupervisionGatewayRequest(contract, request);

  if (json) {
    console.log(JSON.stringify(decision, null, 2));
    return;
  }

  console.log(renderMobileSupervisionGatewayRequestDecision(decision));
}

/**
 * Build a local-only operator review draft for a hypothetical mobile gateway
 * request. This models approval/cancel UI state without performing approval.
 */
export async function showMobileSupervisionGatewayReviewDraft(
  query: string,
  request: MobileSupervisionGatewayRequest,
  json = false,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    includeSnapshot: false,
    limit: 1,
  });
  const draft = buildMobileSupervisionGatewayReviewDraft(query, contract, request);

  if (json) {
    console.log(JSON.stringify(draft, null, 2));
    return;
  }

  console.log(renderMobileSupervisionGatewayReviewDraft(draft));
}

/**
 * Build the disabled listener shell for the future mobile gateway. This is a
 * route/readiness artifact only: no network server is started here.
 */
export async function showMobileSupervisionGatewayListenerShell(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    includeSnapshot: false,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  });
  const shell = buildMobileSupervisionGatewayListenerShell(contract);

  if (json) {
    console.log(JSON.stringify(shell, null, 2));
    return;
  }

  console.log(renderMobileSupervisionGatewayListenerShell(shell));
}

/**
 * Build a preview-only local pairing state for the future mobile gateway. This
 * does not persist credentials, mint tokens, accept pairings or start a server.
 */
export async function showMobileSupervisionPairingState(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
  deviceLabel?: string,
  ttlSeconds?: number,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    includeSnapshot: false,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  });
  const shell = buildMobileSupervisionGatewayListenerShell(contract);
  const state = buildMobileSupervisionPairingState(shell, {
    deviceLabel,
    ttlSeconds,
  });

  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  console.log(renderMobileSupervisionPairingState(state));
}

/**
 * Build a no-network pairing acceptance plan for the future mobile gateway. This
 * explains the mutation boundary without starting a listener or accepting codes.
 */
export async function showMobileSupervisionPairingAcceptancePlan(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
  deviceLabel?: string,
  ttlSeconds?: number,
  localOperatorLabel?: string,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    includeSnapshot: false,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  });
  const shell = buildMobileSupervisionGatewayListenerShell(contract);
  const pairingState = buildMobileSupervisionPairingState(shell, {
    deviceLabel,
    ttlSeconds,
  });
  const plan = buildMobileSupervisionPairingAcceptancePlan(pairingState, {
    localOperatorLabel,
  });

  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(renderMobileSupervisionPairingAcceptancePlan(plan));
}

/**
 * Build a local-only mobile approval queue for the future gateway. The queue
 * describes read-only, pending and blocked requests without mutating state.
 */
export async function showMobileSupervisionApprovalQueue(
  query: string,
  limit = 20,
  sources: string[] = [],
  json = false,
  includeLessons = false,
  maxLessons = 5,
  includeSessions = false,
  maxSessions = 3,
  includeMemories = false,
  maxMemories = 5,
  deviceLabel?: string,
  ttlSeconds?: number,
): Promise<void> {
  const contract = await buildMobileSupervisionGatewayContract(query, {
    cwd: includeLessons || includeMemories ? process.cwd() : undefined,
    includeLessons,
    includeMemories,
    includeSessions,
    includeSnapshot: false,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    sources,
  });
  const shell = buildMobileSupervisionGatewayListenerShell(contract);
  const pairingState = buildMobileSupervisionPairingState(shell, {
    deviceLabel,
    ttlSeconds,
  });
  const queue = buildMobileSupervisionApprovalQueue(contract, pairingState);

  if (json) {
    console.log(JSON.stringify(queue, null, 2));
    return;
  }

  console.log(renderMobileSupervisionApprovalQueue(queue));
}
