/**
 * Advanced Tool Definitions
 *
 * Tools for advanced operations:
 * - Multi-file editing
 * - Git version control
 * - Codebase mapping
 * - Subagent spawning
 */

import type { GrokTool } from './types.js';

// Multi-edit tool for atomic multi-file changes
export const MULTI_EDIT_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "multi_edit",
    description: "Edit multiple files simultaneously in a single atomic operation. Use this for refactoring across multiple files.",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "Array of edit operations to perform",
          items: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Path to the file to edit"
              },
              old_str: {
                type: "string",
                description: "Text to replace"
              },
              new_str: {
                type: "string",
                description: "Text to replace with"
              },
              replace_all: {
                type: "boolean",
                description: "Replace all occurrences (default: false)"
              }
            },
            required: ["file_path", "old_str", "new_str"]
          }
        }
      },
      required: ["edits"]
    }
  }
};

// Git tool for version control operations
export const GIT_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "git",
    description: "Perform git operations: status, diff, add, commit, push, pull, branch, checkout, stash",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["status", "diff", "add", "commit", "push", "pull", "branch", "checkout", "stash", "auto_commit"],
          description: "The git operation to perform"
        },
        args: {
          type: "object",
          description: "Operation-specific arguments",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files to add/commit (for add operation)"
            },
            message: {
              type: "string",
              description: "Commit message (for commit operation)"
            },
            branch: {
              type: "string",
              description: "Branch name (for branch/checkout operations)"
            },
            staged: {
              type: "boolean",
              description: "Show staged diff only (for diff operation)"
            },
            push: {
              type: "boolean",
              description: "Push after commit (for auto_commit)"
            }
          }
        }
      },
      required: ["operation"]
    }
  }
};

// Codebase map tool for understanding project structure
export const CODEBASE_MAP_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "codebase_map",
    description: "Build and query a map of the codebase structure, symbols, and dependencies",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["build", "summary", "search", "symbols"],
          description: "The operation: build (create map), summary (show overview), search (find relevant files), symbols (list exported symbols)"
        },
        query: {
          type: "string",
          description: "Search query for finding relevant context"
        },
        deep: {
          type: "boolean",
          description: "Perform deep analysis including symbols and dependencies (slower)"
        }
      },
      required: ["operation"]
    }
  }
};

// Subagent tool for spawning specialized agents
export const SUBAGENT_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "spawn_subagent",
    description: "Spawn a specialized subagent for specific tasks: code-reviewer, debugger, test-runner, explorer, refactorer, documenter",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["code-reviewer", "debugger", "test-runner", "explorer", "refactorer", "documenter"],
          description: "Type of subagent to spawn"
        },
        task: {
          type: "string",
          description: "The task for the subagent to perform"
        },
        context: {
          type: "string",
          description: "Additional context for the task"
        }
      },
      required: ["type", "task"]
    }
  }
};

/**
 * All advanced tools as an array
 */
export const ADVANCED_TOOLS: GrokTool[] = [
  MULTI_EDIT_TOOL,
  GIT_TOOL,
  CODEBASE_MAP_TOOL,
  SUBAGENT_TOOL,
];
