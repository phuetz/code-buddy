/**
 * Batch Tool Adapter
 *
 * ITool-compliant adapter for the batch_tools parallel execution tool.
 * Wraps the executeBatch function for use with the FormalToolRegistry.
 *
 * Note: The actual executeTool function is injected at runtime by the
 * tool handler, since batch_tools needs access to the registry itself.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { executeBatch, formatBatchResults, MAX_BATCH_SIZE } from '../batch-tool.js';
import type { BatchCall } from '../batch-tool.js';

/**
 * Provider for the executeTool function.
 * Set by the ToolHandler at initialization time.
 */
let executeToolProvider: ((toolName: string, args: Record<string, unknown>) => Promise<ToolResult>) | null = null;
let yoloModeProvider: (() => boolean) | null = null;

/**
 * Set the tool execution provider for batch operations.
 * Must be called before batch_tools can be used.
 */
export function setBatchToolProvider(
  executor: (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>,
  yoloChecker: () => boolean,
): void {
  executeToolProvider = executor;
  yoloModeProvider = yoloChecker;
}

/**
 * BatchToolExecute - ITool adapter for parallel tool execution
 */
export class BatchToolExecute implements ITool {
  readonly name = 'batch_tools';
  readonly description = 'Execute multiple tool calls in parallel. Best for read-only operations.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!executeToolProvider) {
      return {
        success: false,
        error: 'Batch tool provider not initialized. This is a configuration error.',
      };
    }

    try {
      const calls = input.calls as BatchCall[];
      const yoloMode = yoloModeProvider?.() || false;

      const result = await executeBatch(calls, executeToolProvider, yoloMode);
      const output = formatBatchResults(result);
      const noCallsExecuted = result.results.length === 0;
      const allCallsFailed = result.results.length > 0 && result.results.every(r => !r.success);

      if (noCallsExecuted || allCallsFailed) {
        return {
          success: false,
          error: result.summary,
          output,
        };
      }

      return {
        success: true,
        output,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
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
          calls: {
            type: 'array',
            description: 'Array of tool calls to execute in parallel',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', description: 'The tool name' },
                args: { type: 'object', description: 'Arguments for the tool' },
              },
              required: ['tool', 'args'],
            },
          },
          description: {
            type: 'string',
            description: 'Optional description of the batch',
          },
        },
        required: ['calls'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (!Array.isArray(data.calls)) {
      return { valid: false, errors: ['calls must be an array'] };
    }

    if (data.calls.length === 0) {
      return { valid: false, errors: ['calls array must not be empty'] };
    }

    if (data.calls.length > MAX_BATCH_SIZE) {
      return { valid: false, errors: [`calls array exceeds maximum size of ${MAX_BATCH_SIZE}`] };
    }

    for (let i = 0; i < data.calls.length; i++) {
      const call = data.calls[i] as Record<string, unknown>;
      if (!call || typeof call !== 'object') {
        return { valid: false, errors: [`calls[${i}] must be an object`] };
      }
      if (typeof call.tool !== 'string' || !call.tool) {
        return { valid: false, errors: [`calls[${i}].tool must be a non-empty string`] };
      }
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['batch', 'parallel', 'multiple', 'concurrent', 'bulk', 'tools', 'execute', 'multi'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/**
 * Create batch tool instances
 */
export function createBatchTools(): ITool[] {
  return [new BatchToolExecute()];
}

/**
 * Reset batch tool instances (for testing)
 */
export function resetBatchInstances(): void {
  executeToolProvider = null;
  yoloModeProvider = null;
}
