/**
 * Delegate Agent Tool Adapter
 *
 * ITool-compliant adapter that makes the built-in SPECIALIZED agents REACHABLE
 * at runtime as a single LLM tool. The agent calls `delegate_agent` to hand a
 * bounded, multi-step task to a purpose-built agent from the `AgentRegistry`:
 *   - pdf           → PDF agent (extract / metadata / analyze / search / summarize)
 *   - excel         → Excel agent (read / write / sheets / convert / filter / stats / merge)
 *   - data_analysis → DataAnalysis agent (analyze / transform / aggregate / pivot / correlate / …)
 *   - sql           → SQL agent (query / tables / schema / import / export / create)
 *   - archive       → Archive agent (list / extract / create / info / add / remove)
 *   - swe           → SWE agent (edit / debug / refactor / analyze / run) — LLM-driven
 *
 * Why one tool and not six: the deterministic agents (pdf/excel/data/sql/archive)
 * overlap partially with existing single-shot tools (`pdf`, `document`, `archive`)
 * but expose richer multi-step actions (SQL querying, dataframe pivots/correlation,
 * xlsx stats/merge) that no exposed tool covers. Rather than wire six adapters,
 * this one delegate opens the whole registry via `registry.executeOn(id, task)`.
 *
 * LLM-driven agents (currently `swe`) need an `llmCall` (to reason) and an
 * `executeTool` (to drive tools). Those are supplied once at boot by the host
 * CodeBuddyAgent via `setDelegateAgentProvider()` — reusing the exact plumbing
 * the `verify` tool uses (`setVerifyToolProvider`). Deterministic agents ignore
 * the injected bridge. When `swe` is requested with no provider wired, the tool
 * fails closed with a clear configuration error (never a silent no-op).
 *
 * The `verifier` agent has its own dedicated tool (`verify`) and is intentionally
 * NOT routed here.
 */

import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  IToolExecutionContext,
  ToolSchema,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
} from './types.js';
import type {
  SWEMessage,
  SWETool,
  SWELLMResponse,
  SWEToolResult,
} from '../../agent/specialized/swe-agent.js';

/** LLM bridge an LLM-driven specialized agent reasons through (SWE agent shape). */
export type DelegateLlmCall = (messages: SWEMessage[], tools: SWETool[]) => Promise<SWELLMResponse>;
/** Tool executor an LLM-driven specialized agent drives. */
export type DelegateExecuteTool = (
  name: string,
  args: Record<string, unknown>,
  executionExtra?: Record<string, unknown>,
) => Promise<SWEToolResult>;

/**
 * The callable bridge the host injects so `delegate_agent` can run LLM-driven
 * specialized agents (SWE). Kept behind a provider (not imported statically) so
 * the tool module has no dependency on a live LLM client — the agent owns that.
 */
export interface DelegateAgentProvider {
  llmCall: DelegateLlmCall;
  executeTool: DelegateExecuteTool;
}

let _delegateProvider: (() => DelegateAgentProvider) | null = null;

/**
 * Wire the llmCall + executeTool bridge for the `delegate_agent` tool. Called
 * once from codebuddy-agent.ts with the agent's own client + tool executor —
 * the single tolerated contact point, identical to `setVerifyToolProvider`.
 */
export function setDelegateAgentProvider(provider: () => DelegateAgentProvider): void {
  _delegateProvider = provider;
}

/** Reset the provider (for testing). */
export function resetDelegateAgentProvider(): void {
  _delegateProvider = null;
}

/** Friendly tool-facing agent name → AgentRegistry id. */
const AGENT_ID_BY_ALIAS: Record<string, string> = {
  pdf: 'pdf-agent',
  excel: 'excel-agent',
  data_analysis: 'data-analysis-agent',
  data: 'data-analysis-agent',
  sql: 'sql-agent',
  archive: 'archive-agent',
  swe: 'swe',
};

/** Agents that are LLM-driven and therefore require the injected bridge. */
const LLM_DRIVEN_AGENT_IDS = new Set<string>(['swe']);

/** Default action per agent when the caller omits one. */
const DEFAULT_ACTION_BY_ID: Record<string, string> = {
  'pdf-agent': 'extract',
  'excel-agent': 'read',
  'data-analysis-agent': 'analyze',
  'sql-agent': 'query',
  'archive-agent': 'list',
  swe: 'run',
};

export class DelegateAgentTool implements ITool {
  readonly name = 'delegate_agent';
  readonly description =
    'Delegate a bounded, multi-step task to a built-in specialized agent: ' +
    'pdf (extract/analyze/search/summarize PDFs), excel (read/write/stats/merge XLSX), ' +
    'data_analysis (analyze/transform/aggregate/pivot/correlate tabular data), ' +
    'sql (query/schema/import/export databases), archive (list/extract/create zip/tar/7z), ' +
    'or swe (autonomous code edit/debug/refactor). Use for domain work an existing single tool does not cover.';

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const alias = typeof input.agent === 'string' ? input.agent.trim().toLowerCase() : '';
    const agentId = AGENT_ID_BY_ALIAS[alias];
    if (!agentId) {
      return {
        success: false,
        error: `delegate_agent: unknown agent "${input.agent}". Valid agents: ${Object.keys(AGENT_ID_BY_ALIAS).join(', ')}.`,
      };
    }

