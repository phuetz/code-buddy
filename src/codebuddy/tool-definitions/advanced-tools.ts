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

// Multi-edit tool for atomic multi-replacement on a single file
export const MULTI_EDIT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "multi_edit",
    description: "Apply multiple text replacements to a single file atomically. All edits succeed or none are applied. Each edit specifies old_string (text to find) and new_string (replacement). Use this when you need to make several changes to the same file in one operation.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit"
        },
        edits: {
          type: "array",
          description: "Array of edit operations to apply in order",
          items: {
            type: "object",
            properties: {
              old_string: {
                type: "string",
                description: "Exact text to find and replace"
              },
              new_string: {
                type: "string",
                description: "Replacement text"
              }
            },
            required: ["old_string", "new_string"]
          }
        }
      },
      required: ["file_path", "edits"]
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
    description: "Build and query a map of the codebase structure, symbols, dependencies, and code graph. Graph operations query the persistent code knowledge graph for import relationships, component locations, architecture layers, and dependency paths.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["build", "summary", "search", "symbols", "graph_query", "graph_neighbors", "graph_path", "graph_stats", "graph_file_functions"],
          description: "The operation: build (create map), summary (show overview), search (find files), symbols (list exports), graph_query (pattern match on code graph triples), graph_neighbors (ego-graph k-hop around entity), graph_path (shortest dependency path between two entities), graph_stats (code graph statistics), graph_file_functions (list all functions/methods in a file with their call graph)"
        },
        query: {
          type: "string",
          description: "Search query for finding relevant context, or entity name for graph operations (e.g. 'agent-executor', 'CodeBuddyAgent')"
        },
        target: {
          type: "string",
          description: "Target entity for graph_path operation"
        },
        depth: {
          type: "number",
          description: "Depth for graph_neighbors (default 2, max 4)"
        },
        predicate: {
          type: "string",
          description: "Filter by predicate for graph_query (e.g. 'imports', 'usedBy', 'definedIn', 'contains', 'patternOf')"
        },
        node_type: {
          type: "string",
          description: "Filter by node type for graph_query (e.g. 'module', 'agent', 'tool', 'middleware')"
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

// Managed dev-server lifecycle (develop → launch → browse → verify)
export const APP_SERVER_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "app_server",
    description: "Start a local dev server (e.g. 'npm run dev') as a managed background process, wait until its loopback URL answers, and make that origin browsable by the browser tool — use this to TEST a web app you just built. The origin stays browsable only while the server runs. Actions: start, stop, status, logs (server-side stdout/stderr — check them alongside browser_console for both faces of a bug), expose (PUBLIC preview URL via tunnel, TTL-limited — only when the user asks to share/see the app remotely, never for servers handling secrets), unexpose.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "status", "logs", "expose", "unexpose"],
          description: "The app server action to perform"
        },
        command: {
          type: "string",
          description: "Shell command that starts the server, e.g. 'npm run dev' (start)"
        },
        url: {
          type: "string",
          description: "Loopback readiness URL, e.g. http://127.0.0.1:5173/ — must be localhost/127.x/::1 and the port must be free (start)"
        },
        cwd: {
          type: "string",
          description: "Working directory for the server command (start)"
        },
        timeoutMs: {
          type: "number",
          description: "Readiness timeout in ms (start, default 45000)"
        },
        pid: {
          type: "number",
          description: "Managed server pid (stop, logs, expose, unexpose)"
        },
        lines: {
          type: "number",
          description: "Number of log lines (logs, default 100)"
        },
        stderr: {
          type: "boolean",
          description: "Show stderr instead of stdout (logs)"
        },
        ttlMinutes: {
          type: "number",
          description: "Public preview lifetime in minutes (expose, default 30, max 240)"
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

// Plan tool for managing execution plans (PLAN.md)
export const PLAN_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "plan",
    description: "Manage a persistent execution plan (PLAN.md). Use this to track progress on complex tasks with checkbox status tracking.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["init", "read", "update", "append"],
          description: "Action: init (create new plan), read (show current plan), update (change step status), append (add new steps)"
        },
        goal: {
          type: "string",
          description: "High-level goal for the plan (required for init)"
        },
        step: {
          type: "string",
          description: "Step description (for append) or step identifier (for update)"
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "failed"],
          description: "New status for the step (for update)"
        }
      },
      required: ["action"]
    }
  }
};

// Run script tool for sandboxed script execution
export const RUN_SCRIPT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "run_script",
    description: "Execute a Python, TypeScript, or JavaScript script in a secure sandboxed environment (Docker). Supports external dependencies.",
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "The script source code to execute"
        },
        language: {
          type: "string",
          enum: ["python", "typescript", "javascript", "shell"],
          description: "Script language (default: python)"
        },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description: "Package dependencies to install before running (e.g., ['numpy', 'pandas'])"
        },
        env: {
          type: "object",
          description: "Environment variables to set for the script"
        }
      },
      required: ["script"]
    }
  }
};

// Hermes-compatible execute_code tool with persistent run artifacts
export const EXECUTE_CODE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "execute_code",
    description: "Execute a bounded code snippet as a real local subprocess and save script/stdout/stderr/result artifacts under .codebuddy/execute-code.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The source code to execute"
        },
        language: {
          type: "string",
          enum: ["javascript", "typescript", "python", "shell"],
          description: "Snippet language (default: javascript)"
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional command-line arguments passed to the snippet"
        },
        env: {
          type: "object",
          description: "Optional string environment variables. CODEBUDDY_EXECUTE_CODE_RUN_DIR and CODEBUDDY_WORKSPACE_ROOT are always provided."
        },
        timeout_ms: {
          type: "number",
          description: "Execution timeout in milliseconds (default: 30000, max: 120000)"
        }
      },
      required: ["code"]
    }
  }
};

