/**
 * `buddy evolve` — git-versioned evolutionary self-improvement CLI (Phase E).
 *
 * The loop EVALUATES + RANKS candidate variants; keeping one is HUMAN-GATED — `keep` merges only
 * with explicit --confirm, and only into the current branch (never auto, never forced onto main).
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
import { CodeVariantStore, type VariantRecord } from '../../agent/self-improvement/evolution/code-variant-store.js';

interface EvolveOptions {
  goal?: string;
  rounds?: string;
  concurrency?: string;
  baseline?: string;
  model?: string;
  confirm?: boolean;
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function fmtVariant(v: VariantRecord): string {
  const flags = `${v.passedAll ? 'pass' : 'FAIL'}${v.regressions.length ? ` regr:${v.regressions.join(',')}` : ''}`;
  return `  ${v.id.padEnd(16)} score=${v.score.toFixed(3)}  ${flags.padEnd(20)} ${v.branch}  ${v.detail ?? ''}`;
}

export function registerEvolveCommands(program: Command): void {
  const evolve = program
    .command('evolve')
    .description('Git-versioned evolutionary self-improvement: evaluate code variants, keep the best (human-gated)');

  evolve
    .command('list')
    .description('List evaluated candidate variants, ranked by fitness')
    .action(() => {
      const variants = new CodeVariantStore().list().sort((a, b) => b.score - a.score);
      if (variants.length === 0) {
        logger.info('No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.');
        return;
      }
      logger.info(`Evaluated variants (${variants.length}):`);
      for (const v of variants) logger.info(fmtVariant(v));
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
      logger.info(`  fitness=${v.score.toFixed(3)}  passedAll=${v.passedAll}  regressions=[${v.regressions.join(', ')}]`);
      logger.info(`  ${v.detail ?? ''}`);
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
    .requiredOption('--goal <text>', 'The weakness/goal to improve toward')
    .option('--rounds <n>', 'Number of candidate variants to evaluate (fan-out)', '1')
    .option('--concurrency <n>', 'How many candidates to evaluate at once', '2')
    .option('--baseline <ref>', 'Baseline ref to branch from + rank against', 'main')
    .option('--model <model>', 'Model for the mutator agent')
    .action(async (options: EvolveOptions) => {
      if (process.env.CODEBUDDY_EVOLVE !== 'true') {
        logger.error('Evolution is opt-in. Set CODEBUDDY_EVOLVE=true to run (it spawns real agent runs + LLM calls).');
        process.exitCode = 1;
        return;
      }
      const { runEvolutionRound, agentMutator } = await import('../../agent/self-improvement/evolution/evolution-engine.js');
      const { computeFitness, defaultDeterministicComponents } = await import('../../agent/self-improvement/evolution/variant-fitness.js');
      const baselineRef = options.baseline ?? 'main';
      const rounds = Math.max(1, Number(options.rounds ?? '1') || 1);
      const concurrency = Math.max(1, Number(options.concurrency ?? '2') || 2);
      const components = defaultDeterministicComponents();

      logger.info(`Scoring baseline (${baselineRef})…`);
      const baseline = await computeFitness({ checkoutDir: process.cwd() }, components);
      logger.info(`  baseline fitness=${baseline.score.toFixed(3)}`);
      logger.info(`Evolving ${rounds} candidate(s), ${concurrency} at a time, toward: ${options.goal}`);

      const results = await runEvolutionRound({
        rounds,
        concurrency,
        baselineRef,
        weakness: { id: 'goal', goal: options.goal as string, kind: 'manual' },
        mutate: agentMutator(options.model ? { model: options.model } : {}),
        components,
        baseline,
        store: new CodeVariantStore(),
      });
      for (const r of results) {
        logger.info(`  ${r.variantId}: fitness=${r.report.score.toFixed(3)} beats=${r.beatsBaseline} kept=${r.kept}`);
      }
      const winner = results.find((r) => r.beatsBaseline);
      logger.info(
        winner
          ? `\nBest: ${winner.variantId} (fitness ${winner.report.score.toFixed(3)}). Review: \`buddy evolve review ${winner.variantId}\`; keep: \`buddy evolve keep ${winner.variantId} --confirm\`.`
          : '\nNo candidate beat the baseline. Try more rounds, a sharper --goal, or a stronger --model.',
      );
    });
}
