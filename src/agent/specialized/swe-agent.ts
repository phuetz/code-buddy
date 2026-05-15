/**
 * SWE Agent — OpenManus-compatible
 * Specialized agent for software engineering tasks.
 * Tools: Bash, StrReplaceEditor, Terminate
 * Follows the SWE-agent ACI pattern (Agent-Computer Interface).
 */

import { EventEmitter } from 'events';
import { AgentStateMachine, AgentStatus } from '../state-machine.js';
import { TERMINATE_SIGNAL } from '../../tools/terminate-tool.js';
import type { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import { formatToolResultContent } from '../../utils/tool-result-content.js';

/** SWE Agent configuration */
export interface SWEAgentConfig {
  /** Maximum execution steps */
  maxSteps: number;
  /** Maximum characters to show from tool output */
  maxObserve: number;
  /** LLM call function */
  llmCall: (messages: SWEMessage[], tools: SWETool[]) => Promise<SWELLMResponse>;
  /** Tool execution function */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<SWEToolResult>;
  /** Optional code graph for file context injection */
  graph?: KnowledgeGraph;
}

export interface SWEMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: SWEToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface SWEToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface SWETool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface SWELLMResponse {
  content: string;
  tool_calls: SWEToolCall[];
}

export interface SWEToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/** SWE-specific system prompt */
const SWE_SYSTEM_PROMPT = `You are a software engineering agent specialized in code editing, debugging, and repository-level tasks.

## Available Tools
- **bash**: Execute shell commands (git, npm, grep, find, test runners, etc.)
- **str_replace_editor**: View, create, and edit files with precise string replacement
- **terminate**: Signal when the task is complete

## Workflow
1. **Understand**: Read relevant files, check git status, understand the codebase structure
2. **Locate**: Find the exact code that needs to change (use grep, find, view_file)
3. **Edit**: Make precise, minimal changes using str_replace_editor
4. **Verify**: Run tests, linters, or type checkers to validate your changes
5. **Terminate**: Call terminate with a summary when done

## Rules
- Always read a file before editing it
- Use str_replace_editor for code changes (not sed/awk via bash)
- Run tests after making changes to verify correctness
- Make minimal, focused changes — don't refactor unrelated code
- If stuck, try a different approach rather than repeating the same action`;

/** SWE Agent tool definitions */
const SWE_TOOLS: SWETool[] = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command. Use for: running tests, git operations, searching files, installing packages, checking status.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'str_replace_editor',
      description: 'View, create, or edit files. Commands: view (read file), create (new file), str_replace (edit), insert (add lines), undo_edit (revert last edit).',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['view', 'create', 'str_replace', 'insert', 'undo_edit'],
            description: 'The editing command',
          },
          path: { type: 'string', description: 'Absolute file path' },
          old_str: { type: 'string', description: 'String to find (for str_replace)' },
          new_str: { type: 'string', description: 'Replacement string (for str_replace/create)' },
          insert_line: { type: 'number', description: 'Line number to insert after (for insert)' },
          view_range: {
            type: 'array',
            items: { type: 'number' },
            description: 'Line range [start, end] (for view)',
          },
          file_text: { type: 'string', description: 'Full file content (for create)' },
        },
        required: ['command', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminate',
      description: 'Signal that the task is complete. Call when all work is done.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Summary of what was accomplished' },
        },
        required: ['status'],
      },
    },
  },
];

/** Next-step prompt injected after step 0 */
const NEXT_STEP_PROMPT = 'Continue with the next step. If the task is complete, call the terminate tool.';

/** Cached entity extractor — loaded lazily from context provider */
let _extractEntities: ((msg: string) => string[]) | null = null;

/**
 * Set the entity extraction function (called during module initialization).
 */
export function setSWEEntityExtractor(fn: (msg: string) => string[]): void {
  _extractEntities = fn;
}

// Auto-load entity extractor from context provider
import('../../knowledge/code-graph-context-provider.js')
  .then(mod => { _extractEntities = mod.extractEntities; })
  .catch(() => { /* optional — degraded mode without entity extraction */ });

/**
 * Suggest relevant files for a task using the code graph.
 * Extracts entities from the description, resolves them in the graph,
 * then follows dependency edges (BFS) to build an ordered file list.
 */
