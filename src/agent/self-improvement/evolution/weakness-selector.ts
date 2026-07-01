/**
 * Weakness selection — the front of the loop: decide WHAT to improve, automatically. Closes
 * "find a weakness → mutate toward it → evaluate → propose". Two sources:
 *   - failing eval tasks (the agent currently can't do task X) — crisp but LLM-costly to detect;
 *   - self-model hotspots (Code Explorer graph of Code Buddy's own repo) — cheap, no LLM.
 *
 * The mappers (hotspots/failures → Weakness) are pure + unit-tested; the fetchers are best-effort
 * (return [] when Code Explorer / a provider key is absent) and injectable for tests.
 *
 * @module agent/self-improvement/evolution/weakness-selector
 */

import { logger } from '../../../utils/logger.js';
import { runProc, listEvalTasks } from './variant-fitness.js';
import type { Weakness } from './evolution-engine.js';

export interface HotspotInfo {
  file: string;
  score?: number;
  reason?: string;
}

/** Pure: hotspots → weaknesses (refactor a hot/complex region without changing behavior). */
export function hotspotsToWeaknesses(hotspots: HotspotInfo[], limit = 3): Weakness[] {
  return hotspots
    .filter((h) => h.file && h.file.trim().length > 0)
    .slice(0, limit)
    .map((h, i) => ({
      id: `hotspot-${i + 1}`,
      kind: 'hotspot' as const,
      goal: `Improve the hotspot ${h.file}${h.reason ? ` (${h.reason})` : ''}: reduce complexity/coupling WITHOUT changing behavior. All tests must stay green.`,
    }));
}

/** Pure: failing eval task ids → weaknesses (fix the underlying agent behavior, not the test). */
export function evalFailuresToWeaknesses(failedTasks: string[], limit = 3): Weakness[] {
  return failedTasks.slice(0, limit).map((t) => ({
    id: `eval-${t}`,
    kind: 'eval-failure' as const,
    goal: `Make the failing eval task "${t}" pass (see eval/tasks/${t}). Fix the underlying agent behavior — never the test/harness.`,
  }));
}

export type HotspotFetcher = (basePath: string) => Promise<HotspotInfo[]>;
export type EvalFailureDetector = (basePath: string, env?: NodeJS.ProcessEnv) => Promise<string[]>;

export interface SelectWeaknessOptions {
  basePath?: string;
  limit?: number;
  includeEvalFailures?: boolean;
  includeHotspots?: boolean;
  fetchHotspots?: HotspotFetcher;
  detectEvalFailures?: EvalFailureDetector;
  env?: NodeJS.ProcessEnv;
}

/** Gather weaknesses from the enabled sources, dedup, cap at `limit`. */
export async function selectWeaknesses(opts: SelectWeaknessOptions = {}): Promise<Weakness[]> {
  const basePath = opts.basePath ?? process.cwd();
  const limit = opts.limit ?? 3;
  const out: Weakness[] = [];

  if (opts.includeEvalFailures) {
    const detect = opts.detectEvalFailures ?? defaultDetectEvalFailures;
    try {
      out.push(...evalFailuresToWeaknesses(await detect(basePath, opts.env), limit));
    } catch (err) {
      logger.warn(`[evolve] eval-failure detection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (opts.includeHotspots) {
    const fetch = opts.fetchHotspots ?? defaultFetchHotspots;
    try {
      out.push(...hotspotsToWeaknesses(await fetch(basePath), limit));
    } catch (err) {
      logger.warn(`[evolve] hotspot fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const seen = new Set<string>();
  return out.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true))).slice(0, limit);
}

/** Run each eval task; the ones that fail (non-zero exit) are current weaknesses. LLM-costly. */
async function defaultDetectEvalFailures(basePath: string, env?: NodeJS.ProcessEnv): Promise<string[]> {
  const tasks = listEvalTasks(basePath);
  const failed: string[] = [];
  for (const t of tasks) {
    const ctx = { checkoutDir: basePath, ...(env ? { env } : {}) };
    const r = await runProc(process.execPath, ['eval/run-task.mjs', t], ctx);
    if (r.code !== 0) failed.push(t);
  }
  return failed;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Best-effort: query Code Explorer hotspots of this repo. Returns [] if Code Explorer is absent
 *  or slow (bounded by a timeout so --auto never hangs on MCP bootstrap). */
async function defaultFetchHotspots(_basePath: string): Promise<HotspotInfo[]> {
  try {
    const { fetchCodeExplorerInsights } = await import('../../../research/code-explorer-source.js');
    const pubs = await withTimeout(fetchCodeExplorerInsights({ ops: ['hotspots'] }), 30_000, []);
    const fileRe = /[\w./-]+\.(?:ts|tsx|js|mjs|rs|py)/;
    return pubs.map((p) => {
      const text = `${p.title ?? ''} ${p.abstract ?? ''}`;
      const m = fileRe.exec(text);
      return { file: m ? m[0] : '', reason: (p.title ?? '').slice(0, 80) };
    });
  } catch (err) {
    logger.debug(`[evolve] Code Explorer hotspots unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
