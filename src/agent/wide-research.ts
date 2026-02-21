/**
 * Wide Research Mode (Manus AI-inspired)
 *
 * Spawns N parallel sub-agent workers, each handling an independent
 * sub-topic, then aggregates results into a comprehensive report.
 *
 * Architecture:
 *   WideResearchOrchestrator
 *       |
 *       +-- decompose(topic) → string[]   (subtopics via LLM)
 *       |
 *       +-- worker[0..N-1]                (CodeBuddyAgent instances)
 *       |       each: "Research: <subtopic>"
 *       |
 *       +-- aggregate(results) → string   (synthesize via LLM)
 *
 * Each worker gets its own fresh message history and runs concurrently.
 * Results are streamed back via an AsyncGenerator for live progress.
 *
 * Unlike the full multi-agent orchestrator, Wide Research is intentionally
 * flat: workers cannot spawn their own sub-workers. All decomposition
 * happens at the orchestrator level (same pattern as OpenClaw's current
 * flat subagent design).
 */

import { EventEmitter } from 'events';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface WideResearchOptions {
  /** Number of parallel research workers (default: 5, max: 20) */
  workers?: number;
  /** Max tool rounds per worker (default: 15) */
  maxRoundsPerWorker?: number;
  /** Whether to stream partial results as workers finish */
  stream?: boolean;
  /** Additional context injected into each worker's system prompt */
  context?: string;
  /** LLM model for workers (defaults to current agent model) */
  model?: string;
}

export interface ResearchWorkerResult {
  subtopic: string;
  workerIndex: number;
  /** Raw research output from the worker */
  output: string;
  /** Whether the worker completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
}

export interface WideResearchResult {
  topic: string;
  subtopics: string[];
  workerResults: ResearchWorkerResult[];
  /** Synthesized final report */
  report: string;
  /** Total wall-clock duration */
  durationMs: number;
  /** Number of workers that succeeded */
  successCount: number;
}

export type WideResearchProgress =
  | { type: 'decomposed'; subtopics: string[] }
  | { type: 'worker_start'; workerIndex: number; subtopic: string }
  | { type: 'worker_done'; workerIndex: number; subtopic: string; success: boolean }
  | { type: 'aggregating' }
  | { type: 'done'; result: WideResearchResult };

// ============================================================================
// Orchestrator
// ============================================================================

export class WideResearchOrchestrator extends EventEmitter {
  private options: Required<WideResearchOptions>;

  constructor(options: WideResearchOptions = {}) {
    super();
    this.options = {
      workers: Math.min(options.workers ?? 5, 20),
      maxRoundsPerWorker: options.maxRoundsPerWorker ?? 15,
      stream: options.stream ?? true,
      context: options.context ?? '',
      model: options.model ?? '',
    };
  }

  /**
   * Run wide research on a topic.
   * Emits WideResearchProgress events throughout execution.
   */
  async research(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<WideResearchResult> {
    const startTime = Date.now();

    // Step 1: Decompose into subtopics
    const subtopics = await this.decompose(topic, apiKey, providerConfig);
    this.emit('progress', { type: 'decomposed', subtopics } satisfies WideResearchProgress);

    // Step 2: Run workers in parallel (batched by this.options.workers)
    const workerResults: ResearchWorkerResult[] = [];
    const chunks = this.chunk(subtopics, this.options.workers);

    for (const batch of chunks) {
      const batchPromises = batch.map(async (subtopic, batchIdx) => {
        const workerIndex = workerResults.length + batchIdx;
        this.emit('progress', { type: 'worker_start', workerIndex, subtopic } satisfies WideResearchProgress);

        const workerStart = Date.now();
        try {
          const output = await this.runWorker(subtopic, topic, apiKey, providerConfig);
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output,
            success: true,
            durationMs: Date.now() - workerStart,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: true } satisfies WideResearchProgress);
          return result;
        } catch (err) {
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output: '',
            success: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - workerStart,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: false } satisfies WideResearchProgress);
          return result;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      workerResults.push(...batchResults);
    }

    // Step 3: Aggregate
    this.emit('progress', { type: 'aggregating' } satisfies WideResearchProgress);
    const report = await this.aggregate(topic, workerResults, apiKey, providerConfig);

    const finalResult: WideResearchResult = {
      topic,
      subtopics,
      workerResults,
      report,
      durationMs: Date.now() - startTime,
      successCount: workerResults.filter(r => r.success).length,
    };

    this.emit('progress', { type: 'done', result: finalResult } satisfies WideResearchProgress);
    return finalResult;
  }