export function suggestFilesForTask(
  description: string,
  graph: KnowledgeGraph,
  entityExtractor?: (msg: string) => string[],
): string | null {
  if (graph.getStats().tripleCount === 0) return null;

  const extractFn = entityExtractor ?? _extractEntities;
  if (!extractFn) return null;

  const candidates = extractFn(description);
  if (candidates.length === 0) return null;

  // Resolve entities and collect file info
  const fileEntries: Array<{
    entity: string;
    file: string;
    rank: number;
    callerCount: number;
  }> = [];
  const seenEntities = new Set<string>();

  for (const candidate of candidates.slice(0, 8)) {
    const entity = graph.findEntity(candidate);
    if (!entity || seenEntities.has(entity)) continue;
    seenEntities.add(entity);

    // Resolve file path from entity
    let filePath = '';
    if (entity.startsWith('mod:')) {
      filePath = entity.replace(/^mod:/, '');
    } else {
      const definedIn = graph.query({ subject: entity, predicate: 'definedIn' });
      if (definedIn.length > 0) {
        filePath = definedIn[0].object.replace(/^mod:/, '');
      }
    }
    if (!filePath) continue;

    const callers = graph.query({ predicate: 'calls', object: entity });
    const rank = graph.getEntityRank(entity);

    fileEntries.push({ entity, file: filePath, rank, callerCount: callers.length });

    // BFS: also include direct dependencies (1 hop)
    const deps = graph.query({ subject: entity, predicate: 'imports' });
    for (const dep of deps.slice(0, 3)) {
      const depFile = dep.object.replace(/^mod:/, '');
      if (!fileEntries.some(f => f.file === depFile)) {
        fileEntries.push({
          entity: dep.object,
          file: depFile,
          rank: graph.getEntityRank(dep.object),
          callerCount: 0,
        });
      }
    }
  }

  if (fileEntries.length === 0) return null;

  // Sort: dependencies first (low caller count), then by rank
  fileEntries.sort((a, b) => a.callerCount - b.callerCount || b.rank - a.rank);

  // Build context block
  const lines = ['Task affects these files (from dependency graph):'];
  for (let i = 0; i < Math.min(fileEntries.length, 8); i++) {
    const f = fileEntries[i];
    const details: string[] = [];
    if (f.callerCount > 0) details.push(`${f.callerCount} callers`);
    if (f.rank > 0.05) details.push(`PageRank ${f.rank.toFixed(2)}`);
    const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
    lines.push(`${i + 1}. ${f.file}${detailStr}`);
  }
  lines.push('Suggested edit order: dependencies first, then dependents.');

  return lines.join('\n');
}

export class SWEAgent extends EventEmitter {
  readonly name = 'swe-agent';
  readonly description = 'Software Engineering Agent — code editing, debugging, and repository tasks';

  private config: SWEAgentConfig;
  private stateMachine: AgentStateMachine;
  private memory: SWEMessage[] = [];

  constructor(config: SWEAgentConfig) {
    super();
    this.config = config;
    this.stateMachine = new AgentStateMachine(config.maxSteps);

    // Forward state machine events
    this.stateMachine.on('transition', (e) => this.emit('state:transition', e));
    this.stateMachine.on('stuck', (e) => this.emit('state:stuck', e));
    this.stateMachine.on('step', (e) => this.emit('state:step', e));
  }

  /** Current state */
  get status(): AgentStatus {
    return this.stateMachine.status;
  }

  /** Run the SWE agent on a task */
  async run(request: string): Promise<string> {
    // Initialize
    this.memory = [{ role: 'system', content: SWE_SYSTEM_PROMPT }];

    // Inject code graph context if available
    if (this.config.graph) {
      const codeContext = suggestFilesForTask(request, this.config.graph);
      if (codeContext) {
        this.memory.push({ role: 'system', content: `<code_context>\n${codeContext}\n</code_context>` });
      }
    }

    // Inject docs context for architecture awareness
    try {
      const { getDocsContextProvider } = await import('../../docs/docs-context-provider.js');
      const dp = getDocsContextProvider();
      if (dp.isLoaded) {
        const docsCtx = dp.getRelevantContext(request, 800);
        if (docsCtx) {
          this.memory.push({ role: 'system', content: `<docs_context>\n${docsCtx}\n</docs_context>` });
        }
      }
    } catch { /* docs optional */ }

    this.memory.push({ role: 'user', content: request });

    this.stateMachine.start(`SWE task: ${request.substring(0, 80)}`);
    this.emit('run:start', { request });

    let finalResult = '';

    try {
      while (this.stateMachine.canContinue) {
        // Inject next-step prompt after first step
        if (this.stateMachine.currentStep > 0) {
          this.memory.push({ role: 'user', content: NEXT_STEP_PROMPT });
        }

        const result = await this.step();

        if (result !== null) {
          finalResult = result;
          break;
        }

        if (!this.stateMachine.incrementStep()) {
          finalResult = `Max steps (${this.config.maxSteps}) reached.`;
          break;
        }
      }

      this.stateMachine.finish(finalResult.substring(0, 200));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.stateMachine.fail(error);
      finalResult = `Error: ${error.message}`;
    }

    this.emit('run:complete', {
      result: finalResult,
      steps: this.stateMachine.currentStep,
      elapsed: this.stateMachine.elapsedMs,
    });

    return finalResult;
  }

