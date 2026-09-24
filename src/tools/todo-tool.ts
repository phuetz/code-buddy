import { ToolResult } from '../types/index.js';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  /** Optional due date */
  dueDate?: string;
  /** Optional tags */
  tags?: string[];
}

export interface TodoStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  byPriority: {
    high: number;
    medium: number;
    low: number;
  };
}

// Priority values for sorting (higher = more important)
const PRIORITY_ORDER: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// Status values for sorting (in_progress first, then pending, then completed)
const STATUS_ORDER: Record<string, number> = {
  in_progress: 3,
  pending: 2,
  completed: 1,
};

export class TodoTool {
  private todos: TodoItem[] = [];
  private maxItems: number = 100; // Match mistral-vibe's limit

  /**
   * Get priority icon for display
   */
  private getPriorityIcon(priority: string): string {
    switch (priority) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '⚪';
    }
  }

  /**
   * Get status checkbox for display
   */
  private getCheckbox(status: string): string {
    switch (status) {
      case 'completed':
        return '✅';
      case 'in_progress':
        return '🔄';
      case 'pending':
        return '⬜';
      default:
        return '⬜';
    }
  }

  /**
   * Get ANSI color code for status
   */
  private getStatusColor(status: string): string {
    switch (status) {
      case 'completed':
        return '\x1b[32m'; // Green
      case 'in_progress':
        return '\x1b[36m'; // Cyan
      case 'pending':
        return '\x1b[37m'; // White/default
      default:
        return '\x1b[0m'; // Reset
    }
  }

  /**
   * Sort todos by priority and status
   */
  private sortTodos(todos: TodoItem[]): TodoItem[] {
    return [...todos].sort((a, b) => {
      // First sort by status (in_progress > pending > completed)
      const statusDiff = (STATUS_ORDER[b.status] ?? 0) - (STATUS_ORDER[a.status] ?? 0);
      if (statusDiff !== 0) return statusDiff;

      // Then by priority (high > medium > low)
      return (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0);
    });
  }

  /**
   * Get statistics about todos
   */
  getStats(): TodoStats {
    const stats: TodoStats = {
      total: this.todos.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      byPriority: { high: 0, medium: 0, low: 0 },
    };

    for (const todo of this.todos) {
      if (todo.status === 'pending') stats.pending++;
      else if (todo.status === 'in_progress') stats.inProgress++;
      else if (todo.status === 'completed') stats.completed++;

      stats.byPriority[todo.priority]++;
    }

    return stats;
  }

  formatTodoList(only?: TodoItem['status']): string {
    const source = only ? this.todos.filter((todo) => todo.status === only) : this.todos;
    if (source.length === 0) {
      return only ? 'No todos matching filter' : 'No todos created yet';
    }

    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const dim = '\x1b[2m';
    let output = '';

    // Sort todos by status and priority
    const sortedTodos = this.sortTodos(source);

    // Group by status for better visualization
    const groups: Record<TodoItem['status'], TodoItem[]> = {
      in_progress: [],
      pending: [],
      completed: [],
    };

    for (const todo of sortedTodos) {
      groups[todo.status].push(todo);
    }

    // Display in_progress first
    if (groups.in_progress.length > 0) {
      output += `${bold}🔄 In Progress${reset}\n`;
      for (const todo of groups.in_progress) {
        const priority = this.getPriorityIcon(todo.priority);
        output += `  ${priority} ${todo.content}\n`;
      }
      output += '\n';
    }

    // Then pending
    if (groups.pending.length > 0) {
      output += `${bold}⬜ Pending${reset}\n`;
      for (const todo of groups.pending) {
        const priority = this.getPriorityIcon(todo.priority);
        output += `  ${priority} ${todo.content}\n`;
      }
      output += '\n';
    }

    // Then completed
    if (groups.completed.length > 0) {
      output += `${dim}✅ Completed${reset}\n`;
      for (const todo of groups.completed) {
        output += `  ${dim}${todo.content}${reset}\n`;
      }
    }

    // Add stats summary
    const stats = this.getStats();
    output += `\n📊 ${stats.completed}/${stats.total} completed`;
    if (stats.byPriority.high > 0) {
      output += ` | 🔴 ${stats.byPriority.high} high priority`;
    }

    return output.trim();
  }

  async createTodoList(todos: TodoItem[]): Promise<ToolResult> {
    try {
      // Check max items limit (like mistral-vibe)
      const totalAfterAdd = this.todos.length + todos.length;
      if (totalAfterAdd > this.maxItems) {
        return {
          success: false,
          error: `Cannot have more than ${this.maxItems} todos. Current: ${this.todos.length}, adding: ${todos.length}.`,
        };
      }

      // Check for duplicate IDs in new todos
      const newIds = new Set<string>();
      for (const todo of todos) {
        if (newIds.has(todo.id)) {
          return {
            success: false,
            error: `Duplicate todo ID in new items: ${todo.id}. Todo IDs must be unique.`,
          };
        }
        newIds.add(todo.id);
      }

      // Validate todos
      for (const todo of todos) {
        if (!todo.id || !todo.content || !todo.status || !todo.priority) {
          return {
            success: false,
            error: 'Each todo must have id, content, status, and priority fields',
          };
        }

        if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
          return {
            success: false,
            error: `Invalid status: ${todo.status}. Must be pending, in_progress, or completed`,
          };
        }

        if (!['high', 'medium', 'low'].includes(todo.priority)) {
          return {
            success: false,
            error: `Invalid priority: ${todo.priority}. Must be high, medium, or low`,
          };
        }
      }

      // Add new todos (update if ID exists, otherwise append)
      for (const newTodo of todos) {
        const existingIndex = this.todos.findIndex(t => t.id === newTodo.id);
        if (existingIndex >= 0) {
          this.todos[existingIndex] = newTodo;
        } else {
          this.todos.push(newTodo);
        }
      }

      const stats = this.getStats();
      return {
        success: true,
        output: this.formatTodoList(),
        data: {
          message: `Created ${todos.length} todos`,
          count: todos.length,
          stats,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Error creating todo list: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async updateTodoList(
    updates: { id: string; status?: string; content?: string; priority?: string }[]
  ): Promise<ToolResult> {
    try {
      const updatedIds: string[] = [];

      for (const update of updates) {
        const todoIndex = this.todos.findIndex((t) => t.id === update.id);

        if (todoIndex === -1) {
          return {
            success: false,
            error: `Todo with id ${update.id} not found`,
          };
        }

        const todo = this.todos[todoIndex];
        if (!todo) {
          return {
            success: false,
            error: `Todo with id ${update.id} not found`,
          };
        }

        if (update.status && !['pending', 'in_progress', 'completed'].includes(update.status)) {
          return {
            success: false,
            error: `Invalid status: ${update.status}. Must be pending, in_progress, or completed`,
          };
        }

        if (update.priority && !['high', 'medium', 'low'].includes(update.priority)) {
          return {
            success: false,
            error: `Invalid priority: ${update.priority}. Must be high, medium, or low`,
          };
        }

        if (update.status) todo.status = update.status as TodoItem['status'];
        if (update.content) todo.content = update.content;
        if (update.priority) todo.priority = update.priority as TodoItem['priority'];

        updatedIds.push(update.id);
      }

      return {
        success: true,
        output: this.formatTodoList(),
      };
    } catch (error) {
      return {
        success: false,
        error: `Error updating todo list: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async viewTodoList(only?: TodoItem['status']): Promise<ToolResult> {
    return {
      success: true,
      output: this.formatTodoList(only),
    };
  }
}
