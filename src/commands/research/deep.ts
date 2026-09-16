/**
 * `buddy research --deep <topic>` — the opt-in Deep Research (Phase A) CLI path.
 *
 * Strictly additive: this runs ONLY when `--deep` is present (see
 * `maybeRunDeepResearch`). Without the flag the command's existing Wide/direct
 * research behaviour is byte-identical.
 *
 * The heavy lifting lives in `WideResearchOrchestrator.deepResearch` +
 * `agent/deep-research.ts`; this module only handles CLI presentation
 * (progress lines, report file / stdout). The orchestrator is injectable so the
 * routing and rendering are unit-testable without any network.
 *
 * @module commands/research/deep
 */

import * as fs from 'fs/promises';
import path from 'path';
import type { WideResearchOrchestrator, DeepResearchProgress } from '../../agent/wide-research.js';
import {
  formatZeroSourceFailure,
  type DeepResearchLoopOptions,
  type DeepResearchResult,
  type DeepResearchLoopResult,
} from '../../agent/deep-research.js';
import type {
  StormProgress,
  StormResearchOptions,
  StormResearchResult,
} from '../../agent/deep-research-storm.js';

export interface DeepResearchCliOptions {
  deep?: boolean;
  report?: string;
  reportPath?: string;
  providerLabel?: string;
  deepOptions?: DeepResearchLoopOptions;
  /** Phase C: route to the STORM multi-perspective pipeline. */
  storm?: boolean;
  /** Phase C: number of diversified perspectives (only read when `storm`). */
  perspectives?: number;
  /** Phase D: bridge the run to the Collective Knowledge Graph (recall + ingest). */
  ckg?: boolean;
}

/** Minimal CKG activation surface passed to the orchestrator (keeps the fake tiny). */
export interface DeepCkgArg {
  enabled: boolean;
}

/** Minimal orchestrator surface used by the CLI (keeps the injected fake tiny). */
export interface DeepOrchestratorLike {
  on(event: 'progress', listener: (e: DeepResearchProgress | StormProgress) => void): unknown;
  deepResearch(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    deepOptions?: DeepResearchLoopOptions,
    boundariesOverride?: undefined,
    ckg?: DeepCkgArg,
  ): Promise<DeepResearchResult>;
  /** Phase C (STORM) — present only on the real orchestrator; optional for fakes. */
  stormResearch?(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    stormOptions?: StormResearchOptions,
    boundariesOverride?: undefined,
    ckg?: DeepCkgArg,
  ): Promise<StormResearchResult>;
}

export interface DeepResearchCliIo {
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
  makeOrchestrator?: () => DeepOrchestratorLike;
  writeFile?: (file: string, content: string) => Promise<void>;
}

/**
 * Strict gate: only runs the deep path (via `run`) when `--deep` is present.
 * Returns true when it handled the request. Kept dependency-injected so the
 * "flag absent ⇒ deep code never runs" invariant is directly testable.
 */
export async function maybeRunDeepResearch(
  opts: { deep?: boolean },
  run: () => Promise<void>,
): Promise<boolean> {
  if (!opts.deep) return false;
  await run();
  return true;
}

/**
 * Execute the Deep Research CLI flow: subscribe to progress, run the pipeline,
 * then print or persist the cited report. Never throws (errors are reported and
 * a failure report is written when a file target was requested).
 */