/**
 * All advanced tools as an array
 */
export const CODE_GRAPH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "code_graph",
    description: "Query the code dependency graph: find callers/callees, impact analysis, generate Mermaid flowcharts, class hierarchies, and dependency paths. Use this when the user asks about code relationships, who calls what, what would break if something changes, or wants a diagram/flowchart of the code.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["who_calls", "what_calls", "impact", "flowchart", "class_tree", "file_map", "find_path", "module_deps", "communities", "semantic_search", "dead_code", "coupling", "refactor", "drift", "snapshot", "visualize", "impact_preview", "stats"],
          description: "who_calls: find all callers. what_calls: find all callees. impact: transitive impact analysis. flowchart: Mermaid call chain. class_tree: inheritance hierarchy. file_map: file functions with signatures. find_path: dependency path A→B. module_deps: import diagram. communities: architectural clusters. semantic_search: embedding similarity. dead_code: uncalled functions/unimported modules. coupling: inter-module coupling heatmap. refactor: refactoring suggestions. drift: architecture changes vs snapshot. snapshot: save baseline for drift. visualize: interactive D3.js HTML. impact_preview: PR impact from git diff. stats: graph statistics + PageRank."
        },
        query: { type: "string", description: "Function, class, or module name (fuzzy matched)" },
        target: { type: "string", description: "Target entity for find_path operation" },
        depth: { type: "number", description: "Depth for flowchart/impact/module_deps (default 2, max 6)" },
      },
      required: ["operation"],
    },
  },
};

export const DEPLOY_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "deploy",
    description:
      "Deploy applications to cloud platforms (Fly.io, Railway, Render, GCP, Hetzner, Northflank). Generate configs, deploy, check status, or view logs. Requires confirmation. Not a substitute for git or docker.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["generate_config", "deploy", "status", "logs"],
          description: "Deployment action: generate_config, deploy, status, or logs",
        },
        platform: {
          type: "string",
          enum: ["fly", "railway", "render", "hetzner", "northflank", "gcp"],
          description: "Target cloud platform",
        },
        appName: {
          type: "string",
          description: "Application name (used in config generation)",
        },
        region: {
          type: "string",
          description: "Deployment region (e.g. iad, us-central1)",
        },
        port: {
          type: "number",
          description: "Application port (default: 3000)",
        },
        env: {
          type: "object",
          description: "Environment variables as key-value pairs",
          additionalProperties: { type: "string" },
        },
        memory: {
          type: "string",
          description: "Memory allocation (e.g. 512mb, 1gb)",
        },
        cpus: {
          type: "number",
          description: "Number of CPU cores",
        },
        outputDir: {
          type: "string",
          description: "Directory to write generated config files (for generate_config action)",
        },
        tailLines: {
          type: "number",
          description: "Number of log lines to retrieve (default: 50, for logs action)",
        },
      },
      required: ["action", "platform"],
    },
  },
};

export const DOCS_SEARCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "docs_search",
    description:
      "Search project documentation for architecture, API, security, and configuration information. Read-only local docs lookup — not a web search.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g. \"security model\", \"authentication flow\")",
        },
        scope: {
          type: "string",
          enum: ["all", "architecture", "api", "security", "config", "testing"],
          description: "Limit to a category (default: all)",
        },
      },
      required: ["query"],
    },
  },
};

export const KNOWLEDGE_GRAPH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "knowledge_graph",
    description:
      "Query the in-memory code knowledge graph for entity relationships (imports, calls, extends, exports). Actions: query, add, subgraph, path, stats. Distinct from code_graph (static analysis over the repo).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["query", "add", "subgraph", "path", "stats"],
          description: "Action to perform on the knowledge graph",
        },
        subject: {
          type: "string",
          description: "Triple subject (entity name, e.g. \"src/index.ts\", \"MyClass\"). Used by query and add.",
        },
        predicate: {
          type: "string",
          description:
            "Triple predicate (relationship type: imports, exports, calls, extends, implements, dependsOn, contains, definedIn, usedBy, typeof). Used by query and add.",
        },
        object: {
          type: "string",
          description: "Triple object (target entity). Used by query and add.",
        },
        metadata: {
          type: "object",
          description: "Optional metadata key-value pairs for add action.",
          additionalProperties: { type: "string" },
        },
        entity: {
          type: "string",
          description: "Entity name for subgraph exploration.",
        },
        depth: {
          type: "number",
          description: "Max traversal depth for subgraph (default: 2).",
        },
        from: {
          type: "string",
          description: "Starting entity for path finding.",
        },
        to: {
          type: "string",
          description: "Target entity for path finding.",
        },
        maxDepth: {
          type: "number",
          description: "Max path length for path finding (default: 5).",
        },
      },
      required: ["action"],
    },
  },
};

export const ADVANCED_TOOLS: CodeBuddyTool[] = [
  MULTI_EDIT_TOOL,
  GIT_TOOL,
  CODEBASE_MAP_TOOL,
  CODE_GRAPH_TOOL,
  SUBAGENT_TOOL,
  DOCKER_TOOL,
  KUBERNETES_TOOL,
  PROCESS_TOOL,
  APP_SERVER_TOOL,
  JS_REPL_TOOL,
  REASON_TOOL,
  PLAN_TOOL,
  EXECUTE_CODE_TOOL,
  RUN_SCRIPT_TOOL,
  DEPLOY_TOOL,
  DOCS_SEARCH_TOOL,
  KNOWLEDGE_GRAPH_TOOL,
];
