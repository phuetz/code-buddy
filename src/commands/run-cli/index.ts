/**
 * buddy run — observability commands for RunStore runs
 *
 * Subcommands:
 *   buddy run list [--limit N]    → list recent runs
 *   buddy run doctor              → report stale running run rows
 *   buddy run show <runId>        → full timeline + metrics + artifacts
 *   buddy run search <query>      → search run summaries, events, artifacts
 *   buddy run index-artifacts     → backfill artifact search for old runs
 *   buddy run index-doctor        → report/repair stale artifact index rows
 *   buddy run lineage <runId>     → show the fork family tree of a run
 *   buddy run recall-pack <query> → build compact context from matching runs
 *   buddy run trajectory-export <runId> → export redacted run trajectory
 *   buddy run trajectory-batch [query] → export redacted trajectory batch
 *   buddy run retrospective <runId> → run the Learning Agent over a trajectory
 *   buddy run golden-evals [fixtureId] [runId] → list/evaluate golden workflows
 *   buddy run policy-evals [policyId] [runId] → list/evaluate trajectory policies
 *   buddy run mobile-snapshot <query> → build a review-only mobile handoff
 *   buddy run mobile-gateway-contract <query> → describe safe mobile routes
 *   buddy run mobile-gateway-check <query> → evaluate one future mobile route
 *   buddy run mobile-gateway-review-draft <query> → draft local operator review
 *   buddy run mobile-gateway-listener-shell <query> → disabled listener plan
 *   buddy run mobile-pairing-state <query> → preview local pairing state
 *   buddy run mobile-pairing-acceptance-plan <query> → preview pairing acceptance
 *   buddy run mobile-approval-queue <query> → preview local approvals
 *   buddy run tail <runId>        → live-stream events (follow mode)
 *   buddy run replay <runId>      → show timeline + re-execute test steps
 */

import type { Command } from 'commander';

interface RunNumericOptionRule {
  maximum?: number;
  minimum: number;
  option: string;
}

const RUN_NUMERIC_OPTION_RULES: Record<string, RunNumericOptionRule> = {
  limit: { minimum: 0, option: '--limit' },
  maxArtifactBytes: { minimum: 0, option: '--max-artifact-bytes' },
  maxCompressedBytes: { minimum: 0, option: '--max-compressed-bytes' },
  maxEventValueBytes: { minimum: 0, option: '--max-event-value-bytes' },
  maxLessons: { minimum: 0, option: '--max-lessons' },
  maxMemories: { minimum: 0, option: '--max-memories' },
  maxSessions: { minimum: 0, option: '--max-sessions' },
  staleAfterMinutes: { minimum: 0, option: '--stale-after-minutes' },
  ttl: { minimum: 60, maximum: 900, option: '--ttl' },
};

export function validateRunNumericOptions(options: Record<string, unknown>): void {
  for (const [key, rule] of Object.entries(RUN_NUMERIC_OPTION_RULES)) {
    const value = options[key];
    if (value === undefined) continue;
    const raw = String(value).trim();
    const parsed = Number(raw);
    const inRange = Number.isSafeInteger(parsed)
      && parsed >= rule.minimum
      && (rule.maximum === undefined || parsed <= rule.maximum);
    if (!/^\d+$/.test(raw) || !inRange) {
      const range = rule.maximum === undefined
        ? rule.minimum === 0 ? 'a non-negative integer' : `an integer >= ${rule.minimum}`
        : `an integer in ${rule.minimum}–${rule.maximum}`;
      throw new Error(`${rule.option} must be ${range} (received ${JSON.stringify(value)})`);
    }
  }
}

