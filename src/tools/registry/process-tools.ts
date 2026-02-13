/**
 * Process Tool Adapters
 *
 * ITool-compliant adapter for ProcessTool operations.
 * Follows the docker-tools.ts pattern for the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { getProcessTool } from '../process-tool.js';

// ============================================================================
// ProcessOperationTool
// ============================================================================

export class ProcessOperationTool implements ITool {
  readonly name = 'process';
  readonly description = 'Manage system processes: list, poll, log, write stdin, kill, clear logs, remove tracking';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const args = (input.args as Record<string, unknown>) || {};
    const tool = getProcessTool();

    switch (action) {
      case 'list':
        return await tool.list(args.filter as string | undefined);

      case 'poll':
        return await tool.poll(args.pid as number);

      case 'log':
        return await tool.log(args.pid as number, {
          lines: args.lines as number | undefined,
          stderr: args.stderr as boolean | undefined,
        });

      case 'write':
        return await tool.write(args.pid as number, args.input as string);

      case 'kill':
        return await tool.kill(args.pid as number, args.signal as string | undefined);

      case 'clear':
        return await tool.clear(args.pid as number);

      case 'remove':
        return await tool.remove(args.pid as number);

      default:
        return {
          success: false,
          error: `Unknown process action: ${action}`,
        };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Process action to perform',
            enum: ['list', 'poll', 'log', 'write', 'kill', 'clear', 'remove'],
          },
          args: {
            type: 'object',
            description: 'Action-specific arguments',
            properties: {
              pid: {
                type: 'number',
                description: 'Process ID (required for poll, log, write, kill, clear, remove)',
              },
              filter: {
                type: 'string',
                description: 'Filter string for list action',
              },
              input: {
                type: 'string',
                description: 'Input to write to process stdin (for write action)',
              },
              signal: {
                type: 'string',
                description: 'Signal to send (for kill action, default: SIGTERM)',
              },
              lines: {
                type: 'number',
                description: 'Number of log lines to show (for log action, default: 100)',
              },
              stderr: {
                type: 'boolean',
                description: 'Show stderr instead of stdout (for log action)',
              },
            },
          },
        },
        required: ['action'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.action !== 'string' || data.action.trim() === '') {
      return { valid: false, errors: ['action must be a non-empty string'] };
    }

    const validActions = ['list', 'poll', 'log', 'write', 'kill', 'clear', 'remove'];
    if (!validActions.includes(data.action)) {
      return { valid: false, errors: [`Unknown action: ${data.action}`] };
    }

    // Validate pid is present for actions that require it
    const pidActions = ['poll', 'log', 'write', 'kill', 'clear', 'remove'];
    if (pidActions.includes(data.action)) {
      const args = data.args as Record<string, unknown> | undefined;
      if (!args || typeof args.pid !== 'number') {
        return { valid: false, errors: [`Action "${data.action}" requires args.pid (number)`] };
      }
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'system' as ToolCategoryType,
      keywords: ['process', 'pid', 'kill', 'stdin', 'log', 'managed'],
      priority: 5,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  dispose(): void {
    // No cleanup needed
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProcessTools(): ITool[] {
  return [new ProcessOperationTool()];
}

export async function resetProcessInstance(): Promise<void> {
  const { resetProcessTool } = await import('../process-tool.js');
  resetProcessTool();
}
