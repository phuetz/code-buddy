/**
 * Dreaming — heartbeat-paced memory consolidation. Every N beats, the short-term
 * sensory buffer is drained and consolidated into a compact "dream" summary
 * (counts by kind, salient events, time window, average load) appended to a
 * long-term dream journal. The heartbeat-paced analogue of OpenClaw's dreaming
 * (short-term recall → consolidated long-term memory).
 *
 * @module sensory/dreaming
 */

import { appendFile, mkdir, stat, rename } from 'fs/promises';
import path from 'path';

import { getSensoryMemory } from './sensory-memory.js';
import { logger } from '../utils/logger.js';
import type { Perception } from './reactions.js';

const SALIENT_THRESHOLD = 128;

export interface DreamSummary {
  dreamedAt: number;
  windowStartMs: number | null;
  windowEndMs: number | null;
  total: number;
  /** "audio/speech_start" → count, "vital/heartbeat" → count, … */
  byKind: Record<string, number>;
  salient: Array<{ modality?: string; kind?: string; salience?: number; tsMs?: number }>;
  avgLoad: number | null;
}

/** Pure consolidation: summarize a window of perceptions into a dream. */
export function consolidate(perceptions: Perception[], now: number): DreamSummary {
  const byKind: Record<string, number> = {};
  const salient: DreamSummary['salient'] = [];
  let loadSum = 0;
  let loadN = 0;
  let minTs: number | null = null;
  let maxTs: number | null = null;

  for (const p of perceptions) {
    const key = `${p.modality}/${p.kind}`;
    byKind[key] = (byKind[key] ?? 0) + 1;
    if ((p.salience ?? 0) >= SALIENT_THRESHOLD) {
      salient.push({ modality: p.modality, kind: p.kind, salience: p.salience, tsMs: p.tsMs });
    }
    const load = (p.payload as { load1?: unknown } | undefined)?.load1;
    if (typeof load === 'number') {
      loadSum += load;
      loadN += 1;
    }
    // Window on the ingest wall-clock (consistent across senses), not the
    // sense-relative tsMs (frame-relative for audio vs unix for vital).
    if (typeof p.receivedAt === 'number') {
      minTs = minTs === null ? p.receivedAt : Math.min(minTs, p.receivedAt);
      maxTs = maxTs === null ? p.receivedAt : Math.max(maxTs, p.receivedAt);
    }
  }

  return {
    dreamedAt: now,
    windowStartMs: minTs,
    windowEndMs: maxTs,
    total: perceptions.length,
    byKind,
    salient: salient.slice(0, 20),
    avgLoad: loadN > 0 ? loadSum / loadN : null,
  };
}

export interface DreamingOptions {
  cwd?: string;
  now?: number;
  /** Injectable promotion (tests); defaults to promoteSalientDream. */
  promote?: (summary: DreamSummary) => Promise<void>;
  /** Injectable forgetting pass (tests); defaults to runForgettingPass. */
  forget?: () => Promise<void>;
  /** Override the CODEBUDDY_MEMORY_FORGET env gate (tests). */
  forgettingEnabled?: boolean;
}

/**
 * One dreaming pass: drain the short-term buffer, consolidate, append to the
 * dream journal, and promote a SALIENT dream into long-term persistent memory.
 * Returns the summary, or null if there was nothing to consolidate.
 */
export async function runDreamingPass(options: DreamingOptions = {}): Promise<DreamSummary | null> {
  const perceptions = getSensoryMemory().drain();
  if (perceptions.length === 0) return null;

  const summary = consolidate(perceptions, options.now ?? Date.now());
  try {
    const dir = path.join(options.cwd ?? process.cwd(), '.codebuddy', 'companion');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'dreams.jsonl');
    // Rotate when large (the disk-guard lesson): keep one .1 backup, never grow unbounded.
    try {
      const info = await stat(file);
      if (info.size > 512 * 1024) await rename(file, `${file}.1`);
    } catch {
      /* no file yet */
    }
    await appendFile(file, `${JSON.stringify(summary)}\n`, 'utf8');
  } catch (err) {
    logger.warn(`[dreaming] could not persist dream: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Deep consolidation — salient dreams become long-term memory the agent reads.
  if (summary.salient.length > 0) {
    await (options.promote ?? promoteSalientDream)(summary);
  }

  // Sleep prunes as well as it consolidates: the Ebbinghaus pass over
  // persistent memory (opt-in — it removes entries, recoverably).
  const forgettingOn = options.forgettingEnabled ?? process.env.CODEBUDDY_MEMORY_FORGET === 'true';
  if (forgettingOn) {
    await (options.forget ?? runForgettingPass)();
  }

  logger.info(
    `[dreaming] consolidated ${summary.total} perception(s) → ${Object.keys(summary.byKind).length} kind(s), ${summary.salient.length} salient, avg load ${summary.avgLoad ?? '?'}`,
  );
  return summary;
}

/**
 * Ebbinghaus forgetting pass over persistent memory (both scopes): what the
 * companion never recalls fades below the retention threshold and is archived
 * (never rm — a sibling `*.archive.md` keeps everything recoverable); what she
 * actually uses is reinforced at recall and survives. Gated behind
 * CODEBUDDY_MEMORY_FORGET=true by the caller. Never throws.
 */
export async function runForgettingPass(): Promise<void> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const { resolveForgettingConfig } = await import('../memory/memory-forgetting.js');
    const manager = getMemoryManager();
    await manager.initialize();
    const config = resolveForgettingConfig();
    const project = await manager.applyForgetting('project', { config });
    const user = await manager.applyForgetting('user', { config });
    const faded = project.forgotten.length + user.forgotten.length;
    if (faded > 0) {
      logger.info(`[dreaming] forgetting pass: ${faded} memories faded (archived, recoverable)`);
    }
  } catch (err) {
    logger.warn(`[dreaming] forgetting pass failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Promote a salient dream into Code Buddy's persistent memory under a STABLE key
 * (`dream:recent`) so repeated promotions UPDATE rather than accumulate (stays
 * within the memory char budget). Never throws.
 */
export async function promoteSalientDream(summary: DreamSummary): Promise<void> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    // Cap the kinds string (a daemon could emit many distinct kinds → an
    // oversized write that the memory char-limit would reject).
    const kindEntries = Object.entries(summary.byKind).sort((a, b) => b[1] - a[1]);
    const kinds =
      kindEntries
        .slice(0, 12)
        .map(([k, n]) => `${k}×${n}`)
        .join(', ') + (kindEntries.length > 12 ? `, +${kindEntries.length - 12} more` : '');
    const top = summary.salient
      .slice(0, 5)
      .map((s) => `${s.modality}/${s.kind}`)
      .join(', ');
    const value = `Recent salient perception: ${summary.total} events (${kinds}); salient: ${top}; avg load ${summary.avgLoad ?? '?'}.`;
    await manager.remember('dream:recent', value, { scope: 'project', category: 'context', tags: ['dream', 'sensory'] });
  } catch (err) {
    logger.warn(`[dreaming] could not promote dream to memory: ${err instanceof Error ? err.message : String(err)}`);
  }
}
