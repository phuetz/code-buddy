/**
 * Advanced Tool Adapters
 *
 * ITool-compliant adapters for js_repl and multi_edit tools.
 * JSReplTool already implements ITool natively; MultiEditTool needs a thin adapter.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

// ============================================================================
// Lazy-loaded instances
// ============================================================================

let jsReplToolInstance: ITool | null = null;
let multiEditInstance: InstanceType<typeof import('../multi-edit.js').MultiEditTool> | null = null;

async function getJSReplTool(): Promise<ITool> {
  if (!jsReplToolInstance) {
    const { JSReplTool } = await import('../js-repl.js');
    jsReplToolInstance = new JSReplTool();
  }
  return jsReplToolInstance;
}

async function getMultiEdit() {
  if (!multiEditInstance) {
    const { MultiEditTool } = await import('../multi-edit.js');
    multiEditInstance = new MultiEditTool();
  }
  return multiEditInstance;
}

/**
 * Reset all shared instances (for testing)
 */
export function resetAdvancedInstances(): void {
  jsReplToolInstance = null;
  multiEditInstance = null;
}

// ============================================================================
// JSReplExecuteTool — delegates to JSReplTool which already implements ITool
// ============================================================================

export class JSReplExecuteTool implements ITool {
  readonly name = 'js_repl';
  readonly description = 'Execute JavaScript code in a persistent sandboxed REPL. Variables persist across calls. No filesystem or network access.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getJSReplTool();
    return tool.execute(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['execute', 'reset', 'variables'], description: 'Action: execute (default), reset, variables' },
          code: { type: 'string', description: 'JavaScript code to execute' },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    const action = d.action ?? 'execute';
    if (action === 'execute' && typeof d.code !== 'string') {
      return { valid: false, errors: ['code parameter is required for execute action'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['javascript', 'js', 'repl', 'evaluate', 'execute', 'compute'], priority: 3, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// MultiEditExecuteTool — adapter for MultiEditTool.execute(edits)
// ============================================================================

export class MultiEditExecuteTool implements ITool {
  readonly name = 'multi_edit';
  readonly description = 'Edit multiple files simultaneously in a single atomic operation. Use for refactoring across multiple files.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getMultiEdit();
    const edits = input.edits as Array<{
      file_path: string;
      old_str: string;
      new_str: string;
      replace_all?: boolean;
    }>;
    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, error: 'edits must be a non-empty array of edit operations' };
    }
    return tool.execute(edits);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: 'Array of edit operations',
            items: {
              type: 'object',
              properties: {
                file_path: { type: 'string', description: 'Path to the file to edit' },
                old_str: { type: 'string', description: 'Text to replace' },
                new_str: { type: 'string', description: 'Replacement text' },
                replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
              },
              required: ['file_path', 'old_str', 'new_str'],
            },
          },
        },
        required: ['edits'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (!Array.isArray(d.edits) || d.edits.length === 0) {
      return { valid: false, errors: ['edits must be a non-empty array'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'edit' as ToolCategoryType, keywords: ['multi', 'edit', 'refactor', 'batch', 'atomic', 'files'], priority: 5, requiresConfirmation: true, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all advanced tool instances
 */
export function createAdvancedTools(): ITool[] {
  return [
    new JSReplExecuteTool(),
    new MultiEditExecuteTool(),
  ];
}
