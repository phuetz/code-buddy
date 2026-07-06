/**
 * Git Merge Conflict Resolver Tool
 *
 * Parses Git merge conflict markers, provides strategy-based resolution
 * (ours, theirs, both, ai), and exposes a tool for the agent to use.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ConflictRegion {
  filePath: string;
  startLine: number;
  endLine: number;
  ours: string;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
}

export type ConflictStrategy = 'ours' | 'theirs' | 'both' | 'ai';

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse all conflict regions from a file's content.
 * Detects <<<<<<< / ======= / >>>>>>> marker triplets.
 */
export function parseConflicts(fileContent: string, filePath = ''): ConflictRegion[] {
  const lines = fileContent.split('\n');
  const conflicts: ConflictRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    const startLineText = lines[i] ?? '';
    const startMatch = startLineText.match(/^<{7}\s*(.*)/);
    if (!startMatch) {
      i++;
      continue;
    }

    const startLine = i + 1; // 1-indexed
    const oursLabel = (startMatch[1] ?? '').trim() || 'HEAD';
    const oursLines: string[] = [];
    i++;

    // Collect "ours" lines until =======
    while (i < lines.length) {
      const oursLine = lines[i] ?? '';
      if (oursLine.startsWith('=======')) break;
      oursLines.push(oursLine);
      i++;
    }

    if (i >= lines.length) break; // malformed — no separator found
    i++; // skip =======

    // Collect "theirs" lines until >>>>>>>
    const theirsLines: string[] = [];
    let theirsLabel = '';

    while (i < lines.length) {
      const theirsLine = lines[i] ?? '';
      const endMatch = theirsLine.match(/^>{7}\s*(.*)/);
      if (endMatch) {
        theirsLabel = (endMatch[1] ?? '').trim() || 'incoming';
        break;
      }
      theirsLines.push(theirsLine);
      i++;
    }

    if (i >= lines.length) break; // malformed — no end marker

    const endLine = i + 1; // 1-indexed, inclusive
    i++; // move past >>>>>>>

    conflicts.push({
      filePath,
      startLine,
      endLine,
      ours: oursLines.join('\n'),
      theirs: theirsLines.join('\n'),
      oursLabel,
      theirsLabel,
    });
  }

  return conflicts;
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve a single conflict region using the given strategy (non-AI).
 */
export function resolveConflict(
  region: ConflictRegion,
  strategy: 'ours' | 'theirs' | 'both',
): string {
  switch (strategy) {
    case 'ours':
      return region.ours;
    case 'theirs':
      return region.theirs;
    case 'both':
      return region.ours + '\n' + region.theirs;
    default:
      return region.ours;
  }
}

/**
 * Resolve all conflicts in a file.
 *
 * @param filePath  - Path to the file with conflict markers
 * @param strategy  - Resolution strategy (ours|theirs|both|ai)
 * @param llmCall   - Optional async LLM call for 'ai' strategy.
 *                    Receives a prompt string, returns the resolved text.
 */
export async function resolveAllConflicts(
  filePath: string,
  strategy: ConflictStrategy = 'ours',
  llmCall?: (prompt: string) => Promise<string>,
): Promise<{ resolved: number; content: string }> {
  const absolutePath = path.resolve(filePath);
  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  const conflicts = parseConflicts(fileContent, absolutePath);

  if (conflicts.length === 0) {
    return { resolved: 0, content: fileContent };
  }

  const lines = fileContent.split('\n');
  // Process conflicts in reverse order so line indices remain stable
  const sorted = [...conflicts].sort((a, b) => b.startLine - a.startLine);

  for (const conflict of sorted) {
    let replacement: string;

    if (strategy === 'ai' && llmCall) {
      // Build context: 5 lines before and after the conflict region
      const contextBefore = lines
        .slice(Math.max(0, conflict.startLine - 6), conflict.startLine - 1)
        .join('\n');
      const contextAfter = lines
        .slice(conflict.endLine, Math.min(lines.length, conflict.endLine + 5))
        .join('\n');

      const prompt = [
        'Resolve this Git merge conflict by producing the correct merged code.',
        'Only output the merged code, no explanations or markers.',
        '',
        '--- Context before ---',
        contextBefore,
        '',
        `--- Ours (${conflict.oursLabel}) ---`,
        conflict.ours,
        '',
        `--- Theirs (${conflict.theirsLabel}) ---`,
        conflict.theirs,
        '',
        '--- Context after ---',
        contextAfter,
        '',
        'Merged result:',
      ].join('\n');

      try {
        replacement = await llmCall(prompt);
      } catch (_err) {
        logger.warn('AI conflict resolution failed, falling back to ours');
        replacement = resolveConflict(conflict, 'ours');
      }
    } else {
      replacement = resolveConflict(conflict, strategy === 'ai' ? 'ours' : strategy);
    }

    // Replace lines [startLine-1 .. endLine-1] (0-indexed) with replacement
    const replacementLines = replacement.split('\n');
    lines.splice(conflict.startLine - 1, conflict.endLine - conflict.startLine + 1, ...replacementLines);
  }

  const resolvedContent = lines.join('\n');
  return { resolved: conflicts.length, content: resolvedContent };
}

