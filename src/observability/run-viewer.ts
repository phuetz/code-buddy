/**
 * RunViewer — terminal display helpers for RunStore runs.
 *
 * Provides:
 *   showRun()    — display complete timeline + metrics + artifacts
 *   tailRun()    — stream events in real-time (follow mode)
 *   replayRun()  — show timeline then re-execute test steps
 */

import fs from 'fs';
import path from 'path';
import { RunStore, RunEvent, RunSummary, RunMetrics } from './run-store.js';

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
  }

  return `  ${icon} ${time}  ${event.type.padEnd(14)} ${detail}`;
}

/**
 * Build a full timeline string from a list of events.
 */
export function prettyTimeline(events: RunEvent[]): string {
  if (events.length === 0) return '  (no events)';
  const startTs = events[0].ts;
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
