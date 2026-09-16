/**
 * Improvement proposers — turn a curriculum target (+ experiences) into a
 * candidate improvement. The interface is the injection seam: the production
 * path is an LLM-backed proposer that drafts a lesson from real run friction,
 * but V1 ships a DETERMINISTIC static proposer so the engine and its empirical
 * gate stay fully reproducible and testable. Crucially, proposers are kept
 * structurally separate from the benchmark scenarios (the evals) — the engine
 * must never author the checks that bless its own changes.
 *
 * @module agent/self-improvement/proposer
 */

import type { BenchmarkScenario, Experience, ImprovementProposal } from './types.js';

export interface ImprovementProposer {
  /** Async so an LLM-backed proposer can draft novel improvements. */
  propose(
    scenario: BenchmarkScenario,
    experiences: Experience[],
  ): Promise<ImprovementProposal | null>;
}

export interface LessonDraft {
  category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
  content: string;
  context?: string;
}

/** Deterministic proposer backed by a fixed scenarioId → draft map. */
export class StaticProposer implements ImprovementProposer {
  constructor(private readonly drafts: Map<string, LessonDraft>) {}

  async propose(
    scenario: BenchmarkScenario,
    experiences: Experience[],
  ): Promise<ImprovementProposal | null> {
    const draft = this.drafts.get(scenario.id);
    if (!draft) return null;
    return {
      id: `prop-${scenario.id}`,
      kind: 'lesson',
      targetScenarioId: scenario.id,
      experienceId: experiences[0]?.id,
      lesson: { category: draft.category, content: draft.content, context: draft.context },
    };
  }
}

/**
 * Draft a lesson with an LLM. Injected so the proposer stays testable and
 * provider-agnostic. Returns null to decline (e.g. the model can't help).
 */
export type LessonDrafter = (
  scenario: BenchmarkScenario,
  experiences: Experience[],
) => Promise<LessonDraft | null>;

/**
 * LLM-backed proposer — the autonomy leap: it DISCOVERS novel improvements from
 * real run friction rather than replaying a fixed pack. Generation is creative
 * (non-deterministic); the empirical gate downstream is deterministic and
 * rigorous, so a bad draft is simply rejected and rolled back. This is the
 * Voyager "iterative prompting + self-verification" idea grounded by the DGM
 * empirical gate.
 */
export class LlmProposer implements ImprovementProposer {
  constructor(private readonly draft: LessonDrafter) {}

  async propose(
    scenario: BenchmarkScenario,
    experiences: Experience[],
  ): Promise<ImprovementProposal | null> {
    const draft = await this.draft(scenario, experiences);
    if (!draft || !draft.content?.trim()) return null;
    return {
      id: `prop-llm-${scenario.id}`,
      kind: 'lesson',
      targetScenarioId: scenario.id,
      experienceId: experiences[0]?.id,
      lesson: { category: draft.category, content: draft.content.trim(), context: draft.context },
    };
  }
}

/**
 * Build the strict prompt that asks a model to draft ONE durable lesson which
 * would make the agent handle `scenario` correctly next time, grounded in the
 * observed `experiences`. Kept here (not in the proposer) so the wiring layer
 * can pass it to whatever LLM client is available.
 */
