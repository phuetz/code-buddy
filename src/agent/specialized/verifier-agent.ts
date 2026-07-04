/**
 * Verifier Agent — the tester is not the coder, and it hands back evidence.
 *
 * A 9th built-in specialized agent implementing the Replit-Agent-3 /
 * Claude-Code doctrine "show evidence rather than asserting success". The
 * Verifier runs with a FRESH context and inherits none of the coder's claims:
 * its job is to establish whether a task actually works by reproducing it and
 * running real oracles (app_server → web_test → console/network/server logs,
 * or the real test suite, or a real API request), then to return a STRUCTURED
 * verdict backed by the raw evidence — CONFIRMED or NEEDS REVIEW.
 *
 * It is delegated explicitly (like CodeGuardian / SecurityReview) via
 * `AgentRegistry.executeOn('verifier', task)`; it never auto-triggers and
 * never routes by file extension (fileExtensions is empty on purpose so it
 * stays out of the file-based auto-matcher and cannot shadow SWE/CodeGuardian).
 *
 * Toolset: read + execute verification tools only. Destructive write tools
 * (create_file, write_file, str_replace_editor, multi_edit, apply_patch) are
 * denied and refused fail-closed — a verifier inspects and runs, it does not
 * code.
 */

import {
  SpecializedAgent,
  type SpecializedAgentConfig,
  type AgentTask,
  type AgentResult,
} from './types.js';
// Reuse the SWE message/tool shapes so the same llmCall / executeTool bridge
// used by the SWE agent works unchanged for the Verifier.
import type {
  SWEMessage,
  SWETool,
  SWELLMResponse,
  SWEToolResult,
} from './swe-agent.js';

// ============================================================================
// Doctrine system prompt
// ============================================================================

/**
 * The Verifier's role/doctrine. The uppercase contract markers
 * (CONFIRMED / NEEDS REVIEW) and the "evidence" / "never assert success
 * without proof" phrasing are stable and asserted by tests — keep them.
 */
export const VERIFIER_SYSTEM_PROMPT = `You are an INDEPENDENT VERIFIER running with a FRESH CONTEXT.

Your mission is to establish whether a piece of work ACTUALLY WORKS — not whether someone claims it does. You inherit NONE of the coder's assumptions or self-reported success. The coder is not the tester; you are the tester, and you hand back evidence.

## Method: reproduce -> run real oracles -> SHOW THE EVIDENCE
1. Reproduce the change/flow in a real environment.
2. Run real oracles for what is being verified:
   - Web UI: start the dev server with \`app_server\`, then run \`web_test\` (with assertions, and interaction steps if a flow is involved), and read the console / network / server-log evidence it returns; stop the server with \`app_server\` when done.
   - Code: run the real test suite (\`task_verify\` / the project's tests) and re-read the diff.
   - API: make a real request and inspect the real response/status.
3. Collect the RAW evidence — actual test output, the web_test report, network status codes, log excerpts — never a paraphrase.

## Rules
- NEVER assert success without proof. A claim with no evidence is NEEDS REVIEW.
- A FAILED test is useful INFORMATION, not a failure of your mission: report it with its evidence.
- Prefer "NEEDS REVIEW" to optimistic doubt. If you could not run an oracle, say so and why.
- You are read-only: you may read, search, run tests, and drive the app, but you MUST NOT edit, write, or patch files.

## Output: a structured verdict
- WHAT WAS VERIFIED: the checks you attempted.
- RESULT PER CHECK: pass / fail for each, one line each.
- EVIDENCE: the real output for each check (test output, web_test report, network status, log excerpt) — quoted, not summarized.
- FINAL VERDICT: exactly one of
  - CONFIRMED — every check passed with evidence to back it.
  - NEEDS REVIEW — something failed, was unproven, or could not be run (list what is missing).`;

// ============================================================================
// Toolset
// ============================================================================

/** Read + execute verification tools the Verifier is allowed to drive. */
export const VERIFIER_ALLOWED_TOOLS = [
  'app_server',
  'web_test',
  'browser',
  'browser_console',
  'browser_snapshot',
  'browser_navigate',
  'task_verify',
  'execute_code',
  'bash',
  'view_file',
  'read_file',
  'list_directory',
  'search',
  'search_files',
];

/** Destructive write tools — a verifier reads and executes, it does not code. */
export const VERIFIER_DENIED_TOOLS = [
  'create_file',
  'write_file',
  'str_replace_editor',
  'multi_edit',
  'apply_patch',
];

export const VERIFIER_AGENT_CONFIG: SpecializedAgentConfig = {
  id: 'verifier',
  name: 'Verifier',
  description:
    'Independent fresh-context verifier: reproduces a task, runs real oracles (app_server/web_test/tests/API) and returns a CONFIRMED or NEEDS REVIEW verdict backed by evidence',
  capabilities: ['code-verify'],
  // Empty on purpose: the Verifier is delegated explicitly and must never win
  // the file-extension auto-matcher (which would alter existing agent routing).
  fileExtensions: [],
  systemPrompt: VERIFIER_SYSTEM_PROMPT,
  allowedTools: VERIFIER_ALLOWED_TOOLS,
  deniedTools: VERIFIER_DENIED_TOOLS,
  requiredTools: [],
};

const VERIFIER_ACTIONS: Record<string, string> = {
  verify:
    'Independently verify that a task works by reproducing it and running real oracles, then return a CONFIRMED / NEEDS REVIEW verdict with evidence',
};

