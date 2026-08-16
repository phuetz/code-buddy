/**
 * LSP Tool Adapters
 *
 * ITool-compliant tools for LSP navigation, diagnostics, rename, and code
 * action operations.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { executeLspRename } from '../lsp-rename-tool.js';
import { getLSPClient } from '../../lsp/lsp-client.js';
import type { LSPRange } from '../../lsp/lsp-client.js';
import {
  LspDefinitionTool,
  LspDiagnosticsTool,
  LspHoverTool,
  LspReferencesTool,
  LspSymbolsTool,
} from '../lsp-navigation-tools.js';

export {
  LspDefinitionTool,
  LspDiagnosticsTool,
  LspHoverTool,
  LspReferencesTool,
  LspSymbolsTool,
} from '../lsp-navigation-tools.js';

// ============================================================================
// LspRenameExecuteTool
// ============================================================================

/**
 * LspRenameExecuteTool - ITool adapter for LSP symbol rename
 */
export class LspRenameExecuteTool implements ITool {
  readonly name = 'lsp_rename';
  readonly description = 'Rename a symbol across the codebase using the Language Server Protocol. Updates all references across files.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeLspRename({
      filePath: input.file_path as string,
      line: input.line as number,
      character: input.character as number,
      newName: input.new_name as string,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file containing the symbol to rename',
          },
          line: {
            type: 'number',
            description: 'Line number of the symbol (1-based)',
          },
          character: {
            type: 'number',
            description: 'Column number of the symbol (1-based)',
          },
          new_name: {
            type: 'string',
            description: 'New name for the symbol',
          },
        },
        required: ['file_path', 'line', 'character', 'new_name'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.file_path !== 'string' || data.file_path.trim() === '') {
      return { valid: false, errors: ['file_path must be a non-empty string'] };
    }
    if (typeof data.line !== 'number' || data.line < 1) {
      return { valid: false, errors: ['line must be a positive number'] };
    }
    if (typeof data.character !== 'number' || data.character < 1) {
      return { valid: false, errors: ['character must be a positive number'] };
    }
    if (typeof data.new_name !== 'string' || data.new_name.trim() === '') {
      return { valid: false, errors: ['new_name must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['rename', 'refactor', 'symbol', 'lsp', 'language server', 'cross-file'],
      priority: 7,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }
}

// ============================================================================
// LspCodeActionExecuteTool
// ============================================================================

/**
 * LspCodeActionExecuteTool - ITool adapter for LSP code actions
 */
export class LspCodeActionExecuteTool implements ITool {
  readonly name = 'lsp_code_action';
  readonly description = 'Get available code actions (quick fixes, refactorings) for a position or range in a file.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const startLine = input.start_line as number;
    const startChar = input.start_character as number;
    const endLine = (input.end_line as number | undefined) ?? startLine;
    const endChar = (input.end_character as number | undefined) ?? startChar;

    const client = getLSPClient();
    const range: LSPRange = {
      start: { line: startLine - 1, character: startChar - 1 },
      end: { line: endLine - 1, character: endChar - 1 },
    };

    try {
      const actions = await client.codeAction(filePath, range, []);

      if (actions.length === 0) {
        return { success: true, output: 'No code actions available at this position.' };
      }

      const parts = [`Found ${actions.length} code action(s):`, ''];
      for (const action of actions) {
        parts.push(`- **${action.title}**${action.kind ? ` (${action.kind})` : ''}`);
        if (action.edit) {
          const fileCount = Object.keys(action.edit.changes || {}).length +
            (action.edit.documentChanges?.length || 0);
          parts.push(`  Files affected: ${fileCount}`);
        }
      }

      return { success: true, output: parts.join('\n') };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Code action failed: ${message}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the file',
          },
          start_line: {
            type: 'number',
            description: 'Start line of the range (1-based)',
          },
          start_character: {
            type: 'number',
            description: 'Start column of the range (1-based)',
          },
          end_line: {
            type: 'number',
            description: 'End line of the range (1-based)',
          },
          end_character: {
            type: 'number',
            description: 'End column of the range (1-based)',
          },
        },
        required: ['file_path', 'start_line', 'start_character'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.file_path !== 'string' || data.file_path.trim() === '') {
      return { valid: false, errors: ['file_path must be a non-empty string'] };
    }
    if (typeof data.start_line !== 'number' || data.start_line < 1) {
      return { valid: false, errors: ['start_line must be a positive number'] };
    }
    if (typeof data.start_character !== 'number' || data.start_character < 1) {
      return { valid: false, errors: ['start_character must be a positive number'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['code action', 'quickfix', 'refactor', 'lsp', 'language server'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all LSP tool instances
 */
export function createLspTools(): ITool[] {
  return [
    new LspDefinitionTool(),
    new LspReferencesTool(),
    new LspHoverTool(),
    new LspSymbolsTool(),
    new LspDiagnosticsTool(),
    new LspRenameExecuteTool(),
    new LspCodeActionExecuteTool(),
  ];
}

/**
 * Reset LSP tool instances (for testing)
 */
export function resetLspInstances(): void {
  // No shared instance to reset - tools are stateless
}
