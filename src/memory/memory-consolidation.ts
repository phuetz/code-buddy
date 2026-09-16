/**
 * Session Memory Consolidation — Two-Phase Pipeline
 *
 * Phase 1: Extract memories from session traces (rollout JSONL)
 * Phase 2: Consolidate into progressive-disclosure folder structure
 *
 * Folder structure:
 *   .codebuddy/memory/
 *     memory_summary.md    — Always loaded into system prompt (< 500 chars)
 *     MEMORY.md            — Detailed handbook entries
 *     rollout_summaries/   — Per-session distilled summaries
 *
 * Inspired by OpenAI Codex CLI's memory_trace.rs + consolidation template.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export interface ExtractedMemory {
  /** Unique memory ID */
  id: string;
  /** Source session/rollout path */
  source: string;
  /** Raw extracted fact */
  raw: string;
  /** One-line summary */
  summary: string;
  /** Category: preference, pattern, context, decision */
  category: 'preference' | 'pattern' | 'context' | 'decision';
  /** Extraction timestamp */
  timestamp: string;
}

export interface ConsolidationResult {
  /** Number of new memories added */
  memoriesAdded: number;
  /** Number of existing memories updated */
  memoriesUpdated: number;
  /** Number of duplicates skipped */
  duplicatesSkipped: number;
  /** Path to the memory directory */
  memoryDir: string;
}

// ============================================================================
// Phase 1: Extraction
// ============================================================================