  /** Single think-act step. Returns string if terminal, null to continue. */
  private async step(): Promise<string | null> {
    // Think: call LLM
    this.stateMachine.think();
    this.emit('step:think', { step: this.stateMachine.currentStep });

    const response = await this.config.llmCall(this.memory, SWE_TOOLS);

    // Record for stuck detection
    const responseKey = response.content + JSON.stringify(response.tool_calls?.map((tc) => tc.function.name));
    if (this.stateMachine.recordResponse(responseKey)) {
      // Stuck detected — inject perturbation
      const perturbation = this.stateMachine.handleStuckState();
      this.memory.push({ role: 'user', content: perturbation });
      this.emit('step:stuck_recovery', { step: this.stateMachine.currentStep });
      // Return to RUNNING so next step() can call think() again
      this.stateMachine.transition(AgentStatus.RUNNING, 'Stuck recovery');
      return null; // Continue with perturbation
    }

    // Store assistant message
    const assistantMsg: SWEMessage = {
      role: 'assistant',
      content: response.content,
    };
    if (response.tool_calls?.length) {
      assistantMsg.tool_calls = response.tool_calls;
    }
    this.memory.push(assistantMsg);

    // No tool calls → terminal response
    if (!response.tool_calls?.length) {
      if (response.content.trim().length === 0) {
        throw new Error('SWE agent returned no terminal response');
      }
      return response.content;
    }

    // Act: execute tools
    this.stateMachine.act();
    this.emit('step:act', { step: this.stateMachine.currentStep, toolCount: response.tool_calls.length });

    for (const toolCall of response.tool_calls) {
      const name = toolCall.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = { raw: toolCall.function.arguments };
      }

      const result = await this.config.executeTool(name, args);

      // Check for terminate signal
      if (result.output?.startsWith(TERMINATE_SIGNAL)) {
        const status = result.output.replace(TERMINATE_SIGNAL, '').trim();
        this.memory.push({
          role: 'tool',
          content: status,
          tool_call_id: toolCall.id,
          name,
        });
        return status;
      }

      // Truncate large outputs
      let output = result.success
        ? formatToolResultContent(result)
        : `Error: ${formatToolResultContent(result)}`;

      if (output.length > this.config.maxObserve) {
        output = output.substring(0, this.config.maxObserve) + `\n... (truncated, ${output.length} chars total)`;
      }

      this.memory.push({
        role: 'tool',
        content: output,
        tool_call_id: toolCall.id,
        name,
      });

      this.emit('tool:result', { tool: name, success: result.success, length: output.length });
    }

    // Return to running state for next think-act cycle
    this.stateMachine.transition(AgentStatus.RUNNING, 'Tools executed');
    return null;
  }

  /** Get conversation memory */
  getMemory(): ReadonlyArray<SWEMessage> {
    return this.memory;
  }

  /** Get state machine snapshot */
  getState(): Record<string, unknown> {
    return this.stateMachine.toJSON();
  }
}

/**
 * Factory: create SWE agent with Code Buddy's existing infrastructure.
 * Bridges SWE agent's interface with the existing ToolHandler and CodeBuddyClient.
 */
export function createSWEAgent(config: {
  maxSteps?: number;
  maxObserve?: number;
  llmCall: SWEAgentConfig['llmCall'];
  executeTool: SWEAgentConfig['executeTool'];
}): SWEAgent {
  return new SWEAgent({
    maxSteps: config.maxSteps ?? 20,
    maxObserve: config.maxObserve ?? 10000,
    llmCall: config.llmCall,
    executeTool: config.executeTool,
  });
}