    const instruction =
      typeof input.instruction === 'string' && input.instruction.trim()
        ? input.instruction.trim()
        : typeof input.task === 'string' && input.task.trim()
          ? input.task.trim()
          : undefined;
    const action =
      typeof input.action === 'string' && input.action.trim()
        ? input.action.trim()
        : DEFAULT_ACTION_BY_ID[agentId] ?? 'run';
    const filePath = typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath.trim() : undefined;
    const userParams =
      input.params && typeof input.params === 'object' && !Array.isArray(input.params)
        ? (input.params as Record<string, unknown>)
        : {};

    const needsBridge = LLM_DRIVEN_AGENT_IDS.has(agentId);
    if (needsBridge && !_delegateProvider) {
      // Fail closed: the LLM-driven agent needs the bridge and the host never
      // wired it. Surface a clear config error instead of a cryptic deep failure.
      return {
        success: false,
        error:
          `delegate_agent: the "${alias}" agent is LLM-driven and needs an LLM bridge, ` +
          'but setDelegateAgentProvider was never called. This is a configuration error.',
      };
    }

    // Specialized agents read their input file directly (readFileSync):
    // apply the same credential deny list as view_file before handing it over.
    if (filePath) {
      const { checkSecretFileAccess, formatSecretRefusal } = await import('../../security/secret-files.js');
      const secret = checkSecretFileAccess(filePath, 'read', { baseDir: context?.cwd ?? process.cwd() });
      if (secret.secret) {
        return { success: false, error: formatSecretRefusal(filePath, secret) };
      }
    }

    try {
      const bridge = _delegateProvider ? _delegateProvider() : undefined;

      const { AgentRegistry } = await import('../../agent/specialized/agent-registry.js');
      const registry = new AgentRegistry();
      await registry.registerBuiltInAgents();

      const result = await registry.executeOn(agentId, {
        action,
        inputFiles: filePath ? [filePath] : undefined,
        params: {
          ...userParams,
          ...(instruction ? { instruction } : {}),
          ...(context?.cwd ? { workspaceRoot: context.cwd } : {}),
          // Injected bridge is harmless for deterministic agents (they read
          // their own action-specific params) and required for LLM-driven ones.
          ...(bridge ? { llmCall: bridge.llmCall, executeTool: bridge.executeTool } : {}),
        },
      });

      if (!result.success) {
        return { success: false, error: result.error || `Agent "${alias}" failed to produce a result.` };
      }

      const outputFileNote = result.outputFile ? `\n[output: ${result.outputFile}]` : '';
      return { success: true, output: `${result.output ?? 'Agent completed successfully.'}${outputFileNote}`.trim() };
    } catch (error) {
      return {
        success: false,
        error: `delegate_agent failed: ${error instanceof Error ? error.message : String(error)}`,
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
          agent: {
            type: 'string',
            enum: ['pdf', 'excel', 'data_analysis', 'sql', 'archive', 'swe'],
            description: 'Which specialized agent to delegate to.',
          },
          action: {
            type: 'string',
            description:
              'The sub-action for the agent (e.g. pdf: extract|analyze|search|summarize; ' +
              'sql: query|tables|schema|import|export; data_analysis: analyze|transform|aggregate|pivot|correlate; ' +
              'archive: list|extract|create; swe: edit|debug|refactor|run). Omit for a sensible default.',
          },
          instruction: {
            type: 'string',
            description: 'Free-form description of the task (used by swe; passed to other agents as context).',
          },
          filePath: {
            type: 'string',
            description: 'Path to the input file the agent should operate on (PDF/XLSX/CSV/archive/db).',
          },
          params: {
            type: 'object',
            description:
              'Extra action-specific parameters (e.g. { pattern } for pdf search, { query } for sql, { sheetName } for excel).',
          },
        },
        required: ['agent'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.agent !== 'string' || !data.agent.trim()) {
      return { valid: false, errors: ['agent must be a non-empty string'] };
    }
    if (!AGENT_ID_BY_ALIAS[data.agent.trim().toLowerCase()]) {
      return { valid: false, errors: [`agent must be one of: ${Object.keys(AGENT_ID_BY_ALIAS).join(', ')}`] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'delegate', 'agent', 'specialized', 'pdf', 'excel', 'xlsx', 'csv', 'data',
        'analysis', 'sql', 'database', 'query', 'archive', 'zip', 'tar', 'swe',
        'refactor', 'debug', 'dataframe', 'pivot', 'correlate',
      ],
      priority: 6,
      requiresConfirmation: true,
      modifiesFiles: true, // swe/excel-write/sql-import/archive-create can write
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createDelegateAgentTools(): ITool[] {
  return [new DelegateAgentTool()];
}

export function resetDelegateAgentInstances(): void {
  // Stateless tool — nothing instance-level to reset (provider reset is separate).
}