  // --------------------------------------------------------------------------
  // Decompose topic → subtopics via a single LLM call
  // --------------------------------------------------------------------------

  private async decompose(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<string[]> {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(apiKey, providerConfig as any);

    const response = await client.chat([
      {
        role: 'system',
        content: `You are a research coordinator. When given a topic, break it into ${this.options.workers} independent, non-overlapping subtopics that together provide comprehensive coverage. Return ONLY a JSON array of strings, no explanation.`,
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nReturn exactly ${this.options.workers} subtopics as a JSON array.`,
      },
    ]);

    try {
      const content = response.choices[0]?.message?.content ?? '';
      // Extract JSON array from response
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown[];
        if (Array.isArray(parsed)) {
          return parsed
            .filter((s): s is string => typeof s === 'string')
            .slice(0, this.options.workers);
        }
      }
    } catch {
      // Fall back to splitting the topic
    }

    // Fallback: create generic subtopics
    return Array.from({ length: this.options.workers }, (_, i) =>
      `${topic} - aspect ${i + 1}`
    );
  }

  // --------------------------------------------------------------------------
  // Run a single research worker
  // --------------------------------------------------------------------------

  private async runWorker(
    subtopic: string,
    parentTopic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<string> {
    const { CodeBuddyAgent } = await import('./codebuddy-agent.js');

    const agent = new CodeBuddyAgent(apiKey, {
      ...(providerConfig as any),
      maxToolRounds: this.options.maxRoundsPerWorker,
      systemPromptExtra: [
        `You are a focused research agent. Your only task is to research the following subtopic as part of a larger study on "${parentTopic}".`,
        this.options.context,
      ].filter(Boolean).join('\n\n'),
    });

    let output = '';

    const query = [
      `Research this subtopic thoroughly: "${subtopic}"`,
      `Parent topic: "${parentTopic}"`,
      '',
      'Use web search, browser, and any available tools.',
      'Produce a comprehensive summary with key facts, insights, and sources.',
      'Return only the research report, no meta-commentary.',
    ].join('\n');

    for await (const chunk of agent.processUserMessageStream(query)) {
      if (chunk.type === 'content' && chunk.content) {
        output += chunk.content;
      }
    }

    return output || '(no output from worker)';
  }

  // --------------------------------------------------------------------------
  // Aggregate worker results into a final report
  // --------------------------------------------------------------------------

  private async aggregate(
    topic: string,
    results: ResearchWorkerResult[],
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<string> {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(apiKey, providerConfig as any);

    const successful = results.filter(r => r.success);
    if (successful.length === 0) {
      return 'All research workers failed. No report available.';
    }

    const sections = successful
      .map(r => `## ${r.subtopic}\n\n${r.output}`)
      .join('\n\n---\n\n');

    const response = await client.chat([
      {
        role: 'system',
        content: `You are a research synthesizer. Combine the provided research sections into a single coherent, well-structured report. Eliminate redundancy, resolve contradictions, and add an executive summary. Use Markdown headings.`,
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nResearch sections:\n\n${sections}`,
      },
    ]);

    return response.choices[0]?.message?.content ?? 'Aggregation failed: no content returned.';
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

// ============================================================================
// Convenience function for tool use
// ============================================================================

export async function runWideResearch(
  topic: string,
  apiKey: string,
  options?: WideResearchOptions,
  providerConfig?: Record<string, unknown>
): Promise<ToolResult> {
  const orchestrator = new WideResearchOrchestrator(options);

  try {
    const result = await orchestrator.research(topic, apiKey, providerConfig);

    const summary = [
      `# Wide Research: ${topic}`,
      ``,
      `**Workers:** ${result.successCount}/${result.subtopics.length} succeeded`,
      `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
      ``,
      `## Subtopics Researched`,
      ...result.subtopics.map((s, i) => {
        const r = result.workerResults[i];
        return `- ${s} ${r?.success ? '✅' : '❌'}`;
      }),
      ``,
      `---`,
      ``,
      result.report,
    ].join('\n');

    return { success: true, output: summary };
  } catch (err) {
    return {
      success: false,
      error: `Wide Research failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
