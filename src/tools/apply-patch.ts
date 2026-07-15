/**
 * apply_patch Tool — Codex-style patch format
 *
 * Parses and applies patches in the *** Begin Patch / *** End Patch format.
 * Simpler than unified diff for LLM-generated edits.
 *
 * Format:
 *   *** Begin Patch
 *   *** Add File: path
 *   +line1
 *   +line2
 *   *** Delete File: path
 *   *** Update File: path
 *   @@ optional context header
 *    context line (space prefix)
 *   -removed line
 *   +added line
 *   *** End Patch
 *
 * Uses 4-pass seek_sequence for fuzzy matching:
 *   1. Exact byte match
 *   2. Trailing whitespace tolerance
 *   3. Full trim (leading + trailing)
 *   4. Unicode normalization (typographic → ASCII)
 *
 * Inspired by OpenAI Codex CLI's apply-patch crate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { WorkspaceIsolation } from '../workspace/workspace-isolation.js';
import { maybeReviewGatedWrite } from './review-gate-helper.js';

// ============================================================================
// Types
// ============================================================================

interface FileOp {
  type: 'add' | 'delete' | 'update';
  path: string;
  moveTo?: string;
  hunks?: Hunk[];
  content?: string;
}

interface Hunk {
  header?: string;
  oldLines: string[];
  newLines: string[];
}

interface PatchResult {
  filesAdded: string[];
  filesDeleted: string[];
  filesUpdated: string[];
  errors: string[];
}

// ============================================================================
// Unicode Normalization (Pass 4)
// ============================================================================

function normalizeUnicode(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2002\u2003\u2009]/g, ' ');
}

// ============================================================================
// 4-Pass seek_sequence Algorithm
// ============================================================================

/**
 * Find a sequence of lines in the source, starting from startIndex.
 * Tries 4 matching strategies with decreasing strictness.
 *
 * @returns The index where the pattern starts, or -1 if not found.
 */
export function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number = 0,
): number {
  if (pattern.length === 0) return startIndex;
  if (startIndex + pattern.length > lines.length) return -1;

  // Pass 1: Exact match
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const patVal = pattern[j];
      if (lineVal === undefined || patVal === undefined || lineVal !== patVal) { match = false; break; }
    }
    if (match) return i;
  }

  // Pass 2: Trailing whitespace tolerance
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const patVal = pattern[j];
      if (lineVal === undefined || patVal === undefined || lineVal.trimEnd() !== patVal.trimEnd()) { match = false; break; }
    }
    if (match) return i;
  }

  // Pass 3: Full trim (leading + trailing)
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const patVal = pattern[j];
      if (lineVal === undefined || patVal === undefined || lineVal.trim() !== patVal.trim()) { match = false; break; }
    }
    if (match) return i;
  }

  // Pass 4: Unicode normalization
  const normalizedPattern = pattern.map(l => normalizeUnicode(l).trim());
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const lineVal = lines[i + j];
      const normPat = normalizedPattern[j];
      if (lineVal === undefined || normPat === undefined || normalizeUnicode(lineVal).trim() !== normPat) { match = false; break; }
    }
    if (match) return i;
  }

  return -1;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a patch string into FileOp operations.
 */
export function parsePatch(patchText: string): FileOp[] {
  const ops: FileOp[] = [];

  let text = patchText.trim();
  // Strip heredoc wrappers (GPT sometimes wraps in <<'EOF'...EOF)
  text = text.replace(/^<<['"]?EOF['"]?\s*\n/i, '').replace(/\nEOF\s*$/i, '');

  const beginIdx = text.indexOf('*** Begin Patch');
  const endIdx = text.indexOf('*** End Patch');
  if (beginIdx < 0) return ops;

  const body = text.substring(
    text.indexOf('\n', beginIdx) + 1,
    endIdx >= 0 ? endIdx : undefined,
  );

  const lines = body.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) { i++; continue; }

    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim();
      const contentLines: string[] = [];
      i++;
      let addLine = lines[i];
      while (i < lines.length && addLine !== undefined && !addLine.startsWith('***') && !addLine.startsWith('@@')) {
        if (addLine.startsWith('+')) {
          contentLines.push(addLine.slice(1));
        }
        i++;
        addLine = lines[i];
      }
      ops.push({ type: 'add', path: filePath, content: contentLines.join('\n') });

    } else if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim();
      ops.push({ type: 'delete', path: filePath });
      i++;

    } else if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim();
      let moveTo: string | undefined;
      i++;

      const moveLine = lines[i];
      if (i < lines.length && moveLine !== undefined && moveLine.startsWith('*** Move to: ')) {
        moveTo = moveLine.slice('*** Move to: '.length).trim();
        i++;
      }

      const hunks: Hunk[] = [];
      let hunkLine = lines[i];
      while (i < lines.length && hunkLine !== undefined && !hunkLine.startsWith('*** ')) {
        if (hunkLine.startsWith('@@')) {
          const header = hunkLine.slice(2).trim() || undefined;
          i++;
          const oldLines: string[] = [];
          const newLines: string[] = [];

          let l = lines[i];
          while (i < lines.length && l !== undefined && !l.startsWith('@@') && !l.startsWith('*** ')) {
            if (l.startsWith(' ')) {
              oldLines.push(l.slice(1));
              newLines.push(l.slice(1));
            } else if (l.startsWith('-')) {
              oldLines.push(l.slice(1));
            } else if (l.startsWith('+')) {
              newLines.push(l.slice(1));
            }
            i++;
            l = lines[i];
          }
          hunks.push({ header, oldLines, newLines });
        } else {
          i++;
        }
        hunkLine = lines[i];
      }
      ops.push({ type: 'update', path: filePath, moveTo, hunks });

    } else {
      i++;
    }
  }

  return ops;
}

