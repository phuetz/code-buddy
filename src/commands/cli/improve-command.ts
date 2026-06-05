/**
 * `buddy improve` — drive the recursive self-improvement engine.
 *
 * The engine improves the agent's reversible learnable layer (lessons today)
 * only when a deterministic capability benchmark empirically improves with zero
 * regressions, snapshot/rollback always. It is propose-only by default; pass
 * `--apply` (or set CODEBUDDY_SELF_IMPROVE=true) to keep validated improvements.
 *
 * @module commands/cli/improve-command
 */

import type { Command } from 'commander';

import {
  createWorkspaceEngine,
  createWorkspaceLearningStore,
  createWorkspaceRuleEngine,
} from '../../agent/self-improvement/index.js';
import { EvolutionaryArchive } from '../../agent/self-improvement/evolutionary-archive.js';
import { createDefaultRunExperienceSource } from '../../agent/self-improvement/experience-source.js';
import { CorpusStore } from '../../agent/self-improvement/rule-store.js';
import { summarizeTrajectory } from '../../agent/self-improvement/execution-gate.js';
import type { Experience } from '../../agent/self-improvement/types.js';

/**
 * Collect real run-friction experiences (best-effort) so the LLM proposer can
 * ground its drafts in what actually went wrong. Never throws — an empty list
 * just means the proposer relies on the scenario alone.
 */
async function collectExperiences(): Promise<Experience[]> {
  try {
    return await createDefaultRunExperienceSource({ limit: 10 }).collect();
  } catch {
    return [];
  }
}

interface ImproveOptions {
  json?: boolean;
  apply?: boolean;
  max?: string;
  llm?: boolean;
  /** cycle/loop: negatable boolean (default true). restore: a commit sha string. */
  commit?: boolean | string;
  push?: boolean;
  best?: boolean;
  pass?: boolean;
  fail?: boolean;
}

function print(payload: unknown, options: ImproveOptions, text: string): void {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(text);
  }
}

