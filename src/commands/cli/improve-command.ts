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
import { logger } from '../../utils/logger.js';

import {
  createWorkspaceEngine,
  createWorkspaceLearningStore,
  createWorkspaceRuleEngine,
} from '../../agent/self-improvement/index.js';
import { EvolutionaryArchive } from '../../agent/self-improvement/evolutionary-archive.js';
import {
  createDefaultRunExperienceSource,
  createDefaultSensorExperienceSource,
} from '../../agent/self-improvement/experience-source.js';
import { CorpusStore } from '../../agent/self-improvement/rule-store.js';
import { summarizeTrajectory } from '../../agent/self-improvement/execution-gate.js';
import { runPairedGate } from '../../agent/self-improvement/paired-gate.js';
import { createHeadlessRunner, SEED_GRADED_TASKS } from '../../agent/self-improvement/paired-runner.js';
import type { Experience } from '../../agent/self-improvement/types.js';

/**
 * Collect real experiences (best-effort) so the LLM proposer can ground its
 * drafts in what actually went wrong: run friction always, plus world-model
 * sensor surprise when `CODEBUDDY_WORLD_MODEL=true` (the robot seam — off by
 * default, in which case that source contributes nothing). Never throws — an
 * empty list just means the proposer relies on the scenario alone.
 */
