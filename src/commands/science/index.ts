/**
 * `buddy science` — AI-Scientist-lite Phase 0 CLI.
 *
 * Runs ONE bounded, human-gated research/experiment pass by composing existing
 * Code Buddy faculties (see {@link module:agent/science/experiment-orchestrator}).
 * It EXECUTES generated code, so it is defensive by construction:
 *
 *   - OPT-IN: requires `CODEBUDDY_AI_SCIENTIST=true` (default OFF ⇒ prints an
 *     opt-in notice and does nothing — zero behaviour change).
 *   - CLI-ONLY: this is NOT an agent tool. The agent can never launch an
 *     experiment mid-chat; a human must run this command.
 *   - TWO human gates (approve the plan before running code; approve the report
 *     before publishing to the collective knowledge graph) — both FAIL CLOSED.
 *   - SANDBOXED execution (envMode:'isolate') is enforced by the orchestrator.
 *
 * Usage:
 *   CODEBUDDY_AI_SCIENTIST=true buddy science "does focal loss beat CE on toy imbalance?"
 *   CODEBUDDY_AI_SCIENTIST=true buddy science "..." --hypothesis "focal loss ↑ minority recall" --report out.md
 *   CODEBUDDY_AI_SCIENTIST=true buddy science "..." --code-file experiment.py --language python
 *
 * @module commands/science
 */

import { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { logger } from '../../utils/logger.js';
import { runExperiment, type ExperimentRun } from '../../agent/science/experiment-orchestrator.js';
import type { ExperimentLoopResult } from '../../agent/science/experiment-loop.js';
import type { ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';

const VALID_LANGUAGES: ExecuteCodeLanguage[] = ['python', 'javascript', 'typescript', 'shell'];

interface ScienceCliOptions {
  hypothesis?: string;
  codeFile?: string;
  language?: string;
  model?: string;
  timeout?: string;
  report?: string;
  /** Commander sets this false when --no-publish is passed. */
  publish?: boolean;
  /** Phase 1: empirically score + keep-gate the experiment metric. */
  score?: boolean;
  metricKey?: string;
  baselineScore?: string;
  /** Commander sets this false when --lower-is-better is passed. */
  higherIsBetter?: boolean;
  /** Phase 2: execution sandbox backend (isolate|docker|e2b). */
  sandbox?: string;
  /** Phase 2: fail closed instead of degrading to a network-open sandbox. */
  requireNetworkIsolation?: boolean;
  /** Phase 3: run the bounded multi-generation BFTS discovery loop. */
  loop?: boolean;
  /** Phase 3 HARD CAP: max generations. */
  maxGenerations?: string;
  /** Phase 3 HARD CAP: max experiments executed. */
  maxExperiments?: string;
  /** Phase 3 HARD CAP: wall-clock budget (duration, e.g. 30s / 10m / 2h). */
  budget?: string;
  /** Phase 3: parallel workers per generation (bounded). */
  parallel?: string;
  /** Phase 3 HARD CAP: cost budget (arbitrary units); arm with --cost-per-experiment. */
  maxCost?: string;
  /** Phase 3: cost charged per executed experiment (drives --max-cost). */
  costPerExperiment?: string;
}

/** Human-readable one-pass summary. */
function renderRun(run: ExperimentRun): string {
  const lines: string[] = [];
  lines.push(`\n=== AI-Scientist Phase 0 — ${run.status.toUpperCase()} ===\n`);
  if (run.idea) lines.push(`Hypothèse [${run.idea.source}]: ${run.idea.hypothesis}`);
  if (run.novelty) lines.push(`Nouveauté: ${run.novelty.noveltyAssessment} — ${run.novelty.summary}`);
  lines.push('');
  lines.push('Étapes:');
  for (const s of run.stages) {
    lines.push(`  ${s.ok ? '✓' : '✗'} ${s.stage.padEnd(12)} ${s.detail}`);
  }
  if (run.review) lines.push(`\nRevue: ${run.review.verdict}`);
  if (run.empirical) {
    const e = run.empirical;
    lines.push(
      `\nEmpirique: fitness ${e.fitness.score.toFixed(3)} · décision ${e.decision.keep ? 'keep' : 'reject'} (${e.decision.reason}) · gardé=${e.kept}`,
    );
    if (e.variantId) lines.push(`  variant archivé: ${e.variantId}`);
  }
  if (run.error) lines.push(`\nErreur: ${run.error}`);
  return lines.join('\n');
}

/** Human-readable BFTS-loop summary. */
function renderLoop(result: ExperimentLoopResult): string {
  const lines: string[] = [];
  lines.push(`\n=== AI-Scientist Phase 3 (loop) — ${result.status.toUpperCase()} ===\n`);
  if (result.rootIdea) lines.push(`Hypothèse initiale [${result.rootIdea.source}]: ${result.rootIdea.hypothesis}`);
  if (result.novelty) lines.push(`Nouveauté: ${result.novelty.noveltyAssessment} — ${result.novelty.summary}`);
  const b = result.budget;
  lines.push('');
  lines.push(
    `Boucle: ${b.generationsRun}/${b.maxGenerations} génération(s), ${b.experimentsRun}/${b.maxExperiments} expérience(s), ` +
      `${Math.round(b.wallClockMs / 1000)}s — arrêt: ${result.stopReason}`,
  );
  if (result.generations.length) {
    lines.push('');
    lines.push('Générations:');
    for (const g of result.generations) {
      lines.push(
        `  gen ${String(g.generation).padStart(2)} · ${g.experimentsRun} exp · meilleur score ${g.bestScore.toFixed(3)}` +
          (g.parentId ? ` · parent ${g.parentId.slice(0, 8)}` : ' · racine'),
      );
    }
  }
  if (result.best) {
    lines.push('');
    lines.push(
      `Meilleur variant: score ${result.best.score.toFixed(3)} (${result.best.metric.name}=${result.best.metric.value ?? 'n/a'})`,
    );
    lines.push(`  ${result.best.hypothesis}`);
  }
  if (result.review) lines.push(`\nRevue: ${result.review.verdict}`);
  if (result.error) lines.push(`\nErreur: ${result.error}`);
  return lines.join('\n');
}

export function createScienceCommand(): Command {
  const cmd = new Command('science')
    .description(
      'AI-Scientist-lite (EXPERIMENTAL, opt-in CODEBUDDY_AI_SCIENTIST=true): human-gated, sandboxed experiment — a single pass (idea → novelty → GATE → run → analyse → report → review → GATE → publish) or a bounded best-first discovery loop (--loop). Empirical scoring (--score), hardened sandbox (--sandbox docker|e2b).',
    )
    .argument('<goal>', 'The research goal / question to experiment on')
    .option('--hypothesis <text>', 'Supply the hypothesis directly (skips LLM ideation)')
    .option('--code-file <path>', 'Supply the experiment code from a file (skips LLM authoring)')
    .option('--language <lang>', `Experiment language: ${VALID_LANGUAGES.join('|')}`, 'python')
    .option('-m, --model <model>', 'Override the model for this run')
    .option('--timeout <ms>', 'Experiment execution timeout in ms (clamped to the runner cap)')
    .option('-r, --report <file>', 'Write the final Markdown report to a file')
    .option('--no-publish', 'Never publish (still runs + reviews; GATE #2 auto-declines)')
    .option('--score', 'Phase 1: empirically score the experiment metric, record a variant, human keep-gate it (decoupled from the repo)')
    .option('--metric-key <key>', 'Metric key to parse from the experiment stdout (with --score)', 'accuracy')
    .option('--baseline-score <n>', 'Experiment baseline score to beat (with --score); omit to keep the first stepping-stone')
    .option('--no-higher-is-better', 'Treat the metric as lower-is-better, e.g. a loss (with --score)')
    .option(
      '--sandbox <backend>',
      'Phase 2 execution sandbox: isolate|docker|e2b (default isolate). docker cuts the network (--network none); e2b runs off-host. Also set via CODEBUDDY_SCIENCE_SANDBOX',
    )
    .option(
      '--require-network-isolation',
      'Phase 2: refuse to run (fail closed) if the chosen sandbox cannot cut network egress, instead of silently degrading to the network-open isolate runner. Implies --sandbox docker when no backend is given',
    )
    .option(
      '--loop',
      'Phase 3 (EXPERIMENTAL): run the BOUNDED multi-generation best-first tree search discovery loop instead of a single pass. Autonomous BETWEEN two human gates (approve plan+budget, then approve the best result), capped by --max-generations / --max-experiments / --budget',
    )
    .option('--max-generations <n>', 'Phase 3 HARD CAP: max generations (default 5, clamped ≤100)')
    .option('--max-experiments <n>', 'Phase 3 HARD CAP: max experiments executed (default 10, clamped ≤500)')
    .option('--budget <duration>', 'Phase 3 HARD CAP: wall-clock budget, e.g. 500, 30s, 10m, 2h (default 30m)')
    .option('--parallel <n>', 'Phase 3: parallel workers per generation (default 1, clamped ≤8)')
    .option(
      '--max-cost <n>',
      'Phase 3 HARD CAP: cost budget in arbitrary units — the loop stops the instant it is reached. Only fires when armed with --cost-per-experiment (default cost 0). Also via CODEBUDDY_SCIENCE_MAX_COST',
    )
    .option(
      '--cost-per-experiment <n>',
      'Phase 3: cost charged per executed experiment; accumulates toward --max-cost (default 0 = the cost cap never fires). Also via CODEBUDDY_SCIENCE_COST_PER_EXPERIMENT',
    )
    .action(async (goal: string, opts: ScienceCliOptions) => {
      // ── OPT-IN gate (default OFF = zero behaviour change) ─────────────────
      if (process.env.CODEBUDDY_AI_SCIENTIST !== 'true') {
        logger.error(
          'AI-Scientist is an EXPERIMENTAL, opt-in feature that EXECUTES generated code in a sandbox.\n' +
            'It is off by default. Enable it explicitly for this session:\n\n' +
            '  CODEBUDDY_AI_SCIENTIST=true buddy science "<goal>"\n\n' +
            'It will ask you to approve the plan BEFORE running code and the report BEFORE publishing.',
        );
        process.exitCode = 1;
        return;
      }

      const language = (opts.language ?? 'python').toLowerCase();
      if (!VALID_LANGUAGES.includes(language as ExecuteCodeLanguage)) {
        logger.error(`Invalid --language "${language}". Use one of: ${VALID_LANGUAGES.join(', ')}.`);
        process.exitCode = 1;
        return;
      }

      const { resolveCommandProvider } = await import('../llm-provider-resolution.js');
      const provider = resolveCommandProvider(opts.model ? { explicitModel: opts.model } : {});
      if (!provider) {
        logger.error(
          'No LLM provider available — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        );
        process.exitCode = 1;
        return;
      }

      // ── Phase 2 (OPT-IN via --sandbox / --require-network-isolation / env) ──
      const { resolveScienceSandbox } = await import('./sandbox-option.js');
      const sandboxRes = resolveScienceSandbox(
        {
          ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
          ...(opts.requireNetworkIsolation ? { requireNetworkIsolation: true } : {}),
        },
        process.env,
      );
      if (sandboxRes.kind === 'invalid') {
        logger.error(sandboxRes.error);
        process.exitCode = 1;
        return;
      }

      // ── Phase 3 (OPT-IN via --loop): the bounded, human-bracketed BFTS loop ──
      // Autonomous BETWEEN two gates, capped by hard budgets. WITHOUT --loop the
      // command falls through to the byte-identical Phase 0/1/2 single pass below.
      if (opts.loop) {
        const { resolveLoopBudget } = await import('./loop-option.js');
        const budgetRes = resolveLoopBudget(
          {
            ...(opts.maxGenerations ? { maxGenerations: opts.maxGenerations } : {}),
            ...(opts.maxExperiments ? { maxExperiments: opts.maxExperiments } : {}),
            ...(opts.budget ? { budget: opts.budget } : {}),
            ...(opts.parallel ? { parallel: opts.parallel } : {}),
            ...(opts.maxCost ? { maxCost: opts.maxCost } : {}),
            ...(opts.costPerExperiment ? { costPerExperiment: opts.costPerExperiment } : {}),
          },
          process.env,
        );
        if (budgetRes.kind === 'invalid') {
          logger.error(budgetRes.error);
          process.exitCode = 1;
          return;
        }

        const loopTimeoutMs = opts.timeout ? Number(opts.timeout) : undefined;
        const { buildScienceLoopDeps } = await import('./deps.js');
        const loopDeps = buildScienceLoopDeps({
          provider,
          language: language as ExecuteCodeLanguage,
          metricKey: opts.metricKey ?? 'accuracy',
          higherIsBetter: opts.higherIsBetter !== false,
          ...(opts.hypothesis ? { hypothesis: opts.hypothesis } : {}),
          ...(opts.codeFile ? { codeFile: opts.codeFile } : {}),
          ...(opts.publish === false ? { noPublish: true } : {}),
          ...(sandboxRes.kind === 'sandbox'
            ? {
                sandbox: {
                  backend: sandboxRes.backend,
                  requireNetworkIsolation: sandboxRes.requireNetworkIsolation,
                },
              }
            : {}),
        });

        logger.info(`AI-Scientist Phase 3 (BFTS loop) — goal: ${goal}`);
        logger.info(
          'BOUNDED autonomy: two human gates bracket the loop (approve plan+budget, then approve the best result). Both fail closed.',
        );
        logger.info('Between the gates the loop runs autonomously, STOPPING the instant any hard cap is reached.');
        logger.info('');

        const { runExperimentLoop } = await import('../../agent/science/experiment-loop.js');
        const loopResult = await runExperimentLoop(goal, loopDeps, {
          ...budgetRes.budget,
          ...(loopTimeoutMs && Number.isFinite(loopTimeoutMs) ? { experimentTimeoutMs: loopTimeoutMs } : {}),
          onGeneration: (g) =>
            logger.info(`  [gen ${g.generation}] ${g.experimentsRun} exp · best ${g.bestScore.toFixed(3)}`),
        });

        logger.info(renderLoop(loopResult));

        if (loopResult.report && opts.report) {
          try {
            await writeFile(opts.report, loopResult.report.report, 'utf8');
            logger.info(`\nRapport écrit → ${opts.report}`);
          } catch (err) {
            logger.error(`Impossible d'écrire le rapport: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (loopResult.report && !opts.report) {
          console.log(`\n${loopResult.report.report}`);
        }

        if (loopResult.status === 'failed') process.exitCode = 1;
        return;
      }

      const timeoutMs = opts.timeout ? Number(opts.timeout) : undefined;
      const { buildScienceDeps, buildEmpiricalScoringConfig } = await import('./deps.js');
      const deps = buildScienceDeps({
        provider,
        language: language as ExecuteCodeLanguage,
        ...(opts.hypothesis ? { hypothesis: opts.hypothesis } : {}),
        ...(opts.codeFile ? { codeFile: opts.codeFile } : {}),
        ...(opts.publish === false ? { noPublish: true } : {}),
        ...(sandboxRes.kind === 'sandbox'
          ? {
              sandbox: {
                backend: sandboxRes.backend,
                requireNetworkIsolation: sandboxRes.requireNetworkIsolation,
              },
            }
          : {}),
      });

      // ── Phase 1 (OPT-IN via --score): empirical scoring / keep-gate ────────
      const baselineScore = opts.baselineScore !== undefined ? Number(opts.baselineScore) : undefined;
      if (opts.baselineScore !== undefined && !Number.isFinite(baselineScore)) {
        logger.error(`Invalid --baseline-score "${opts.baselineScore}" (must be a number).`);
        process.exitCode = 1;
        return;
      }
      const empirical = opts.score
        ? buildEmpiricalScoringConfig({
            metricKey: opts.metricKey ?? 'accuracy',
            higherIsBetter: opts.higherIsBetter !== false,
            ...(baselineScore !== undefined && Number.isFinite(baselineScore) ? { baselineScore } : {}),
          })
        : undefined;

      logger.info(`AI-Scientist Phase ${empirical ? '1' : '0'} — goal: ${goal}`);
      logger.info('Two human gates will ask for your approval (plan, then publication). Both fail closed.');
      if (empirical) logger.info('A third keep-gate will ask before an experiment variant is kept. It also fails closed.');
      if (sandboxRes.kind === 'sandbox') {
        const posture =
          sandboxRes.backend === 'docker'
            ? 'network CUT (docker --network none)'
            : sandboxRes.backend === 'e2b'
              ? 'off-host microVM (host isolated; outbound network NOT cut)'
              : 'local isolate (network NOT isolated)';
        logger.info(
          `Sandbox: ${sandboxRes.backend} — ${posture}` +
            (sandboxRes.requireNetworkIsolation ? ' · --require-network-isolation: fail-closed if unavailable' : ''),
        );
      }
      logger.info('');

      const run = await runExperiment(goal, deps, {
        ...(timeoutMs && Number.isFinite(timeoutMs) ? { experimentTimeoutMs: timeoutMs } : {}),
        ...(empirical ? { empirical } : {}),
        onStage: (s) => logger.info(`  [${s.ok ? 'ok' : '..'}] ${s.stage}: ${s.detail}`),
      });

      logger.info(renderRun(run));

      if (run.report && opts.report) {
        try {
          await writeFile(opts.report, run.report.report, 'utf8');
          logger.info(`\nRapport écrit → ${opts.report}`);
        } catch (err) {
          logger.error(`Impossible d'écrire le rapport: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (run.report && !opts.report) {
        // Print the report to stdout so it is capturable without a file.
        console.log(`\n${run.report.report}`);
      }

      if (run.status === 'failed') process.exitCode = 1;
    });

  return cmd;
}