export function buildLessonDraftPrompt(
  scenario: BenchmarkScenario,
  experiences: Experience[],
  knowledge: string[] = [],
): string {
  const evidence = experiences
    .slice(0, 5)
    .map((e) => `- [${e.kind}] ${e.detail} (${e.context})`)
    .join('\n');
  // Relevant findings from the collective knowledge base (e.g. ingested AI research) — this is
  // how a knowledge base on AI lets the agent self-improve more easily: drafts are grounded in
  // real, retrieved knowledge rather than the model's memory alone. Empty until the CKG is fed.
  const research = knowledge
    .slice(0, 3)
    .map((k) => `- ${k}`)
    .join('\n');
  return [
    'You maintain an AI coding agent\'s lesson library.',
    'Write ONE durable, reusable lesson (1-2 sentences) that would make the agent',
    `handle this recurring situation correctly next time. Situation: ${scenario.description}`,
    scenario.expectIncludes.length
      ? `The lesson MUST mention: ${scenario.expectIncludes.join(', ')}.`
      : '',
    `It should be retrievable when searching for: "${scenario.query}".`,
    evidence ? `Observed friction:\n${evidence}` : '',
    research ? `Relevant findings from the collective AI knowledge base:\n${research}` : '',
    'Reply with ONLY the lesson text — no preamble, no markdown, no secrets.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A curated knowledge pack the static proposer can use to BOOTSTRAP the agent's
 * lesson library — each draft is then empirically validated by the gate before
 * it is kept. This is deliberately SEPARATE from SEED_BENCHMARK_SCENARIOS so the
 * proposer never co-authors its own evals.
 */
export const SEED_LESSON_DRAFTS = new Map<string, LessonDraft>([
  [
    'npm-test-path-filter',
    {
      category: 'RULE',
      content:
        'When running npm test, always pass a path filter (e.g. `npm test -- path/to/file.test.ts`); the full suite is slow.',
    },
  ],
  [
    'esm-js-extension-imports',
    {
      category: 'RULE',
      content:
        'This is an ESM project: relative import statements need a .js extension even when writing code in a .ts source file.',
    },
  ],
  [
    'logger-not-console',
    {
      category: 'RULE',
      content:
        'Use the logger (src/utils/logger) in production code, not console.log — tests spy on logger and console output is not captured.',
    },
  ],
  [
    'atomic-write-state',
    {
      category: 'RULE',
      content:
        'State write operations for JSON and Markdown must pass via atomic-write.ts, with append-only logs using O_APPEND.',
    },
  ],
  [
    'git-add-named-files',
    {
      category: 'RULE',
      content:
        'Stage files for git add nommément one by one; jamais -A ni git commit -a to avoid committing unrelated unstaged changes.',
    },
  ],
  [
    'subproc-bounded-timeout',
    {
      category: 'RULE',
      content:
        'Always invoke wait_agent with timeout to monitor completion and keep child processes bounded.',
    },
  ],
  [
    'no-secrets-in-repo',
    {
      category: 'RULE',
      content:
        'For jwt_secret and tokens, never persist any secret in clair in tracked files; use environment variables or SecretRef configuration.',
    },
  ],
  [
    'isolated-home-tests',
    {
      category: 'RULE',
      content:
        'Always execute test commands with a dedicated HOME isolé under _qa/<mission>/home that is gitignoré.',
    },
  ],
  [
    'str-replace-omission-block',
    {
      category: 'RULE',
      content:
        'Perform targeted edits using str_replace; omission placeholder patterns like rest of code are strictly blocked.',
    },
  ],
  [
    'verify-before-finishing',
    {
      category: 'RULE',
      content:
        'When touching file changes, the verificationenforcement middleware requires running verify before finishing.',
    },
  ],
  [
    'report-before-inspection',
    {
      category: 'RULE',
      content:
        'Sous docs/reports, chaque mission exige un rapport créé avant toute inspection initialisé avant toute analyse.',
    },
  ],
  [
    'tests-live-in-tests-only',
    {
      category: 'RULE',
      content:
        'Per vitest.config, tests must be placed in tests/ only; no in-source test files are permitted under src/.',
    },
  ],
  [
    'self-improvement-never-touch-src',
    {
      category: 'RULE',
      content:
        'The self-improvement engine improves only the reversible learnable layer and never edits src directly.',
    },
  ],
  [
    'peer-tool-fails-closed',
    {
      category: 'RULE',
      content:
        'Remote peer.tool.invoke fails closed with PEER_WORKSPACE_NOT_CONFIGURED if workspace root is unset.',
    },
  ],
  [
    'batch-anti-tautology-guard',
    {
      category: 'RULE',
      content:
        'When executing /batch, any write task reporting success with no files changed triggers the anti-tautology guard.',
    },
  ],
]);
