/**
 * Research topics store — the persistent set of subjects the auto-ingest daemon studies.
 *
 * Before this, topics were env-only (`CODEBUDDY_RESEARCH_TOPICS`), so you couldn't manage them
 * without editing the service env. This adds a hand-editable JSON store (`~/.codebuddy/research-topics.json`)
 * that `buddy research topics add|remove|list|clear` administers, and the daemon reads the UNION of
 * the env list and the store — so both keep working and the CLI actually feeds the daemon.
 *
 * Pure file I/O, best-effort, never-throws; path overridable via `CODEBUDDY_RESEARCH_TOPICS_FILE`
 * (keeps tests off the real home dir).
 *
 * @module research/research-topics
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

function defaultStorePath(): string {
  return process.env.CODEBUDDY_RESEARCH_TOPICS_FILE || join(getCodeBuddyHome(), 'research-topics.json');
}

function normalize(topics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of topics) {
    const t = (raw ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue; // case-insensitive dedup, keep first spelling
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Load the persisted topic list (deduped, order-preserving). */
export function loadStoredTopics(storePath = defaultStorePath()): string[] {
  try {
    const data = readJsonAtomicSync<unknown>(storePath, []);
    if (Array.isArray(data)) return normalize(data.filter((t): t is string => typeof t === 'string'));
  } catch {
    /* best effort */
  }
  return [];
}

export function saveStoredTopics(topics: string[], storePath = defaultStorePath()): void {
  try {
    mkdirSync(dirname(storePath), { recursive: true });
    writeJsonAtomicSync(storePath, normalize(topics));
  } catch {
    /* best effort */
  }
}

/** Add topics; returns the resulting full list. */
export function addStoredTopics(topics: string[], storePath = defaultStorePath()): string[] {
  const next = normalize([...loadStoredTopics(storePath), ...topics]);
  saveStoredTopics(next, storePath);
  return next;
}

/** Remove topics (case-insensitive); returns the resulting list. */
export function removeStoredTopics(topics: string[], storePath = defaultStorePath()): string[] {
  const drop = new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const next = loadStoredTopics(storePath).filter((t) => !drop.has(t.toLowerCase()));
  saveStoredTopics(next, storePath);
  return next;
}

export function clearStoredTopics(storePath = defaultStorePath()): void {
  saveStoredTopics([], storePath);
}

/**
 * The effective topics the daemon should study: the UNION of the env `CODEBUDDY_RESEARCH_TOPICS`
 * list and the persisted store (deduped). Either source alone works.
 */
export function resolveResearchTopics(
  env: NodeJS.ProcessEnv = process.env,
  storePath = defaultStorePath(),
): string[] {
  const fromEnv = (env.CODEBUDDY_RESEARCH_TOPICS ?? '').split(',');
  return normalize([...fromEnv, ...loadStoredTopics(storePath)]);
}
