/**
 * Attention Tool Adapters
 *
 * ITool-compliant adapters for:
 * - TodoAttentionTool  (`todo_update`)     — Manus AI attention bias
 * - RestoreContextTool (`restore_context`) — Manus AI restorable compression
 *
 * These two tools work together: the agent updates todos to maintain
 * focus across long sessions, and can restore compressed context content
 * by identifier when it needs to revisit earlier information.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { getTodoTracker } from '../../agent/todo-tracker.js';
import { getRestorableCompressor } from '../../context/restorable-compression.js';

// ============================================================================
// TodoAttentionTool
// ============================================================================

export class TodoAttentionTool implements ITool {
  readonly name = 'todo_update';
  readonly description = [
    'Manage the persistent task list (todo.md). Use this to track progress on complex tasks.',
    'Actions: add (create item), complete (mark done), update (change status/text), remove (delete), clear_done (remove completed items), list (show all).',
    'The current task list is automatically appended to the end of the LLM context each turn to keep objectives in focus.',
  ].join(' ');

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const tracker = getTodoTracker(process.cwd());

    try {
      switch (action) {
        case 'add': {
          const text = input.text as string;
          if (!text) return { success: false, error: 'text is required for add action' };
          const item = tracker.add(
            text,
            (input.priority as 'high' | 'medium' | 'low') ?? 'medium'
          );
          return { success: true, output: `Added: [${item.id}] ${item.text}` };
        }

        case 'complete': {
          const id = input.id as string;
          if (!id) return { success: false, error: 'id is required for complete action' };
          const ok = tracker.complete(id);
          return ok
            ? { success: true, output: `Marked complete: ${id}` }
            : { success: false, error: `Item not found: ${id}` };
        }

        case 'update': {
          const id = input.id as string;
          if (!id) return { success: false, error: 'id is required for update action' };
          const ok = tracker.update(id, {
            text: input.text as string | undefined,
            status: input.status as 'pending' | 'in_progress' | 'done' | 'blocked' | undefined,
            priority: input.priority as 'high' | 'medium' | 'low' | undefined,
          });
          return ok
            ? { success: true, output: `Updated: ${id}` }
            : { success: false, error: `Item not found: ${id}` };
        }

        case 'remove': {
          const id = input.id as string;
          if (!id) return { success: false, error: 'id is required for remove action' };
          const ok = tracker.remove(id);
          return ok
            ? { success: true, output: `Removed: ${id}` }
            : { success: false, error: `Item not found: ${id}` };
        }

        case 'clear_done': {
          const n = tracker.clearDone();
          return { success: true, output: `Cleared ${n} completed items` };
        }

        case 'list': {
          const items = tracker.getAll();
          if (items.length === 0) return { success: true, output: 'No items in todo list.' };
          const lines = items.map(i =>
            `[${i.id}] (${i.status}/${i.priority}) ${i.text}`
          );
          return { success: true, output: lines.join('\n') };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: add, complete, update, remove, clear_done, list` };
      }
    } catch (err) {
      return {
        success: false,
        error: `todo_update failed: ${err instanceof Error ? err.message : String(err)}`,
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
          action: {
            type: 'string',
            enum: ['add', 'complete', 'update', 'remove', 'clear_done', 'list'],
            description: 'Action to perform',
          },
          text: {
            type: 'string',
            description: 'Item text (required for add; optional for update)',
          },
          id: {
            type: 'string',
            description: 'Item ID (required for complete/update/remove)',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'done', 'blocked'],
            description: 'New status (for update)',
          },
          priority: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Priority (for add/update, default: medium)',
          },
        },
        required: ['action'],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    const validActions = ['add', 'complete', 'update', 'remove', 'clear_done', 'list'];
    if (!input.action || !validActions.includes(input.action as string)) {
      return {
        isValid: false,
        errors: [`action must be one of: ${validActions.join(', ')}`],
      };
    }
    if ((input.action === 'add') && !input.text) {
      return { isValid: false, errors: ['text is required for add'] };
    }
    if (['complete', 'update', 'remove'].includes(input.action as string) && !input.id) {
      return { isValid: false, errors: ['id is required for this action'] };
    }
    return { isValid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      version: '1.0.0',
      author: 'Code Buddy',
      category: 'planning' as ToolCategoryType,
      tags: ['todo', 'tasks', 'planning', 'attention'],
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// ============================================================================
// RestoreContextTool
// ============================================================================

export class RestoreContextTool implements ITool {
  readonly name = 'restore_context';
  readonly description = [
    'Restore compressed context content by identifier (file path or URL).',
    'When context is compressed, file paths and URLs are preserved as identifiers.',
    'Use this tool to retrieve the full original content that was compressed away.',
    'Provide the exact file path (e.g. "src/agent/types.ts") or URL seen in an earlier message.',
  ].join(' ');

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const identifier = input.identifier as string;
    if (!identifier) return { success: false, error: 'identifier is required' };

    const compressor = getRestorableCompressor();
    const result = compressor.restore(identifier);

    if (result.found) {
      return {
        success: true,
        output: `Restored content for "${identifier}":\n\n${result.content}`,
      };
    }

    return {
      success: false,
      error: result.content, // contains helpful hint (web_fetch, etc.)
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'File path (e.g. "src/agent/types.ts") or URL to restore',
          },
        },
        required: ['identifier'],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    if (!input.identifier) {
      return { isValid: false, errors: ['identifier is required'] };
    }
    return { isValid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      version: '1.0.0',
      author: 'Code Buddy',
      category: 'context' as ToolCategoryType,
      tags: ['context', 'memory', 'compression', 'restore'],
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAttentionTools(): ITool[] {
  return [
    new TodoAttentionTool(),
    new RestoreContextTool(),
  ];
}
