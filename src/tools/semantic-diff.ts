/**
 * Semantic Diff Tool
 *
 * Provides semantic-aware code comparison:
 * - Ignores formatting differences
 * - Detects renamed variables/functions
 * - Identifies moved code blocks
 * - Highlights structural changes
 */

import * as fs from 'fs-extra';

export type ChangeType =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'moved'
  | 'formatting';

export interface SemanticChange {
  type: ChangeType;
  location: {
    file?: string;
    startLine: number;
    endLine: number;
  };
  description: string;
  oldCode?: string;
  newCode?: string;
  confidence: number; // 0-1
}

export interface SemanticDiffResult {
  summary: {
    totalChanges: number;
    additions: number;
    deletions: number;
    modifications: number;
    renames: number;
    moves: number;
    formattingOnly: number;
  };
  changes: SemanticChange[];
  isSemanticEquivalent: boolean;
}

export interface DiffOptions {
  /** Ignore whitespace differences */
  ignoreWhitespace?: boolean;
  /** Ignore comment changes */
  ignoreComments?: boolean;
  /** Detect renamed identifiers */
  detectRenames?: boolean;
  /** Detect moved code blocks */
  detectMoves?: boolean;
  /** Minimum similarity for rename detection (0-1) */
  renameSimilarity?: number;
}

const DEFAULT_OPTIONS: DiffOptions = {
  ignoreWhitespace: true,
  ignoreComments: true,
  detectRenames: true,
  detectMoves: true,
  renameSimilarity: 0.8,
};

/**
 * Compute semantic diff between two code strings
 */
export function semanticDiff(
  oldCode: string,
  newCode: string,
  options: DiffOptions = {}
): SemanticDiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const changes: SemanticChange[] = [];

  // Normalize code for comparison
  const normalizedOld = normalizeCode(oldCode, opts);
  const normalizedNew = normalizeCode(newCode, opts);

  // Check if semantically equivalent
  if (normalizedOld === normalizedNew) {
    // Check if there were formatting differences
    if (oldCode !== newCode) {
      changes.push({
        type: 'formatting',
        location: { startLine: 1, endLine: oldCode.split('\n').length },
        description: 'Formatting changes only (whitespace, comments)',
        confidence: 1.0,
      });
    }

    return {
      summary: {
        totalChanges: changes.length,
        additions: 0,
        deletions: 0,
        modifications: 0,
        renames: 0,
        moves: 0,
        formattingOnly: changes.length,
      },
      changes,
      isSemanticEquivalent: true,
    };
  }

  // Extract code blocks for comparison
  const oldBlocks = extractCodeBlocks(oldCode);
  const newBlocks = extractCodeBlocks(newCode);

  // Find added blocks
  for (const newBlock of newBlocks) {
    const match = findMatchingBlock(newBlock, oldBlocks, opts.renameSimilarity || 0.8);

    if (!match) {
      changes.push({
        type: 'added',
        location: { startLine: newBlock.startLine, endLine: newBlock.endLine },
        description: `Added ${newBlock.type}: ${newBlock.name || 'anonymous'}`,
        newCode: newBlock.code,
        confidence: 1.0,
      });
    } else if (match.similarity < 1.0 && match.similarity >= (opts.renameSimilarity || 0.8)) {
      // Possible rename or modification
      if (isRename(match.block, newBlock)) {
        changes.push({
          type: 'renamed',
          location: { startLine: newBlock.startLine, endLine: newBlock.endLine },
          description: `Renamed ${match.block.name} -> ${newBlock.name}`,
          oldCode: match.block.code,
          newCode: newBlock.code,
          confidence: match.similarity,
        });
      } else {
        changes.push({
          type: 'modified',
          location: { startLine: newBlock.startLine, endLine: newBlock.endLine },
          description: `Modified ${newBlock.type}: ${newBlock.name || 'anonymous'}`,
          oldCode: match.block.code,
          newCode: newBlock.code,
          confidence: match.similarity,
        });
      }
    }
  }

  // Find removed blocks
  for (const oldBlock of oldBlocks) {
    const match = findMatchingBlock(oldBlock, newBlocks, opts.renameSimilarity || 0.8);

    if (!match) {
      changes.push({
        type: 'removed',
        location: { startLine: oldBlock.startLine, endLine: oldBlock.endLine },
        description: `Removed ${oldBlock.type}: ${oldBlock.name || 'anonymous'}`,
        oldCode: oldBlock.code,
        confidence: 1.0,
      });
    }
  }

  // Detect moved blocks
  if (opts.detectMoves) {
    detectMovedBlocks(changes, oldBlocks, newBlocks);
  }

  // Calculate summary
  const summary = {
    totalChanges: changes.length,
    additions: changes.filter(c => c.type === 'added').length,
    deletions: changes.filter(c => c.type === 'removed').length,
    modifications: changes.filter(c => c.type === 'modified').length,
    renames: changes.filter(c => c.type === 'renamed').length,
    moves: changes.filter(c => c.type === 'moved').length,
    formattingOnly: changes.filter(c => c.type === 'formatting').length,
  };

  return {
    summary,
    changes,
    isSemanticEquivalent: summary.totalChanges === summary.formattingOnly,
  };
}

