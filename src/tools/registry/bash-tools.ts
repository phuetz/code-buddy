/**
 * Bash Tool Adapters
 *
 * ITool-compliant adapters for BashTool operations.
 * These adapters wrap the existing BashTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { BashTool } from '../bash.js';

// ============================================================================
// Shared BashTool Instance
// ============================================================================

let bashInstance: BashTool | null = null;

function getBash(): BashTool {
  if (!bashInstance) {
    bashInstance = new BashTool();
  }
  return bashInstance;
}

/**
 * Reset the shared BashTool instance (for testing)
 */
export function resetBashInstance(): void {
  if (bashInstance) {
    bashInstance.dispose();
    bashInstance = null;
  }
}

// ============================================================================
// BashExecuteTool
// ============================================================================

/**
 * BashExecuteTool - ITool adapter for executing bash commands
 */
export class BashExecuteTool implements ITool {
  readonly name = 'bash';
  readonly description = 'Execute a shell command with security validation and optional timeout';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) ?? 30000;

    return await getBash().execute(command, timeout);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Command timeout in milliseconds (default: 30000)',
            default: 30000,
          },
        },
        required: ['command'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.command !== 'string' || data.command.trim() === '') {
      return { valid: false, errors: ['command must be a non-empty string'] };
    }

    if (data.timeout !== undefined && typeof data.timeout !== 'number') {
      return { valid: false, errors: ['timeout must be a number'] };
    }

    if (data.timeout !== undefined && data.timeout < 0) {
      return { valid: false, errors: ['timeout must be a positive number'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'system' as ToolCategoryType,
      keywords: ['bash', 'shell', 'command', 'execute', 'run', 'terminal'],
      priority: 10,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  dispose(): void {
    resetBashInstance();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all bash tool instances
 */
export function createBashTools(): ITool[] {
  return [
    new BashExecuteTool(),
  ];
}
