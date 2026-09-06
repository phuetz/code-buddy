/**
 * Persistent Memory Tools
 *
 * Tools for the agent to autonomously manage its persistent memory (CLAUDE.md style).
 * - remember: Store information in project or user memory
 * - replace_memory: Replace an existing memory entry under Hermes-style bounds
 * - memory_propose: Queue a long-term memory candidate for human review
 * - recall: Explicitly retrieve a memory by key
 * - forget: Remove a memory entry
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType, IToolExecutionContext } from './types.js';
import { getMemoryManager, type MemoryCategory } from '../../memory/persistent-memory.js';
import { getMemoryCandidateQueue } from '../../memory/memory-candidate-queue.js';
import { executeHermesLifecycleHook } from '../../hooks/hermes-lifecycle-hooks.js';

// ============================================================================
// remember
// ============================================================================

export class RememberTool implements ITool {
  readonly name = 'remember';
  readonly description =
    'Store important information, decisions, or preferences in persistent memory. This survives across sessions and is project-scoped by default.';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    // Per-bot memory (multi-bot channels): scope by botId so bots don't share
    // each other's facts. No botId = global memory (default). initialize() is
    // idempotent, so this is cheap for the already-initialized global instance.
    const mm = getMemoryManager(undefined, context?.botId);
    await mm.initialize();

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

      const result = await mm.remember(key, value, { scope, category });
      return {
        success: true,
        output: `${result.message} Usage: ${result.usage.used}/${result.usage.limit} chars (${result.usage.percent}%).`,
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
            enum: ['project', 'preferences', 'decisions', 'patterns', 'context', 'custom'],
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
// replace_memory
// ============================================================================

export class ReplaceMemoryTool implements ITool {
  readonly name = 'replace_memory';
  readonly description =
    'Replace an existing persistent memory entry. Use when a stored fact is obsolete or too verbose and must be rewritten under the memory char budget.';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    // Per-bot memory (multi-bot channels): scope by botId so bots don't share
    // each other's facts. No botId = global memory (default). initialize() is
    // idempotent, so this is cheap for the already-initialized global instance.
    const mm = getMemoryManager(undefined, context?.botId);
    await mm.initialize();

    let key = input.key as string;
    let value = input.value as string;
    let scope = (input.scope as 'project' | 'user') ?? 'project';
    let category = input.category as MemoryCategory | undefined;

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
          error: hookResult.feedback ?? 'Memory replacement blocked by BeforeMemoryWrite hook.',
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

      const result = await mm.replace(key, value, { scope, category });
      if (result.status === 'missing') {
        return {
          success: true,
          output: result.message,
        };
      }

      return {
        success: true,
        output: `${result.message} Usage: ${result.usage.used}/${result.usage.limit} chars (${result.usage.percent}%).`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to replace memory: ${err instanceof Error ? err.message : String(err)}`,
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
            description: 'Existing memory key to replace',
          },
          value: {
            type: 'string',
            description: 'New concise memory value',
          },
          scope: {
            type: 'string',
            enum: ['project', 'user'],
            description: 'Memory scope to replace in (default: project)',
          },
          category: {
            type: 'string',
            enum: ['project', 'preferences', 'decisions', 'patterns', 'context', 'custom'],
            description: 'Optional replacement category',
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
      keywords: ['memory', 'replace', 'rewrite', 'update', 'persist', 'preference'],
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
// memory_propose
// ============================================================================

export class MemoryProposeTool implements ITool {
  readonly name = 'memory_propose';
  readonly description =
    'Propose a long-term memory candidate for human review. Use this instead of remember when the fact is inferred, ambiguous, or should not be silently injected into future prompts.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const key = input.key as string;
    const value = input.value as string;
    const scope = (input.scope as 'project' | 'user') ?? 'project';
    const category = (input.category as MemoryCategory) ?? 'context';
    const confidence = typeof input.confidence === 'number' ? input.confidence : undefined;
    const rationale = typeof input.rationale === 'string' ? input.rationale : undefined;

    try {
      const { candidate, deduped } = getMemoryCandidateQueue(process.cwd()).propose({
        key,
        value,
        scope,
        category,
        source: 'self_observed',
        ...(confidence !== undefined ? { confidence } : {}),
        ...(rationale ? { rationale } : {}),
      });
      return {
        success: true,
        output: `${deduped ? 'Matched existing pending' : 'Proposed'} memory candidate ${candidate.id} (${candidate.scope}/${candidate.category}). Approve with: /memory accept ${candidate.id}`,
      };
    } catch (err) {
      return {
        success: false,
        error: `memory_propose failed: ${err instanceof Error ? err.message : String(err)}`,
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
            description: 'Short kebab-case key for the memory candidate',
          },
          value: {
            type: 'string',
            description: 'Concise candidate memory value',
          },
          scope: {
            type: 'string',
            enum: ['project', 'user'],
            description: 'Candidate scope (default: project)',
          },
          category: {
            type: 'string',
            enum: ['project', 'preferences', 'decisions', 'patterns', 'context', 'custom'],
            description: 'Candidate category',
          },
          confidence: {
            type: 'number',
            description: 'Confidence from 0 to 1',
          },
          rationale: {
            type: 'string',
            description: 'Short evidence note for reviewer',
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
      keywords: ['memory', 'candidate', 'propose', 'review', 'long-term', 'persist'],
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

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    // Per-bot memory (multi-bot channels): scope by botId so bots don't share
    // each other's facts. No botId = global memory (default). initialize() is
    // idempotent, so this is cheap for the already-initialized global instance.
    const mm = getMemoryManager(undefined, context?.botId);
    try {
      await mm.initialize();
      const key = input.key as string;
      const scope = input.scope as 'project' | 'user' | undefined;

      const value = mm.recall(key, scope);

      if (value) {
        return {
          success: true,
          output: `Memory for "${key}":

${value}`,
        };
      }
      return {
        success: true,
        output: `No memory found for key "${key}"${scope ? ` in ${scope} scope` : ''}.`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to recall memory: ${err instanceof Error ? err.message : String(err)}`,
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

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    // Per-bot memory (multi-bot channels): scope by botId so bots don't share
    // each other's facts. No botId = global memory (default). initialize() is
    // idempotent, so this is cheap for the already-initialized global instance.
    const mm = getMemoryManager(undefined, context?.botId);
    try {
      await mm.initialize();
      const key = input.key as string;
      const scope = (input.scope as 'project' | 'user') ?? 'project';

      const deleted = await mm.forget(key, scope);

      if (deleted) {
        return {
          success: true,
          output: `Successfully forgot "${key}" from ${scope} memory.`,
        };
      }
      return {
        success: true,
        output: `No memory found for key "${key}" in ${scope} scope.`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to forget memory: ${err instanceof Error ? err.message : String(err)}`,
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
    new ReplaceMemoryTool(),
    new MemoryProposeTool(),
    new RecallTool(),
    new ForgetTool(),
  ];
}