/**
 * Compare two files semantically
 */
export async function semanticDiffFiles(
  oldFile: string,
  newFile: string,
  options: DiffOptions = {}
): Promise<SemanticDiffResult> {
  const oldCode = await fs.readFile(oldFile, 'utf-8');
  const newCode = await fs.readFile(newFile, 'utf-8');

  const result = semanticDiff(oldCode, newCode, options);

  // Add file paths to locations
  for (const change of result.changes) {
    change.location.file = newFile;
  }

  return result;
}

interface CodeBlock {
  type: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'other';
  name?: string;
  code: string;
  normalizedCode: string;
  startLine: number;
  endLine: number;
}

/**
 * Normalize code for semantic comparison
 */
function normalizeCode(code: string, opts: DiffOptions): string {
  let normalized = code;

  // Remove comments
  if (opts.ignoreComments) {
    normalized = normalized
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*/g, ''); // line comments
  }

  // Normalize whitespace
  if (opts.ignoreWhitespace) {
    normalized = normalized
      .replace(/\s+/g, ' ') // collapse whitespace
      .replace(/\s*([{};,():])\s*/g, '$1') // remove space around punctuation
      .trim();
  }

  return normalized;
}

/**
 * Extract semantic code blocks from source
 */
function extractCodeBlocks(code: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = code.split('\n');

  // Regex patterns for different constructs
  const patterns = [
    { type: 'function' as const, regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
    { type: 'function' as const, regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/ },
    { type: 'class' as const, regex: /^(?:export\s+)?class\s+(\w+)/ },
    { type: 'interface' as const, regex: /^(?:export\s+)?interface\s+(\w+)/ },
    { type: 'variable' as const, regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/ },
    { type: 'import' as const, regex: /^import\s+/ },
  ];

  let currentBlock: Partial<CodeBlock> | null = null;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check if starting a new block
    if (!currentBlock) {
      for (const { type, regex } of patterns) {
        const match = trimmedLine.match(regex);
        if (match) {
          currentBlock = {
            type,
            name: match[1] || undefined,
            startLine: i + 1,
            code: line,
          };
          braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

          // Single-line statements
          if (braceCount === 0 && (trimmedLine.endsWith(';') || type === 'import')) {
            blocks.push({
              ...currentBlock,
              endLine: i + 1,
              normalizedCode: normalizeCode(currentBlock.code || '', DEFAULT_OPTIONS),
            } as CodeBlock);
            currentBlock = null;
          }
          break;
        }
      }
    } else {
      // Continue current block
      currentBlock.code += '\n' + line;
      braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      // Block ends when braces are balanced
      if (braceCount <= 0) {
        blocks.push({
          ...currentBlock,
          endLine: i + 1,
          normalizedCode: normalizeCode(currentBlock.code || '', DEFAULT_OPTIONS),
        } as CodeBlock);
        currentBlock = null;
        braceCount = 0;
      }
    }
  }

  // Handle unclosed block
  if (currentBlock) {
    blocks.push({
      ...currentBlock,
      endLine: lines.length,
      normalizedCode: normalizeCode(currentBlock.code || '', DEFAULT_OPTIONS),
    } as CodeBlock);
  }

  return blocks;
}

