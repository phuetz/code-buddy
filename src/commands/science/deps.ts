/**
 * Real-brick wiring for the AI-Scientist-lite Phase 0 pass.
 *
 * Each boundary in {@link ExperimentDeps} is bound here to an EXISTING Code
 * Buddy faculty — nothing is reimplemented:
 *   - ideate         → user `--hypothesis` OR one bounded LLM call
 *   - assessNovelty  → Collective Knowledge Graph `recallHybrid` (a light
 *                      novelty verdict; full novelty packaging is Phase 3)
 *   - gates          → AskHumanTool (fail closed: default answer = "non")
 *   - authorExperiment → user `--code-file` OR one bounded LLM call
 *   - executeCode    → the real `execute-code-runner` (isolation is set by the
 *                      orchestrator, not here)
 *   - analyze        → one bounded LLM summary of the execution output
 *   - report         → deep-research `synthesize` (cited report + "## Références")
 *   - review         → the built-in Verifier agent (fresh context, read-only)
 *   - publish        → CKG `ingestPublication`
 *
 * Every boundary is never-throws at its own edge; the orchestrator additionally
 * guards each stage, so a brick failure degrades the pass rather than crashing.
 *
 * @module commands/science/deps
 */

import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { ResolvedCommandProvider } from '../llm-provider-resolution.js';
import type { ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';
import { executeCode } from '../../tools/execute-code-runner.js';
import { ExperimentVariantStore } from '../../agent/science/experiment-variant-store.js';
import { stdoutNumberMetric } from '../../agent/science/experiment-fitness.js';
import type { EmpiricalScoringConfig } from '../../agent/science/experiment-empirical-gate.js';
import type { FitnessReport } from '../../agent/self-improvement/evolution/variant-fitness.js';
import type {
  ExperimentDeps,
  GateDecision,
  HumanGatePrompt,
  NoveltyVerdict,
  ScienceIdea,
  ReportContext,
  ReviewVerdict,
} from '../../agent/science/experiment-orchestrator.js';
import { boundText } from '../../agent/science/experiment-orchestrator.js';
import type { ExperimentLoopDeps, MutationContext } from '../../agent/science/experiment-loop.js';
import {
  createExperimentSandboxRunner,
  type ExperimentSandboxBackend,
} from '../../agent/science/experiment-sandbox.js';
import { getAskHumanTool } from '../../tools/ask-human-tool.js';
import { logger } from '../../utils/logger.js';

/** CLI-supplied knobs threaded into the real wiring. */
export interface ScienceDepsConfig {
  provider: ResolvedCommandProvider;
  /** User-supplied hypothesis (skips LLM ideation). */
  hypothesis?: string;
  /** User-supplied experiment code file (skips LLM authoring). */
  codeFile?: string;
  /** Experiment language (default 'python'). */
  language: ExecuteCodeLanguage;
  /** Skip publication entirely (still runs, still reviews; GATE #2 auto-declines). */
  noPublish?: boolean;
  /**
   * Phase 2 OPT-IN execution sandbox. When set, the experiment step is routed
   * through the network-isolating sandbox router instead of the plain isolate
   * runner. UNSET ⇒ byte-identical Phase 0/1 (the plain isolate runner, network
   * NOT isolated — the router is never even constructed).
   */
  sandbox?: {
    backend: ExperimentSandboxBackend;
    requireNetworkIsolation: boolean;
  };
}

/** A tiny provider-agnostic text chat, bounded and never-throws. */
async function chatText(
  provider: ResolvedCommandProvider,
  system: string,
  user: string,
): Promise<string> {
  try {
    const { CodeBuddyClient } = await import('../../codebuddy/client.js');
    const client = new CodeBuddyClient(provider.apiKey, provider.model, provider.baseURL);
    const resp = await client.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const content = resp?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  } catch (err) {
    logger.debug(`[science] LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** Extract the first fenced code block, else the raw trimmed text. */
function extractCode(raw: string): string {
  const fence = raw.match(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/);
  return (fence?.[1] ?? raw).trim();
}

// ---------------------------------------------------------------------------
// Gate wiring — AskHumanTool, FAIL CLOSED (default answer is a decline).
// ---------------------------------------------------------------------------

function makeGate(): (prompt: HumanGatePrompt) => Promise<GateDecision> {
  return async (prompt: HumanGatePrompt): Promise<GateDecision> => {
    const tool = getAskHumanTool();
    const res = await tool.execute({
      question: `${prompt.title}\n\n${prompt.body}\n\nApprouver ?`,
      options: ['oui', 'non'],
      // On timeout / non-interactive (no TTY) this returns the default → DECLINE.
      default: 'non',
      timeout: 300,
    });
    const answer = (res.output ?? '').trim().toLowerCase();
    const approved = ['oui', 'o', 'yes', 'y', 'approve', 'approuver'].includes(answer);
    return approved
      ? { approved: true }
      : { approved: false, reason: `réponse: ${answer || 'aucune'}` };
  };
}

// ---------------------------------------------------------------------------
// Novelty — CKG recallHybrid → a light verdict.
// ---------------------------------------------------------------------------

async function assessNoveltyFromCkg(idea: ScienceIdea, goal: string): Promise<NoveltyVerdict> {
  try {
    const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
    const ckg = getCollectiveKnowledgeGraph();
    const hits = await ckg.recallHybrid(`${idea.hypothesis} ${goal}`, { limit: 5 });
    const strong = hits.filter((h) => (h.similarity ?? 0) >= 0.6 || h.corroborations >= 2);
    const evidence = hits.slice(0, 3).map((h) => `[${h.type}] ${h.name} (sim=${(h.similarity ?? 0).toFixed(2)})`);
    if (strong.length >= 2) {
      return { noveltyAssessment: 'known', evidence, summary: `${strong.length} proche(s) déjà dans le CKG` };
    }
    if (hits.length > 0) {
      return { noveltyAssessment: 'incremental', evidence, summary: `${hits.length} voisin(s) faible(s) dans le CKG` };
    }
    return { noveltyAssessment: 'novel', evidence: [], summary: 'aucun voisin dans le CKG' };
  } catch (err) {
    return {
      noveltyAssessment: 'unknown',
      evidence: [`CKG recall indisponible: ${err instanceof Error ? err.message : String(err)}`],
      summary: 'nouveauté non évaluable',
    };
  }
}

// ---------------------------------------------------------------------------
// Report — deep-research synthesize over a single synthetic "source".
// ---------------------------------------------------------------------------

async function synthesizeReport(provider: ResolvedCommandProvider, ctx: ReportContext): Promise<string> {
  const { synthesize, resolveDeepResearchOptions } = await import('../../agent/deep-research.js');
  const opts = resolveDeepResearchOptions({});
  const evidence = [
    `Hypothèse: ${ctx.idea.hypothesis}`,
    `Nouveauté: ${ctx.novelty.noveltyAssessment} — ${ctx.novelty.summary}`,
    `Exécution (sandbox isolate): exit ${ctx.execution.exitCode ?? 'unknown'}${ctx.execution.timedOut ? ', timeout' : ''}, ${ctx.execution.durationMs}ms`,
    // Head+tail bound so the synthesizer sees BOTH the opening lines and the
    // final result line of a long log (not just a head-only slice).
    `stdout:\n${boundText(ctx.execution.stdout, 4000)}`,
    ctx.execution.stderr.trim() ? `stderr:\n${boundText(ctx.execution.stderr, 1000)}` : '',
    `Analyse: ${ctx.analysis.summary}`,
    ...ctx.analysis.findings.map((f) => `- ${f}`),
  ]
    .filter(Boolean)
    .join('\n');
  const source = {
    id: 1,
    url: `experiment://${ctx.execution.runId}`,
    title: `Experiment run ${ctx.execution.runId}`,
    content: evidence,
    query: ctx.goal,
  };
  const plan = {
    question: ctx.goal,
    subQuestions: [{ subQuestion: ctx.idea.hypothesis, queries: [ctx.goal] }],
  };
  const { report } = await synthesize(
    ctx.goal,
    plan,
    [source],
    {
      llm: (messages) =>
        chatText(
          provider,
          messages.find((m) => m.role === 'system')?.content ?? '',
          messages.find((m) => m.role === 'user')?.content ?? '',
        ),
      search: async () => [],
      scrape: async () => '',
    },
    opts,
  );
  return report;
}

// ---------------------------------------------------------------------------
// Review — the built-in Verifier agent (fresh context, read-only verdict).
// ---------------------------------------------------------------------------

async function reviewWithVerifier(
  provider: ResolvedCommandProvider,
  report: { report: string },
  idea: ScienceIdea,
): Promise<ReviewVerdict> {
  try {
    const { getAgentRegistry } = await import('../../agent/specialized/agent-registry.js');
    const registry = getAgentRegistry();
    // The `buddy science` path never runs `initializeAgentRegistry()`, so the
    // singleton can be EMPTY here — an unpopulated registry makes
    // `executeOn('verifier', …)` return "Agent not found: verifier" and the review
    // silently dies as "no verifier output". Populate the built-ins first (same
    // guard `executeSpecializedTask` uses) so the verifier actually runs.
    if (registry.getAll().length === 0) {
      await registry.registerBuiltInAgents();
    }
    // Adapt the SWE llmCall shape to a single-shot text review (no tool calls ⇒
    // the verifier loop terminates on the first response with its verdict).
    const llmCall = async (
      messages: Array<{ role: string; content: string }>,
    ): Promise<{ content: string; tool_calls: [] }> => {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const rest = messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content)
        .join('\n\n');
      const content = await chatText(provider, system, rest);
      return { content, tool_calls: [] };
    };
    // Read-only executor: the verifier gates tools anyway; we expose none here.
    const executeTool = async (): Promise<{ success: false; error: string }> => ({
      success: false,
      error: 'no tools available to the Phase-0 reviewer (evidence is embedded in the instruction)',
    });
    const instruction = [
      'Independently review whether this experiment report is supported by its own evidence.',
      `Hypothesis: ${idea.hypothesis}`,
      '',
      'Report under review:',
      // Head+tail bound: the code-rendered evidence section lives at the report
      // TAIL, so keep the tail visible even when a long report must be bounded.
      boundText(report.report, 8000),
      '',
      'Return CONFIRMED only if the report is internally consistent and its conclusions follow from the shown execution output; otherwise NEEDS REVIEW with the reason.',
    ].join('\n');
    const result = await registry.executeOn('verifier', {
      action: 'verify',
      params: { llmCall, executeTool, instruction },
    });
    const verdict = result.metadata?.verdict === 'CONFIRMED' ? 'CONFIRMED' : 'NEEDS REVIEW';
    return { verdict, evidence: (result.output ?? '').slice(0, 4000) || 'no verifier output' };
  } catch (err) {
    return { verdict: 'NEEDS REVIEW', evidence: `verifier unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Publish — CKG ingestPublication.
// ---------------------------------------------------------------------------

async function publishToCkg(report: { report: string }, idea: ScienceIdea): Promise<void> {
  const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
  const ckg = getCollectiveKnowledgeGraph();
  await ckg.ingestPublication({
    title: `Experiment: ${idea.hypothesis}`.slice(0, 300),
    abstract: report.report.slice(0, 2000),
    source: 'ai-scientist-phase0',
  });
}

// ---------------------------------------------------------------------------
// Phase 1 — empirical scoring config (opt-in via `--score`).
// ---------------------------------------------------------------------------

/** CLI knobs for the Phase 1 empirical scoring / keep-gate. */
export interface EmpiricalCliConfig {
  /** Metric key to parse from the experiment's stdout (e.g. 'accuracy'). */
  metricKey: string;
  /** Direction: default higher-is-better; set false for a loss/error. */
  higherIsBetter?: boolean;
  /** Optional [min,max] to rescale the raw metric into [0,1]. */
  min?: number;
  max?: number;
  /** Experiment baseline score to beat (NEVER `main` — an experiment number). */
  baselineScore?: number;
  /** Genealogy: the parent variant id. */
  parentId?: string;
  /** Override the variant store path (default `.codebuddy/science/…`). */
  storePath?: string;
}

/**
 * Build the {@link EmpiricalScoringConfig} from CLI knobs. The keep-gate reuses
 * the same fail-closed AskHumanTool gate; the metric parser is the stdout number
 * parser; the store is the append-only experiment variant store. DECOUPLED: the
 * baseline is an EXPERIMENT score, never the repo/`main`.
 */
export function buildEmpiricalScoringConfig(cli: EmpiricalCliConfig): EmpiricalScoringConfig {
  const metricName = cli.metricKey;
  const parseMetric = stdoutNumberMetric(metricName, {
    higherIsBetter: cli.higherIsBetter !== false,
    ...(cli.min !== undefined ? { min: cli.min } : {}),
    ...(cli.max !== undefined ? { max: cli.max } : {}),
  });
  const store = new ExperimentVariantStore(cli.storePath);
  const baseline: FitnessReport | undefined =
    typeof cli.baselineScore === 'number'
      ? {
          score: cli.baselineScore,
          passedAll: true,
          regressions: [],
          components: [
            { name: metricName, weight: 1, score: cli.baselineScore, passed: true, detail: `baseline ${cli.baselineScore}` },
          ],
        }
      : undefined;
  return {
    parseMetric,
    store,
    confirmKeep: makeGate(),
    createId: () => randomUUID(),
    now: () => new Date().toISOString(),
    metricName,
    ...(baseline ? { baseline } : {}),
    ...(cli.parentId ? { parentId: cli.parentId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/** Build the real-brick {@link ExperimentDeps} from the CLI config. */
export function buildScienceDeps(config: ScienceDepsConfig): ExperimentDeps {
  const { provider } = config;
  const gate = makeGate();

  return {
    ideate: async (goal: string): Promise<ScienceIdea> => {
      if (config.hypothesis && config.hypothesis.trim()) {
        return { hypothesis: config.hypothesis.trim(), source: 'user' };
      }
      const raw = await chatText(
        provider,
        'You are a research scientist. Given a goal, state ONE falsifiable hypothesis and a one-line experiment sketch. Format:\nHYPOTHESIS: <one sentence>\nPLAN: <one sentence>',
        `Goal: ${goal}`,
      );
      const hMatch = raw.match(/HYPOTHESIS:\s*(.+)/i);
      const pMatch = raw.match(/PLAN:\s*(.+)/i);
      const hypothesis = (hMatch?.[1] ?? raw.split('\n')[0] ?? goal).trim();
      const rationale = pMatch?.[1]?.trim();
      return { hypothesis: hypothesis || goal, source: 'reasoning', ...(rationale ? { rationale } : {}) };
    },

    assessNovelty: (idea, goal) => assessNoveltyFromCkg(idea, goal),

    confirmExperiment: gate,

    authorExperiment: async (idea, goal) => {
      if (config.codeFile && config.codeFile.trim()) {
        const code = await readFile(config.codeFile, 'utf8');
        return { code, language: config.language };
      }
      const raw = await chatText(
        provider,
        `You write a SINGLE self-contained ${config.language} experiment script that tests the hypothesis and PRINTS its measurable result to stdout. No external network calls, no extra files, standard library only, deterministic. Output ONLY the code in a fenced block.`,
        `Goal: ${goal}\nHypothesis: ${idea.hypothesis}${idea.rationale ? `\nPlan: ${idea.rationale}` : ''}`,
      );
      return { code: extractCode(raw), language: config.language };
    },

    // Real sandboxed runner. The orchestrator sets envMode:'isolate'.
    // Phase 2 (OPT-IN): when a sandbox backend is selected, route through the
    // network-isolating router. UNSET ⇒ byte-identical Phase 0/1 (this exact
    // plain-runner expression; the router is never constructed).
    executeCode: config.sandbox
      ? createExperimentSandboxRunner({
          backend: config.sandbox.backend,
          requireNetworkIsolation: config.sandbox.requireNetworkIsolation,
        })
      : (input, options) => executeCode(input, options),

    analyze: async (execution, idea) => {
      const raw = await chatText(
        provider,
        'You are a data analyst. Summarize what the experiment output shows about the hypothesis in 2-3 sentences, then list up to 4 concrete findings as bullet lines starting with "- ".',
        `Hypothesis: ${idea.hypothesis}\n\nstdout:\n${execution.stdout.slice(0, 6000)}\n\nstderr:\n${execution.stderr.slice(0, 1000)}\n\nexit=${execution.exitCode}`,
      );
      const lines = raw.split('\n').map((l) => l.trim());
      const findings = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
      const summary = lines.filter((l) => l && !l.startsWith('- ')).join(' ').trim();
      return {
        summary: summary || 'analyse indisponible',
        findings: findings.length ? findings : [`exit ${execution.exitCode ?? 'unknown'}`],
      };
    },

    report: async (ctx) => ({ report: await synthesizeReport(provider, ctx) }),

    review: (report, idea) => reviewWithVerifier(provider, report, idea),

    // GATE #2 — when --no-publish is set, decline deterministically (nothing published).
    confirmPublication: config.noPublish
      ? async (): Promise<GateDecision> => ({ approved: false, reason: '--no-publish' })
      : gate,

    publish: (report, idea) => publishToCkg(report, idea),
  };
}

// ---------------------------------------------------------------------------
// Phase 3 — the BFTS loop's extra boundaries (mutation, metric, store, clock).
// ---------------------------------------------------------------------------

/** Generate a CHILD hypothesis, a concrete variation of the parent + archive. */
async function mutateHypothesis(provider: ResolvedCommandProvider, ctx: MutationContext): Promise<ScienceIdea> {
  const archiveLines = ctx.archive
    .slice(0, 5)
    .map((v) => `- score ${v.score.toFixed(3)}: ${v.hypothesis}`)
    .join('\n');
  const raw = await chatText(
    provider,
    'You are a research scientist running a best-first search. Given a PARENT hypothesis and the best-so-far archive, propose ONE improved CHILD hypothesis that is a concrete VARIATION of the parent (a different mechanism / parameter / approach) likely to score higher. Keep it falsifiable and runnable. Format:\nHYPOTHESIS: <one sentence>\nPLAN: <one sentence>',
    `Goal: ${ctx.goal}\nParent hypothesis: ${ctx.parentIdea.hypothesis}\nParent score: ${ctx.parent.score.toFixed(3)}\nBest-so-far archive:\n${archiveLines || '(none yet)'}`,
  );
  const hMatch = raw.match(/HYPOTHESIS:\s*(.+)/i);
  const pMatch = raw.match(/PLAN:\s*(.+)/i);
  const hypothesis = (hMatch?.[1] ?? raw.split('\n')[0] ?? ctx.parentIdea.hypothesis).trim();
  const rationale = pMatch?.[1]?.trim();
  return {
    hypothesis: hypothesis || ctx.parentIdea.hypothesis,
    source: 'reasoning',
    ...(rationale ? { rationale } : {}),
  };
}

/** CLI knobs for the Phase 3 loop, on top of the shared {@link ScienceDepsConfig}. */
export interface ScienceLoopDepsConfig extends ScienceDepsConfig {
  /** Metric key to parse + score every generation on (default 'accuracy'). */
  metricKey?: string;
  /** Direction of the metric: default higher-is-better; false for a loss/error. */
  higherIsBetter?: boolean;
  /** Optional [min,max] to rescale the raw metric into [0,1]. */
  min?: number;
  max?: number;
  /** Override the variant store path (default `.codebuddy/science/…`). */
  storePath?: string;
}

/**
 * Build the real-brick {@link ExperimentLoopDeps}: the shared Phase-0 boundaries
 * (via {@link buildScienceDeps}) PLUS the loop's extras — mutation, metric parser,
 * the append-only variant store, and the injected clock / id / RNG. The two gates
 * are the SAME fail-closed AskHumanTool gate (GATE #1 = plan+budget, GATE #2 =
 * publication). Nothing is reimplemented.
 */
export function buildScienceLoopDeps(config: ScienceLoopDepsConfig): ExperimentLoopDeps {
  const base = buildScienceDeps(config);
  const metricName = config.metricKey ?? 'accuracy';
  const parseMetric = stdoutNumberMetric(metricName, {
    higherIsBetter: config.higherIsBetter !== false,
    ...(config.min !== undefined ? { min: config.min } : {}),
    ...(config.max !== undefined ? { max: config.max } : {}),
  });
  return {
    ...base,
    mutate: (ctx) => mutateHypothesis(config.provider, ctx),
    parseMetric,
    store: new ExperimentVariantStore(config.storePath),
    createId: () => randomUUID(),
    now: () => new Date().toISOString(),
    // Injected boundaries — no un-injected Date.now()/Math.random() in the loop's
    // hot path (the loop reads the clock/RNG only through these).
    clock: () => Date.now(),
    random: () => Math.random(),
  };
}
