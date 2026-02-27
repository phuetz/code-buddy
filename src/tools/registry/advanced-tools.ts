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
let codebaseMapperInstance: InstanceType<typeof import('../../context/codebase-map.js').CodebaseMapper> | null = null;

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

async function getCodebaseMapper() {
  if (!codebaseMapperInstance) {
    const { CodebaseMapper } = await import('../../context/codebase-map.js');
    codebaseMapperInstance = new CodebaseMapper();
  }
  return codebaseMapperInstance;
}

/**
 * Reset all shared instances (for testing)
 */
export function resetAdvancedInstances(): void {
  jsReplToolInstance = null;
  multiEditInstance = null;
  codebaseMapperInstance = null;
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
// MultiEditExecuteTool — adapter for MultiEditTool.execute(filePath, edits)
// Applies multiple {old_string, new_string} replacements to a single file
// atomically. All edits succeed or none are applied.
// ============================================================================

export class MultiEditExecuteTool implements ITool {
  readonly name = 'multi_edit';
  readonly description = 'Apply multiple text replacements to a single file atomically. All edits succeed or none are applied.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getMultiEdit();
    const filePath = input.file_path as string;
    const edits = input.edits as Array<{
      old_string: string;
      new_string: string;
    }>;
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'file_path is required and must be a string' };
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, error: 'edits must be a non-empty array of {old_string, new_string} pairs' };
    }
    return tool.execute(filePath, edits);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to edit' },
          edits: {
            type: 'array',
            description: 'Array of edit operations to apply in order',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: 'Exact text to find and replace' },
                new_string: { type: 'string', description: 'Replacement text' },
              },
              required: ['old_string', 'new_string'],
            },
          },
        },
        required: ['file_path', 'edits'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.file_path !== 'string' || (d.file_path as string).trim() === '') {
      return { valid: false, errors: ['file_path must be a non-empty string'] };
    }
    if (!Array.isArray(d.edits) || d.edits.length === 0) {
      return { valid: false, errors: ['edits must be a non-empty array'] };
    }
    for (let i = 0; i < (d.edits as unknown[]).length; i++) {
      const edit = (d.edits as Record<string, unknown>[])[i];
      if (typeof edit?.old_string !== 'string') {
        return { valid: false, errors: [`Edit #${i + 1}: old_string must be a string`] };
      }
      if (typeof edit?.new_string !== 'string') {
        return { valid: false, errors: [`Edit #${i + 1}: new_string must be a string`] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'file_write' as ToolCategoryType, keywords: ['multi', 'edit', 'replace', 'batch', 'atomic', 'refactor'], priority: 8, requiresConfirmation: true, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// CodebaseMapExecuteTool — adapter for CodebaseMapper
// ============================================================================

export class CodebaseMapExecuteTool implements ITool {
  readonly name = 'codebase_map';
  readonly description = 'Build and query a map of the codebase structure, symbols, and dependencies';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const mapper = await getCodebaseMapper();
    const operation = input.operation as string;

    switch (operation) {
      case 'build': {
        const map = await mapper.buildMap({ deep: !!input.deep });
        return { success: true, output: `Codebase map built: ${map.summary.totalFiles} files, ${map.summary.totalLines} lines` };
      }
      case 'summary': {
        const map = await mapper.buildMap();
        const s = map.summary;
        const langs = Object.entries(s.languages).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, c]) => `  ${l}: ${c}`).join('\n');
        return { success: true, output: `Files: ${s.totalFiles}\nLines: ${s.totalLines}\nTest files: ${s.testFiles}\nTop dirs: ${s.topLevelDirs.join(', ')}\nEntry points: ${s.entryPoints.join(', ')}\nLanguages:\n${langs}` };
      }
      case 'search': {
        const query = input.query as string;
        if (!query) return { success: false, error: 'query parameter is required for search operation' };
        const map = await mapper.buildMap();
        const matches: string[] = [];
        const q = query.toLowerCase();
        for (const [filePath] of map.files) {
          if (filePath.toLowerCase().includes(q)) matches.push(filePath);
        }
        return { success: true, output: matches.length > 0 ? `Found ${matches.length} files:\n${matches.slice(0, 50).join('\n')}` : 'No matching files found' };
      }
      case 'symbols': {
        const map = await mapper.buildMap({ deep: true });
        const symbolEntries: string[] = [];
        for (const [name, infos] of map.symbols) {
          for (const info of infos) {
            if (info.exported) symbolEntries.push(`${info.type} ${name} (${info.file}:${info.line})`);
          }
        }
        return { success: true, output: symbolEntries.length > 0 ? `Found ${symbolEntries.length} exported symbols:\n${symbolEntries.slice(0, 100).join('\n')}` : 'No exported symbols found' };
      }
      default:
        return { success: false, error: `Unknown operation: ${operation}. Use build, summary, search, or symbols.` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['build', 'summary', 'search', 'symbols'], description: 'The operation to perform' },
          query: { type: 'string', description: 'Search query (for search operation)' },
          deep: { type: 'boolean', description: 'Deep analysis including symbols (slower)' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (!d.operation || typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (d.operation === 'search' && typeof d.query !== 'string') return { valid: false, errors: ['query is required for search'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['codebase', 'map', 'structure', 'symbols', 'dependencies', 'search'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// SpawnSubagentExecuteTool — adapter for Subagent
// ============================================================================

export class SpawnSubagentExecuteTool implements ITool {
  readonly name = 'spawn_subagent';
  readonly description = 'Spawn a specialized subagent for specific tasks: code-reviewer, debugger, test-runner, explorer, refactorer, documenter';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const { Subagent, PREDEFINED_SUBAGENTS } = await import('../../agent/subagents.js');
    const type = input.type as string;
    const task = input.task as string;
    const context = input.context as string | undefined;
    const parallel = input.parallel as boolean | undefined;
    const tasks = input.tasks as Array<{ type: string; task: string; context?: string }> | undefined;

    // Parallel execution: run multiple subagents concurrently
    if (parallel && tasks && tasks.length > 0) {
      try {
        const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
        if (!apiKey) {
          return { success: false, error: 'No API key available for parallel subagents (GROK_API_KEY or XAI_API_KEY)' };
        }
        const { getParallelSubagentRunner } = await import('../../agent/subagents.js');
        const runner = getParallelSubagentRunner(apiKey, process.env.GROK_BASE_URL);

        const parallelTasks = tasks.map((t: { type: string; task: string; context?: string }, i: number) => ({
          id: `parallel-${i}`,
          agentType: t.type,
          task: t.task,
          context: t.context,
        }));

        const execResult = await runner.runParallel(parallelTasks);

        const outputs: string[] = [];
        for (const [id, result] of execResult.results) {
          outputs.push(`[${id}] ${result.success ? result.output : `ERROR: ${result.output}`}`);
        }

        return {
          success: execResult.success,
          output: `Parallel execution: ${execResult.completedCount}/${parallelTasks.length} succeeded\n\n` +
            outputs.join('\n\n---\n\n'),
        };
      } catch (err) {
        return { success: false, error: `Parallel execution failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    const config = PREDEFINED_SUBAGENTS[type];
    if (!config) {
      return { success: false, error: `Unknown subagent type: ${type}. Available: ${Object.keys(PREDEFINED_SUBAGENTS).join(', ')}` };
    }

    const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
    if (!apiKey) {
      return { success: false, error: 'No API key available for subagent (GROK_API_KEY or XAI_API_KEY)' };
    }

    const subagent = new Subagent(apiKey, config, process.env.GROK_BASE_URL);
    const result = await subagent.run(task, context);

    return {
      success: result.success,
      output: result.output,
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['code-reviewer', 'debugger', 'test-runner', 'explorer', 'refactorer', 'documenter'], description: 'Type of subagent' },
          task: { type: 'string', description: 'The task for the subagent' },
          context: { type: 'string', description: 'Additional context' },
          parallel: { type: 'boolean', description: 'Run multiple subagents in parallel (requires tasks array)' },
          tasks: { type: 'array', description: 'Array of {type, task, context} for parallel execution', items: { type: 'object', properties: { type: { type: 'string' }, task: { type: 'string' }, context: { type: 'string' } }, required: ['type', 'task'] } },
        },
        required: ['type', 'task'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.type !== 'string') return { valid: false, errors: ['type is required'] };
    if (typeof d.task !== 'string') return { valid: false, errors: ['task is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['subagent', 'spawn', 'delegate', 'review', 'debug', 'test'], priority: 3, modifiesFiles: false, makesNetworkRequests: true };
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
    new CodebaseMapExecuteTool(),
    new SpawnSubagentExecuteTool(),
  ];
}
