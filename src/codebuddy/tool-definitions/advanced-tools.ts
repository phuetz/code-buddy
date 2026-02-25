/**
 * Advanced Tool Definitions
 *
 * Tools for advanced operations:
 * - Multi-file editing
 * - Git version control
 * - Codebase mapping
 * - Subagent spawning
 */

import type { CodeBuddyTool } from './types.js';

// Multi-edit tool for atomic multi-file changes
export const MULTI_EDIT_TOOL: CodeBuddyTool = {
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
export const GIT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "git",
    description: "Perform git operations: status, diff, add, commit, push, pull, branch, checkout, stash, blame, cherry-pick, bisect",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "status", "diff", "add", "commit", "push", "pull",
            "branch", "checkout", "stash", "auto_commit",
            "blame", "cherry_pick",
            "bisect_start", "bisect_step", "bisect_reset"
          ],
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
              description: "Commit message (for commit/stash operation)"
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
            },
            file: {
              type: "string",
              description: "File path (for blame operation)"
            },
            start_line: {
              type: "number",
              description: "Starting line number (for blame line range)"
            },
            end_line: {
              type: "number",
              description: "Ending line number (for blame line range)"
            },
            commit: {
              type: "string",
              description: "Commit hash (for cherry_pick operation)"
            },
            no_commit: {
              type: "boolean",
              description: "Apply changes without committing (for cherry_pick)"
            },
            bad_ref: {
              type: "string",
              description: "Known bad commit ref (for bisect_start)"
            },
            good_ref: {
              type: "string",
              description: "Known good commit ref (for bisect_start)"
            },
            result: {
              type: "string",
              enum: ["good", "bad", "skip"],
              description: "Mark current commit (for bisect_step)"
            },
            pop: {
              type: "boolean",
              description: "Pop the stash (for stash operation)"
            },
            create: {
              type: "boolean",
              description: "Create a new branch (for checkout operation)"
            },
            delete: {
              type: "boolean",
              description: "Delete a branch (for branch operation)"
            }
          }
        }
      },
      required: ["operation"]
    }
  }
};

// Codebase map tool for understanding project structure
export const CODEBASE_MAP_TOOL: CodeBuddyTool = {
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
export const SUBAGENT_TOOL: CodeBuddyTool = {
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

// Docker tool for container management
export const DOCKER_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "docker",
    description: "Manage Docker containers and images: list, run, stop, build, logs, exec, compose, and more",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "list_containers",
            "list_images",
            "run",
            "stop",
            "start",
            "remove_container",
            "remove_image",
            "logs",
            "exec",
            "build",
            "pull",
            "push",
            "inspect",
            "compose_up",
            "compose_down",
            "system_info",
            "prune"
          ],
          description: "The Docker operation to perform"
        },
        args: {
          type: "object",
          description: "Operation-specific arguments",
          properties: {
            // Common args
            container: {
              type: "string",
              description: "Container ID or name"
            },
            image: {
              type: "string",
              description: "Image name or ID"
            },
            all: {
              type: "boolean",
              description: "Include stopped containers (for list_containers)"
            },
            // Run args
            name: {
              type: "string",
              description: "Container name (for run)"
            },
            ports: {
              type: "array",
              items: { type: "string" },
              description: "Port mappings (e.g., ['8080:80', '443:443'])"
            },
            volumes: {
              type: "array",
              items: { type: "string" },
              description: "Volume mappings (e.g., ['/host/path:/container/path'])"
            },
            env: {
              type: "object",
              description: "Environment variables"
            },
            detach: {
              type: "boolean",
              description: "Run in background (for run)"
            },
            command: {
              type: "string",
              description: "Command to execute (for run/exec)"
            },
            // Build args
            context: {
              type: "string",
              description: "Build context path (for build)"
            },
            dockerfile: {
              type: "string",
              description: "Dockerfile path (for build)"
            },
            tag: {
              type: "string",
              description: "Image tag (for build)"
            },
            noCache: {
              type: "boolean",
              description: "Build without cache"
            },
            // Logs args
            tail: {
              type: "number",
              description: "Number of lines to show (for logs)"
            },
            // Compose args
            file: {
              type: "string",
              description: "Compose file path"
            },
            services: {
              type: "array",
              items: { type: "string" },
              description: "Services to start (for compose_up)"
            },
            removeVolumes: {
              type: "boolean",
              description: "Remove volumes (for compose_down)"
            },
            // Prune args
            pruneType: {
              type: "string",
              enum: ["containers", "images", "volumes", "system"],
              description: "Type of resources to prune"
            },
            force: {
              type: "boolean",
              description: "Force operation"
            }
          }
        }
      },
      required: ["operation"]
    }
  }
};