/** Tool schemas advertised to the LLM (names must match the executeTool bridge). */
const VERIFIER_TOOLS: SWETool[] = [
  {
    type: 'function',
    function: {
      name: 'app_server',
      description:
        'Start/stop a managed local dev server and get its loopback URL for testing the app. Actions: start, stop, status.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'] },
          command: { type: 'string', description: 'Command to start the server (e.g. "npm run dev")' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_test',
      description:
        'One-call structured UI test with evidence: console + server logs + snapshot + screenshot + assertions + interaction steps.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to test' },
          assertions: { type: 'array', items: { type: 'object' }, description: 'Assertions to check' },
          steps: { type: 'array', items: { type: 'object' }, description: 'Interaction steps to perform first' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_verify',
      description: 'Run the verification contract for the repo (typecheck, tests, lint) and return the real output.',
      parameters: {
        type: 'object',
        properties: {
          checks: { type: 'array', items: { type: 'string' }, description: 'Subset of checks to run (default all)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command to run tests, make a real API request (curl), or inspect state. Read-only intent.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_file',
      description: 'Read a file to inspect the change under verification.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the codebase for a pattern to locate what to verify.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
];

// ============================================================================
// Agent
// ============================================================================

type LlmCall = (messages: SWEMessage[], tools: SWETool[]) => Promise<SWELLMResponse>;
type ExecuteTool = (name: string, args: Record<string, unknown>) => Promise<SWEToolResult>;

/**
 * SpecializedAgent-compatible Verifier. Delegated via
 * `registry.executeOn('verifier', { action: 'verify', params: { llmCall, executeTool, instruction } })`.
 */
export class VerifierAgent extends SpecializedAgent {
  constructor() {
    super(VERIFIER_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.emit('initialized');
  }

  getSupportedActions(): string[] {
    return Object.keys(VERIFIER_ACTIONS);
  }

  getActionHelp(action: string): string {
    return VERIFIER_ACTIONS[action] || `Unknown action: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();

    // Validate the callable params at the boundary (mirrors the SWE adapter),
    // so a malformed delegation fails with a clear message.
    const llmCall = task.params?.llmCall;
    const executeTool = task.params?.executeTool;
    if (typeof llmCall !== 'function') {
      return { success: false, error: 'Verifier requires task.params.llmCall to be a function' };
    }
    if (typeof executeTool !== 'function') {
      return { success: false, error: 'Verifier requires task.params.executeTool to be a function' };
    }

    const maxSteps = (task.params?.maxSteps as number) ?? 12;
    const maxObserve = (task.params?.maxObserve as number) ?? 10000;

    try {
      const verdict = await this.runVerificationLoop(
        this.buildRequest(task),
        llmCall as LlmCall,
        this.gate(executeTool as ExecuteTool),
        maxSteps,
        maxObserve,
      );

      const confirmed = /\bCONFIRMED\b/.test(verdict) && !/\bNEEDS REVIEW\b/.test(verdict);

      return {
        success: true,
        output: verdict,
        duration: Date.now() - start,
        metadata: { verdict: confirmed ? 'CONFIRMED' : 'NEEDS REVIEW' },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Wrap executeTool with the toolset gate: a denied/non-allowed tool is
   * refused fail-closed and never reaches the real executor.
   */
  private gate(executeTool: ExecuteTool): ExecuteTool {
    return async (name: string, args: Record<string, unknown>): Promise<SWEToolResult> => {
      if (!this.isToolAllowed(name)) {
        return {
          success: false,
          error: `Tool "${name}" is not permitted for the Verifier. The Verifier is read-only (reads, searches, runs tests, drives the app) and must not edit, write, or patch files.`,
        };
      }
      return executeTool(name, args);
    };
  }

  private buildRequest(task: AgentTask): string {
    const parts: string[] = [];
    if (task.params?.instruction) parts.push(String(task.params.instruction));
    if (task.inputFiles?.length) parts.push(`Files under verification: ${task.inputFiles.join(', ')}`);
    if (task.data) parts.push(String(task.data));
    return parts.join('\n') || 'Independently verify that the described work actually functions and hand back evidence.';
  }

  private async runVerificationLoop(
    request: string,
    llmCall: LlmCall,
    executeTool: ExecuteTool,
    maxSteps: number,
    maxObserve: number,
  ): Promise<string> {
    const messages: SWEMessage[] = [
      { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
      { role: 'user', content: request },
    ];

    let lastContent = '';

    for (let step = 0; step < maxSteps; step++) {
      const response = await llmCall(messages, VERIFIER_TOOLS);
      lastContent = response.content || lastContent;

      const assistantMsg: SWEMessage = { role: 'assistant', content: response.content };
      if (response.tool_calls?.length) assistantMsg.tool_calls = response.tool_calls;
      messages.push(assistantMsg);

      // No tool calls => the model has produced its final verdict.
      if (!response.tool_calls?.length) {
        return response.content || lastContent || 'NEEDS REVIEW — verifier produced no output.';
      }

      for (const toolCall of response.tool_calls) {
        const name = toolCall.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = { raw: toolCall.function.arguments };
        }

        const result = await executeTool(name, args);
        let output = result.success
          ? result.output || 'Success (no output)'
          : `Error: ${result.error || 'Unknown error'}`;
        if (output.length > maxObserve) {
          output = output.substring(0, maxObserve) + `\n... (truncated, ${output.length} chars total)`;
        }

        messages.push({ role: 'tool', content: output, tool_call_id: toolCall.id, name });
      }
    }

    // Ran out of steps without a clean final answer: fail honest.
    return (
      lastContent +
      `\n\nFINAL VERDICT: NEEDS REVIEW — verification did not converge within ${maxSteps} steps; evidence above is incomplete.`
    );
  }
}

// ============================================================================
// Singleton
// ============================================================================

let verifierInstance: VerifierAgent | null = null;

export function getVerifierAgent(): VerifierAgent {
  if (!verifierInstance) verifierInstance = new VerifierAgent();
  return verifierInstance;
}

export function resetVerifierAgent(): void {
  verifierInstance = null;
}
