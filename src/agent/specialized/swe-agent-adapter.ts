/**
 * SWE Agent Adapter — Bridges SWEAgent into the SpecializedAgent registry
 */

import {
  SpecializedAgent,
  type AgentTask,
  type AgentResult,
} from './types.js';

const SWE_AGENT_CONFIG = {
  id: 'swe',
  name: 'SWE Agent',
  description: 'Software engineering agent for code editing, debugging, and repository-level tasks (OpenManus-compatible)',
  capabilities: ['code-edit' as const, 'code-debug' as const, 'code-analyze' as const, 'code-refactor' as const],
  fileExtensions: ['ts', 'js', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'sh'],
};

const SWE_ACTIONS: Record<string, string> = {
  edit: 'Edit files with precise string replacement',
  debug: 'Find and fix bugs in code',
  refactor: 'Refactor code for improved quality',
  analyze: 'Analyze code structure and dependencies',
  run: 'Execute a free-form SWE task',
};

export class SWESpecializedAgent extends SpecializedAgent {
  constructor() {
    super(SWE_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();

    try {
      // Lazy import to avoid circular deps
      const { createSWEAgent } = await import('./swe-agent.js');

      // Apply per-agent config overrides from agent_defaults.agents.swe
      const configOptions = this.getConfig().options ?? {};

      // Validate callable params at the adapter boundary so a malformed task
      // fails with a clear message instead of a cryptic runtime error deep in the loop.
      const llmCall = task.params?.llmCall;
      const executeTool = task.params?.executeTool;
      if (typeof llmCall !== 'function') {
        throw new Error('SWE agent requires task.params.llmCall to be a function');
      }
      if (typeof executeTool !== 'function') {
        throw new Error('SWE agent requires task.params.executeTool to be a function');
      }

      type SWEAgentOptions = Parameters<typeof createSWEAgent>[0];
      const agent = createSWEAgent({
        maxSteps: (task.params?.maxSteps as number) ?? 20,
        maxObserve: (task.params?.maxObserve as number) ?? (configOptions.maxTokens as number | undefined) ?? 10000,
        llmCall: llmCall as SWEAgentOptions['llmCall'],
        executeTool: executeTool as SWEAgentOptions['executeTool'],
        model: typeof task.params?.model === 'string' ? task.params.model : undefined,
        contextWindow:
          typeof task.params?.contextWindow === 'number' ? task.params.contextWindow : undefined,
        responseReserveTokens:
          typeof task.params?.responseReserveTokens === 'number'
            ? task.params.responseReserveTokens
            : undefined,
        workspaceRoot:
          typeof task.params?.workspaceRoot === 'string'
            ? task.params.workspaceRoot
            : process.cwd(),
      });

      const prompt = this.buildPrompt(task);
      const result = await agent.run(prompt);

      return {
        success: true,
        output: result,
        duration: Date.now() - start,
        metadata: { steps: agent.getState().currentStep },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  getSupportedActions(): string[] {
    return Object.keys(SWE_ACTIONS);
  }

  getActionHelp(action: string): string {
    return SWE_ACTIONS[action] || 'Unknown action';
  }

  private buildPrompt(task: AgentTask): string {
    const parts: string[] = [];
    if (task.action && task.action !== 'run') {
      parts.push(`Action: ${task.action}`);
    }
    if (task.inputFiles?.length) {
      parts.push(`Files: ${task.inputFiles.join(', ')}`);
    }
    if (task.params?.instruction) {
      parts.push(String(task.params.instruction));
    }
    if (task.data) {
      parts.push(String(task.data));
    }
    return parts.join('\n') || 'Execute SWE task';
  }
}

let sweInstance: SWESpecializedAgent | null = null;

export function getSWEAgent(): SWESpecializedAgent {
  if (!sweInstance) sweInstance = new SWESpecializedAgent();
  return sweInstance;
}

export function resetSWEAgent(): void {
  sweInstance = null;
}
