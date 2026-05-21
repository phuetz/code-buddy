/**
 * Persistent Memory Tools
 *
 * Tools for the agent to autonomously manage its persistent memory (CLAUDE.md style).
 * - remember: Store information in project or user memory
 * - recall: Explicitly retrieve a memory by key
 * - forget: Remove a memory entry
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { getMemoryManager, type MemoryCategory } from '../../memory/persistent-memory.js';
import { executeHermesLifecycleHook } from '../../hooks/hermes-lifecycle-hooks.js';

// ============================================================================
// remember
// ============================================================================

export class RememberTool implements ITool {
  readonly name = 'remember';
  readonly description =
    'Store important information, decisions, or preferences in persistent memory. This survives across sessions and is project-scoped by default.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const mm = getMemoryManager();

    let key = input.key as string;
    let value = input.value as string;
    let scope = (input.scope as 'project' | 'user') ?? 'project';
    let category = (input.category as MemoryCategory) ?? 'custom';

    try {
      const hookResult = await executeHermesLifecycleHook(process.cwd(), 'before_memory_write', {
        toolName: this.name,
        toolInput: { key, value, scope, category },
        memoryKey: key,
        memoryValue: value,
        memoryScope: scope,
        memoryCategory: category,
      });

      if (!hookResult.allowed) {
        return {
          success: false,
          error: hookResult.feedback ?? 'Memory write blocked by BeforeMemoryWrite hook.',
        };
      }

      if (hookResult.updatedInput) {
        key = typeof hookResult.updatedInput.key === 'string' ? hookResult.updatedInput.key : key;
        value = typeof hookResult.updatedInput.value === 'string' ? hookResult.updatedInput.value : value;
        scope = hookResult.updatedInput.scope === 'user' || hookResult.updatedInput.scope === 'project'
          ? hookResult.updatedInput.scope
          : scope;
        category = typeof hookResult.updatedInput.category === 'string'
          ? hookResult.updatedInput.category as MemoryCategory
          : category;
      }

      await mm.remember(key, value, { scope, category });
      return {
        success: true,
        output: `Successfully remembered "${key}" in ${scope} memory (category: ${category}).`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to store memory: ${err instanceof Error ? err.message : String(err)}`,
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
          key: {
            type: 'string',
            description: 'Short unique key for this memory (e.g., "build-system", "indent-style")',
          },
          value: {
            type: 'string',
            description: 'The information to be remembered',
          },
          scope: {
            type: 'string',
            enum: ['project', 'user'],
            description: 'Whether this is specific to this project or for all your projects (default: project)',
          },
          category: {
            type: 'string',
            enum: ['project', 'preferences', 'decisions', 'patterns', 'custom'],
            description: 'The type of information being stored',
          },
        },
        required: ['key', 'value'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.key !== 'string' || !data.key.trim()) {
      return { valid: false, errors: ['key must be a non-empty string'] };
    }
    if (typeof data.value !== 'string' || !data.value.trim()) {
      return { valid: false, errors: ['value must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['memory', 'remember', 'persist', 'context', 'preference'],
      priority: 5,
      requiresConfirmation: false,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// recall
// ============================================================================

export class RecallTool implements ITool {
  readonly name = 'recall';
  readonly description =
    'Explicitly retrieve a specific memory entry by its key. Use this if the information is not currently in your system prompt.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const mm = getMemoryManager();
    const key = input.key as string;
    const scope = input.scope as 'project' | 'user' | undefined;

    const value = mm.recall(key, scope);

    if (value) {
      return {
        success: true,
        output: `Memory for "${key}":

${value}`,
      };
    } else {
      return {
        success: true,
        output: `No memory found for key "${key}"${scope ? ` in ${scope} scope` : ''}.`,
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
          key: {
            type: 'string',
            description: 'The key of the memory to retrieve',
          },
          scope: {
            type: 'string',
            enum: ['project', 'user'],
            description: 'Optional scope to search in',
          },
        },
        required: ['key'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.key !== 'string' || !data.key.trim()) {
      return { valid: false, errors: ['key must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['memory', 'recall', 'retrieve', 'lookup'],
      priority: 5,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// forget
// ============================================================================

export class ForgetTool implements ITool {
  readonly name = 'forget';
  readonly description =
    'Remove a memory entry that is no longer valid or useful.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const mm = getMemoryManager();
    const key = input.key as string;
    const scope = (input.scope as 'project' | 'user') ?? 'project';

    const deleted = await mm.forget(key, scope);

    if (deleted) {
      return {
        success: true,
        output: `Successfully forgot "${key}" from ${scope} memory.`,
      };
    } else {
      return {
        success: true,
        output: `No memory found for key "${key}" in ${scope} scope.`,
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
          key: {
            type: 'string',
            description: 'The key of the memory to remove',
          },
          scope: {
            type: 'string',
            enum: ['project', 'user'],
            description: 'The scope to remove from (default: project)',
          },
        },
        required: ['key'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.key !== 'string' || !data.key.trim()) {
      return { valid: false, errors: ['key must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['memory', 'forget', 'delete', 'remove'],
      priority: 4,
      requiresConfirmation: false,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createMemoryTools(): ITool[] {
  return [
    new RememberTool(),
    new RecallTool(),
    new ForgetTool(),
  ];
}