// ============================================================================
// Dry-run compute (review gate)
// ============================================================================

export interface ComputedPatch {
  /** Full resulting content per touched path (null = delete) — review-gate input. */
  changes: Array<{ path: string; newContent: string | null }>;
  errors: string[];
}

interface ResolvedPatchPaths {
  source: string;
  destination?: string;
}

interface PatchPathPreflight {
  paths: ResolvedPatchPaths[];
  errors: string[];
}

/**
 * Resolve every patch target against the canonical workspace root before any
 * read or write. `path.resolve(cwd, candidate)` alone is not a boundary check:
 * `../outside`, an absolute path, or a symlinked parent can otherwise escape.
 *
 * The whole patch is preflighted at once so a later invalid operation cannot
 * leave earlier operations partially applied. Strict mode deliberately
 * disables WorkspaceIsolation's read-only system whitelist for this write
 * surface: apply_patch may only mutate descendants of its supplied cwd.
 */
function preflightPatchPaths(ops: FileOp[], cwd: string): PatchPathPreflight {
  const lexicalRoot = path.resolve(cwd);
  let workspaceRoot: string;
  try {
    workspaceRoot = fs.realpathSync(lexicalRoot);
    if (!fs.statSync(workspaceRoot).isDirectory()) {
      return { paths: [], errors: [`Patch workspace is not a directory: ${cwd}`] };
    }
  } catch (error) {
    return {
      paths: [],
      errors: [
        `Patch workspace is unavailable: ${cwd} (${error instanceof Error ? error.message : String(error)})`,
      ],
    };
  }

  const isolation = new WorkspaceIsolation({
    workspaceRoot,
    enabled: true,
    strictMode: true,
    additionalAllowedPaths: [],
  });
  const paths: ResolvedPatchPaths[] = [];
  const errors: string[] = [];

  for (const op of ops) {
    const sourceCandidate = path.resolve(workspaceRoot, op.path);
    const source = isolation.validatePath(sourceCandidate, `apply_patch ${op.type}`);
    let destination: ReturnType<WorkspaceIsolation['validatePath']> | undefined;
    if (op.moveTo) {
      const destinationCandidate = path.resolve(workspaceRoot, op.moveTo);
      destination = isolation.validatePath(destinationCandidate, 'apply_patch move destination');
    }

    if (!source.valid) {
      errors.push(`${op.type} ${op.path}: ${source.error ?? 'path is outside the patch workspace'}`);
    }
    if (op.moveTo && destination && !destination.valid) {
      errors.push(`move ${op.path} -> ${op.moveTo}: ${destination.error ?? 'destination is outside the patch workspace'}`);
    }

    paths.push({
      source: source.resolved,
      ...(destination?.valid ? { destination: destination.resolved } : {}),
    });
  }

  return { paths, errors };
}

/**
 * Compute the FULL resulting content of every file the patch touches, without
 * writing anything — the input the diff-review gate needs. STRICTER than
 * `applyPatchOps` on purpose: any failed hunk or missing update target is an
 * error (a partially-resolved patch is not what the agent intended, so the
 * gated path fails closed instead of applying the hunks that happened to
 * match). Legacy ungated behavior is unchanged.
 */
