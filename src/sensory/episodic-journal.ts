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

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import path from 'path';
import { readRecentDialogueHearing } from '../companion/dialogue-percepts.js';
import {
  analyzeConversationTurn,
  extractSalientTerms,
} from '../conversation/dialogue-act.js';
import type { ConversationTurn } from '../conversation/types.js';
import { logger } from '../utils/logger.js';

export interface EpisodeSummary {
  at: number;
  /** Total non-empty utterances considered. */
  count: number;
  /** The distinct recent utterances (a proxy for topics without an LLM). */
  topics: string[];
  /** The injectable/spoken summary line, '' when there was nothing worth summarizing. */
  line: string;
  /** Structured continuity cues extracted from a complete user/Lisa thread. */
  corrections?: string[];
  commitments?: string[];
  openLoops?: string[];
  lastUserPoint?: string;
  lastAssistantPosition?: string;
  fingerprint?: string;
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

function safeExcerpt(text: string, limit = 240): string {
  return text
    .replace(/[<>]/g, (character) => (character === '<' ? '‹' : '›'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function topFocusTerms(turns: ConversationTurn[], limit = 6): string[] {
  const scores = new Map<string, number>();
  turns.forEach((turn, index) => {
    const recency = 1 + index / Math.max(1, turns.length);
    for (const term of extractSalientTerms(turn.content, 8)) {
      scores.set(term, (scores.get(term) ?? 0) + recency);
    }
  });
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function lastMatching(
  turns: ConversationTurn[],
  predicate: (turn: ConversationTurn, index: number) => boolean,
  limit: number
): string[] {
  return turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn, index }) => predicate(turn, index))
    .slice(-limit)
    .map(({ turn }) => safeExcerpt(turn.content));
}

/** Build a compact "where we were" memory from both sides of the conversation. */
export function summarizeConversationEpisode(
  sourceTurns: ConversationTurn[],
  now: number
): EpisodeSummary {
  const turns = sourceTurns
    .map((turn) => ({ role: turn.role, content: turn.content.trim() }) satisfies ConversationTurn)
    .filter((turn) => turn.content)
    .slice(-40);
  if (turns.length === 0) return { at: now, count: 0, topics: [], line: '' };

  const topics = topFocusTerms(turns);
  const corrections = lastMatching(
    turns,
    (turn, index) =>
      turn.role === 'user' && analyzeConversationTurn(turn.content, turns.slice(0, index)).act === 'correction',
    2
  );
  const commitments = lastMatching(
    turns,
    (turn) =>
      /\b(je vais|nous allons|on va|je m engage|prochaine etape|prochaine étape|il faudra|reste a|reste à)\b/i.test(
        turn.content
      ),
    3
  );
  const openLoops = lastMatching(
    turns,
    (turn, index) => {
      if (/\b(plus tard|on en reparle|a reprendre|à reprendre|a suivre|à suivre)\b/i.test(turn.content)) {
        return true;
      }
      return index === turns.length - 1 && /\?\s*$/.test(turn.content);
    },
    3
  );
  const lastUserPoint = [...turns].reverse().find((turn) => turn.role === 'user')?.content;
  const lastAssistantPosition = [...turns]
    .reverse()
    .find((turn) => turn.role === 'assistant')?.content;
  const parts = [
    topics.length
      ? `Récemment, notre conversation portait surtout sur : ${topics.join(', ')}.`
      : '',
    lastUserPoint ? `Dernier point de l'utilisateur : ${safeExcerpt(lastUserPoint)}.` : '',
    lastAssistantPosition
      ? `Dernière position de Lisa : ${safeExcerpt(lastAssistantPosition)}.`
      : '',
    corrections.length ? `Correction à respecter : ${corrections.at(-1)}.` : '',
    commitments.length ? `Engagement ou prochaine étape : ${commitments.at(-1)}.` : '',
    openLoops.length ? `Point encore ouvert : ${openLoops.at(-1)}.` : '',
  ].filter(Boolean);
  const line = parts.join(' ');
  return {
    at: now,
    count: turns.length,
    topics,
    line,
    corrections,
    commitments,
    openLoops,
    ...(lastUserPoint ? { lastUserPoint: safeExcerpt(lastUserPoint) } : {}),
    ...(lastAssistantPosition
      ? { lastAssistantPosition: safeExcerpt(lastAssistantPosition) }
      : {}),
  };
}

export interface EpisodeDeps {
  now?: number;
  cwd?: string;
  /** How many recent hearing percepts to consolidate. Default 20. */
  limit?: number;
  /** Read recent heard utterances. Default: the companion hearing percepts. */
  readHeard?: (limit: number, cwd?: string) => Promise<string[]>;
  /** Prefer a complete cross-channel user/Lisa thread when available. */
  readConversation?: (limit: number) => Promise<ConversationTurn[]>;
  /** Optional LLM refinement of the episode line → null keeps the template. */
  refine?: (heard: string[]) => Promise<string | null>;
  /** Promote the episode to persistent memory. Default: `promoteEpisode`. */
  promote?: (ep: EpisodeSummary) => Promise<void>;
  /** Override the deduplication cursor in tests. */
  statePath?: string;
}

async function defaultReadHeard(limit: number, cwd?: string): Promise<string[]> {
  return readRecentDialogueHearing(limit, cwd);
}

/**
 * One episodic-consolidation pass: read recent dialogue, summarize it, append to the episode journal,
 * and promote to persistent memory. Returns the episode, or null when there was nothing to consolidate.
 * Never throws.
 */
export async function runEpisodeConsolidation(deps: EpisodeDeps = {}): Promise<EpisodeSummary | null> {
  const limit = deps.limit ?? 20;
  const now = deps.now ?? Date.now();
  const conversation = deps.readConversation ? await deps.readConversation(limit) : [];
  const heard =
    conversation.length > 0
      ? conversation.filter((turn) => turn.role === 'user').map((turn) => turn.content)
      : await (deps.readHeard ?? defaultReadHeard)(limit, deps.cwd);
  if (conversation.length === 0 && heard.length === 0) return null;

  const ep = conversation.length > 0
    ? summarizeConversationEpisode(conversation, now)
    : summarizeEpisode(heard, now);
  if (!ep.line) return null;

  if (deps.refine) {
    try {
      const refined = await deps.refine(heard);
      if (refined && refined.trim()) ep.line = refined.trim();
    } catch {
      /* keep the template line */
    }
  }

  ep.fingerprint = createHash('sha256').update(ep.line).digest('hex');
  const dir = path.join(deps.cwd ?? process.cwd(), '.codebuddy', 'companion');
  const statePath = deps.statePath ?? path.join(dir, 'episode-state.json');
  try {
    const previous = JSON.parse(await readFile(statePath, 'utf8')) as { fingerprint?: unknown };
    if (previous.fingerprint === ep.fingerprint) return null;
  } catch {
    /* First episode or unreadable cursor: continue with a safe rebuild. */
  }

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'episodes.jsonl');
    try {
      const info = await stat(file);
      if (info.size > 512 * 1024) await rename(file, `${file}.1`); // rotate, one backup (disk-guard lesson)
    } catch {
      /* no file yet */
    }
    await appendFile(file, `${JSON.stringify(ep)}\n`, { encoding: 'utf8', mode: 0o600 });
    await writeFile(statePath, JSON.stringify({ fingerprint: ep.fingerprint, at: ep.at }), {
      encoding: 'utf8',
      mode: 0o600,
    });
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
