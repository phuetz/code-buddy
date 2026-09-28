/**
 * LSP Rename Tool
 *
 * Exposes LSP rename functionality to the agent, enabling
 * cross-file symbol renaming via the Language Server Protocol.
 *
 * Uses the LSP client to get a workspace edit, then applies
 * all text edits across affected files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLSPClient } from '../lsp/lsp-client.js';
import type { LSPWorkspaceEdit, LSPTextEdit } from '../lsp/lsp-client.js';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { checkSecretFileAccess, formatSecretRefusal } from '../security/secret-files.js';

// ============================================================================
// Types
// ============================================================================

export interface LspRenameParams {
  filePath: string;
  line: number;
  character: number;
  newName: string;
}

interface FileEditSummary {
  file: string;
  editCount: number;
  editsApplied: string[];
}

// ============================================================================
// Workspace Edit Application
// ============================================================================

/**
 * Apply a single text edit to file content.
 * Returns the modified content.
 */
function applyTextEdit(content: string, edit: LSPTextEdit): string {
  const lines = content.split('\n');
  const startLine = edit.range.start.line;
  const startChar = edit.range.start.character;
  const endLine = edit.range.end.line;
  const endChar = edit.range.end.character;

  // Build the text before the edit range
  const beforeLines = lines.slice(0, startLine);
  const beforePartial = lines[startLine]?.substring(0, startChar) ?? '';

  // Build the text after the edit range
  const afterPartial = lines[endLine]?.substring(endChar) ?? '';
  const afterLines = lines.slice(endLine + 1);

  // Reconstruct
  const before = beforeLines.length > 0
    ? beforeLines.join('\n') + '\n' + beforePartial
    : beforePartial;

  const after = afterLines.length > 0
    ? afterPartial + '\n' + afterLines.join('\n')
    : afterPartial;

  return before + edit.newText + after;
}

/**
 * Apply multiple text edits to a file's content.
 * Edits are applied in reverse order (bottom-up) to preserve positions.
 */