export function computePatchedFiles(ops: FileOp[], cwd: string = process.cwd()): ComputedPatch {
  const changes: ComputedPatch['changes'] = [];
  const errors: string[] = [];

  const preflight = preflightPatchPaths(ops, cwd);
  if (preflight.errors.length > 0) {
    return { changes, errors: preflight.errors };
  }

  for (const [index, op] of ops.entries()) {
    const resolvedPaths = preflight.paths[index];
    if (!resolvedPaths) {
      errors.push(`Internal patch path resolution failure for: ${op.path}`);
      continue;
    }
    const fullPath = resolvedPaths.source;
    if (op.type === 'add') {
      changes.push({ path: op.path, newContent: op.content ?? '' });
      continue;
    }
    if (op.type === 'delete') {
      // Legacy skips missing deletes silently — same here.
      if (fs.existsSync(fullPath)) changes.push({ path: op.path, newContent: null });
      continue;
    }
    // update
    if (!fs.existsSync(fullPath)) {
      errors.push(`File not found: ${op.path}`);
      continue;
    }
    const fileLines = fs.readFileSync(fullPath, 'utf-8').split('\n');
    let lineIndex = 0;
    let failed = false;
    for (const hunk of op.hunks ?? []) {
      if (hunk.oldLines.length > 0) {
        const seekIdx = seekSequence(fileLines, hunk.oldLines, lineIndex);
        if (seekIdx >= 0) {
          fileLines.splice(seekIdx, hunk.oldLines.length, ...hunk.newLines);
          lineIndex = seekIdx + hunk.newLines.length;
        } else {
          errors.push(`Hunk failed in ${op.path}: "${hunk.oldLines[0]?.substring(0, 60)}..."`);
          failed = true;
        }
      } else if (hunk.newLines.length > 0) {
        fileLines.splice(lineIndex, 0, ...hunk.newLines);
        lineIndex += hunk.newLines.length;
      }
    }
    if (failed) continue;
    const newContent = fileLines.join('\n');
    if (op.moveTo) {
      changes.push({ path: op.moveTo, newContent });
      changes.push({ path: op.path, newContent: null });
    } else {
      changes.push({ path: op.path, newContent });
    }
  }
  return { changes, errors };
}

// ============================================================================
// Applier
// ============================================================================

