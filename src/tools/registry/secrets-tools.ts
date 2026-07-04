/**
 * Secrets Detector Tool Adapter
 *
 * ITool-compliant adapter for the `scan_secrets` tool. Wraps the real
 * `executeScanSecrets` implementation (src/security/secrets-detector.ts) so the
 * finished secrets scanner is dispatchable through the FormalToolRegistry.
 *
 * Before this adapter existed, `scan_secrets` was exposed to the LLM
 * (SECRETS_TOOLS → registerGroup in codebuddy/tools.ts) but had NO dispatch
 * path anywhere — the interactive handler resolved it to "Unknown tool".
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { SCAN_SECRETS_TOOL } from '../../codebuddy/tool-definitions/secrets-tools.js';
import { executeScanSecrets } from '../../security/secrets-detector.js';

/**
 * ScanSecretsExecuteTool - ITool adapter for the hardcoded-secrets scanner.
 */
export class ScanSecretsExecuteTool implements ITool {
  readonly name = 'scan_secrets';
  readonly description = SCAN_SECRETS_TOOL.function.description;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeScanSecrets({
      path: input.path as string,
      recursive: input.recursive as boolean | undefined,
      exclude: input.exclude as string[] | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: SCAN_SECRETS_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.path !== 'string' || !data.path.trim()) {
      return { valid: false, errors: ['path is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'system' as ToolCategoryType,
      keywords: ['secrets', 'credentials', 'api key', 'token', 'password', 'leak', 'scan', 'security', 'hardcoded'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/**
 * Create secrets detector tool instances.
 */
export function createSecretsTools(): ITool[] {
  return [new ScanSecretsExecuteTool()];
}

/**
 * Reset secrets tool instances (for testing). Tool is stateless — no-op.
 */
export function resetSecretsInstances(): void {
  // No shared instance to reset.
}
