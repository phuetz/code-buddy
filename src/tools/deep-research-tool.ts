/**
 * Deep Research tool adapter (`deep_research`).
 *
 * Exposes the mature Deep/Wide/STORM research pipeline — until now reachable
 * ONLY from the `buddy research --deep/--iterations/--perspectives/--ckg` CLI —
 * to the agent IN CONVERSATION, as a first-class, RAG-selectable, dispatchable
 * tool. It is a thin ITool adapter: it resolves the ambient provider (same path
 * as the CLI, `resolveCommandProvider`) and delegates to the SAME orchestrator
 * (`WideResearchOrchestrator.deepResearch` / `.stormResearch` / `.research`) —
 * it duplicates NO business logic.
 *
 * Two deliberate differences from the CLI path:
 *   1. CONSERVATIVE in-chat bounds. A tool fired mid-conversation must not kick
 *      off a massive web crawl, so the defaults are tighter than the CLI's
 *      (3 sub-questions, 2 queries each, 3 results/query, a low global source
 *      cap, 1 iteration). Optional params let the agent scale up ONLY when it
 *      explicitly asks (still clamped).
 *   2. NEVER-THROWS. Every failure degrades to `{ success:false, error }` — the
 *      agentic loop never sees an exception from research.
 *
 * All side-effecting edges (provider resolution, orchestrator construction) are
 * INJECTABLE so the delegation is unit-testable with zero network. Their
 * defaults are resolved via dynamic `import()` so the heavy research graph stays
 * off the hot import path.
 *
 * @module tools/deep-research-tool
 */

import type { ToolResult } from '../types/index.js';
import type {
  ITool,
  ToolSchema,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
} from './registry/types.js';
import type {
  WideResearchOptions,
  WideResearchResult,
} from '../agent/wide-research.js';
import type {
  DeepResearchLoopOptions,
  DeepResearchLoopResult,
} from '../agent/deep-research.js';
import type {
  StormResearchOptions,
  StormResearchResult,
} from '../agent/deep-research-storm.js';
import type { CkgRunOptions } from '../agent/deep-research-ckg.js';
import type { ResolvedCommandProvider } from '../commands/llm-provider-resolution.js';

// ============================================================================
// Injectable seams (real impls resolved lazily; fakes injected in tests)
// ============================================================================

/**
 * Minimal orchestrator surface the adapter delegates to — the real
 * `WideResearchOrchestrator` satisfies it structurally. `stormResearch` is
 * optional so a tiny fake need only implement what a given test exercises.
 */
export interface DeepResearchOrchestratorLike {
  research(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
  ): Promise<WideResearchResult>;
  deepResearch(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    deepOptions?: DeepResearchLoopOptions,
    boundariesOverride?: undefined,
    ckg?: CkgRunOptions,
  ): Promise<DeepResearchLoopResult>;
  stormResearch?(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    stormOptions?: StormResearchOptions,
    boundariesOverride?: undefined,
    ckg?: CkgRunOptions,
  ): Promise<StormResearchResult>;
}

/** Injectable dependencies (defaults wire the real CLI provider + orchestrator). */
export interface DeepResearchToolDeps {
  /** Build the orchestrator from conservative wide options. */
  makeOrchestrator?: (options: WideResearchOptions) => DeepResearchOrchestratorLike;
  /** Resolve the ambient provider (apiKey/model/baseURL). Null ⇒ no provider. */
  resolveProvider?: () => ResolvedCommandProvider | null;
}

// ============================================================================
// Conservative in-chat bounds (tighter than the CLI — a chat call stays cheap)
// ============================================================================

/** Report chars returned to the model (it re-reads the report; keep it bounded). */
const MAX_OUTPUT_CHARS = 16_000;

