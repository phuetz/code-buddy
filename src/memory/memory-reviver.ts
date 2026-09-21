/**
 * Memory Reviver — turns the skeleton CODEBUDDY_MEMORY.md and the per-agent
 * MEMORY.md files (full of "done" placeholders) into living, queryable memory.
 *
 * - Scans agent MEMORY.md files, drops empty "done" entries, keeps real ones.
 * - Promotes high-value facts into CODEBUDDY_MEMORY.md under the right section.
 * - Writes a compact memory_summary.md for system-prompt injection.
 * - Idempotent: safe to run after every session or on a cron tick.
 *
 * @module memory/memory-reviver
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';

const CODEBUDDY_DIR = '.codebuddy';
const GLOBAL_MEMORY = 'CODEBUDDY_MEMORY.md';
const AGENT_MEMORY_DIR = 'agent-memory';
const SUMMARY_FILE = 'memory_summary.md';
const MEMORY_SUBDIR = 'memory';

export interface ReviverOptions {
  workDir?: string;
  maxSummaryChars?: number;
  dropDonePlaceholders?: boolean;
}

const DEFAULTS = { maxSummaryChars: 1500, dropDonePlaceholders: true };

function globalMemoryPath(cwd: string) {
  return path.join(cwd, CODEBUDDY_DIR, GLOBAL_MEMORY);
}
function agentDir(cwd: string) {
  return path.join(cwd, CODEBUDDY_DIR, AGENT_MEMORY_DIR);
}
function summaryPath(cwd: string) {
  return path.join(cwd, CODEBUDDY_DIR, MEMORY_SUBDIR, SUMMARY_FILE);
}

/** True when an agent MEMORY.md entry is just an empty placeholder. */
export function isPlaceholderEntry(block: string): boolean {
  const body = block.replace(/^##\s*\S+\s*\n/, '').trim();
  return body.length === 0 || /^done\s*$/i.test(body);
}

/**
 * Read an agent MEMORY.md and return only the non-placeholder entries,
 * grouped by date heading.
 */
export function extractRealEntries(content: string): Array<{ date: string; text: string }> {
  const out: Array<{ date: string; text: string }> = [];
  const parts = content.split(/(?=^##\s+)/m);
  for (const part of parts) {
    const m = part.match(/^##\s*(\S+)\s*\n([\s\S]*)$/);
    if (!m) continue;
    const date = m[1];
    const text = m[2].trim();
    if (!text || /^done\s*$/i.test(text)) continue;
    out.push({ date, text });
  }
  return out;
}

export interface ReviveResult {
  agentsScanned: number;
  realEntriesFound: number;
  promoted: number;
  placeholdersDropped: number;
  summaryWritten: boolean;
}

/**
 * Revive memory: clean agent files, promote facts, write a summary.
 * Idempotent across runs.
 */
export function reviveMemory(options: ReviverOptions = {}): ReviveResult {
  const cwd = options.workDir ?? process.cwd();
  const drop = options.dropDonePlaceholders ?? DEFAULTS.dropDonePlaceholders;
  const maxSummary = options.maxSummaryChars ?? DEFAULTS.maxSummaryChars;

  const result: ReviveResult = {
    agentsScanned: 0,
    realEntriesFound: 0,
    promoted: 0,
    placeholdersDropped: 0,
    summaryWritten: false,
  };

  const aDir = agentDir(cwd);
  const allReal: Array<{ date: string; text: string; agent: string }> = [];

  if (fs.existsSync(aDir)) {
    for (const entry of fs.readdirSync(aDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const memFile = path.join(aDir, entry.name, 'MEMORY.md');
      if (!fs.existsSync(memFile)) continue;
      result.agentsScanned++;
      const content = readTextAtomicSync(memFile, '');
      const real = extractRealEntries(content);
      result.realEntriesFound += real.length;
      for (const r of real) allReal.push({ ...r, agent: entry.name });

      if (drop) {
        const cleaned = ['# Agent Memory — ' + entry.name, '', ...real.map((r) => `## ${r.date}\n\n${r.text}`)].join('\n');
        const originalBlocks = content.split(/(?=^##\s+)/m).filter((b) => b.trim());
        result.placeholdersDropped += originalBlocks.length - real.length;
        writeFileAtomicSync(memFile, cleaned + '\n', { mode: 0o600 });
      }
    }
  }

  // Promote into global CODEBUDDY_MEMORY.md under ## Custom
  const gPath = globalMemoryPath(cwd);
  let global = readTextAtomicSync(gPath, '');
  if (!global.includes('## Custom')) {
    global += '\n## Custom\n';
  }
  const existingCustom = new Set(
    (global.split('## Custom')[1] ?? '')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean),
  );
  const toPromote = allReal.filter((r) => !existingCustom.has(r.text.toLowerCase()));
  if (toPromote.length > 0) {
    const block = toPromote.map((r) => `- [${r.agent} · ${r.date}] ${r.text}`).join('\n');
    global = global.replace(/## Custom\s*\n/, `## Custom\n${block}\n`);
    writeFileAtomicSync(gPath, global, { mode: 0o600 });
    result.promoted = toPromote.length;
  }

  // Write compact summary for prompt injection
  const memDir = path.join(cwd, CODEBUDDY_DIR, MEMORY_SUBDIR);
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  const facts = allReal.slice(-12).map((r) => `- ${r.text}`);
  const summary = ['# Memory Summary', '', 'Living memory (revived):', ...facts, ''].join('\n');
  writeFileAtomicSync(summaryPath(cwd), summary.substring(0, maxSummary), { mode: 0o600 });
  result.summaryWritten = true;

  logger.info('Memory revived', result);
  return result;
}

export function loadRevivedSummary(workDir: string = process.cwd()): string | null {
  const p = summaryPath(workDir);
  const c = readTextAtomicSync(p, '');
  return c || null;
}