export function registerRunCommands(program: Command): void {
  const run = program
    .command('run')
    .description('Inspect and replay agent runs (observability)');

  run.hook('preAction', (_thisCommand, actionCommand) => {
    try {
      validateRunNumericOptions(actionCommand.opts());
    } catch (error) {
      actionCommand.error(`error: ${error instanceof Error ? error.message : String(error)}`, {
        code: 'commander.invalidArgument',
        exitCode: 1,
      });
    }
  });

  // ── buddy run list ─────────────────────────────────────────────
  run
    .command('list')
    .description('List recent runs')
    .option('-n, --limit <n>', 'number of runs to show', '20')
    .action(async (opts: { limit: string }) => {
      const { listRuns } = await import('../../observability/run-viewer.js');
      listRuns(parseInt(opts.limit, 10));
    });

  // ── buddy run doctor ───────────────────────────────────────────
  run
    .command('doctor')
    .description('Report stale running runs and other run ledger drift without mutating stored runs')
    .option('-n, --limit <n>', 'number of recent runs to inspect', '30')
    .option('--stale-after-minutes <n>', 'mark running runs stale after this many minutes', '60')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean; limit: string; staleAfterMinutes: string }) => {
      const { runDoctor } = await import('../../observability/run-viewer.js');
      runDoctor({
        json: opts.json === true,
        limit: parseInt(opts.limit, 10),
        staleAfterMinutes: parseInt(opts.staleAfterMinutes, 10),
      });
    });

  // ── buddy run show ─────────────────────────────────────────────
  run
    .command('show <runId>')
    .description('Show complete timeline, metrics, and artifacts for a run')
    .action(async (runId: string) => {
      const { showRun } = await import('../../observability/run-viewer.js');
      await showRun(runId);
    });

  // ── buddy run search ───────────────────────────────────────────
  run
    .command('search <query...>')
    .description('Search run summaries, events, and text artifacts')
    .option('-n, --limit <n>', 'number of matches to show', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: { json?: boolean; limit: string; source: string[] }) => {
      const { searchRuns } = await import('../../observability/run-viewer.js');
      searchRuns(queryParts.join(' '), parseInt(opts.limit, 10), opts.source, opts.json === true);
    });

  // ── buddy run index-artifacts ─────────────────────────────────
  run
    .command('index-artifacts')
    .description('Backfill the durable artifact search index for historical run folders')
    .option('-n, --limit <n>', 'number of recent runs to scan', '100')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean; limit: string; source: string[] }) => {
      const { indexRunArtifacts } = await import('../../observability/run-viewer.js');
      indexRunArtifacts(parseInt(opts.limit, 10), opts.source, opts.json === true);
    });

  // ── buddy run index-doctor ────────────────────────────────────
  run
    .command('index-doctor')
    .description('Report (and optionally repair) stale artifact index rows whose run folders were pruned or moved')
    .option('--repair', 'delete stale rows from the index')
    .option('--include-orphans', 'also remove rows whose run folder exists but artifact file is gone')
    .option('--json', 'output JSON')
    .action(async (opts: { repair?: boolean; includeOrphans?: boolean; json?: boolean }) => {
      const { runIndexDoctor } = await import('../../observability/run-viewer.js');
      runIndexDoctor({
        repair: opts.repair === true,
        includeOrphans: opts.includeOrphans === true,
        json: opts.json === true,
      });
    });

  // ── buddy run lineage ─────────────────────────────────────────
  run
    .command('lineage <runId>')
    .description('Show the fork family tree of a run (ancestors + descendants)')
    .option('--json', 'output JSON')
    .action(async (runId: string, opts: { json?: boolean }) => {
      const { runLineage } = await import('../../observability/run-viewer.js');
      runLineage(runId, opts.json === true);
    });

  // ── buddy run recall-pack ─────────────────────────────────────
  run
    .command('recall-pack <query...>')
    .description('Build a compact recall pack from matching run summaries, events, and artifacts')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      sessions?: boolean;
      source: string[];
    }) => {
      const { showRunRecallPack } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showRunRecallPack(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
      );
    });

  // ── buddy run trajectory-export ──────────────────────────────
  run
    .command('trajectory-export <runId>')
    .description('Export a redacted run trajectory for debugging, audit, or evals')
    .option('--include-artifact-content', 'include redacted artifact content previews')
    .option('--max-artifact-bytes <n>', 'maximum bytes per artifact preview', '4000')
    .option('--json', 'output JSON')
    .action(async (runId: string, opts: {
      includeArtifactContent?: boolean;
      json?: boolean;
      maxArtifactBytes: string;
    }) => {
      const { showRunTrajectoryExport } = await import('../../observability/run-viewer.js');
      await showRunTrajectoryExport(
        runId,
        opts.json === true,
        opts.includeArtifactContent === true,
        parseInt(opts.maxArtifactBytes, 10),
      );
    });

  // ── buddy run trajectory-batch ───────────────────────────────
  run
    .command('trajectory-batch [query...]')
    .description('Export a redacted batch of run trajectories plus compressed agent context')
    .option('-n, --limit <n>', 'maximum runs to include', '5')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--run-id <runId>', 'explicit run id to include (repeatable, comma-separated accepted)', collectOption, [])
    .option('--include-artifact-content', 'include redacted artifact content previews')
    .option('--max-artifact-bytes <n>', 'maximum bytes per artifact preview', '4000')
    .option('--max-compressed-bytes <n>', 'maximum bytes in the compressed agent context', '12000')
    .option('--max-event-value-bytes <n>', 'maximum bytes per redacted event value', '2000')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[] | undefined, opts: {
      includeArtifactContent?: boolean;
      json?: boolean;
      limit: string;
      maxArtifactBytes: string;
      maxCompressedBytes: string;
      maxEventValueBytes: string;
      runId: string[];
      source: string[];
    }) => {
      const { showRunTrajectoryBatchExport } = await import('../../observability/run-viewer.js');
      await showRunTrajectoryBatchExport((queryParts ?? []).join(' '), {
        includeArtifactContent: opts.includeArtifactContent === true,
        json: opts.json === true,
        limit: parseInt(opts.limit, 10),
        maxArtifactBytes: parseInt(opts.maxArtifactBytes, 10),
        maxCompressedBytes: parseInt(opts.maxCompressedBytes, 10),
        maxEventValueBytes: parseInt(opts.maxEventValueBytes, 10),
        runIds: opts.runId,
        sources: opts.source,
      });
    });

  // ── buddy run retrospective ──────────────────────────────────
  run
    .command('retrospective <runId>')
    .description('Run the Learning Agent over a redacted trajectory and propose review-gated lessons/skills')
    .option('--dry-run', 'inspect the retrospective without writing artifacts or candidates')
    .option('--force', 'run even if the automatic complexity gate would skip it')
    .option('--json', 'output JSON')
    .action(async (runId: string, opts: {
      dryRun?: boolean;
      force?: boolean;
      json?: boolean;
    }) => {
      const { showLearningRetrospective } = await import('../../observability/run-viewer.js');
      await showLearningRetrospective(runId, {
        dryRun: opts.dryRun === true || argvHasFlag('--dry-run'),
        force: opts.force === true,
        json: opts.json === true,
      });
    });

  // ── buddy run golden-evals ───────────────────────────────────
  run
    .command('golden-evals [fixtureId] [runId]')
    .description('List golden workflow eval fixtures, or evaluate one run against one fixture')
    .option('--json', 'output JSON')
    .action(async (fixtureId: string | undefined, runId: string | undefined, opts: { json?: boolean }) => {
      const { showGoldenWorkflowEvals } = await import('../../observability/run-viewer.js');
      await showGoldenWorkflowEvals(fixtureId, runId, opts.json === true);
    });

  // ── buddy run policy-evals ───────────────────────────────────
  run
    .command('policy-evals [policyId] [runId]')
    .description('List trajectory policy evals, or evaluate one run against one policy')
    .option('--json', 'output JSON')
    .action(async (policyId: string | undefined, runId: string | undefined, opts: { json?: boolean }) => {
      const { showPolicyEvals } = await import('../../observability/run-viewer.js');
      await showPolicyEvals(policyId, runId, opts.json === true);
    });

  // ── buddy run mobile-snapshot ─────────────────────────────────
  run
    .command('mobile-snapshot <query...>')
    .description('Build a redacted review-only snapshot for mobile supervision')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      sessions?: boolean;
      source: string[];
    }) => {
      const { showMobileSupervisionSnapshot } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showMobileSupervisionSnapshot(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
      );
    });

  // ── buddy run mobile-gateway-contract ────────────────────────
  run
    .command('mobile-gateway-contract <query...>')
    .description('Describe the review-only mobile supervision gateway contract')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--json', 'output JSON')
    .option('--no-snapshot', 'omit the embedded mobile snapshot from the contract output')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      sessions?: boolean;
      snapshot?: boolean;
      source: string[];
    }) => {
      const { showMobileSupervisionGatewayContract } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showMobileSupervisionGatewayContract(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
        opts.snapshot !== false,
      );
    });

  // ── buddy run mobile-gateway-check ───────────────────────────
  run
    .command('mobile-gateway-check <query...>')
    .description('Evaluate a hypothetical mobile gateway request against the review-only policy')
    .requiredOption('--action <action>', 'mobile gateway action to evaluate')
    .requiredOption('--method <method>', 'HTTP method to evaluate (GET or POST)')
    .requiredOption('--path <path>', 'request path to evaluate')
    .option('--local-operator', 'mark the request as reviewed by a local operator')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      action: string;
      json?: boolean;
      localOperator?: boolean;
      method: string;
      path: string;
    }) => {
      const { showMobileSupervisionGatewayDecision } = await import('../../observability/run-viewer.js');
      await showMobileSupervisionGatewayDecision(
        queryParts.join(' '),
        {
          action: opts.action,
          hasLocalOperator: opts.localOperator === true,
          method: parseMobileGatewayMethod(opts.method),
          path: opts.path,
        },
        opts.json === true,
      );
    });

  // ── buddy run mobile-gateway-review-draft ────────────────────
  run
    .command('mobile-gateway-review-draft <query...>')
    .description('Build a local-only operator review draft for a hypothetical mobile gateway request')
    .requiredOption('--action <action>', 'mobile gateway action to review')
    .requiredOption('--method <method>', 'HTTP method to review (GET or POST)')
    .requiredOption('--path <path>', 'request path to review')
    .option('--local-operator', 'mark the request as reviewed by a local operator')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      action: string;
      json?: boolean;
      localOperator?: boolean;
      method: string;
      path: string;
    }) => {
      const { showMobileSupervisionGatewayReviewDraft } = await import('../../observability/run-viewer.js');
      await showMobileSupervisionGatewayReviewDraft(
        queryParts.join(' '),
        {
          action: opts.action,
          hasLocalOperator: opts.localOperator === true,
          method: parseMobileGatewayMethod(opts.method),
          path: opts.path,
        },
        opts.json === true,
      );
    });

  // ── buddy run mobile-gateway-listener-shell ──────────────────
  run
    .command('mobile-gateway-listener-shell <query...>')
    .description('Build the disabled local listener shell for the future mobile gateway')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      sessions?: boolean;
      source: string[];
    }) => {
      const { showMobileSupervisionGatewayListenerShell } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showMobileSupervisionGatewayListenerShell(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
      );
    });

  // ── buddy run mobile-pairing-state ───────────────────────────
  run
    .command('mobile-pairing-state <query...>')
    .description('Build a preview-only local pairing state for the future mobile gateway')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--device-label <label>', 'local label for the supervising device')
    .option('--ttl <seconds>', 'preview pairing TTL in seconds (60-900)', '300')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      deviceLabel?: string;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      sessions?: boolean;
      source: string[];
      ttl: string;
    }) => {
      const { showMobileSupervisionPairingState } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showMobileSupervisionPairingState(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
        opts.deviceLabel,
        parseInt(opts.ttl, 10),
      );
    });

  // ── buddy run mobile-pairing-acceptance-plan ─────────────────
  run
    .command('mobile-pairing-acceptance-plan <query...>')
    .description('Build a no-network pairing acceptance plan for the future mobile gateway')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--device-label <label>', 'local label for the supervising device')
    .option('--ttl <seconds>', 'preview pairing TTL in seconds (60-900)', '300')
    .option('--operator-label <label>', 'local operator label for the acceptance plan')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      deviceLabel?: string;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      operatorLabel?: string;
      sessions?: boolean;
      source: string[];
      ttl: string;
    }) => {
      const { showMobileSupervisionPairingAcceptancePlan } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showMobileSupervisionPairingAcceptancePlan(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
        opts.deviceLabel,
        parseInt(opts.ttl, 10),
        opts.operatorLabel,
      );
    });

  // ── buddy run mobile-approval-queue ──────────────────────────
  run
    .command('mobile-approval-queue <query...>')
    .description('Build a local-only mobile approval queue for the future gateway')
    .option('-n, --limit <n>', 'number of matches to include', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectOption, [])
    .option('--lessons', 'include matching lessons.md entries')
    .option('--max-lessons <n>', 'number of matching lessons to include', '5')
    .option('--memories', 'include matching persistent memory entries')
    .option('--max-memories <n>', 'number of matching memories to include', '5')
    .option('--sessions', 'include matching saved sessions')
    .option('--max-sessions <n>', 'number of matching sessions to include', '3')
    .option('--all-context', 'include matching lessons, memories, and saved sessions')
    .option('--device-label <label>', 'local label for the supervising device')
    .option('--ttl <seconds>', 'preview pairing TTL in seconds (60-900)', '300')
    .option('--json', 'output JSON')
    .action(async (queryParts: string[], opts: {
      allContext?: boolean;
      deviceLabel?: string;
      json?: boolean;
      lessons?: boolean;
      limit: string;
      memories?: boolean;
      maxMemories: string;
      maxLessons: string;
      maxSessions: string;
      sessions?: boolean;
      source: string[];
      ttl: string;
    }) => {
      const { showMobileSupervisionApprovalQueue } = await import('../../observability/run-viewer.js');
      const includeAllContext = opts.allContext === true;
      await showMobileSupervisionApprovalQueue(
        queryParts.join(' '),
        parseInt(opts.limit, 10),
        opts.source,
        opts.json === true,
        includeAllContext || opts.lessons === true,
        parseInt(opts.maxLessons, 10),
        includeAllContext || opts.sessions === true,
        parseInt(opts.maxSessions, 10),
        includeAllContext || opts.memories === true,
        parseInt(opts.maxMemories, 10),
        opts.deviceLabel,
        parseInt(opts.ttl, 10),
      );
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

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function argvHasFlag(flag: string): boolean {
  return process.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function parseMobileGatewayMethod(method: string): 'GET' | 'POST' {
  const normalized = method.trim().toUpperCase();
  if (normalized === 'GET' || normalized === 'POST') {
    return normalized;
  }
  throw new Error(`Unsupported mobile gateway method: ${method}`);
}
