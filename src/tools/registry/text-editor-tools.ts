/**
 * Text Editor Tool Adapters
 *
 * ITool-compliant adapters for TextEditorTool operations.
 * These adapters wrap the existing TextEditorTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { TextEditorTool } from '../index.js';

// ============================================================================
// Shared TextEditorTool Instance
// ============================================================================

// Lazy-loaded singleton for TextEditorTool
let textEditorInstance: TextEditorTool | null = null;

function getTextEditor(): TextEditorTool {
  if (!textEditorInstance) {
    textEditorInstance = new TextEditorTool();
  }
  return textEditorInstance;
}

/**
 * Reset the shared TextEditorTool instance (for testing)
 */
export function resetTextEditorInstance(): void {
  if (textEditorInstance) {
    textEditorInstance.dispose();
    textEditorInstance = null;
  }
}

// ============================================================================
// ViewFileTool
// ============================================================================

/**
 * ViewFileTool - ITool adapter for viewing file contents
 */
export class ViewFileTool implements ITool {
  readonly name = 'view_file';
  readonly description = 'View file contents with optional line range';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const path = input.path as string;
    const startLine = input.start_line as number | undefined;
    const endLine = input.end_line as number | undefined;

    const range: [number, number] | undefined =
      startLine !== undefined && endLine !== undefined
        ? [startLine, endLine]
        : undefined;

    return await getTextEditor().view(path, range);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file or directory to view',
          },
          start_line: {
            type: 'number',
            description: 'Start line for partial view (1-indexed)',
          },
          end_line: {
            type: 'number',
            description: 'End line for partial view (1-indexed)',
          },
        },
        required: ['path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.path !== 'string' || data.path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    if (data.start_line !== undefined && typeof data.start_line !== 'number') {
      return { valid: false, errors: ['start_line must be a number'] };
    }

    if (data.end_line !== undefined && typeof data.end_line !== 'number') {
      return { valid: false, errors: ['end_line must be a number'] };
    }

    if ((data.start_line !== undefined) !== (data.end_line !== undefined)) {
      return { valid: false, errors: ['Both start_line and end_line must be provided together'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read' as ToolCategoryType,
      keywords: ['view', 'read', 'file', 'content', 'display'],
      priority: 10,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// CreateFileTool
// ============================================================================

/**
 * CreateFileTool - ITool adapter for creating new files
 */
export class CreateFileTool implements ITool {
  readonly name = 'create_file';
  readonly description = 'Create a new file with the specified content';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const path = input.path as string;
    const content = input.content as string;

    return await getTextEditor().create(path, content);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path where the new file should be created',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.path !== 'string' || data.path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    if (typeof data.content !== 'string') {
      return { valid: false, errors: ['content must be a string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_write' as ToolCategoryType,
      keywords: ['create', 'write', 'file', 'new'],
      priority: 8,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// StrReplaceEditorTool
// ============================================================================

/**
 * StrReplaceEditorTool - ITool adapter for string replacement in files
 */
export class StrReplaceEditorTool implements ITool {
  readonly name = 'str_replace_editor';
  readonly description = 'Replace text in a file using exact or fuzzy matching';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const path = input.path as string;
    const oldStr = input.old_str as string;
    const newStr = input.new_str as string;
    const replaceAll = (input.replace_all as boolean) ?? false;

    return await getTextEditor().strReplace(path, oldStr, newStr, replaceAll);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to edit',
          },
          old_str: {
            type: 'string',
            description: 'Text to find and replace',
          },
          new_str: {
            type: 'string',
            description: 'Replacement text',
          },
          replace_all: {
            type: 'boolean',
            description: 'If true, replace all occurrences; otherwise only first',
            default: false,
          },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.path !== 'string' || data.path.trim() === '') {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    if (typeof data.old_str !== 'string') {
      return { valid: false, errors: ['old_str must be a string'] };
    }

    if (typeof data.new_str !== 'string') {
      return { valid: false, errors: ['new_str must be a string'] };
    }

    if (data.replace_all !== undefined && typeof data.replace_all !== 'boolean') {
      return { valid: false, errors: ['replace_all must be a boolean'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_write' as ToolCategoryType,
      keywords: ['edit', 'replace', 'modify', 'file', 'text', 'string'],
      priority: 9,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all text editor tool instances
 */
export function createTextEditorTools(): ITool[] {
  return [
    new ViewFileTool(),
    new CreateFileTool(),
    new StrReplaceEditorTool(),
  ];
}