/** Patterns indicating memorable content in conversation */
const MEMORY_SIGNALS = [
  /(?:prefer|always|never|don't|do not|please)\s+/i,
  /(?:remember|note|important|convention|rule|pattern)\s*:/i,
  /(?:we use|our convention|our pattern|the team)\s+/i,
  /(?:this project|this repo|this codebase)\s+/i,
  /(?:correct(?:ion)?|actually|instead|not that)\s*[,:]?\s+/i,
];

/**
 * Extract memorable content from conversation messages.
 * Simulates Phase 1 — finds user corrections, preferences, and patterns.
 */
export function extractMemoriesFromMessages(
  messages: Array<{ role: string; content: string }>,
  source: string = 'session',
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  let idCounter = 0;

  for (const msg of messages) {
    if (msg.role !== 'user' || !msg.content) continue;

    // Check for memory signals
    for (const signal of MEMORY_SIGNALS) {
      if (signal.test(msg.content)) {
        // Extract the relevant sentence (up to 200 chars around the match)
        const match = msg.content.match(signal);
        if (!match) continue;

        const matchIdx = msg.content.indexOf(match[0]);
        const sentenceStart = Math.max(0, msg.content.lastIndexOf('.', matchIdx) + 1);
        const sentenceEnd = msg.content.indexOf('.', matchIdx + match[0].length);
        const raw = msg.content.substring(
          sentenceStart,
          sentenceEnd > 0 ? sentenceEnd + 1 : Math.min(msg.content.length, matchIdx + 200),
        ).trim();

        if (raw.length < 10 || raw.length > 500) continue;

        // Categorize
        let category: ExtractedMemory['category'] = 'context';
        if (/prefer|always|never|don't/i.test(raw)) category = 'preference';
        if (/pattern|convention|we use/i.test(raw)) category = 'pattern';
        if (/correct|actually|instead/i.test(raw)) category = 'decision';

        memories.push({
          id: `mem-${Date.now()}-${idCounter++}`,
          source,
          raw,
          summary: raw.substring(0, 100) + (raw.length > 100 ? '...' : ''),
          category,
          timestamp: new Date().toISOString(),
        });

        break; // One memory per message
      }
    }
  }

  return memories;
}

/**
 * Extract memories from a rollout or a persisted session payload.
 *
 * Rollouts are commonly represented as JSONL, while SessionStore persists a
 * JSON object containing a `messages` array. Supporting both shapes keeps the
 * background worker independent from the session persistence format.
 */
export function extractMemoriesFromRollout(
  rollout: unknown,
  source: string = 'rollout',
): ExtractedMemory[] {
  let payload: unknown = rollout;

  if (typeof rollout === 'string') {
    let contents = rollout;
    try {
      if (fs.existsSync(rollout)) {
        contents = fs.readFileSync(rollout, 'utf8');
        source = rollout;
      }
    } catch {
      // Treat the input as rollout content when a path cannot be read.
    }
    try {
      payload = JSON.parse(contents);
    } catch {
      payload = contents
        .split(/\r?\n/)
        .filter(line => line.trim())
        .flatMap(line => {
          try {
            return [JSON.parse(line) as unknown];
          } catch {
            return [];
          }
        });
    }
  }

  const rawMessages = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.messages)
      ? payload.messages
      : [];
  const messages = rawMessages.flatMap(message => {
    if (!isRecord(message) || typeof message.content !== 'string') {
      return [];
    }

    const role = typeof message.role === 'string'
      ? message.role
      : typeof message.type === 'string'
        ? message.type
        : null;
    return role ? [{ role, content: message.content }] : [];
  });

  return extractMemoriesFromMessages(messages, source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================================================
// Phase 2: Consolidation
// ============================================================================

const MEMORY_DIR = '.codebuddy/memory';
const SUMMARY_FILE = 'memory_summary.md';
const MEMORY_FILE = 'MEMORY.md';
const ROLLOUT_DIR = 'rollout_summaries';

/**
 * Consolidate extracted memories into the progressive-disclosure folder.
 */
export function consolidateMemories(
  newMemories: ExtractedMemory[],
  cwd: string = process.cwd(),
): ConsolidationResult {
  const memDir = path.join(cwd, MEMORY_DIR);
  const rolloutDir = path.join(memDir, ROLLOUT_DIR);

  // Ensure directories exist
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  if (!fs.existsSync(rolloutDir)) fs.mkdirSync(rolloutDir, { recursive: true });

  // Load existing memories
  const memoryFilePath = path.join(memDir, MEMORY_FILE);
  const existingContent = readTextAtomicSync(memoryFilePath, '');

  const existingLines = new Set(
    existingContent.split('\n')
      .filter(l => l.startsWith('- '))
      .map(l => l.slice(2).trim().toLowerCase()),
  );

  let memoriesAdded = 0;
  let duplicatesSkipped = 0;
  const newEntries: string[] = [];

  for (const mem of newMemories) {
    // Deduplicate by summary similarity
    const normalized = mem.summary.toLowerCase().trim();
    if (existingLines.has(normalized)) {
      duplicatesSkipped++;
      continue;
    }

    // Check for word-overlap dedup (more robust than substring prefix)
    let isDuplicate = false;
    const words = new Set(normalized.split(/\s+/).filter(w => w.length > 3));
    for (const existing of existingLines) {
      const existingWords = existing.split(/\s+/).filter(w => w.length > 3);
      const overlap = existingWords.filter(w => words.has(w)).length;
      // If >60% of words overlap, consider it a duplicate
      if (existingWords.length > 0 && overlap / existingWords.length > 0.6) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) {
      duplicatesSkipped++;
      continue;
    }

    newEntries.push(`- [${mem.category}] ${mem.raw}`);
    existingLines.add(normalized);
    memoriesAdded++;
  }

  // Append new entries to MEMORY.md with file lock
  if (newEntries.length > 0) {
    const section = `\n## Session ${new Date().toISOString().split('T')[0]}\n\n${newEntries.join('\n')}\n`;
    const lockPath = memoryFilePath + '.lock';
    try {
      // Atomic lock: O_EXCL fails if file exists
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      try {
        fs.appendFileSync(memoryFilePath, section, { encoding: 'utf8', mode: 0o600 });
      } finally {
        try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
      }
    } catch {
      // Lock failed (another process writing) — append anyway (appendFileSync is atomic on most OS for small writes)
      fs.appendFileSync(memoryFilePath, section, { encoding: 'utf8', mode: 0o600 });
    }
  }

  // Update summary (first 500 chars of key facts)
  const summaryPath = path.join(memDir, SUMMARY_FILE);
  const allMemories = existingContent + '\n' + newEntries.join('\n');
  const preferences = allMemories.split('\n')
    .filter(l => l.includes('[preference]') || l.includes('[pattern]'))
    .slice(-10)
    .join('\n');
  if (preferences.trim()) {
    const summaryContent = `# Memory Summary\n\nKey preferences and patterns:\n${preferences}\n`;
    writeFileAtomicSync(summaryPath, summaryContent.substring(0, 2000), { mode: 0o600 });
  }

  // Write rollout summary
  const firstMemory = newMemories[0];
  if (firstMemory) {
    const slug = new Date().toISOString().replace(/[:.]/g, '-');
    const rolloutPath = path.join(rolloutDir, `${slug}.md`);
    const rolloutContent = [
      `# Rollout Summary: ${slug}`,
      ``,
      `Source: ${firstMemory.source}`,
      `Extracted: ${newMemories.length} memories`,
      ``,
      ...newMemories.map(m => `- [${m.category}] ${m.summary}`),
    ].join('\n');
    writeFileAtomicSync(rolloutPath, rolloutContent, { mode: 0o600 });

    // Prune old rollout summaries (keep last 30)
    try {
      const summaries = fs.readdirSync(rolloutDir).sort();
      if (summaries.length > 30) {
        for (const old of summaries.slice(0, summaries.length - 30)) {
          fs.unlinkSync(path.join(rolloutDir, old));
        }
      }
    } catch { /* best effort */ }
  }

  logger.debug(`Memory consolidation: +${memoriesAdded}, =${duplicatesSkipped} dupes`);

  return {
    memoriesAdded,
    memoriesUpdated: 0,
    duplicatesSkipped,
    memoryDir: memDir,
  };
}

/**
 * Load the memory summary for system prompt injection.
 * Returns null if no summary exists.
 */
export function loadMemorySummary(cwd: string = process.cwd()): string | null {
  const summaryPath = path.join(cwd, MEMORY_DIR, SUMMARY_FILE);
  const content = readTextAtomicSync(summaryPath, '');
  return content || null;
}