// ============================================================================
// Tool Entry Point
// ============================================================================

/**
 * Execute the resolve_conflicts tool.
 */
export async function executeResolveConflicts(args: {
  file_path?: string;
  strategy?: ConflictStrategy;
  scan_only?: boolean;
}): Promise<ToolResult> {
  try {
    const cwd = process.cwd();

    // If no file specified, scan for all conflicted files
    if (!args.file_path || args.scan_only) {
      return scanForConflicts(cwd);
    }

    const filePath = path.resolve(cwd, args.file_path);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const conflicts = parseConflicts(fileContent, filePath);

    if (conflicts.length === 0) {
      return { success: true, output: `No merge conflicts found in ${args.file_path}` };
    }

    const strategy = args.strategy || 'ours';

    if (strategy === 'ai') {
      // In tool mode, we can't do AI resolution without an injected LLM call
      // Return conflict details so the agent can handle it
      const details = conflicts.map((c, i) =>
        `Conflict ${i + 1} (lines ${c.startLine}-${c.endLine}):\n` +
        `  Ours (${c.oursLabel}):\n${indent(c.ours)}\n` +
        `  Theirs (${c.theirsLabel}):\n${indent(c.theirs)}`
      ).join('\n\n');

      return {
        success: true,
        output: `Found ${conflicts.length} conflict(s) in ${args.file_path}:\n\n${details}\n\n` +
          'Use strategy "ours", "theirs", or "both" to resolve automatically, ' +
          'or resolve manually using str_replace_editor.',
      };
    }

    const result = await resolveAllConflicts(filePath, strategy);
    fs.writeFileSync(filePath, result.content, 'utf-8');

    return {
      success: true,
      output: `Resolved ${result.resolved} conflict(s) in ${args.file_path} using strategy "${strategy}".`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`resolve_conflicts error: ${msg}`);
    return { success: false, error: `Failed to resolve conflicts: ${msg}` };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function indent(text: string, prefix = '    '): string {
  return text.split('\n').map(l => prefix + l).join('\n');
}

/**
 * Scan the project for files containing merge conflict markers.
 */
function scanForConflicts(cwd: string): ToolResult {
  try {
    const { execSync } = require('child_process');
    const output = execSync(
      'git diff --name-only --diff-filter=U',
      { cwd, encoding: 'utf-8', timeout: 10000 },
    ).trim();

    if (!output) {
      return { success: true, output: 'No files with merge conflicts found.' };
    }

    const files = output.split('\n').filter(Boolean);
    const summaries: string[] = [];

    for (const file of files) {
      const fullPath = path.join(cwd, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const conflicts = parseConflicts(content, fullPath);
        summaries.push(`  ${file}: ${conflicts.length} conflict(s)`);
      } catch {
        summaries.push(`  ${file}: (unable to read)`);
      }
    }

    return {
      success: true,
      output: `Files with merge conflicts:\n${summaries.join('\n')}`,
    };
  } catch {
    // Fallback: not in a git repo or git not available
    return { success: true, output: 'Unable to scan for conflicts (git not available or not in a repository).' };
  }
}
