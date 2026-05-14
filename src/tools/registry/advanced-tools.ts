/**
 * Advanced Tool Adapters
 *
 * ITool-compliant adapters for js_repl and multi_edit tools.
 * JSReplTool already implements ITool natively; MultiEditTool needs a thin adapter.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';

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
    const operation = input.operation as string;

    // Graph operations use KnowledgeGraph directly (no CodebaseMapper needed)
    if (operation.startsWith('graph_')) {
      return this.executeGraphOperation(operation, input);
    }

    const mapper = await getCodebaseMapper();

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
        return { success: false, error: `Unknown operation: ${operation}. Use build, summary, search, symbols, graph_query, graph_neighbors, graph_path, or graph_stats.` };
    }
  }

  private async executeGraphOperation(operation: string, input: Record<string, unknown>): Promise<ToolResult> {
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      // Try lazy-loading from disk
      const { loadCodeGraph, codeGraphExists } = await import('../../knowledge/code-graph-persistence.js');
      if (codeGraphExists(process.cwd())) {
        loadCodeGraph(graph, process.cwd());
      }
      if (graph.getStats().tripleCount === 0) {
        return { success: false, error: 'Code graph is empty. Run `buddy onboard` or profile the repo first to build the code graph.' };
      }
    }

    // Deep mode: enrich with class hierarchy + call graph if not already done
    if (input.deep) {
      const hasCalls = graph.query({ predicate: 'calls' }).length > 0;
      if (!hasCalls) {
        try {
          const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
          const added = populateDeepCodeGraph(graph, process.cwd());
          if (added > 0) {
            // Persist enriched graph
            const { saveCodeGraph } = await import('../../knowledge/code-graph-persistence.js');
            saveCodeGraph(graph, process.cwd());
          }
        } catch {
          // Deep population optional — continue with existing graph
        }
      }
    }

    switch (operation) {
      case 'graph_query': {
        const entity = input.query as string;
        const predicate = input.predicate as string | undefined;
        const nodeType = input.node_type as string | undefined;

        if (!entity && !predicate && !nodeType) {
          return { success: false, error: 'At least one of query, predicate, or node_type is required for graph_query' };
        }

        // Resolve entity if provided
        let resolvedEntity: string | undefined;
        if (entity) {
          resolvedEntity = graph.findEntity(entity) ?? undefined;
          if (!resolvedEntity) {
            return { success: true, output: `No entity found matching "${entity}" in the code graph.` };
          }
        }

        // Build query pattern
        const pattern: { subject?: string; predicate?: string; object?: string } = {};
        if (resolvedEntity) pattern.subject = resolvedEntity;
        if (predicate) pattern.predicate = predicate;

        let triples = graph.query(pattern);

        // Also check as object
        if (resolvedEntity) {
          const asObject = graph.query({ object: resolvedEntity, predicate });
          triples = [...triples, ...asObject];
        }

        // Filter by nodeType metadata if specified
        if (nodeType) {
          triples = triples.filter(t => t.metadata?.nodeType === nodeType);
        }

        if (triples.length === 0) {
          return { success: true, output: `No triples found for query.${resolvedEntity ? ` Resolved entity: ${resolvedEntity}` : ''}` };
        }

        const lines = triples.slice(0, 30).map(t => `${t.subject} --${t.predicate}--> ${t.object}`);
        const more = triples.length > 30 ? `\n... +${triples.length - 30} more` : '';
        return { success: true, output: `Found ${triples.length} triples${resolvedEntity ? ` (entity: ${resolvedEntity})` : ''}:\n${lines.join('\n')}${more}` };
      }

      case 'graph_neighbors': {
        const entity = input.query as string;
        if (!entity) return { success: false, error: 'query parameter (entity name) is required for graph_neighbors' };

        const resolved = graph.findEntity(entity);
        if (!resolved) {
          return { success: true, output: `No entity found matching "${entity}" in the code graph.` };
        }

        const depth = Math.min(Math.max(input.depth as number || 2, 1), 4);
        const egoGraph = graph.formatEgoGraph(resolved, depth, 800);

        return { success: true, output: egoGraph || `Entity "${resolved}" has no neighbors.` };
      }

      case 'graph_path': {
        const entity = input.query as string;
        const target = input.target as string;
        if (!entity || !target) {
          return { success: false, error: 'Both query (source entity) and target are required for graph_path' };
        }

        const resolvedFrom = graph.findEntity(entity);
        const resolvedTo = graph.findEntity(target);
        if (!resolvedFrom) return { success: true, output: `No entity found matching source "${entity}".` };
        if (!resolvedTo) return { success: true, output: `No entity found matching target "${target}".` };

        const paths = graph.findPath(resolvedFrom, resolvedTo, 6);
        if (paths.length === 0) {
          return { success: true, output: `No path found between ${resolvedFrom} and ${resolvedTo}.` };
        }

        const shortest = paths[0];
        const pathStr = shortest.map(t => `${t.subject} --${t.predicate}--> ${t.object}`).join('\n  → ');
        return {
          success: true,
          output: `Path (${shortest.length} hops) from ${resolvedFrom} to ${resolvedTo}:\n  ${pathStr}${paths.length > 1 ? `\n(${paths.length - 1} alternate paths found)` : ''}`,
        };
      }

      case 'graph_stats': {
        const stats = graph.getStats();
        const lines = [
          `Code Graph Statistics:`,
          `  Triples: ${stats.tripleCount}`,
          `  Unique subjects: ${stats.subjectCount}`,
          `  Predicates: ${stats.predicateCount}`,
          `  Unique objects: ${stats.objectCount}`,
        ];

        // Count by predicate type
        const predCounts = new Map<string, number>();
        for (const t of graph.toJSON()) {
          predCounts.set(t.predicate, (predCounts.get(t.predicate) ?? 0) + 1);
        }
        const predLines = [...predCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([p, c]) => `    ${p}: ${c}`);
        lines.push(`  By predicate:\n${predLines.join('\n')}`);

        return { success: true, output: lines.join('\n') };
      }

      case 'graph_file_functions': {
        const fileQuery = input.query as string;
        if (!fileQuery) return { success: false, error: 'query parameter (file name or path) is required for graph_file_functions' };

        // Resolve to a module entity
        const resolvedMod = graph.findEntity(fileQuery);
        if (!resolvedMod || !resolvedMod.startsWith('mod:')) {
          return { success: true, output: `No module found matching "${fileQuery}". Try a file path like "agent-executor" or "src/agent/codebuddy-agent".` };
        }

        // Get all functions contained in this module
        const containedFns = graph.query({ subject: resolvedMod, predicate: 'containsFunction' });

        if (containedFns.length === 0) {
          // Fall back to definedIn (Phase 1 data might have some)
          const definedHere = graph.query({ predicate: 'definedIn', object: resolvedMod });
          if (definedHere.length === 0) {
            return { success: true, output: `No functions found in ${resolvedMod}. Run with deep=true to scan function/method definitions and call graph.` };
          }
          // Format Phase 1 fallback
          const fnLines = definedHere.map(t => `  ${t.subject}`);
          return { success: true, output: `${resolvedMod} — symbols defined here:\n${fnLines.join('\n')}` };
        }

        // Sort by line number
        const sorted = [...containedFns].sort((a, b) => {
          const lineA = parseInt(a.metadata?.line ?? '0', 10);
          const lineB = parseInt(b.metadata?.line ?? '0', 10);
          return lineA - lineB;
        });

        // Build output: each function with its calls and callers
        const outputLines: string[] = [];
        outputLines.push(`${resolvedMod} — ${sorted.length} functions/methods:\n`);

        for (const fnTriple of sorted) {
          const fnId = fnTriple.object;
          const line = fnTriple.metadata?.line ? `:${fnTriple.metadata.line}` : '';
          const kind = fnTriple.metadata?.nodeType ?? 'function';
          const cls = fnTriple.metadata?.className ? `[${fnTriple.metadata.className}] ` : '';

          // What does this function call?
          const callsOut = graph.query({ subject: fnId, predicate: 'calls' });
          // What calls this function?
          const callsIn = graph.query({ predicate: 'calls', object: fnId });

          const params = fnTriple.metadata?.params ?? '';
          const retType = fnTriple.metadata?.returnType ? `: ${fnTriple.metadata.returnType}` : '';
          const signature = params ? `${params}${retType}` : '';
          outputLines.push(`${cls}${fnId}${line} (${kind}) ${signature}`.trimEnd());

          if (callsOut.length > 0) {
            const targets = callsOut.slice(0, 10).map(t => t.object);
            const more = callsOut.length > 10 ? ` +${callsOut.length - 10} more` : '';
            outputLines.push(`  → calls: ${targets.join(', ')}${more}`);
          }
          if (callsIn.length > 0) {
            const callers = callsIn.slice(0, 10).map(t => t.subject);
            const more = callsIn.length > 10 ? ` +${callsIn.length - 10} more` : '';
            outputLines.push(`  ← called by: ${callers.join(', ')}${more}`);
          }
        }

        return { success: true, output: outputLines.join('\n') };
      }

      default:
        return { success: false, error: `Unknown graph operation: ${operation}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['build', 'summary', 'search', 'symbols', 'graph_query', 'graph_neighbors', 'graph_path', 'graph_stats', 'graph_file_functions'], description: 'The operation to perform' },
          query: { type: 'string', description: 'Search query or entity name for graph operations' },
          target: { type: 'string', description: 'Target entity for graph_path' },
          depth: { type: 'number', description: 'Depth for graph_neighbors (default 2, max 4)' },
          predicate: { type: 'string', description: 'Predicate filter for graph_query' },
          node_type: { type: 'string', description: 'Node type filter for graph_query' },
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
    if (d.operation === 'graph_neighbors' && typeof d.query !== 'string') return { valid: false, errors: ['query (entity) is required for graph_neighbors'] };
    if (d.operation === 'graph_path' && (typeof d.query !== 'string' || typeof d.target !== 'string')) return { valid: false, errors: ['query (source) and target are required for graph_path'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['codebase', 'map', 'structure', 'symbols', 'dependencies', 'search', 'graph', 'imports', 'neighbors', 'path', 'architecture', 'layers', 'components'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
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
        const provider = detectProviderFromEnv();
        if (!provider) {
          return { success: false, error: 'No AI provider configured for parallel subagents. Run `buddy login chatgpt` or set a provider API key.' };
        }
        const { getParallelSubagentRunner } = await import('../../agent/subagents.js');
        const runner = getParallelSubagentRunner(provider.apiKey, provider.baseURL, provider.defaultModel);

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

    const provider = detectProviderFromEnv();
    if (!provider) {
      return { success: false, error: 'No AI provider configured for subagent. Run `buddy login chatgpt` or set a provider API key.' };
    }

    // Pipeline integration: use _input as task if task is generic, and _context as context
    const finalTask = (task === 'process' || !task) ? (input._input as string || task) : task;
    const finalContext = context || (input._context as string) || (input._input as string);

    const subagent = new Subagent(provider.apiKey, config, provider.baseURL, provider.defaultModel);
    const result = await subagent.run(finalTask, finalContext);

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
    new CodeGraphToolAdapter(),
  ];
}

/**
 * Thin adapter that lazy-loads the full CodeGraphTool on first execute.
 */
class CodeGraphToolAdapter implements ITool {
  readonly name = 'code_graph';
  readonly description = 'Query the code dependency graph: find callers, callees, impact analysis, generate flowcharts, class hierarchies, and dependency paths';
  private _inner: ITool | null = null;

  private async inner(): Promise<ITool> {
    if (!this._inner) {
      const { CodeGraphTool } = await import('./code-graph-tools.js');
      this._inner = new CodeGraphTool();
    }
    return this._inner;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return (await this.inner()).execute(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['who_calls', 'what_calls', 'impact', 'flowchart', 'class_tree', 'file_map', 'find_path', 'module_deps', 'stats'], description: 'The operation to perform' },
          query: { type: 'string', description: 'Function, class, or module name' },
          target: { type: 'string', description: 'Target entity for find_path' },
          depth: { type: 'number', description: 'Depth (default 2, max 6)' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (!d.operation) return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'codebase' as ToolCategoryType, keywords: ['code graph', 'call graph', 'who calls', 'callers', 'impact', 'flowchart', 'mermaid', 'diagram', 'class hierarchy', 'inheritance', 'dependencies'], priority: 7, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}
