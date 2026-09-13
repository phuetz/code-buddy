import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ToolResult } from '../types/index.js';
import type { CodeBuddyTool } from '../codebuddy/tool-definitions/types.js';
import { BM25Index } from '../tools/tool-search.js';
import { CodeExecTool, attachCodeExecRuntime, clearCodeExecSession } from '../tools/code-exec-tool.js';
import { TOOL_METADATA } from '../tools/metadata.js';
import { BoundedOutput } from '../utils/bounded-output.js';

export interface ToolHarnessOptions {
  cwd: string;
  tools: readonly CodeBuddyTool[];
  /** Must use the host's normal permission and validation pipeline. */
  dispatch: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>;
  /** Only tools proven safe for concurrent reads; other calls form FIFO barriers. */
  parallelTools?: readonly string[];
}

interface Execution {
  controller: AbortController;
  output: BoundedOutput;
  completed: Promise<void>;
  result?: ToolResult;
  waiting: boolean;
  notify?: () => void;
}

export interface HarnessWaitResult {
  sessionId: string;
  status: 'running' | 'completed';
  output: string;
  result?: ToolResult;
}

/** Model-independent tool harness. No LLM client, process-global cwd, or global tool index. */
export class ToolHarness {
  private readonly id = randomUUID();
  private readonly catalog = new BM25Index();
  private readonly tools: Map<string, CodeBuddyTool>;
  private readonly executions = new Map<string, Execution>();
  private disposed = false;
  readonly cwd: string;

  constructor(private readonly options: ToolHarnessOptions) {
    this.cwd = path.resolve(options.cwd);
    this.tools = new Map(options.tools.filter(tool => !['code_exec', 'exec'].includes(tool.function.name))
      .map(tool => [tool.function.name, tool]));
    this.catalog.index([...this.tools.values()].map(tool => ({
      name: tool.function.name, description: tool.function.description ?? '', parameters: tool.function.parameters,
    })));
  }

  search(query: string, maxResults = 10) {
    return this.catalog.search(query, maxResults).map(result => ({ ...result, parameters: this.catalog.getTool(result.name)?.parameters }));
  }

