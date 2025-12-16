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
      const statusDiff = STATUS_ORDER[b.status] - STATUS_ORDER[a.status];
      if (statusDiff !== 0) return statusDiff;

      // Then by priority (high > medium > low)
      return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
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

  formatTodoList(): string {
    if (this.todos.length === 0) {
      return 'No todos created yet';
    }

    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const dim = '\x1b[2m';
    let output = '';

    // Sort todos by status and priority
    const sortedTodos = this.sortTodos(this.todos);

    // Group by status for better visualization
    const groups: Record<string, TodoItem[]> = {
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
      if (todos.length > this.maxItems) {
        return {
          success: false,
          error: `Cannot create more than ${this.maxItems} todos. Received ${todos.length}.`,
        };
      }

      // Validate unique IDs (like mistral-vibe)
      const ids = new Set<string>();
      for (const todo of todos) {
        if (ids.has(todo.id)) {
          return {
            success: false,
            error: `Duplicate todo ID: ${todo.id}. Todo IDs must be unique.`,
          };
        }
        ids.add(todo.id);
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

      this.todos = todos;

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

  async viewTodoList(): Promise<ToolResult> {
    return {
      success: true,
      output: this.formatTodoList(),
    };
  }
}
