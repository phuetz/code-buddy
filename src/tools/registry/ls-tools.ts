/**
 * LS Tool Adapter
 *
 * ITool-compliant adapter for the dedicated directory listing tool.
 * Auto-approved (read-only operation, no bash needed).
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { LsTool } from '../ls-tool.js';

// ============================================================================
// Shared LsTool Instance
// ============================================================================

let lsToolInstance: LsTool | null = null;

function getLsTool(): LsTool {
  if (!lsToolInstance) {
    lsToolInstance = new LsTool();
  }
  return lsToolInstance;
}

/**
 * Reset the shared LsTool instance (for testing)
 */
export function resetLsInstance(): void {
  lsToolInstance = null;
}

// ============================================================================
// ListDirectoryTool
// ============================================================================

/**
 * ListDirectoryTool - ITool adapter for directory listing
 */
export class ListDirectoryTool implements ITool {
  readonly name = 'list_directory';
  readonly description = 'List files and directories at a given path. Returns name, type, size, and modification time. Auto-approved read-only operation.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const directory = (input.path as string) || '.';
    return await getLsTool().execute(directory);
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
            description: 'Directory path to list (default: current directory)',
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (data.path !== undefined && typeof data.path !== 'string') {
      return { valid: false, errors: ['path must be a string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read' as ToolCategoryType,
      keywords: ['list', 'directory', 'files', 'ls', 'folder', 'contents'],
      priority: 9,
      modifiesFiles: false,
      makesNetworkRequests: false,
      requiresConfirmation: false,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create all LS-related tool adapters
 */
export function createLsTools(): ITool[] {
  return [
    new ListDirectoryTool(),
  ];
}
