/**
 * Parallel Agent Tool
 * 
 * Allows the agent to spawn multiple sub-agents in parallel to handle
 * independent sub-tasks concurrently. Inspired by Claude Code.
 */

import { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { ToolResult } from '../../types/index.js';
import { getParallelSubagentRunner, ParallelTask } from '../../agent/subagents.js';
import { logger } from '../../utils/logger.js';

export class ParallelAgentTool implements ITool {
  readonly name = 'spawn_parallel_agents';
  readonly description = 'Execute multiple sub-tasks concurrently using parallel sub-agents. Best for independent tasks like analyzing multiple files, searching different topics, or running multiple tests.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tasks = input.tasks as Array<{
      id?: string;
      type?: string;
      task: string;
      context?: string;
      system_prompt?: string;
    }>;

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return { success: false, error: 'No tasks provided for parallel execution.' };
    }

    const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
    if (!apiKey) {
      return { success: false, error: 'No API key available for sub-agents.' };
    }

    const runner = getParallelSubagentRunner(apiKey, process.env.GROK_BASE_URL);
    
    // Pipeline integration: if no tasks but has _input, treat _input as a list of tasks or a single task
    let finalTasks = tasks;
    if ((!tasks || tasks.length === 0) && input._input) {
      finalTasks = [{ task: input._input as string }];
    }

    if (!finalTasks || !Array.isArray(finalTasks) || finalTasks.length === 0) {
      return { success: false, error: 'No tasks provided for parallel execution.' };
    }

    // Convert to ParallelTask format
    const parallelTasks: ParallelTask[] = finalTasks.map((t, i) => ({
      id: t.id || `task-${i}`,
      agentType: t.type || 'explorer', // Default to explorer if not specified
      task: t.task,
      context: t.context || (input._context as string),
    }));

    logger.info(`Spawning ${parallelTasks.length} parallel agents...`);

    try {
      const result = await runner.runParallel(parallelTasks);
      
      let output = `## Parallel Execution Results (${result.completedCount}/${parallelTasks.length} succeeded)

`;
      
      for (const [id, taskResult] of result.results) {
        output += `### Task: ${id} (${taskResult.success ? '✅ Success' : '❌ Failed'})
`;
        output += `${taskResult.output}

`;
        if (taskResult.toolsUsed.length > 0) {
          output += `*Tools used: ${taskResult.toolsUsed.join(', ')}*

`;
        }
        output += `---

`;
      }

      return {
        success: result.success,
        output: output.trim(),
      };
    } catch (err) {
      return {
        success: false,
        error: `Parallel execution failed: ${err instanceof Error ? err.message : String(err)}`,
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
          tasks: {
            type: 'array',
            description: 'List of tasks to execute in parallel',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique identifier for this task' },
                type: { 
                  type: 'string', 
                  enum: ['code-reviewer', 'debugger', 'test-runner', 'explorer', 'refactorer', 'documenter'],
                  description: 'Type of specialized agent to use' 
                },
                task: { type: 'string', description: 'The specific instructions for this sub-agent' },
                context: { type: 'string', description: 'Additional context for this specific task' },
              },
              required: ['task'],
            },
          },
        },
        required: ['tasks'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
      return { valid: false, errors: ['tasks must be a non-empty array'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['parallel', 'concurrent', 'agents', 'multi-tasking', 'batch'],
      priority: 5,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createParallelTools(): ITool[] {
  return [new ParallelAgentTool()];
}
