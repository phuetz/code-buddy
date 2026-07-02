/**
 * Episodic journal — heartbeat-paced consolidation of the DIALOGUE (not sensor stats).
 *
 * `dreaming.ts` consolidates the short-term sensory buffer into counts-by-kind (how much motion /
 * speech / heartbeat happened). This is its companion for the CONVERSATION: it summarizes what was
 * actually HEARD into a short episodic line ("récemment on a parlé de …") and promotes it to a stable
 * memory key, so the arrival opener and event follow-ups can reference "what we talked about" instead
 * of only the last raw utterance. Phase 6 of the interactions refonte.
 *
 * Pure core (`summarizeEpisode`) + a best-effort, never-throws pass; everything injectable for tests.
 *
 * @module sensory/episodic-journal
 */

import { appendFile, mkdir, stat, rename } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface EpisodeSummary {
  at: number;
  /** Total non-empty utterances considered. */
  count: number;
  /** The distinct recent utterances (a proxy for topics without an LLM). */
  topics: string[];
  /** The injectable/spoken summary line, '' when there was nothing worth summarizing. */
  line: string;
}

/**
 * Pure consolidation: turn a list of heard utterances into a compact episode. Drops consecutive
 * duplicates (STT re-hears) and keeps the last few distinct ones. No LLM — the caller may refine.
 */
export function summarizeEpisode(heard: string[], now: number): EpisodeSummary {
  const clean = heard.map((s) => (s ?? '').trim()).filter(Boolean);
  const distinct: string[] = [];
  for (const t of clean) {
    if (t !== distinct[distinct.length - 1]) distinct.push(t);
  }
  const topics = distinct.slice(-6);
  const line = topics.length ? `Récemment, on a parlé de : ${topics.join(' ; ')}.` : '';
  return { at: now, count: clean.length, topics, line };
}

export interface EpisodeDeps {
  now?: number;
  cwd?: string;
  /** How many recent hearing percepts to consolidate. Default 20. */
  limit?: number;
  /** Read recent heard utterances. Default: the companion hearing percepts. */
  readHeard?: (limit: number, cwd?: string) => Promise<string[]>;
  /** Optional LLM refinement of the episode line → null keeps the template. */
  refine?: (heard: string[]) => Promise<string | null>;
  /** Promote the episode to persistent memory. Default: `promoteEpisode`. */
  promote?: (ep: EpisodeSummary) => Promise<void>;
}

async function defaultReadHeard(limit: number, cwd?: string): Promise<string[]> {
  try {
    const { readRecentCompanionPercepts } = await import('../companion/percepts.js');
    const heard = await readRecentCompanionPercepts({ modality: 'hearing', limit, ...(cwd ? { cwd } : {}) });
    return heard
      .map((h) => String((h.payload as { text?: string })?.text ?? h.summary ?? '').replace(/^Heard:\s*/i, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * One episodic-consolidation pass: read recent dialogue, summarize it, append to the episode journal,
 * and promote to persistent memory. Returns the episode, or null when there was nothing to consolidate.
 * Never throws.
 */
export async function runEpisodeConsolidation(deps: EpisodeDeps = {}): Promise<EpisodeSummary | null> {
  const heard = await (deps.readHeard ?? defaultReadHeard)(deps.limit ?? 20, deps.cwd);
  if (heard.length === 0) return null;

  const ep = summarizeEpisode(heard, deps.now ?? Date.now());
  if (!ep.line) return null;

  if (deps.refine) {
    try {
      const refined = await deps.refine(heard);
      if (refined && refined.trim()) ep.line = refined.trim();
    } catch {
      /* keep the template line */
    }
  }

  try {
    const dir = path.join(deps.cwd ?? process.cwd(), '.codebuddy', 'companion');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'episodes.jsonl');
    try {
      const info = await stat(file);
      if (info.size > 512 * 1024) await rename(file, `${file}.1`); // rotate, one backup (disk-guard lesson)
    } catch {
      /* no file yet */
    }
    await appendFile(file, `${JSON.stringify(ep)}\n`, 'utf8');
  } catch (err) {
    logger.warn(`[episode] could not persist episode: ${err instanceof Error ? err.message : String(err)}`);
  }

  await (deps.promote ?? promoteEpisode)(ep);
  logger.info(`[episode] consolidated ${ep.count} utterance(s) → ${ep.topics.length} topic(s)`);
  return ep;
}

/**
 * Promote the episode into persistent memory under a STABLE key (`episode:recent`) so repeated
 * consolidations UPDATE rather than accumulate. Never throws.
 */
export async function promoteEpisode(ep: EpisodeSummary): Promise<void> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    await manager.remember('episode:recent', ep.line, {
      scope: 'project',
      category: 'context',
      tags: ['episode', 'conversation'],
    });
  } catch (err) {
    logger.warn(`[episode] could not promote episode to memory: ${err instanceof Error ? err.message : String(err)}`);
  }
}