// Kubernetes tool for cluster management
export const KUBERNETES_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "kubernetes",
    description: "Manage Kubernetes clusters: get resources, apply manifests, logs, exec, scale, rollout, and more",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "cluster_info",
            "get_context",
            "list_contexts",
            "use_context",
            "get",
            "describe",
            "apply",
            "delete",
            "logs",
            "exec",
            "scale",
            "rollout_status",
            "rollout_restart",
            "port_forward",
            "get_events",
            "top",
            "create_namespace",
            "set_namespace",
            "create_configmap",
            "create_secret"
          ],
          description: "The Kubernetes operation to perform"
        },
        args: {
          type: "object",
          description: "Operation-specific arguments",
          properties: {
            // Resource identification
            resourceType: {
              type: "string",
              enum: [
                "pods",
                "deployments",
                "services",
                "configmaps",
                "secrets",
                "namespaces",
                "nodes",
                "ingresses",
                "persistentvolumeclaims",
                "statefulsets",
                "daemonsets",
                "jobs",
                "cronjobs",
                "replicasets"
              ],
              description: "Type of Kubernetes resource"
            },
            name: {
              type: "string",
              description: "Resource name"
            },
            namespace: {
              type: "string",
              description: "Kubernetes namespace"
            },
            // Get options
            allNamespaces: {
              type: "boolean",
              description: "Query all namespaces"
            },
            selector: {
              type: "string",
              description: "Label selector (e.g., 'app=nginx')"
            },
            output: {
              type: "string",
              enum: ["wide", "yaml", "json", "name"],
              description: "Output format"
            },
            // Apply options
            path: {
              type: "string",
              description: "Path to manifest file or URL"
            },
            dryRun: {
              type: "boolean",
              description: "Dry-run mode"
            },
            // Logs options
            container: {
              type: "string",
              description: "Container name in pod"
            },
            tail: {
              type: "number",
              description: "Number of lines to show"
            },
            previous: {
              type: "boolean",
              description: "Show previous container logs"
            },
            timestamps: {
              type: "boolean",
              description: "Show timestamps"
            },
            // Exec options
            command: {
              type: "string",
              description: "Command to execute"
            },
            // Scale options
            replicas: {
              type: "number",
              description: "Number of replicas"
            },
            // Port-forward options
            localPort: {
              type: "number",
              description: "Local port number"
            },
            remotePort: {
              type: "number",
              description: "Remote port number"
            },
            // Context options
            context: {
              type: "string",
              description: "Context name"
            },
            // ConfigMap/Secret options
            data: {
              type: "object",
              description: "Key-value data for ConfigMap/Secret"
            },
            secretType: {
              type: "string",
              description: "Secret type (default: generic)"
            },
            // Delete options
            force: {
              type: "boolean",
              description: "Force deletion"
            },
            gracePeriod: {
              type: "number",
              description: "Grace period in seconds"
            }
          }
        }
      },
      required: ["operation"]
    }
  }
};

// Process management tool
export const PROCESS_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "process",
    description: "Manage system processes: list, poll status, read logs, write to stdin, kill, clear logs, remove from tracking",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "poll", "log", "write", "kill", "clear", "remove"],
          description: "The process action to perform"
        },
        args: {
          type: "object",
          description: "Action-specific arguments",
          properties: {
            pid: {
              type: "number",
              description: "Process ID (required for poll, log, write, kill, clear, remove)"
            },
            filter: {
              type: "string",
              description: "Filter string for list action"
            },
            input: {
              type: "string",
              description: "Input to write to stdin (for write action)"
            },
            signal: {
              type: "string",
              description: "Signal to send (for kill, default: SIGTERM)"
            },
            lines: {
              type: "number",
              description: "Number of log lines (for log, default: 100)"
            },
            stderr: {
              type: "boolean",
              description: "Show stderr instead of stdout (for log)"
            }
          }
        }
      },
      required: ["action"]
    }
  }
};

// JavaScript REPL tool for sandboxed code execution
export const JS_REPL_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "js_repl",
    description: "Execute JavaScript code in a persistent sandboxed REPL. Variables persist across calls. No filesystem or network access.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["execute", "reset", "variables"],
          description: "Action: execute code (default), reset context, or list variables"
        },
        code: {
          type: "string",
          description: "JavaScript code to execute (required for execute action)"
        }
      },
      required: ["action"]
    }
  }
};

// Reasoning tool for Tree-of-Thought problem solving (MCTS + BFS)
export const REASON_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "reason",
    description: "Solve complex problems using Tree-of-Thought reasoning with Monte Carlo Tree Search. Use this for planning, architecture decisions, debugging complex issues, or any task requiring structured multi-step reasoning. Returns a reasoning tree with scored solution paths.",
    parameters: {
      type: "object",
      properties: {
        problem: {
          type: "string",
          description: "The problem statement or question to reason about"
        },
        context: {
          type: "string",
          description: "Additional context, constraints, or background information"
        },
        mode: {
          type: "string",
          enum: ["shallow", "medium", "deep", "exhaustive"],
          description: "Reasoning depth: shallow (~5 iterations), medium (~20), deep (~50), exhaustive (~100). Default: medium"
        },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Constraints that the solution must satisfy"
        }
      },
      required: ["problem"]
    }
  }
};

/**
 * All advanced tools as an array
 */
export const ADVANCED_TOOLS: CodeBuddyTool[] = [
  MULTI_EDIT_TOOL,
  GIT_TOOL,
  // CODEBASE_MAP_TOOL — removed: no execution handler (audit 2026-02-25)
  // SUBAGENT_TOOL — removed: no execution handler (audit 2026-02-25)
  DOCKER_TOOL,
  KUBERNETES_TOOL,
  PROCESS_TOOL,
  JS_REPL_TOOL,
  REASON_TOOL,
];