/**
 * Find a matching block based on similarity
 */
function findMatchingBlock(
  target: CodeBlock,
  candidates: CodeBlock[],
  threshold: number
): { block: CodeBlock; similarity: number } | null {
  let bestMatch: { block: CodeBlock; similarity: number } | null = null;

  for (const candidate of candidates) {
    // Same type preference
    if (candidate.type !== target.type) continue;

    const similarity = calculateSimilarity(target.normalizedCode, candidate.normalizedCode);

    if (similarity >= threshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { block: candidate, similarity };
      }
    }
  }

  return bestMatch;
}

/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  // Use Jaccard similarity on tokens
  const tokensA = new Set(a.split(/\W+/).filter(t => t.length > 0));
  const tokensB = new Set(b.split(/\W+/).filter(t => t.length > 0));

  const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.size / union.size;
}

/**
 * Check if two blocks represent a rename
 */
function isRename(oldBlock: CodeBlock, newBlock: CodeBlock): boolean {
  if (oldBlock.type !== newBlock.type) return false;
  if (!oldBlock.name || !newBlock.name) return false;
  if (oldBlock.name === newBlock.name) return false;

  // Replace old name with new name in old code and compare
  const renamedOld = oldBlock.normalizedCode.replace(
    new RegExp(`\\b${oldBlock.name}\\b`, 'g'),
    newBlock.name
  );

  return calculateSimilarity(renamedOld, newBlock.normalizedCode) > 0.95;
}

/**
 * Detect moved code blocks
 */
function detectMovedBlocks(
  changes: SemanticChange[],
  oldBlocks: CodeBlock[],
  newBlocks: CodeBlock[]
): void {
  // Find blocks that appear in both but at different positions
  const addedChanges = changes.filter(c => c.type === 'added');
  const removedChanges = changes.filter(c => c.type === 'removed');

  for (const added of addedChanges) {
    for (const removed of removedChanges) {
      if (added.newCode && removed.oldCode) {
        const similarity = calculateSimilarity(
          normalizeCode(added.newCode, DEFAULT_OPTIONS),
          normalizeCode(removed.oldCode, DEFAULT_OPTIONS)
        );

        if (similarity > 0.9) {
          // Mark as moved instead
          added.type = 'moved';
          added.description = added.description.replace('Added', 'Moved');
          added.oldCode = removed.oldCode;

          // Remove the "removed" change
          const idx = changes.indexOf(removed);
          if (idx !== -1) {
            changes.splice(idx, 1);
          }
          break;
        }
      }
    }
  }
}

/**
 * Format semantic diff result for display
 */
export function formatSemanticDiff(result: SemanticDiffResult): string {
  const lines: string[] = [
    '',
    '== Semantic Diff Report ==',
    '',
  ];

  if (result.isSemanticEquivalent) {
    lines.push('Files are semantically equivalent.');
    if (result.summary.formattingOnly > 0) {
      lines.push('(Only formatting differences detected)');
    }
    return lines.join('\n');
  }

  lines.push('Summary:');
  lines.push(`  Total changes: ${result.summary.totalChanges}`);
  if (result.summary.additions > 0) lines.push(`  Additions: ${result.summary.additions}`);
  if (result.summary.deletions > 0) lines.push(`  Deletions: ${result.summary.deletions}`);
  if (result.summary.modifications > 0) lines.push(`  Modifications: ${result.summary.modifications}`);
  if (result.summary.renames > 0) lines.push(`  Renames: ${result.summary.renames}`);
  if (result.summary.moves > 0) lines.push(`  Moves: ${result.summary.moves}`);
  lines.push('');

  lines.push('Changes:');
  for (const change of result.changes) {
    const icon = {
      added: '+',
      removed: '-',
      modified: '~',
      renamed: '→',
      moved: '↔',
      formatting: ' ',
    }[change.type];

    lines.push(`  ${icon} L${change.location.startLine}: ${change.description}`);
  }

  return lines.join('\n');
}

export default semanticDiff;