export function applyPatchOps(ops: FileOp[], cwd: string = process.cwd()): PatchResult {
  const result: PatchResult = { filesAdded: [], filesDeleted: [], filesUpdated: [], errors: [] };

  const preflight = preflightPatchPaths(ops, cwd);
  if (preflight.errors.length > 0) {
    result.errors.push(...preflight.errors);
    return result;
  }

  for (const [index, op] of ops.entries()) {
    const resolvedPaths = preflight.paths[index];
    if (!resolvedPaths) {
      result.errors.push(`Internal patch path resolution failure for: ${op.path}`);
      continue;
    }
    const fullPath = resolvedPaths.source;
    try {
      if (op.type === 'add') {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, op.content ?? '');
        result.filesAdded.push(op.path);

      } else if (op.type === 'delete') {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          result.filesDeleted.push(op.path);
        }

      } else if (op.type === 'update') {
        if (!fs.existsSync(fullPath)) {
          result.errors.push(`File not found: ${op.path}`);
          continue;
        }
        const fileLines = fs.readFileSync(fullPath, 'utf-8').split('\n');
        let lineIndex = 0;

        for (const hunk of op.hunks ?? []) {
          if (hunk.oldLines.length > 0) {
            const seekIdx = seekSequence(fileLines, hunk.oldLines, lineIndex);
            if (seekIdx >= 0) {
              fileLines.splice(seekIdx, hunk.oldLines.length, ...hunk.newLines);
              lineIndex = seekIdx + hunk.newLines.length;
            } else {
              result.errors.push(`Hunk failed in ${op.path}: "${hunk.oldLines[0]?.substring(0, 60)}..."`);
            }
          } else if (hunk.newLines.length > 0) {
            fileLines.splice(lineIndex, 0, ...hunk.newLines);
            lineIndex += hunk.newLines.length;
          }
        }

        if (op.moveTo) {
          const newPath = resolvedPaths.destination;
          if (!newPath) {
            result.errors.push(`Move destination was not resolved: ${op.moveTo}`);
            continue;
          }
          const newDir = path.dirname(newPath);
          if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
          fs.writeFileSync(newPath, fileLines.join('\n'));
          fs.unlinkSync(fullPath);
          result.filesUpdated.push(`${op.path} → ${op.moveTo}`);
        } else {
          fs.writeFileSync(fullPath, fileLines.join('\n'));
          result.filesUpdated.push(op.path);
        }
      }
    } catch (err) {
      result.errors.push(`${op.type} ${op.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

// ============================================================================
// Tool
// ============================================================================

export class ApplyPatchTool extends BaseTool {
  readonly name = 'apply_patch';
  readonly description = 'Apply a patch to modify files. Use *** Begin Patch / *** End Patch format with -/+ lines. Supports adding, deleting, and updating files with fuzzy matching.';

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      patch: {
        type: 'string',
        description: 'The patch content in *** Begin Patch format.',
        required: true,
      },
      intent: {
        type: 'string',
        description: 'What this change is trying to achieve (used by the diff-review gate when enabled).',
        required: false,
      },
    };
  }

  /**
   * @param cwd Base directory for the patch's relative paths — an embedded
   *   engine's session workingDirectory. Defaults to `process.cwd()` (CLI).
   */
  async execute(input: Record<string, unknown>, cwd?: string): Promise<ToolResult> {
    const patchText = input.patch as string;
    if (!patchText) return this.error('patch is required');

    try {
      const ops = parsePatch(patchText);
      if (ops.length === 0) {
        return this.error('No valid operations found in patch.');
      }

      // Shared write gates. Their heavy module graphs remain dynamically
      // loaded by review-gate-helper; both env vars off keeps this legacy path.
      const rawMode = (process.env.CODEBUDDY_DIFF_REVIEW ?? 'off').toLowerCase();
      if (
        rawMode === 'static'
        || rawMode === 'full'
        || process.env.CODEBUDDY_SHADOW_WORKSPACE === 'true'
      ) {
        return await this.executeGated(ops, typeof input.intent === 'string' ? input.intent : undefined, cwd);
      }

      return this.executeLegacy(ops, cwd);
    } catch (err) {
      return this.error(`Patch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Review-gated path: resolve the patch to full before/after content
   * (fail-closed on any unresolved hunk), then let the diff-review gate
   * validate, apply transactionally and journal. A reject/annotate verdict
   * comes back as a tool ERROR carrying the annotations, so the agent can
   * revise the patch instead of silently losing the edit.
   */
  private async executeGated(ops: FileOp[], intent?: string, baseCwd?: string): Promise<ToolResult> {
    const cwd = baseCwd ?? process.cwd();
    const { changes, errors } = computePatchedFiles(ops, cwd);
    const gateLabel = process.env.CODEBUDDY_SHADOW_WORKSPACE === 'true' ? 'write gate' : 'review gate';
    if (errors.length > 0) {
      return this.error(`${gateLabel}: patch does not resolve against the working tree (fail-closed, nothing applied):\n${errors.join('\n')}`);
    }
    if (changes.length === 0) {
      return this.error(`${gateLabel}: patch resolves to no effective change.`);
    }
    const gate = await maybeReviewGatedWrite({
      changes,
      baseDirectory: cwd,
      intent: intent ?? `apply_patch (${ops.length} operation${ops.length > 1 ? 's' : ''})`,
      originLabel: 'apply_patch',
    });
    if (gate.gated && !gate.ok) {
      logger.debug('apply_patch write gate: blocked');
      return this.error(gate.error);
    }
    if (gate.gated && gate.ok) {
      logger.debug('apply_patch write gate: applied');
      return this.success(gate.summary);
    }
    return this.executeLegacy(ops, cwd);
  }

  private executeLegacy(ops: FileOp[], cwd?: string): ToolResult {
    const patchResult = applyPatchOps(ops, cwd ?? process.cwd());
    const lines: string[] = [];
    if (patchResult.filesAdded.length > 0) lines.push(`Added: ${patchResult.filesAdded.join(', ')}`);
    if (patchResult.filesDeleted.length > 0) lines.push(`Deleted: ${patchResult.filesDeleted.join(', ')}`);
    if (patchResult.filesUpdated.length > 0) lines.push(`Updated: ${patchResult.filesUpdated.join(', ')}`);
    if (patchResult.errors.length > 0) lines.push(`Errors: ${patchResult.errors.join('; ')}`);
    logger.debug(`apply_patch: +${patchResult.filesAdded.length} -${patchResult.filesDeleted.length} ~${patchResult.filesUpdated.length} !${patchResult.errors.length}`);
    const onlyLine = lines[0];
    return patchResult.errors.length > 0 && lines.length === 1 && onlyLine !== undefined
      ? this.error(onlyLine)
      : this.success(lines.join('\n'));
  }
}
