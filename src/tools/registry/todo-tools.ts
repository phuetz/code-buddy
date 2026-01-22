/**
 * Todo Tool Adapters
 *
 * ITool-compliant adapters for TodoTool operations.
 * These adapters wrap the existing TodoTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { TodoTool, TodoItem } from '../todo-tool.js';

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
    const todos = input.todos as TodoItem[];

    return await getTodo().createTodoList(todos);
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
      if (!todo.id || !todo.content || !todo.status || !todo.priority) {
        return { valid: false, errors: [`Todo at index ${i} must have id, content, status, and priority`] };
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
    new UpdateTodoListTool(),
  ];
}