export function registerImproveCommands(program: Command): void {
  const improve = program
    .command('improve')
    .description('Recursive self-improvement: empirically validate and apply reversible learning improvements');

  improve
    .command('status')
    .description('Show capability-benchmark coverage, autonomy mode, archive, and git store versions')
    .option('--json', 'output JSON')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceEngine();
      const status = engine.status();
      const store = await createWorkspaceLearningStore().status();
      const text = [
        `Autonomy: ${status.autonomy}`,
        `Capability coverage: ${status.score.covered}/${status.score.total} (${Math.round(status.score.ratio * 100)}%)`,
        `Uncovered: ${status.score.results.filter((r) => !r.covered).map((r) => r.scenarioId).join(', ') || '(none)'}`,
        `Archive: ${status.archive.count} validated improvement(s), total Δ=${status.archive.totalDelta}`,
        `Store: ${store.versions} version(s); head ${store.head ? `${store.head.covered}/${store.head.total}` : '—'}, best ${store.best?.score ? `${store.best.score.covered}/${store.best.score.total} (${store.best.shortSha})` : '—'}`,
      ].join('\n');
      print({ kind: 'self_improvement_status', ...status, store }, options, text);
    });

  improve
    .command('cycle')
    .description('Run one improvement cycle (propose → empirically validate → keep/rollback)')
    .option('--json', 'output JSON')
    .option('--apply', 'keep empirically-validated improvements (overrides propose-only for this run)')
    .option('--llm', 'use the model to discover novel lessons from run friction (else a deterministic seed pack)')
    .option('--no-commit', 'do not version an applied improvement in the git learning store')
    .option('--push', 'push the learning store to its configured git remote after committing')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceEngine({
        ...(options.apply ? { autonomy: 'auto-apply' as const } : {}),
        useLlm: options.llm === true,
      });
      const experiences = options.llm ? await collectExperiences() : [];
      const result = await engine.runCycle(experiences);
      let committed: string | undefined;
      if (result.applied && options.apply && options.commit !== false) {
        const store = createWorkspaceLearningStore();
        const version = await store.commitVersion({
          ...(result.selectedScenarioId ? { scenarioId: result.selectedScenarioId } : {}),
          ...(result.gate?.delta !== undefined ? { delta: result.gate.delta } : {}),
          reason: 'improve cycle',
        });
        committed = version.sha.slice(0, 8);
        if (options.push) await store.push();
      }
      const verdict = result.applied
        ? `APPLIED improvement to "${result.selectedScenarioId}" (Δ=${result.gate?.delta})`
        : result.gate?.accepted
          ? `WOULD improve "${result.selectedScenarioId}" (Δ=${result.gate?.delta}) — re-run with --apply to keep`
          : result.selectedScenarioId
            ? `No improvement kept for "${result.selectedScenarioId}": ${result.notes.join('; ')}`
            : result.notes.join('; ');
      const text = [
        `Autonomy: ${result.autonomy}`,
        `Coverage: ${result.scoreBefore.covered}/${result.scoreBefore.total} → ${result.scoreAfter.covered}/${result.scoreAfter.total}`,
        verdict,
        committed ? `Versioned in learning store: ${committed}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      print({ ...result, committed }, options, text);
    });

  improve
    .command('loop')
    .description('Run improvement cycles until no further validated progress is made')
    .option('--json', 'output JSON')
    .option('--apply', 'keep empirically-validated improvements (overrides propose-only for this run)')
    .option('--max <n>', 'maximum cycles', (v) => v)
    .option('--llm', 'use the model to discover novel lessons from run friction (else a deterministic seed pack)')
    .option('--no-commit', 'do not version applied improvements in the git learning store')
    .option('--push', 'push the learning store to its configured git remote after committing')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceEngine({
        ...(options.apply ? { autonomy: 'auto-apply' as const } : {}),
        useLlm: options.llm === true,
      });
      const experiences = options.llm ? await collectExperiences() : [];
      const doCommit = options.apply === true && options.commit !== false;
      const store = doCommit ? createWorkspaceLearningStore() : null;
      const cap = options.max ? Math.max(1, Number.parseInt(options.max, 10)) : 25;

      // Drive the loop here (not engine.runLoop) so each applied improvement gets
      // its own reversible git version. Stop on the first non-applied cycle.
      const results = [];
      for (let i = 0; i < cap; i++) {
        const r = await engine.runCycle(experiences);
        results.push(r);
        if (r.applied && store) {
          await store.commitVersion({
            ...(r.selectedScenarioId ? { scenarioId: r.selectedScenarioId } : {}),
            ...(r.gate?.delta !== undefined ? { delta: r.gate.delta } : {}),
            reason: 'improve loop',
          });
        }
        if (!r.applied) break;
      }
      if (store && options.push) await store.push();

      const appliedCount = results.filter((r) => r.applied).length;
      const final = engine.status();
      const storeStatus = store ? await store.status() : null;
      const text = [
        `Autonomy: ${results[0]?.autonomy ?? 'propose-only'}`,
        `Cycles: ${results.length}, applied: ${appliedCount}`,
        `Final coverage: ${final.score.covered}/${final.score.total} (${Math.round(final.score.ratio * 100)}%)`,
        storeStatus ? `Store versions: ${storeStatus.versions}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      print({ kind: 'self_improvement_loop', cycles: results, status: final, store: storeStatus }, options, text);
    });

  improve
    .command('archive')
    .description('List empirically-validated improvements kept by the engine')
    .option('--json', 'output JSON')
    .action((options: ImproveOptions) => {
      const engine = createWorkspaceEngine();
      const entries = new EvolutionaryArchive().list();
      const text = entries.length
        ? entries
            .map((e: { targetScenarioId: string; delta: number; createdAt: string }) =>
              `${e.createdAt}  ${e.targetScenarioId}  Δ=${e.delta}`,
            )
            .join('\n')
        : 'No validated improvements archived yet.';
      print({ kind: 'self_improvement_archive', entries, status: engine.status() }, options, text);
    });

  improve
    .command('versions')
    .description('List git-versioned learning-store states with their benchmark scores')
    .option('--json', 'output JSON')
    .action(async (options: ImproveOptions) => {
      const store = createWorkspaceLearningStore();
      const versions = await store.listVersions();
      const best = await store.bestVersion();
      const text = versions.length
        ? versions
            .map((v, i) => {
              const score = v.score ? `${v.score.covered}/${v.score.total}` : '—';
              const flags = [i === 0 ? 'HEAD' : '', best && v.sha === best.sha ? 'BEST' : '']
                .filter(Boolean)
                .join(',');
              return `${v.shortSha}  ${score}  ${v.message}${flags ? `  [${flags}]` : ''}`;
            })
            .join('\n')
        : 'No learning-store versions yet (run `improve cycle --apply`).';
      print({ kind: 'self_improvement_versions', versions, best }, options, text);
    });

  improve
    .command('restore')
    .description('Restore the learnable state to a known-good version (revert to one that works better)')
    .option('--json', 'output JSON')
    .option('--best', 'restore to the highest-scoring version (default)')
    .option('--commit <sha>', 'restore to a specific store commit')
    .option('--push', 'push the learning store after restoring')
    .action(async (options: ImproveOptions) => {
      const store = createWorkspaceLearningStore();
      const target =
        typeof options.commit === 'string' ? { commit: options.commit } : { best: true };
      const result = await store.restore(target);
      if (!result) {
        print({ kind: 'self_improvement_restore', restored: false }, options, 'No known-good version to restore.');
        return;
      }
      if (options.push) await store.push();
      const text = [
        `Restored to ${result.restoredFrom.slice(0, 8)}`,
        `Coverage now: ${result.score.covered}/${result.score.total} (${Math.round(result.score.ratio * 100)}%)`,
      ].join('\n');
      print({ kind: 'self_improvement_restore', restored: true, ...result }, options, text);
    });

  // --- Execution-grounded RULE learning (validated against recorded behavior) ---
  const rules = improve
    .command('rules')
    .description('Learn behavioral rules validated against a labeled trajectory corpus (correctness, not keywords)');

  rules
    .command('status')
    .description('Show rule-classification accuracy over the trajectory corpus')
    .option('--json', 'output JSON')
    .action((options: ImproveOptions) => {
      const status = createWorkspaceRuleEngine().status();
      const text = [
        `Autonomy: ${status.autonomy}`,
        `Corpus classification: ${status.score.correct}/${status.score.total} (${Math.round(status.score.accuracy * 100)}%)`,
        `Learned rules: ${status.rules}`,
      ].join('\n');
      print({ kind: 'rule_learning_status', ...status }, options, text);
    });

  rules
    .command('cycle')
    .description('Propose one behavioral rule and validate it against the corpus')
    .option('--json', 'output JSON')
    .option('--apply', 'keep the rule if it correctly reclassifies recorded runs with no regression')
    .option('--no-commit', 'do not version the learned rule in the git learning store')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceRuleEngine(options.apply ? { autonomy: 'auto-apply' } : {});
      const result = engine.runCycle();
      if (result.applied && options.apply && options.commit !== false) {
        await createWorkspaceLearningStore().commitVersion({ reason: 'improve rules cycle' });
      }
      const verdict = result.applied
        ? `LEARNED rule for "${result.targetId}" (Δ=${result.gate?.delta})`
        : result.gate?.accepted
          ? `WOULD learn a rule for "${result.targetId}" (Δ=${result.gate?.delta}) — re-run with --apply`
          : result.notes.join('; ');
      const text = [
        `Accuracy: ${Math.round(result.accuracyBefore * 100)}% → ${Math.round(result.accuracyAfter * 100)}%`,
        verdict,
      ].join('\n');
      print(result, options, text);
    });

  rules
    .command('loop')
    .description('Learn rules until the corpus is fully and correctly classified')
    .option('--json', 'output JSON')
    .option('--apply', 'keep validated rules')
    .option('--no-commit', 'do not version learned rules in the git learning store')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceRuleEngine(options.apply ? { autonomy: 'auto-apply' } : {});
      const results = engine.runLoop();
      if (results.some((r) => r.applied) && options.apply && options.commit !== false) {
        await createWorkspaceLearningStore().commitVersion({ reason: 'improve rules loop' });
      }
      const final = engine.status();
      const text = [
        `Cycles: ${results.length}, learned: ${results.filter((r) => r.applied).length}`,
        `Corpus classification: ${final.score.correct}/${final.score.total} (${Math.round(final.score.accuracy * 100)}%); rules: ${final.rules}`,
      ].join('\n');
      print({ kind: 'rule_learning_loop', cycles: results, status: final }, options, text);
    });

  // --- Labeled trajectory corpus (human-curated) for the rule learner ---
  const corpus = improve
    .command('corpus')
    .description('Curate the labeled trajectory corpus the rule learner validates against');

  corpus
    .command('add')
    .description('Label a recorded run pass/fail and add it to the corpus')
    .argument('<runId>', 'a run id from the RunStore (.codebuddy/runs/)')
    .option('--json', 'output JSON')
    .option('--pass', 'label the run as compliant (good behavior)')
    .option('--fail', 'label the run as non-compliant (behavior a rule should flag)')
    .action(async (runId: string, options: ImproveOptions) => {
      if (options.pass === options.fail) {
        console.error('Specify exactly one of --pass or --fail.');
        process.exitCode = 1;
        return;
      }
      const { buildRunTrajectoryExport } = await import('../../observability/run-trajectory-export.js');
      const exported = buildRunTrajectoryExport(runId, { includeArtifactContent: false });
      if (!exported) {
        console.error(`Run not found: ${runId}`);
        process.exitCode = 1;
        return;
      }
      const trajectory = summarizeTrajectory(exported);
      const store = new CorpusStore();
      store.add({ id: runId, shouldPass: options.pass === true, trajectory });
      const text = `Added ${runId} to corpus as ${options.pass ? 'PASS' : 'FAIL'} (tools: ${trajectory.toolNames.join(', ') || 'none'}).`;
      print({ kind: 'corpus_add', runId, shouldPass: options.pass === true, trajectory }, options, text);
    });

  corpus
    .command('list')
    .description('List labeled trajectories in the corpus')
    .option('--json', 'output JSON')
    .action((options: ImproveOptions) => {
      const entries = new CorpusStore().list();
      const text = entries.length
        ? entries.map((t) => `${t.shouldPass ? 'PASS' : 'FAIL'}  ${t.id}  [${t.trajectory.toolNames.join(', ')}]`).join('\n')
        : 'Corpus is empty — `improve corpus add <runId> --pass|--fail`. (Seed corpus used until then.)';
      print({ kind: 'corpus_list', entries }, options, text);
    });

  corpus
    .command('remove')
    .description('Remove a labeled trajectory from the corpus')
    .argument('<id>', 'corpus entry id (the run id)')
    .option('--json', 'output JSON')
    .action((id: string, options: ImproveOptions) => {
      const removed = new CorpusStore().remove(id);
      print({ kind: 'corpus_remove', id, removed }, options, removed ? `Removed ${id}.` : `Not in corpus: ${id}.`);
    });
}
