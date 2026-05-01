/**
 * Advisor Tool Adapter
 *
 * ITool-compliant adapter for the advisor tool.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { executeAdvisor, type AdvisorConfig } from '../advisor-tool.js';

let _advisorConfigProvider: (() => AdvisorConfig) | null = null;

/**
 * Register the advisor config provider so the tool reads the user's TOML
 * `[advisor]` settings at call time. Called once from codebuddy-agent.ts.
 */
export function setAdvisorConfigProvider(provider: () => AdvisorConfig): void {
  _advisorConfigProvider = provider;
}

/**
 * Reset the config provider (for testing).
 */
export function resetAdvisorConfigProvider(): void {
  _advisorConfigProvider = null;
}

export class AdvisorExecuteTool implements ITool {
  readonly name = 'advisor';
  readonly description =
    'Consult a stronger reviewer model for a second opinion mid-task. The full conversation history is forwarded automatically.';

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    const config = _advisorConfigProvider ? _advisorConfigProvider() : {};
    return await executeAdvisor(config);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  }

  validate(_input: unknown): IValidationResult {
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['advisor', 'review', 'second opinion', 'consult', 'check', 'validate', 'expert', 'critique'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createAdvisorTools(): ITool[] {
  return [new AdvisorExecuteTool()];
}

export function resetAdvisorInstances(): void {
  // Stateless tool — nothing to reset
}