/** In-chat defaults — deliberately smaller than the CLI's Deep Research options. */
const IN_CHAT_DEEP_DEFAULTS = {
  maxSubQuestions: 3,
  queriesPerSubQuestion: 2,
  resultsPerQuery: 3,
  /** Low global source cap by default (agent may raise via `max_sources`). */
  maxSources: 6,
  concurrency: 3,
  perSourceChars: 2000,
} as const;

/** Conservative wide-research fan-out (fewer, faster workers than the CLI's 5). */
const IN_CHAT_WIDE_OPTIONS: WideResearchOptions = {
  workers: 3,
  maxRoundsPerWorker: 6,
  workerTimeoutMs: 60_000,
  overallTimeoutMs: 180_000,
};

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}

// ============================================================================
// The adapter
// ============================================================================

export class DeepResearchTool implements ITool {
  readonly name = 'deep_research';
  readonly description =
    'Run a bounded, multi-source, CITED research pipeline on a topic and return a structured report with a "## Références" section. Use for questions that need several web sources cross-checked into one report (state of the art, comparisons, "what does the literature say"), not a single quick lookup (use web_search for that).';

  private readonly deps: DeepResearchToolDeps;

  constructor(deps: DeepResearchToolDeps = {}) {
    this.deps = deps;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
      if (!topic) {
        return { success: false, error: 'deep_research requires a non-empty "topic".' };
      }

      const provider = await this.resolveProvider();
      if (!provider) {
        return {
          success: false,
          error:
            'No LLM provider available for deep_research — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        };
      }
      // Record<string, unknown> so it threads straight into the orchestrator's
      // provider-config param (the CLI passes the same { model, baseURL } shape).
      const providerConfig: Record<string, unknown> = {
        model: provider.model,
        baseURL: provider.baseURL,
      };

      const mode = input.mode === 'wide' ? 'wide' : 'deep';
      const orchestrator = await this.makeOrchestrator(IN_CHAT_WIDE_OPTIONS);

      if (mode === 'wide') {
        const result = await orchestrator.research(topic, provider.apiKey, providerConfig);
        return { success: true, output: this.renderWide(topic, result) };
      }

      // Deep path (default). CONSERVATIVE bounds; agent-supplied knobs are clamped.
      const maxSources = clampInt(input.max_sources, IN_CHAT_DEEP_DEFAULTS.maxSources, 1, 20);
      const rounds = clampInt(input.iterations, 1, 1, 3);
      const wantsStorm = typeof input.perspectives === 'number' && input.perspectives >= 2;
      const ckgArg: CkgRunOptions | undefined = input.ckg === true ? { enabled: true } : undefined;

      if (wantsStorm && typeof orchestrator.stormResearch === 'function') {
        const perspectives = clampInt(input.perspectives, 4, 2, 6);
        const stormOptions: StormResearchOptions = {
          ...IN_CHAT_DEEP_DEFAULTS,
          maxSources,
          perspectives,
        };
        const result = await orchestrator.stormResearch(
          topic,
          provider.apiKey,
          providerConfig,
          stormOptions,
          undefined,
          ckgArg,
        );
        return { success: true, output: this.renderDeep(topic, result) };
      }

      const deepOptions: DeepResearchLoopOptions = {
        ...IN_CHAT_DEEP_DEFAULTS,
        maxSources,
        rounds,
      };
      const result = await orchestrator.deepResearch(
        topic,
        provider.apiKey,
        providerConfig,
        deepOptions,
        undefined,
        ckgArg,
      );
      return { success: true, output: this.renderDeep(topic, result) };
    } catch (err) {
      return {
        success: false,
        error: `Deep Research failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Default seams (dynamic import keeps the heavy graph off the hot path)
  // --------------------------------------------------------------------------

  private async resolveProvider(): Promise<ResolvedCommandProvider | null> {
    if (this.deps.resolveProvider) return this.deps.resolveProvider();
    const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
    return resolveCommandProvider();
  }

  private async makeOrchestrator(options: WideResearchOptions): Promise<DeepResearchOrchestratorLike> {
    if (this.deps.makeOrchestrator) return this.deps.makeOrchestrator(options);
    const { WideResearchOrchestrator } = await import('../agent/wide-research.js');
    return new WideResearchOrchestrator(options);
  }

  // --------------------------------------------------------------------------
  // Rendering (bounded — the model re-reads the report)
  // --------------------------------------------------------------------------

  private renderDeep(topic: string, result: DeepResearchLoopResult | StormResearchResult): string {
    const loop = result as Partial<DeepResearchLoopResult>;
    const storm = result as Partial<StormResearchResult>;
    const isStorm = Array.isArray(storm.perspectives) && typeof storm.coWritten === 'boolean';
    const header = [
      `# Deep Research: ${topic}`,
      '',
      isStorm ? 'Mode: deep (STORM multi-perspective)' : 'Mode: deep',
      `Sources: ${result.sources.length} (${result.duplicatesDropped} near-duplicate(s) dropped)`,
      isStorm
        ? `Perspectives: ${storm.perspectives!.length}`
        : typeof loop.rounds === 'number' && loop.rounds > 1
          ? `Rounds: ${loop.rounds} (${loop.converged ? 'converged' : 'round cap reached'})`
          : undefined,
      `Planner: ${result.plannerLlmUsed ? 'LLM' : 'deterministic'} | Synthesis: ${result.synthesisLlmUsed ? 'LLM' : 'deterministic'}`,
      `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
      '',
      '---',
      '',
    ].filter((l): l is string => l !== undefined);
    return this.truncate(`${header.join('\n')}${result.report}`);
  }

  private renderWide(topic: string, result: WideResearchResult): string {
    const header = [
      `# Wide Research: ${topic}`,
      '',
      'Mode: wide (parallel sub-agents)',
      `Workers: ${result.successCount}/${result.subtopics.length} succeeded`,
      `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
      '',
      '---',
      '',
    ];
    return this.truncate(`${header.join('\n')}${result.report}`);
  }

  /** Truncate cleanly, appending a note so the model knows content was elided. */
  private truncate(text: string): string {
    if (text.length <= MAX_OUTPUT_CHARS) return text;
    return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n… [rapport tronqué à ${MAX_OUTPUT_CHARS} caractères — relancer avec une question plus ciblée pour le détail]`;
  }

  // --------------------------------------------------------------------------
  // ITool boilerplate
  // --------------------------------------------------------------------------

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'The research question or topic to investigate.',
          },
          mode: {
            type: 'string',
            enum: ['deep', 'wide'],
            description:
              "'deep' (default): deterministic cited pipeline (plan → search → scrape → dedup → synthesize). 'wide': parallel sub-agent research fan-out (broader, less citation-strict).",
          },
          iterations: {
            type: 'number',
            description:
              'Deep only: number of gap-analysis rounds (1-3, default 1). >1 re-searches to fill gaps in the draft. Higher = slower/more thorough.',
          },
          perspectives: {
            type: 'number',
            description:
              'Deep only: research the topic from N diversified perspectives (2-6) and co-write an outline-first cited article (STORM). Activates the multi-perspective pipeline.',
          },
          ckg: {
            type: 'boolean',
            description:
              'Deep only: bridge the run to the Collective Knowledge Graph — recall prior collective knowledge and ingest the deduped sources for cross-run accumulation.',
          },
          max_sources: {
            type: 'number',
            description:
              'Deep only: global cap on scraped sources (1-20, default 6). Raise only when the topic explicitly needs broader coverage (slower).',
          },
        },
        required: ['topic'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.topic !== 'string' || data.topic.trim() === '') {
      return { valid: false, errors: ['topic must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: [
        'research',
        'deep research',
        'investigate',
        'sources',
        'cite',
        'citation',
        'report',
        'literature',
        'state of the art',
        "état de l'art",
        'recherche approfondie',
        'storm',
        'perspectives',
      ],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
