import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';
import { MIXTURE_OF_AGENTS_TOOL } from '../../codebuddy/tool-definitions/moa-tools.js';
import {
  executeMixtureOfAgents,
  type MixtureOfAgentsOptions,
} from '../mixture-of-agents-tool.js';
import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

export class MixtureOfAgentsTool implements ITool {
  readonly name = 'mixture_of_agents';
  readonly description = MIXTURE_OF_AGENTS_TOOL.function.description;

  constructor(private readonly options: MixtureOfAgentsOptions = {}) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executeMixtureOfAgents(input, this.options);
  }

  getSchema(): ToolSchema {
    const definition: CodeBuddyTool = MIXTURE_OF_AGENTS_TOOL;
    return {
      name: this.name,
      description: this.description,
      parameters: definition.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.user_prompt !== 'string' || !data.user_prompt.trim()) {
      return { valid: false, errors: ['user_prompt is required'] };
    }
    const allowedUseCases = new Set([
      'balanced',
      'fast',
      'code',
      'architecture',
      'decision',
      'research',
      'security',
    ]);
    if (
      data.use_case !== undefined &&
      (typeof data.use_case !== 'string' || !allowedUseCases.has(data.use_case))
    ) {
      return { valid: false, errors: ['use_case must be a supported multi-LLM profile'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'mixture',
        'agents',
        'moa',
        'openrouter',
        'frontier',
        'reasoning',
        'collaboration',
        'aggregation',
        'hermes',
      ],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createMixtureOfAgentsTools(options: MixtureOfAgentsOptions = {}): ITool[] {
  return [new MixtureOfAgentsTool(options)];
}
