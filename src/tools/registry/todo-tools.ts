/**
 * Todo Tool Adapters
 *
 * ITool-compliant adapters for TodoTool operations.
 * These adapters wrap the existing TodoTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { TodoTool } from '../index.js';
import type { TodoItem } from '../todo-tool.js';

// ============================================================================
// Shared TodoTool Instance
// ============================================================================

let todoInstance: TodoTool | null = null;

function getTodo(): TodoTool {
  if (!todoInstance) {
    todoInstance = new TodoTool();
  }
  return todoInstance;
}

/**
 * Reset the shared TodoTool instance (for testing)
 */
export function resetTodoInstance(): void {
  todoInstance = null;
}

// ============================================================================
// CreateTodoListTool
// ============================================================================

/**
 * CreateTodoListTool - ITool adapter for creating todo lists
 */
export class CreateTodoListTool implements ITool {
  readonly name = 'create_todo_list';
  readonly description = 'Create a new todo list with tasks';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const todos = (input.todos as Record<string, unknown>[]) || [];

    const normalizedTodos: TodoItem[] = todos.map((todo, index) => {
      const rawId = todo.id;
      const rawStatus = todo.status;
      const rawPriority = todo.priority;
      const completed = todo.completed;

      const id =
        typeof rawId === 'string'
          ? rawId
          : typeof rawId === 'number'
            ? String(rawId)
            : `todo-${Date.now()}-${index}`;

      const content =
        typeof todo.content === 'string'
          ? todo.content
          : typeof todo.text === 'string'
            ? todo.text
            : '';

      const status: TodoItem['status'] =
        rawStatus === 'pending' || rawStatus === 'in_progress' || rawStatus === 'completed'
          ? rawStatus
          : completed === true
            ? 'completed'
            : 'pending';

      const priority: TodoItem['priority'] =
        rawPriority === 'high' || rawPriority === 'medium' || rawPriority === 'low'
          ? rawPriority
          : 'medium';

      return {
        id,
        content,
        status,
        priority,
      };
    });

    return await getTodo().createTodoList(normalizedTodos);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Array of todo items to create',
            items: {
              type: 'object',
              description: 'Todo item with id, content, status, and priority',
            },
          },
        },
        required: ['todos'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (!Array.isArray(data.todos)) {
      return { valid: false, errors: ['todos must be an array'] };
    }

    for (let i = 0; i < data.todos.length; i++) {
      const todo = data.todos[i] as Record<string, unknown>;
      const hasText = typeof todo.text === 'string' && todo.text.trim().length > 0;
      const hasContent = typeof todo.content === 'string' && todo.content.trim().length > 0;
      if (!hasText && !hasContent) {
        return { valid: false, errors: [`Todo at index ${i} must include content or text`] };
      }
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['todo', 'task', 'list', 'create', 'plan'],
      priority: 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// GetTodoListTool
// ============================================================================

/**
 * GetTodoListTool - ITool adapter for viewing todo lists
 */
export class GetTodoListTool implements ITool {
  readonly name = 'get_todo_list';
  readonly description = 'Get the current todo list to see all tasks and their status';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filter = input.filter as string | undefined;
    const result = await getTodo().viewTodoList();

    // Apply filter if specified
    if (filter && filter !== 'all' && result.success && result.output) {
      const lines = result.output.split('\n');
      const filtered = lines.filter(line => {
        if (filter === 'pending') return line.includes('⬜') || line.includes('pending');
        if (filter === 'in_progress') return line.includes('🔄') || line.includes('in_progress');
        if (filter === 'completed') return line.includes('✅') || line.includes('completed');
        return true;
      });
      return { success: true, output: filtered.join('\n') || 'No todos matching filter' };
    }

    return result;
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Filter by status: all, pending, in_progress, completed',
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['todo', 'task', 'list', 'view', 'get', 'show'],
      priority: 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// UpdateTodoListTool
// ============================================================================

/**
 * UpdateTodoListTool - ITool adapter for updating todo lists
 */
export class UpdateTodoListTool implements ITool {
  readonly name = 'update_todo_list';
  readonly description = 'Update existing todo items (change status, content, or priority)';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const updates = input.updates as { id: string; status?: string; content?: string; priority?: string }[];

    return await getTodo().updateTodoList(updates);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description: 'Array of updates to apply',
            items: {
              type: 'object',
              description: 'Update with id and fields to change',
            },
          },
        },
        required: ['updates'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (!Array.isArray(data.updates)) {
      return { valid: false, errors: ['updates must be an array'] };
    }

    for (let i = 0; i < data.updates.length; i++) {
      const update = data.updates[i] as Record<string, unknown>;
      if (!update.id) {
        return { valid: false, errors: [`Update at index ${i} must have an id`] };
      }
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['todo', 'task', 'update', 'status', 'progress'],
      priority: 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all todo tool instances
 */
export function createTodoTools(): ITool[] {
  return [
    new CreateTodoListTool(),
    new GetTodoListTool(),
    new UpdateTodoListTool(),
  ];
}