async function collectExperiences(): Promise<Experience[]> {
  const sources = [
    createDefaultRunExperienceSource({ limit: 10 }),
    createDefaultSensorExperienceSource({ limit: 10 }),
  ];
  const collected = await Promise.all(
    sources.map(async (source) => {
      try {
        return await source.collect();
      } catch {
        return [] as Experience[];
      }
    }),
  );
  return collected.flat();
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

interface ImproveBenchOptions extends ImproveOptions {
  run?: boolean;
  history?: boolean | string;
  report?: boolean;
  models?: string;
  provider?: string;
  scenarios?: string;
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
    .command('bench')
    .description('Measure active models on the curated capability benchmark (opt-in)')
    .option('--run', 'run the benchmark against the selected active models')
    .option('--history [model]', 'show the ASCII score history, optionally for one model')
    .option('--report', 'show latest model scores, regressions, and a recommendation')
    .option('--models <models>', 'comma-separated model ids to benchmark')
    .option('--provider <provider>', 'benchmark only one active provider')
    .option('--scenarios <n>', 'maximum number of curated scenarios')
    .option('--json', 'output JSON')
    .action(async (options: ImproveBenchOptions) => {
      if (process.env.CODEBUDDY_SELF_BENCH !== 'true') {
        logger.error(
          'Self-benchmark is opt-in. Set CODEBUDDY_SELF_BENCH=true to run or inspect it.'
        );
        process.exitCode = 1;
        return;
      }
      if (!options.run && options.history === undefined && !options.report) {
        logger.error('Choose at least one mode: --run, --history [model], or --report.');
        process.exitCode = 1;
        return;
      }

      const benchmark = await import('../../agent/self-improvement/continuous-benchmark.js');
      const run = options.run
        ? await benchmark.runBenchmark({
            ...(options.models ? { models: options.models } : {}),
            ...(options.provider ? { provider: options.provider } : {}),
            ...(options.scenarios ? { scenarios: Number.parseInt(options.scenarios, 10) } : {}),
          })
        : undefined;
      const history = await benchmark.readBenchmarkHistory();
      const report = options.report
        ? benchmark.createBenchmarkReport(
            history,
            (() => {
              const configured = Number(process.env.CODEBUDDY_SELF_BENCH_DROP);
              return Number.isFinite(configured) && configured >= 0
                ? configured
                : benchmark.DEFAULT_SELF_BENCH_DROP;
            })()
          )
        : undefined;

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              kind: 'continuous_capability_benchmark',
              ...(run ? { run } : {}),
              ...(options.history !== undefined ? { history } : {}),
              ...(report ? { report } : {}),
            },
            null,
            2
          )
        );
        return;
      }

      const sections: string[] = [];
      if (run) {
        sections.push(
          [
            `Benchmark run ${run.runId}:`,
            ...run.models.map(
              (model) =>
                `  ${model.model}: ${(model.score * 100).toFixed(0)}% ` +
                `(${model.scenarios} scenario(s), ${Math.round(model.latencyMs)}ms)`
            ),
            run.models.length === 0 ? '  No active model matched the filters.' : '',
          ]
            .filter(Boolean)
            .join('\n')
        );
      }
      if (options.history !== undefined) {
        const model = typeof options.history === 'string' ? options.history : undefined;
        sections.push(benchmark.renderBenchmarkHistory(history, model));
      }
      if (report) {
        sections.push(
          [
            'Latest capability state:',
            ...report.latest.map(
              (model) =>
                `  ${model.model}: ${(model.score * 100).toFixed(0)}% (${Math.round(model.latencyMs)}ms)`
            ),
            report.regressions.length > 0
              ? `Regressions: ${report.regressions
                  .map((entry) => `${entry.model} ${(entry.drop * 100).toFixed(1)}%`)
                  .join(', ')}`
              : 'Regressions: none detected',
            `Recommendation: ${report.recommendation}`,
          ].join('\n')
        );
      }
      console.log(sections.join('\n\n'));
    });

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
    .command('tools')
    .description('Author + behaviorally validate NEW tools for the agent (held-out gated, anti-gaming)')
    .option('--json', 'output JSON')
    .option('--apply', 'keep validated tools for this session (overrides propose-only)')
    .action(async (options: ImproveOptions) => {
      const { ToolImprovementEngine } = await import('../../agent/self-improvement/tool-engine.js');
      const { LlmToolProposer } = await import('../../agent/self-improvement/llm-tool-proposer.js');
      const { SEED_TOOL_SCENARIOS } = await import('../../agent/self-improvement/tool-benchmark.js');
      const engine = new ToolImprovementEngine({
        scenarios: SEED_TOOL_SCENARIOS,
        proposer: new LlmToolProposer(),
        ...(options.apply ? { autonomy: 'auto-apply' as const } : {}),
      });
      const results = await engine.runLoop();
      const kept = results.map((r) => (r.applied ? r.gate?.appliedRef : null)).filter(Boolean);
      const text = [
        `Autonomy: ${results[0]?.autonomy ?? 'propose-only'}`,
        `Cycles: ${results.length}`,
        ...results.map(
          (r) =>
            `  ${r.selectedScenarioId ?? '—'}: ${
              r.applied
                ? `AUTHORED + KEPT (${r.gate?.appliedRef})`
                : r.gate?.accepted
                  ? 'accepted (propose-only) — re-run with --apply to keep'
                  : r.gate?.rejectionReason
                    ? `rejected (${r.gate.rejectionReason})`
                    : r.notes.join('; ')
            }`,
        ),
        kept.length
          ? `Kept: ${kept.join(', ')} (archived + persisted to .codebuddy/self-improvement; reloaded at next start unless CODEBUDDY_LOAD_AUTHORED_TOOLS=false)`
          : 'No tool kept this run',
      ].join('\n');
      print({ kind: 'self_improvement_tools', cycles: results }, options, text);
    });

  improve
    .command('skills')
    .description('Author + safety-gate NEW skills for the agent (firewall + coverage)')
    .option('--json', 'output JSON')
    .option('--apply', 'install validated skills (overrides propose-only)')
    .action(async (options: ImproveOptions) => {
      const { SkillImprovementEngine } = await import('../../agent/self-improvement/skill-engine.js');
      const { LlmSkillProposer } = await import('../../agent/self-improvement/skill-proposer.js');
      const { SEED_SKILL_SCENARIOS } = await import('../../agent/self-improvement/skill-benchmark.js');
      const engine = new SkillImprovementEngine({
        scenarios: SEED_SKILL_SCENARIOS,
        proposer: new LlmSkillProposer(),
        ...(options.apply ? { autonomy: 'auto-apply' as const } : {}),
      });
      const results = await engine.runLoop();
      const kept = results.map((r) => (r.applied ? r.gate?.appliedRef : null)).filter(Boolean);
      const text = [
        `Autonomy: ${results[0]?.autonomy ?? 'propose-only'}`,
        `Cycles: ${results.length}`,
        ...results.map(
          (r) =>
            `  ${r.selectedScenarioId ?? '—'}: ${
              r.applied
                ? `AUTHORED + INSTALLED (${r.gate?.appliedRef})`
                : r.gate?.accepted
                  ? 'accepted (propose-only) — re-run with --apply to install'
                  : r.gate?.rejectionReason
                    ? `rejected (${r.gate.rejectionReason})`
                    : r.notes.join('; ')
            }`,
        ),
        kept.length ? `Installed: ${kept.join(', ')} (under .codebuddy/skills/authored)` : 'No skill installed this run',
      ].join('\n');
      print({ kind: 'self_improvement_skills', cycles: results }, options, text);
    });

  improve
    .command('skills-list')
    .description('List installed authored skills (with pinned status)')
    .option('--json', 'output JSON')
    .action(async (options: ImproveOptions) => {
      const { LiveSkillMutator } = await import('../../agent/self-improvement/skill-mutator.js');
      const m = new LiveSkillMutator();
      const skills = m.listAuthored().map((name) => ({ name, pinned: m.isPinned(name) }));
      const text = skills.length
        ? skills.map((s) => `  ${s.pinned ? '📌' : '  '} ${s.name}`).join('\n')
        : 'No authored skills installed';
      print({ kind: 'authored_skills', skills }, options, text);
    });

  improve
    .command('skills-pin <name>')
    .description('Pin an authored skill (protect it from curation overwrite/remove/consolidation)')
    .option('--json', 'output JSON')
    .action(async (name: string, options: ImproveOptions) => {
      const { LiveSkillMutator } = await import('../../agent/self-improvement/skill-mutator.js');
      const ok = new LiveSkillMutator().pin(name);
      print({ kind: 'skill_pin', name, ok }, options, ok ? `Pinned ${name}` : `Skill not found: ${name}`);
    });

  improve
    .command('skills-unpin <name>')
    .description('Unpin an authored skill')
    .option('--json', 'output JSON')
    .action(async (name: string, options: ImproveOptions) => {
      const { LiveSkillMutator } = await import('../../agent/self-improvement/skill-mutator.js');
      const ok = new LiveSkillMutator().unpin(name);
      print({ kind: 'skill_unpin', name, ok }, options, ok ? `Unpinned ${name}` : `Skill not found: ${name}`);
    });

  improve
    .command('skills-restore <name>')
    .description('Restore a previously archived authored skill')
    .option('--json', 'output JSON')
    .action(async (name: string, options: ImproveOptions) => {
      const { LiveSkillMutator } = await import('../../agent/self-improvement/skill-mutator.js');
      const ok = new LiveSkillMutator().restore(name);
      print({ kind: 'skill_restore', name, ok }, options, ok ? `Restored ${name}` : `No archived skill: ${name}`);
    });

  improve
    .command('skills-consolidate')
    .description('Merge overlapping authored skills into one umbrella (coverage-gated)')
    .option('--json', 'output JSON')
    .option('--apply', 'install the umbrella + archive merged siblings (else preview)')
    .action(async (options: ImproveOptions) => {
      const { LiveSkillMutator } = await import('../../agent/self-improvement/skill-mutator.js');
      const { consolidateCluster, buildClusterFromInstalled, LlmUmbrellaProposer } = await import('../../agent/self-improvement/skill-consolidator.js');
      const { SEED_SKILL_SCENARIOS } = await import('../../agent/self-improvement/skill-benchmark.js');
      const mutator = new LiveSkillMutator();
      const cluster = buildClusterFromInstalled(mutator, SEED_SKILL_SCENARIOS);
      const out = await consolidateCluster(cluster, new LlmUmbrellaProposer(), mutator, new EvolutionaryArchive(), {
        keepOnAccept: options.apply === true,
      });
      const text = out.accepted
        ? out.absorbed.length
          ? `Consolidated ${out.absorbed.join(', ')} into ${out.umbrellaName}` + (out.skippedPinned.length ? ` (kept pinned: ${out.skippedPinned.join(', ')})` : '')
          : `Would consolidate into ${out.umbrellaName} — re-run with --apply` + (out.skippedPinned.length ? ` (would keep pinned: ${out.skippedPinned.join(', ')})` : '')
        : `No consolidation: ${out.rejectionReason} — ${out.reasons.join('; ')}`;
      print({ kind: 'skill_consolidation', ...out }, options, text);
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

  improve
    .command('verify')
    .description('Paired LIVE gate: does a lesson actually improve behavior? (agent±lesson on graded tasks, Bayesian)')
    .argument('<lesson>', 'the candidate lesson text to verify')
    .option('--json', 'output JSON')
    .option('--threshold <p>', 'acceptance confidence (default 0.95)', (v) => v)
    .action(async (lesson: string, options: ImproveOptions & { threshold?: string }) => {
      const threshold = options.threshold ? Number.parseFloat(options.threshold) : 0.95;
      const result = await runPairedGate(lesson, SEED_GRADED_TASKS, createHeadlessRunner(), { threshold });
      const verdict = result.accepted
        ? `ACCEPT — the lesson improves behavior (P=${result.decision.pImprove.toFixed(3)} ≥ ${threshold})`
        : result.rejectionReason === 'inert'
          ? 'REJECT — inert: the lesson changed no behavior on any task'
          : result.rejectionReason === 'safety-regression'
            ? 'REJECT — safety regression'
            : `REJECT — not confident (P=${result.decision.pImprove.toFixed(3)} < ${threshold})`;
      const text = [
        `Paired live gate over ${result.tasksRun} task(s): ${result.decision.wins} win / ${result.decision.losses} loss`,
        verdict,
      ].join('\n');
      print({ kind: 'self_improvement_verify', ...result }, options, text);
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