export async function runDeepResearchCli(
  topic: string,
  apiKey: string,
  providerConfig: { model?: string; baseURL?: string },
  opts: DeepResearchCliOptions,
  io: DeepResearchCliIo = {},
): Promise<void> {
  const log = io.log ?? ((m: string) => console.log(m));
  const errorLog = io.errorLog ?? ((m: string) => console.error(m));
  const writeFile = io.writeFile ?? (async (file: string, content: string) => {
    const outputPath = path.resolve(file);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf-8');
  });
  const reportPath = opts.reportPath ?? opts.report;

  let orchestrator: DeepOrchestratorLike;
  if (io.makeOrchestrator) {
    orchestrator = io.makeOrchestrator();
  } else {
    // CLI path: wire the worker factory before the orchestrator spawns sub-agents.
    const { maybeDiscoverLocalSearxng } = await import('./discover-searxng.js');
    const hadSearxng = Boolean(process.env.SEARXNG_URL?.trim());
    const discovered = await maybeDiscoverLocalSearxng();
    if (discovered && !hadSearxng) {
      log(`  🔎 Local SearXNG discovered at ${discovered}`);
    }
    const { ensureResearchWorkerFactory } = await import('./wire-research-worker.js');
    await ensureResearchWorkerFactory();
    const { WideResearchOrchestrator } = await import('../../agent/wide-research.js');
    orchestrator = new WideResearchOrchestrator() as unknown as WideResearchOrchestrator;
  }

  orchestrator.on('progress', (e: DeepResearchProgress | StormProgress) => {
    // Phase C (STORM) progress — its own channel, only emitted on the storm path.
    if (e.type === 'storm') {
      switch (e.stage) {
        case 'perspectives':
          log('  🎭 Instantiating diversified perspectives...');
          break;
        case 'perspectives-ready':
          log(`  🎭 ${e.count} perspective(s) ready`);
          break;
        case 'perspective-done':
          log(
            `  ${e.failed ? '⚠️' : '🔭'} Perspective "${e.perspective}": ${e.failed ? 'failed (dropped)' : `${e.sources} source(s)`}`,
          );
          break;
        case 'merged-perspectives':
          log(`  🧬 Merged perspectives → ${e.total} shared source(s), ${e.dropped} cross-perspective duplicate(s) dropped`);
          break;
        case 'outlining':
          log('  🗂️ Building the article outline...');
          break;
        case 'outlined':
          log(`  🗂️ Outline: ${e.sections} section(s) (${e.llmUsed ? 'LLM' : 'deterministic'})`);
          break;
        case 'writing':
          log('  ✍️ Co-writing sections with per-section citations...');
          break;
        case 'written':
          log(`  ✍️ ${e.sections} section(s) written (${e.coWritten ? 'outline-first' : 'flat fallback'})`);
          break;
        case 'storm-done':
          if (e.sources === 0) {
            log('  ❌ STORM Deep Research produced 0 cited source(s)');
          } else {
            log(`  ✅ STORM Deep Research complete (${e.sources} cited source(s))`);
          }
          break;
      }
      return;
    }
    if (e.type !== 'deep') return;
    switch (e.stage) {
      case 'planning':
        log('  🧭 Planning search queries...');
        break;
      case 'planned':
        log(`  📝 ${e.subQuestions} sub-question(s), ${e.queries} search queries (${e.llmUsed ? 'LLM' : 'fallback'})`);
        break;
      case 'collecting':
        log(`  🌐 Collecting up to ${e.urls} source(s)...`);
        break;
      case 'searched':
        log(
          `  🔎 Search: ${e.hits} hit(s) in → ${e.urls} unique URL(s) from ${e.queries} quer${e.queries === 1 ? 'y' : 'ies'}`,
        );
        break;
      case 'collected':
        log(`  📥 Kept ${e.scraped} source(s) after scrape/snippet fallback`);
        break;
      case 'deduped':
        log(`  🧹 ${e.kept} kept, ${e.dropped} near-duplicate(s) dropped`);
        break;
      case 'synthesizing':
        log('  🔗 Synthesizing cited report...');
        break;
      // Phase B (gap loop) — only emitted when --iterations > 1.
      case 'gap-analysis':
        log(`  🔎 Round ${e.round}: analysing gaps in the draft...`);
        break;
      case 'gaps':
        log(
          `  🧩 Round ${e.round}: ${e.gaps} gap(s), ${e.queries} new quer${e.queries === 1 ? 'y' : 'ies'}` +
            `${e.sufficient ? ' (draft judged sufficient)' : ''}`,
        );
        break;
      case 'merged':
        log(`  ➕ Round ${e.round}: +${e.added} new source(s), ${e.dropped} duplicate(s) dropped (${e.total} total)`);
        break;
      case 'converged':
        log(`  🎯 Converged at round ${e.round} (${e.reason})`);
        break;
      case 'done':
        if (e.sources === 0) {
          log('  ❌ Deep Research produced 0 cited source(s)');
        } else {
          log(`  ✅ Deep Research complete (${e.sources} cited source(s))`);
        }
        break;
    }
  });

  try {
    // Phase D (CKG bridge) is opt-in: activated when `--ckg` (or the shared env
    // gate) is set. Absent ⇒ `ckgArg` is undefined and the orchestrator's off-path
    // runs, byte-identically (no recall, no ingest). Rides on the deep path.
    const ckgArg: DeepCkgArg | undefined = opts.ckg ? { enabled: true } : undefined;
    // Phase C (STORM) is opt-in: routed ONLY when `storm` is set AND the
    // orchestrator exposes `stormResearch`. Absent ⇒ the exact Phase-A/B
    // `deepResearch` path runs, byte-identically.
    const result: DeepResearchResult =
      opts.storm && typeof orchestrator.stormResearch === 'function'
        ? await orchestrator.stormResearch(
            topic,
            apiKey,
            providerConfig,
            { ...opts.deepOptions, perspectives: opts.perspectives },
            undefined,
            ckgArg,
          )
        : await orchestrator.deepResearch(topic, apiKey, providerConfig, opts.deepOptions, undefined, ckgArg);
    if (!Array.isArray(result.sources) || result.sources.length === 0) {
      throw new Error(formatZeroSourceFailure(result));
    }
    const content = buildDeepReportFile(topic, result, opts.providerLabel);

    if (reportPath) {
      await writeFile(reportPath, content);
      log(`\n📄 Report saved: ${reportPath}`);
    } else {
      log('\n' + result.report);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorLog(`\n❌ Deep Research failed: ${message}`);
    if (reportPath) {
      const failure = [
        `# Deep Research: ${topic}`,
        '',
        `Generated: ${new Date().toISOString()}`,
        'Mode: deep',
        'Status: failed',
        '',
        `Error: ${message}`,
      ].join('\n');
      await writeFile(reportPath, failure).catch(() => undefined);
    }
    process.exitCode = 1;
  }
}

/** Assemble the metadata preface + the cited report body for file output. */
export function buildDeepReportFile(
  topic: string,
  result: DeepResearchResult,
  providerLabel?: string,
): string {
  // The loop metadata is present only on the Phase-B result; read it optionally
  // so a plain Phase-A result renders exactly as before (no "Rounds:" line).
  const loop = result as Partial<DeepResearchLoopResult>;
  const roundsLine =
    typeof loop.rounds === 'number' && loop.rounds > 1
      ? `Rounds: ${loop.rounds} (${loop.converged ? 'converged' : 'round cap reached'})`
      : undefined;
  // STORM (Phase-C) metadata is present only on the storm result; read it
  // optionally too, so Phase-A/B rendering is untouched (no "Perspectives:" line).
  const storm = result as Partial<StormResearchResult>;
  const isStorm = Array.isArray(storm.perspectives) && typeof storm.coWritten === 'boolean';
  const modeLine = isStorm ? 'Mode: deep (STORM multi-perspective)' : 'Mode: deep';
  const perspectivesLine = isStorm
    ? `Perspectives: ${storm.perspectives!.length} (${storm.perspectives!.map((p) => p.perspective.label).join(', ')})`
    : undefined;
  const outlineLine = isStorm
    ? `Outline: ${storm.outline?.sections.length ?? 0} section(s) | ` +
      `Article: ${storm.coWritten ? 'outline-first co-written' : 'flat fallback'}`
    : undefined;
  // Phase-D (CKG) metadata is present only when the bridge ran; read it optionally
  // so a run WITHOUT `--ckg` renders exactly as before (no "Mémoire collective" line).
  const ckg = (result as Partial<{ ckg: { enabled: boolean; recalled: number; ingested: number } }>).ckg;
  const ckgLine =
    ckg?.enabled
      ? `Mémoire collective (CKG): ${ckg.recalled} rappelée(s), ${ckg.ingested} ingérée(s)`
      : undefined;
  return [
    `# Deep Research: ${topic}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    modeLine,
    providerLabel ? `Provider: ${providerLabel}` : undefined,
    `Sources: ${result.sources.length} (${result.duplicatesDropped} near-duplicate(s) dropped)`,
    roundsLine,
    perspectivesLine,
    outlineLine,
    ckgLine,
    `Planner: ${result.plannerLlmUsed ? 'LLM' : 'deterministic'} | ` +
      `Synthesis: ${result.synthesisLlmUsed ? 'LLM' : 'deterministic'}`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    '',
    '---',
    '',
    result.report,
  ]
    .filter((l): l is string => l !== undefined)
    .join('\n');
}