function applyEditsToContent(content: string, edits: LSPTextEdit[]): string {
  // Sort edits in reverse order (bottom-right first) to avoid position shifts
  const sorted = [...edits].sort((a, b) => {
    if (b.range.start.line !== a.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  let result = content;
  for (const edit of sorted) {
    result = applyTextEdit(result, edit);
  }
  return result;
}

/**
 * Extract edits from a workspace edit, normalizing both `changes` and
 * `documentChanges` formats.
 */
function extractEdits(workspaceEdit: LSPWorkspaceEdit): Map<string, LSPTextEdit[]> {
  const editsByFile = new Map<string, LSPTextEdit[]>();

  // Handle `changes` format
  if (workspaceEdit.changes) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
      const filePath = uriToPath(uri);
      editsByFile.set(filePath, edits);
    }
  }

  // Handle `documentChanges` format
  if (workspaceEdit.documentChanges) {
    for (const docChange of workspaceEdit.documentChanges) {
      const filePath = uriToPath(docChange.textDocument.uri);
      const existing = editsByFile.get(filePath) || [];
      existing.push(...docChange.edits);
      editsByFile.set(filePath, existing);
    }
  }

  return editsByFile;
}

/**
 * Convert a file:// URI to a local file path.
 */
function uriToPath(uri: string): string {
  // Preserve the leading root separator; stripping `file:///` turned an
  // absolute LSP edit into a path relative to the agent's current directory.
  return fileURLToPath(uri);
}

/**
 * Describe a text edit for human-readable output.
 */
function describeEdit(edit: LSPTextEdit): string {
  const startLine = edit.range.start.line + 1;
  const endLine = edit.range.end.line + 1;
  const range = startLine === endLine
    ? `line ${startLine}`
    : `lines ${startLine}-${endLine}`;
  return `${range}: "${edit.newText.substring(0, 50)}${edit.newText.length > 50 ? '...' : ''}"`;
}

// ============================================================================
// LSP Rename Tool
// ============================================================================

/**
 * Execute an LSP rename operation.
 *
 * 1. Calls prepareRename to validate the position is renameable
 * 2. Calls rename to get the workspace edit
 * 3. Applies all edits across files
 * 4. Returns a summary of changes
 */
export async function executeLspRename(params: LspRenameParams): Promise<ToolResult> {
  const { filePath, line, character, newName } = params;

  // Validate parameters
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'filePath is required and must be a string' };
  }
  if (typeof line !== 'number' || line < 1) {
    return { success: false, error: 'line must be a positive number (1-based)' };
  }
  if (typeof character !== 'number' || character < 1) {
    return { success: false, error: 'character must be a positive number (1-based)' };
  }
  if (!newName || typeof newName !== 'string' || newName.trim() === '') {
    return { success: false, error: 'newName is required and must be a non-empty string' };
  }

  // Resolve the file path
  const resolvedPath = path.resolve(filePath);
  const initialSecret = checkSecretFileAccess(resolvedPath, 'read');
  if (initialSecret.secret) return { success: false, error: formatSecretRefusal(resolvedPath, initialSecret) };
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `File not found: ${resolvedPath}` };
  }

  const client = getLSPClient();
  const lang = client.detectLanguage(resolvedPath);
  if (!lang) {
    return { success: false, error: `Unsupported language for file: ${resolvedPath}` };
  }

  try {
    // Step 1: Prepare rename (validate the position)
    const prepareResult = await client.prepareRename(resolvedPath, line, character);
    if (!prepareResult) {
      return {
        success: false,
        error: `Cannot rename symbol at ${resolvedPath}:${line}:${character}. The position may not contain a renameable symbol, or the LSP server does not support rename.`,
      };
    }

    logger.debug('prepareRename succeeded', {
      placeholder: prepareResult.placeholder,
      range: prepareResult.range,
    });

    // Step 2: Get the workspace edit
    const workspaceEdit = await client.rename(resolvedPath, line, character, newName);
    if (!workspaceEdit) {
      return {
        success: false,
        error: `Rename operation returned no edits for ${resolvedPath}:${line}:${character}`,
      };
    }

    // Step 3: Extract and apply edits
    const editsByFile = extractEdits(workspaceEdit);
    if (editsByFile.size === 0) {
      return {
        success: false,
        error: 'Rename returned an empty workspace edit (no changes)',
      };
    }

    // Reject the entire workspace edit before applying any file. A language
    // server can return edits for paths other than the initially requested one.
    for (const editFilePath of editsByFile.keys()) {
      const verdict = checkSecretFileAccess(editFilePath, 'read');
      if (verdict.secret) return { success: false, error: formatSecretRefusal(editFilePath, verdict) };
    }

    const summaries: FileEditSummary[] = [];

    for (const [editFilePath, edits] of editsByFile) {
      const verdict = checkSecretFileAccess(editFilePath, 'read');
      if (verdict.secret) return { success: false, error: formatSecretRefusal(editFilePath, verdict) };
      try {
        const content = fs.readFileSync(editFilePath, 'utf-8');
        const modified = applyEditsToContent(content, edits);
        const beforeWrite = checkSecretFileAccess(editFilePath, 'read');
        if (beforeWrite.secret) return { success: false, error: formatSecretRefusal(editFilePath, beforeWrite) };
        fs.writeFileSync(editFilePath, modified, 'utf-8');

        summaries.push({
          file: editFilePath,
          editCount: edits.length,
          editsApplied: edits.map(e => describeEdit(e)),
        });
      } catch (fileErr) {
        logger.warn(`Failed to apply edits to ${editFilePath}: ${fileErr}`);
        summaries.push({
          file: editFilePath,
          editCount: 0,
          editsApplied: [`ERROR: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`],
        });
      }
    }

    // Step 4: Format summary
    const totalEdits = summaries.reduce((sum, s) => sum + s.editCount, 0);
    const parts: string[] = [
      `Renamed "${prepareResult.placeholder || '(symbol)'}" to "${newName}"`,
      `Files changed: ${summaries.length}`,
      `Total edits: ${totalEdits}`,
      '',
    ];

    for (const summary of summaries) {
      parts.push(`## ${summary.file}`);
      parts.push(`  ${summary.editCount} edit(s):`);
      for (const desc of summary.editsApplied) {
        parts.push(`  - ${desc}`);
      }
      parts.push('');
    }

    return {
      success: true,
      output: parts.join('\n'),
      data: {
        filesChanged: summaries.length,
        totalEdits,
        files: summaries.map(s => s.file),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`LSP rename failed: ${message}`);
    return { success: false, error: `LSP rename failed: ${message}` };
  }
}

// ============================================================================
// Exports for testing
// ============================================================================

export { applyTextEdit, applyEditsToContent, extractEdits, uriToPath };