  async call(name: string, args: Record<string, unknown> = {}, signal = new AbortController().signal): Promise<ToolResult> {
    if (this.disposed || signal.aborted) return { success: false, error: 'Harness call cancelled' };
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { success: false, error: 'Tool arguments must be an object' };
    if (name === 'tool_search') {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 2000) return { success: false, error: 'query must be a nonempty string of at most 2000 characters' };
      if (args.max_results !== undefined && (typeof args.max_results !== 'number' || !Number.isInteger(args.max_results) || args.max_results < 1 || args.max_results > 50)) return { success: false, error: 'max_results must be an integer between 1 and 50' };
      const tools = this.search(args.query, typeof args.max_results === 'number' ? args.max_results : 10);
      return { success: true, output: JSON.stringify(tools), data: { tools, names: tools.map(tool => tool.name) } };
    }
    if (!this.tools.has(name)) return { success: false, error: `Tool is not available: ${name}` };
    try { return await this.options.dispatch(name, args, signal); }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  /** Start an isolated JavaScript cell. Effects always route through call(). */
  start(code: string, options: { timeoutMs?: number; typecheck?: boolean } = {}): string {
    if (this.disposed) throw new Error('Harness is disposed');
    for (const [id, execution] of this.executions) {
      if (this.executions.size < 32) break;
      if (execution.result && !execution.waiting) this.executions.delete(id);
    }
    if (this.executions.size >= 32) throw new Error('Harness execution limit reached');
    const sessionId = randomUUID();
    const execution: Execution = {
      controller: new AbortController(), output: new BoundedOutput(64 * 1024), completed: Promise.resolve(), waiting: false,
    };
    const context = attachCodeExecRuntime({ cwd: this.cwd, sessionId: this.id }, {
      scopeId: `harness:${this.id}`, sessionId: this.id, cwd: this.cwd,
      availableTools: [...new Set([...this.tools.keys(), 'tool_search'])],
      toolCatalog: [...this.tools.values()].map(tool => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })),
      toolMetadata: [...this.tools.values()].map(tool => ({ name: tool.function.name, description: tool.function.description ?? '' })),
      parallelTools: this.options.parallelTools,
      executor: (name, args, signal) => this.call(name, args, signal),
      abortSignal: execution.controller.signal,
      onOutput: delta => { execution.output.append(delta); execution.notify?.(); },
    });
    execution.completed = new CodeExecTool().execute({ code, typecheck: options.typecheck, ...(options.timeoutMs !== undefined ? { timeout_ms: options.timeoutMs } : {}) }, context)
      .then(result => { execution.result = result; })
      .catch(error => { execution.result = { success: false, error: error instanceof Error ? error.message : String(error) }; });
    this.executions.set(sessionId, execution);
    return sessionId;
  }

  /** Consume only new explicit yield output; the final result includes the complete bounded output. */
  async wait(sessionId: string, yieldTimeMs = 1000): Promise<HarnessWaitResult> {
    const execution = this.executions.get(sessionId);
    if (!execution) throw new Error('Unknown harness execution');
    if (execution.waiting) throw new Error('Only one consumer may wait on an execution');
    if (!Number.isFinite(yieldTimeMs) || yieldTimeMs < 0 || yieldTimeMs > 60000) throw new Error('yieldTimeMs must be between 0 and 60000');
    execution.waiting = true;
    let timer: NodeJS.Timeout | undefined;
    try {
      if (!execution.result && !execution.output.retainedBytes) {
        await Promise.race([execution.completed, new Promise<void>(resolve => { execution.notify = resolve; timer = setTimeout(resolve, yieldTimeMs); })]);
      }
      return { sessionId, status: execution.result ? 'completed' : 'running', output: execution.output.drain(), ...(execution.result ? { result: execution.result } : {}) };
    } finally { clearTimeout(timer); execution.waiting = false; execution.notify = undefined; }
  }

  cancel(sessionId: string): void {
    const execution = this.executions.get(sessionId);
    if (!execution) throw new Error('Unknown harness execution');
    execution.controller.abort();
  }

  async exec(code: string, options: { timeoutMs?: number; signal?: AbortSignal; typecheck?: boolean } = {}): Promise<ToolResult> {
    if (options.signal?.aborted) return { success: false, error: 'Harness call cancelled' };
    const sessionId = this.start(code, options);
    const execution = this.executions.get(sessionId)!;
    const abort = (): void => execution.controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    try { await execution.completed; return execution.result!; }
    finally { options.signal?.removeEventListener('abort', abort); this.executions.delete(sessionId); }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const execution of this.executions.values()) execution.controller.abort();
    await Promise.all([...this.executions.values()].map(execution => execution.completed));
    this.executions.clear();
    clearCodeExecSession(this.id);
  }
}

/** Bind an existing agent, preserving ToolHandler's policy, approvals and project scope. */
export async function createAgentToolHarness(agent: {
  getMemoryScope(): { cwd: string; botId?: string };
  executeToolByName(name: string, args: Record<string, unknown>, extra?: Record<string, unknown>): Promise<ToolResult>;
}, tools?: readonly CodeBuddyTool[]): Promise<ToolHarness> {
  const catalog = tools ?? await (await import('../codebuddy/tools.js')).getAllCodeBuddyTools();
  const scope = agent.getMemoryScope();
  const cwd = path.resolve(scope.cwd);
  const botId = scope.botId;
  return new ToolHarness({ cwd, tools: catalog, parallelTools: TOOL_METADATA.filter(tool => tool.fleetSafe === true && tool.effect === 'read').map(tool => tool.name), dispatch: (name, args, abortSignal) => {
    const currentScope = agent.getMemoryScope();
    if (path.resolve(currentScope.cwd) !== cwd) return Promise.resolve({ success: false, error: 'Agent workspace changed; create a new harness' });
    if (currentScope.botId !== botId) return Promise.resolve({ success: false, error: 'Agent bot changed; create a new harness' });
    return agent.executeToolByName(name, args, { abortSignal });
  } });
}
