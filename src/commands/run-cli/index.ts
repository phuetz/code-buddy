/**
 * buddy run — observability commands for RunStore runs
 *
 * Subcommands:
 *   buddy run list [--limit N]    → list recent runs
 *   buddy run show <runId>        → full timeline + metrics + artifacts
 *   buddy run tail <runId>        → live-stream events (follow mode)
 *   buddy run replay <runId>      → show timeline + re-execute test steps
 */

import type { Command } from 'commander';

export function registerRunCommands(program: Command): void {
  const run = program
    .command('run')
    .description('Inspect and replay agent runs (observability)');

  // ── buddy run list ─────────────────────────────────────────────
  run
    .command('list')
    .description('List recent runs')
    .option('-n, --limit <n>', 'number of runs to show', '20')
    .action(async (opts: { limit: string }) => {
      const { listRuns } = await import('../../observability/run-viewer.js');
      listRuns(parseInt(opts.limit, 10));
    });

  // ── buddy run show ─────────────────────────────────────────────
  run
    .command('show <runId>')
    .description('Show complete timeline, metrics, and artifacts for a run')
    .action(async (runId: string) => {
      const { showRun } = await import('../../observability/run-viewer.js');
      await showRun(runId);
    });

  // ── buddy run tail ─────────────────────────────────────────────
  run
    .command('tail <runId>')
    .description('Stream run events in real-time (follow mode)')
    .action(async (runId: string) => {
      const { tailRun } = await import('../../observability/run-viewer.js');
      await tailRun(runId);
    });

  // ── buddy run replay ───────────────────────────────────────────
  run
    .command('replay <runId>')
    .description('Show timeline and re-execute test steps')
    .option('--no-rerun', 'only show timeline, do not re-run tests')
    .action(async (runId: string, opts: { rerun: boolean }) => {
      const { replayRun } = await import('../../observability/run-viewer.js');
      await replayRun(runId, opts.rerun !== false);
    });
}
