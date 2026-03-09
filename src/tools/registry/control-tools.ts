/**
 * Control Tools — Agent lifecycle control
 * - terminate: Signal task completion (OpenManus-compatible)
 */

import { executeTerminate, TERMINATE_TOOL_DEFINITION } from '../terminate-tool.js';
import type { ITool, ToolExecutorFn } from './types.js';

/** Terminate tool adapter */
export class TerminateExecuteTool implements ITool {
  readonly name = 'terminate';
  readonly description = TERMINATE_TOOL_DEFINITION.function.description;
  readonly schema = TERMINATE_TOOL_DEFINITION.function;
  readonly category = 'control' as const;

  async execute(args: Record<string, unknown>): Promise<{ success: boolean; output?: string; error?: string }> {
    return executeTerminate({ status: String(args.status || 'Task completed.') });
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: TERMINATE_TOOL_DEFINITION.function.parameters as import('./types.js').JsonSchema,
    };
  }

  getExecutor(): ToolExecutorFn {
    return async (_name, args) => this.execute(args);
  }
}

/** Factory: create all control tools */
export function createControlTools(): ITool[] {
  return [new TerminateExecuteTool()];
}

let terminateInstance: TerminateExecuteTool | null = null;

export function getTerminateInstance(): TerminateExecuteTool {
  if (!terminateInstance) terminateInstance = new TerminateExecuteTool();
  return terminateInstance;
}

export function resetControlInstances(): void {
  terminateInstance = null;
}
