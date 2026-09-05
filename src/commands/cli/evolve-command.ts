/**
 * `buddy evolve` — git-versioned evolutionary self-improvement CLI (Phase E).
 *
 * The loop EVALUATES + RANKS candidate variants; keeping one is HUMAN-GATED — `keep` merges only
 * with explicit --confirm, only into the current branch, and NEVER onto a protected branch
 * (main/master) — that invariant is enforced in code (`assertMergeTargetAllowed`), not convention.
 *
 *   evolve run --goal "<weakness>"   author + evaluate candidate variant(s) (gated by CODEBUDDY_EVOLVE)
 *   evolve list                      list evaluated variants (ranked)
 *   evolve review <id>               show a variant's fitness + diff vs baseline (read-only)
 *   evolve keep <id> [--confirm]     merge a reviewed variant into the current branch (human-gated)
 *
 * @module commands/cli/evolve-command
 */

import { execFileSync } from 'child_process';
import type { Command } from 'commander';
import { logger } from '../../utils/logger.js';
import {
  CodeVariantStore,
  genealogyRows,
  variantGeneration,
  type VariantRecord,
} from '../../agent/self-improvement/evolution/code-variant-store.js';

interface EvolveOptions {
  goal?: string;
  auto?: boolean;
  source?: string;
  rounds?: string;
  concurrency?: string;
  baseline?: string;
  model?: string;
  /** Pick the mutator model per-cycle with the cost-aware UCB bandit (opt-in). */
  modelBandit?: boolean;
  confirm?: boolean;
  /** Commander sets this false when --no-plan is passed (default true → deliberate planning on). */
  plan?: boolean;
  /** Branch each candidate off the current best elite (compounding), not the baseline. */
  compound?: boolean;
  /** Re-index Code Explorer before selecting weaknesses, so hotspots/feature-map are fresh. */
  refreshModel?: boolean;
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Branches self-evolved code must NEVER be merged onto directly. */
const PROTECTED_MERGE_BRANCHES = new Set(['main', 'master']);

/**
 * Enforce the "never onto main" invariant in CODE, not just convention: `evolve
 * keep` merges into the CURRENT branch, so refuse when that is a protected
 * branch. A maintainer must land self-evolved code via an integration branch
 * (then open a normal reviewed PR), never straight onto main/master.
 */
export function assertMergeTargetAllowed(currentBranch: string): { ok: boolean; reason?: string } {
  const name = currentBranch.trim();
  if (PROTECTED_MERGE_BRANCHES.has(name)) {
    return {
      ok: false,
      reason:
        `refusing to merge self-evolved code directly onto '${name}'. ` +
        `Check out an integration branch first (e.g. \`git checkout -b evolve/keep-<id>\`), ` +
        `keep there, then open a normal reviewed PR.`,
    };
  }
  return { ok: true };
}

function fmtVariant(v: VariantRecord): string {
  const flags = `${v.passedAll ? 'pass' : 'FAIL'}${v.regressions.length ? ` regr:${v.regressions.join(',')}` : ''}`;
  const parents = (v.parents ?? []).length ? ` ⇐ ${(v.parents ?? []).join(',')}` : '';
  return `  gen${variantGeneration(v)} ${v.id.padEnd(16)} score=${v.score.toFixed(3)}  ${flags.padEnd(20)} ${(v.behavior ?? '-').padEnd(18)} ${v.branch}${parents}  ${v.detail ?? ''}`;
}

export function registerEvolveCommands(program: Command): void {
  const evolve = program
    .command('evolve')
    .description('Git-versioned evolutionary self-improvement: evaluate code variants, keep the best (human-gated)');

  evolve
    .command('list')
    .description('List evaluated candidate variants, ranked by fitness')
    .option('--json', 'Output the variant records as JSON (for scripts / the GUI)', false)
    .action((opts: { json?: boolean }) => {
      const variants = new CodeVariantStore().list().sort((a, b) => b.score - a.score);
      if (opts.json) {
        // Raw JSON to stdout (not via logger) so it's machine-parseable.
        console.log(JSON.stringify(variants, null, 2));
        return;
      }
      if (variants.length === 0) {
        logger.info('No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.');
        return;
      }
      logger.info(`Evaluated variants (${variants.length}):`);
      for (const v of variants) logger.info(fmtVariant(v));
    });

  evolve
    .command('tree')
    .description('Show the genealogy of evaluated variants — the generations of recursive self-improvement')
    .action(() => {
      const rows = genealogyRows(new CodeVariantStore().list());
      if (rows.length === 0) {
        logger.info('No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.');
        return;
      }
      logger.info(`Genealogy (${rows.length} variant(s), by generation):`);
      let curGen = -1;
      for (const { record, generation } of rows) {
        if (generation !== curGen) {
          curGen = generation;
          logger.info(`\n── generation ${generation} ──`);
        }
        logger.info(fmtVariant(record));
      }
    });

  evolve
    .command('review <id>')
    .description('Show a variant\'s fitness + diff vs baseline (read-only)')
    .option('--baseline <ref>', 'Baseline ref to diff against', 'main')
    .action((id: string, options: EvolveOptions) => {
      const v = new CodeVariantStore().list().find((x) => x.id === id);
      if (!v) {
        logger.error(`Variant '${id}' not found. Use \`buddy evolve list\`.`);
        process.exitCode = 1;
        return;
      }
      logger.info(`Variant ${v.id}  (${v.branch})`);
      logger.info(`  generation=${variantGeneration(v)}${(v.parents ?? []).length ? `  parents=[${(v.parents ?? []).join(', ')}]` : '  (from baseline)'}`);
      logger.info(`  fitness=${v.score.toFixed(3)}  passedAll=${v.passedAll}  regressions=[${v.regressions.join(', ')}]`);
      logger.info(`  ${v.detail ?? ''}`);
      if (v.plan) {
        logger.info(`\nPlan qui a produit cette version :\n${v.plan}`);
      }
      try {
        const stat = git(['diff', '--stat', `${options.baseline}...${v.branch}`]);
        logger.info(`\nDiff vs ${options.baseline}:\n${stat}`);
      } catch {
        logger.warn(`  (could not diff ${v.branch} vs ${options.baseline} — branch may have been pruned)`);
      }
    });

  evolve
    .command('keep <id>')
    .description('Merge a reviewed variant into the CURRENT branch (human-gated; needs --confirm)')
    .option('--confirm', 'Actually perform the merge (without this it only previews)')
    .action((id: string, options: EvolveOptions) => {
      const v = new CodeVariantStore().list().find((x) => x.id === id);
      if (!v) {
        logger.error(`Variant '${id}' not found.`);
        process.exitCode = 1;
        return;
      }
      const current = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      const target = assertMergeTargetAllowed(current);
      if (!target.ok) {
        logger.error(target.reason ?? `refusing to merge onto '${current}'.`);
        process.exitCode = 1;
        return;
      }
      if (!options.confirm) {
        logger.info(`Preview: keep ${v.id} (${v.branch}) → merge into '${current}'.`);
        logger.info(`  fitness=${v.score.toFixed(3)}  passedAll=${v.passedAll}  regressions=[${v.regressions.join(', ')}]`);
        logger.info('  Re-run with --confirm to merge. Code Buddy never auto-merges self-evolved code.');
        return;
      }
      try {
        execFileSync('git', ['merge', '--no-ff', '-m', `evolve: keep ${v.id} (${v.detail ?? ''})`, v.branch], {
          stdio: 'inherit',
        });
        logger.info(`Merged ${v.branch} into '${current}'. Review the result and run your full validation.`);
      } catch {
        logger.error('Merge failed (conflicts?). Resolve manually or `git merge --abort`.');
        process.exitCode = 1;
      }
    });

  evolve
    .command('run')
    .description('Author + evaluate candidate variant(s) toward a weakness (gated by CODEBUDDY_EVOLVE=true)')
    .option('--goal <text>', 'The weakness/goal to improve toward (manual)')
    .option('--auto', 'Pick the weakness automatically (failing eval tasks / self-model hotspots)')
    .option('--source <src>', 'Auto source: eval | hotspots | research | both | all', 'hotspots')
    .option('--rounds <n>', 'Candidates per goal (fan-out), or max auto-weaknesses', '1')
    .option('--concurrency <n>', 'How many candidates to evaluate at once', '2')
    .option('--baseline <ref>', 'Baseline ref to branch from + rank against', 'main')
    .option('--model <model>', 'Model for the mutator agent + planner')
    .option('--model-bandit', 'Pick the mutator model per-cycle with the cost-aware UCB bandit (opt-in; overrides --model per cycle)')
    .option('--no-plan', 'Skip deliberate planning (use the ad-hoc mutator prompt)')
    .option('--compound', 'Branch each candidate off the current best elite (compounding), not the baseline')
    .option('--refresh-model', 'Re-index Code Explorer first so hotspots + feature map are fresh (--auto)')
    .action(async (options: EvolveOptions) => {
      if (process.env.CODEBUDDY_EVOLVE !== 'true') {
        logger.error('Evolution is opt-in. Set CODEBUDDY_EVOLVE=true to run (it spawns real agent runs + LLM calls).');
        process.exitCode = 1;
        return;
      }
      if (!options.goal && !options.auto) {
        logger.error('Provide --goal "<text>" or --auto (auto-select a weakness).');
        process.exitCode = 1;
        return;
      }
      const { runEvolutionRound, agentMutator, formatEvolveRoundSummary } = await import('../../agent/self-improvement/evolution/evolution-engine.js');
      const { makeLlmVariantPlanner } = await import('../../agent/self-improvement/evolution/variant-planner.js');
      const { computeFitness, defaultDeterministicComponents } = await import('../../agent/self-improvement/evolution/variant-fitness.js');
      const baselineRef = options.baseline ?? 'main';
      const rounds = Math.max(1, Number(options.rounds ?? '1') || 1);
      const concurrency = Math.max(1, Number(options.concurrency ?? '2') || 2);
      const components = defaultDeterministicComponents();
      const mutate = agentMutator(options.model ? { model: options.model } : {});
      // Deliberate planner (default on). --no-plan → a planner that returns null → mutator's ad-hoc prompt.
      const planner = options.plan === false
        ? (async () => null)
        : makeLlmVariantPlanner(options.model ? { model: options.model } : {});
      const store = new CodeVariantStore();

      // Resolve the weakness/goals.
      let weaknesses: Array<{ id: string; goal: string; kind: 'manual' | 'eval-failure' | 'hotspot' | 'research' }>;
      if (options.goal) {
        weaknesses = [{ id: 'goal', goal: options.goal, kind: 'manual' }];
      } else {
        const { selectWeaknesses } = await import('../../agent/self-improvement/evolution/weakness-selector.js');
        const src = options.source ?? 'hotspots';
        const all = src === 'all';
        if (options.refreshModel) {
          try {
            const { getCodeExplorerClient } = await import('../../plugins/code-explorer/code-explorer-client.js');
            logger.info('Refreshing self-model (Code Explorer detect_changes)…');
            await getCodeExplorerClient().call('detect_changes', {});
          } catch (err) {
            logger.warn(`[evolve] self-model refresh skipped: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        logger.info(`Auto-selecting weaknesses (source: ${src})…`);
        weaknesses = await selectWeaknesses({
          basePath: process.cwd(),
          limit: rounds,
          includeEvalFailures: all || src === 'eval' || src === 'both',
          includeHotspots: all || src === 'hotspots' || src === 'both',
          includeResearch: all || src === 'research',
          env: process.env,
        });
        if (weaknesses.length === 0) {
          logger.info('No weakness found (Code Explorer not indexed / no failing eval task). Try --goal or --source eval.');
          return;
        }
        logger.info(`Selected ${weaknesses.length} weakness(es): ${weaknesses.map((w) => w.goal.slice(0, 60)).join(' | ')}`);
      }

      logger.info(`Scoring baseline (${baselineRef})…`);
      const baseline = await computeFitness({ checkoutDir: process.cwd() }, components);
      logger.info(`  baseline fitness=${baseline.score.toFixed(3)}`);

      // Compounding: build each candidate on top of the current best elite (guarded by reachability
      // in the engine → falls back to baseline if that elite branch was pruned). Fitness stays vs baseline.
      let compoundFrom: string | undefined;
      if (options.compound) {
        const elite = store.best({ baselineScore: baseline.score });
        compoundFrom = elite?.branch;
        logger.info(
          compoundFrom
            ? `Compounding from elite ${elite!.id} (${compoundFrom}, fitness ${elite!.score.toFixed(3)})`
            : 'Compound requested but no prior elite beats the baseline → branching off baseline',
        );
      }

      // Manual goal → fan out `rounds` candidates for it. Auto → one round per selected weakness.
      const allResults = [];
      for (const w of weaknesses) {
        logger.info(`\nEvolving toward: ${w.goal}`);
        const results = await runEvolutionRound({
          rounds: options.goal ? rounds : 1,
          concurrency,
          baselineRef,
          weakness: w,
          mutate,
          planner,
          components,
          baseline,
          store,
          ...(compoundFrom ? { compoundFrom } : {}),
          ...(options.modelBandit ? { useModelBandit: true } : {}),
        });
        for (const r of results) {
          logger.info(`  ${r.variantId}: fitness=${r.report.score.toFixed(3)} beats=${r.beatsBaseline} kept=${r.kept}`);
        }
        allResults.push(...results);
      }

      logger.info(`\n${formatEvolveRoundSummary(allResults)}`);
    });
}
