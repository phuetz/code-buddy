/**
 * Tool Dependency Graph Module
 *
 * Manages tool dependencies and execution ordering for smart parallelization.
 * Enables safe parallel execution of tools by analyzing:
 * - Tool output/input dependencies
 * - Resource conflicts (files, directories)
 * - Side effects and state modifications
 *
 * @module agent/execution
 */

import { CodeBuddyToolCall } from "../../codebuddy/client.js";
import { logger } from "../../utils/logger.js";

/**
 * Resource type that a tool can access
 */
export type ResourceType = "file" | "directory" | "network" | "process" | "state";

/**
 * Access mode for a resource
 */
export type AccessMode = "read" | "write" | "execute";

/**
 * Resource access declaration
 */
export interface ResourceAccess {
  /** Type of resource being accessed */
  type: ResourceType;
  /** Resource identifier (file path, URL, etc.) */
  identifier: string;
  /** Access mode */
  mode: AccessMode;
}

/**
 * Tool metadata for dependency analysis
 */
export interface ToolMetadata {
  /** Tool name */
  name: string;
  /** Resources this tool reads */
  reads: ResourceType[];
  /** Resources this tool writes */
  writes: ResourceType[];
  /** Whether the tool has side effects */
  hasSideEffects: boolean;
  /** Tools that must run before this one */
  dependsOn: string[];
  /** Whether the tool is safe for parallel execution */
  parallelSafe: boolean;
  /** Priority for execution ordering (higher = earlier) */
  priority: number;
}

/**
 * Default tool metadata definitions
 */
export const TOOL_METADATA: Record<string, Partial<ToolMetadata>> = {
  // Read-only tools (safe for parallel)
  view_file: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 10,
  },
  search: {
    reads: ["file", "directory"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 10,
  },
  find_symbols: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 10,
  },
  find_references: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 10,
  },
  find_definition: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 10,
  },
  codebase_map: {
    reads: ["directory"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 10,
  },

  // Network tools (safe for parallel)
  web_search: {
    reads: ["network"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 8,
  },
  web_fetch: {
    reads: ["network"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 8,
  },

  // File modification tools (require ordering)
  create_file: {
    reads: [],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 5,
  },
  str_replace_editor: {
    reads: ["file"],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 4,
  },
  edit_file: {
    reads: ["file"],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 4,
  },
  multi_edit: {
    reads: ["file"],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 4,
  },

  // Bash - most side effects
  bash: {
    reads: ["file", "directory", "network", "process"],
    writes: ["file", "directory", "process", "state"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 3,
  },

  // Git operations
  git: {
    reads: ["file", "directory"],
    writes: ["file", "directory", "state"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 2,
  },

  // Todo operations (state modification)
  create_todo_list: {
    reads: [],
    writes: ["state"],
    hasSideEffects: true,
    parallelSafe: true, // Different tool calls create different lists
    priority: 6,
  },
  update_todo_list: {
    reads: ["state"],
    writes: ["state"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 6,
  },

  // Media tools (safe for parallel)
  pdf: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 7,
  },
  audio: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 7,
  },
  video: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 7,
  },
  document: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 7,
  },
  ocr: {
    reads: ["file"],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 7,
  },

  // Generation tools (write files)
  screenshot: {
    reads: [],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: true, // Different screenshots go to different files
    priority: 6,
  },
  diagram: {
    reads: [],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: true,
    priority: 6,
  },
  export: {
    reads: ["file"],
    writes: ["file"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 5,
  },

  // Reasoning tool (no side effects)
  reason: {
    reads: [],
    writes: [],
    hasSideEffects: false,
    parallelSafe: true,
    priority: 9,
  },

  // Browser tool (side effects)
  browser: {
    reads: ["network"],
    writes: ["file", "state"],
    hasSideEffects: true,
    parallelSafe: false,
    priority: 5,
  },
};

/**
 * Node in the dependency graph
 */
export interface GraphNode {
  /** Tool call ID */
  id: string;
  /** Tool name */
  toolName: string;
  /** Tool call data */
  toolCall: CodeBuddyToolCall;
  /** Resources accessed by this tool */
  resources: ResourceAccess[];
  /** Dependencies (must execute before this) */
  dependencies: Set<string>;
  /** Dependents (execute after this) */
  dependents: Set<string>;
  /** Execution level (for parallel scheduling) */
  level: number;
}

/**
 * Execution plan with parallel batches
 */
export interface ExecutionPlan {
  /** Batches of tool calls that can run in parallel */
  batches: CodeBuddyToolCall[][];
  /** Total number of levels */
  levels: number;
  /** Whether any parallelization was possible */
  parallelized: boolean;
  /** Explanation of the plan */
  explanation: string;
}

/**
 * ToolDependencyGraph - Analyzes and manages tool execution dependencies
 *
 * @example
 * ```typescript
 * const graph = new ToolDependencyGraph();
 * const plan = graph.buildExecutionPlan(toolCalls);
 *
 * for (const batch of plan.batches) {
 *   // Execute tools in batch in parallel
 *   await Promise.all(batch.map(tc => executeTool(tc)));
 * }
 * ```
 */
export class ToolDependencyGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private customMetadata: Map<string, Partial<ToolMetadata>> = new Map();

  /**
   * Register custom tool metadata
   */
  registerToolMetadata(toolName: string, metadata: Partial<ToolMetadata>): void {
    this.customMetadata.set(toolName, metadata);
  }

  /**
   * Get metadata for a tool
   */
  getToolMetadata(toolName: string): ToolMetadata {
    const custom = this.customMetadata.get(toolName);
    const builtin = TOOL_METADATA[toolName];
    const merged = { ...builtin, ...custom };

    return {
      name: toolName,
      reads: merged.reads || [],
      writes: merged.writes || [],
      hasSideEffects: merged.hasSideEffects ?? true,
      dependsOn: merged.dependsOn || [],
      parallelSafe: merged.parallelSafe ?? false,
      priority: merged.priority ?? 5,
    };
  }

  /**
   * Extract resources accessed by a tool call
   */
  extractResources(toolCall: CodeBuddyToolCall): ResourceAccess[] {
    const resources: ResourceAccess[] = [];
    const metadata = this.getToolMetadata(toolCall.function.name);

    try {
      const args = JSON.parse(toolCall.function.arguments);

      // Extract file paths
      const filePath = args.path || args.target_file || args.file_path || args.file;
      if (filePath) {
        const mode: AccessMode = metadata.writes.includes("file") ? "write" : "read";
        resources.push({ type: "file", identifier: filePath, mode });
      }

      // Extract directory paths
      const dirPath = args.directory || args.dir || args.folder;
      if (dirPath) {
        const mode: AccessMode = metadata.writes.includes("directory") ? "write" : "read";
        resources.push({ type: "directory", identifier: dirPath, mode });
      }

      // Extract URLs
      const url = args.url;
      if (url) {
        resources.push({ type: "network", identifier: url, mode: "read" });
      }

      // Bash command - try to detect file operations
      if (toolCall.function.name === "bash" && args.command) {
        const bashResources = this.extractBashResources(args.command);
        resources.push(...bashResources);
      }
    } catch {
      // Failed to parse arguments, assume worst case
      logger.debug("Failed to parse tool arguments for dependency analysis", {
        toolName: toolCall.function.name,
      });
    }

    return resources;
  }

  /**
   * Extract resources from a bash command (best effort)
   */
  private extractBashResources(command: string): ResourceAccess[] {
    const resources: ResourceAccess[] = [];

    // Simple heuristics for common patterns
    // Read operations
    if (/\bcat\b|\bless\b|\bhead\b|\btail\b|\bgrep\b/.test(command)) {
      // Extract file paths after these commands
      const matches = command.match(/(?:cat|less|head|tail|grep)\s+(?:-[^\s]+\s+)*([^\s|>]+)/g);
      if (matches) {
        for (const match of matches) {
          const path = match.split(/\s+/).pop();
          if (path && !path.startsWith("-")) {
            resources.push({ type: "file", identifier: path, mode: "read" });
          }
        }
      }
    }

    // Write operations
    if (/\becho\b.*>|\btee\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b/.test(command)) {
      resources.push({ type: "file", identifier: "*", mode: "write" });
      resources.push({ type: "directory", identifier: "*", mode: "write" });
    }

    // Process operations
    if (/\bkill\b|\bpkill\b/.test(command)) {
      resources.push({ type: "process", identifier: "*", mode: "execute" });
    }

    // Git operations
    if (/\bgit\b/.test(command)) {
      resources.push({ type: "directory", identifier: ".git", mode: "write" });
      resources.push({ type: "state", identifier: "git", mode: "write" });
    }

    // npm/yarn operations
    if (/\bnpm\b|\byarn\b|\bpnpm\b/.test(command)) {
      resources.push({ type: "directory", identifier: "node_modules", mode: "write" });
      resources.push({ type: "file", identifier: "package-lock.json", mode: "write" });
    }

    return resources;
  }

  /**
   * Check if two tool calls have a resource conflict
   */
  hasResourceConflict(
    resources1: ResourceAccess[],
    resources2: ResourceAccess[]
  ): boolean {
    for (const r1 of resources1) {
      for (const r2 of resources2) {
        // Same resource type
        if (r1.type !== r2.type) continue;

        // Wildcard match
        if (r1.identifier === "*" || r2.identifier === "*") {
          // Write + any = conflict
          if (r1.mode === "write" || r2.mode === "write") {
            return true;
          }
        }

        // Exact match
        if (r1.identifier === r2.identifier) {
          // Write + any = conflict
          if (r1.mode === "write" || r2.mode === "write") {
            return true;
          }
        }

        // Directory containment check
        if (r1.type === "file" && r2.type === "directory") {
          if (r1.identifier.startsWith(r2.identifier + "/")) {
            if (r1.mode === "write" || r2.mode === "write") {
              return true;
            }
          }
        }
        if (r2.type === "file" && r1.type === "directory") {
          if (r2.identifier.startsWith(r1.identifier + "/")) {
            if (r1.mode === "write" || r2.mode === "write") {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Build dependency graph from tool calls
   */
  buildGraph(toolCalls: CodeBuddyToolCall[]): Map<string, GraphNode> {
    this.nodes.clear();

    // Create nodes
    for (const tc of toolCalls) {
      const resources = this.extractResources(tc);
      const node: GraphNode = {
        id: tc.id,
        toolName: tc.function.name,
        toolCall: tc,
        resources,
        dependencies: new Set(),
        dependents: new Set(),
        level: 0,
      };
      this.nodes.set(tc.id, node);
    }

    // Build dependencies based on resource conflicts
    const nodeList = Array.from(this.nodes.values());
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const node1 = nodeList[i];
        const node2 = nodeList[j];

        // Check for resource conflicts
        if (this.hasResourceConflict(node1.resources, node2.resources)) {
          // The later tool depends on the earlier one
          node2.dependencies.add(node1.id);
          node1.dependents.add(node2.id);
        }

        // Check for explicit tool dependencies
        const meta2 = this.getToolMetadata(node2.toolName);
        if (meta2.dependsOn.includes(node1.toolName)) {
          node2.dependencies.add(node1.id);
          node1.dependents.add(node2.id);
        }
      }
    }

    // Calculate levels using topological sort
    this.calculateLevels();

    return this.nodes;
  }

  /**
   * Calculate execution levels using topological sort
   */
  private calculateLevels(): void {
    const _visited = new Set<string>();
    const levels = new Map<string, number>();

    const visit = (nodeId: string): number => {
      if (levels.has(nodeId)) {
        return levels.get(nodeId)!;
      }

      const node = this.nodes.get(nodeId);
      if (!node) return 0;

      if (node.dependencies.size === 0) {
        levels.set(nodeId, 0);
        return 0;
      }

      let maxDepLevel = -1;
      for (const depId of node.dependencies) {
        maxDepLevel = Math.max(maxDepLevel, visit(depId));
      }

      const level = maxDepLevel + 1;
      levels.set(nodeId, level);
      return level;
    };

    // Visit all nodes
    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    // Update node levels
    for (const [nodeId, level] of levels) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.level = level;
      }
    }
  }

  /**
   * Build an execution plan with parallel batches
   */
  buildExecutionPlan(toolCalls: CodeBuddyToolCall[]): ExecutionPlan {
    if (toolCalls.length === 0) {
      return {
        batches: [],
        levels: 0,
        parallelized: false,
        explanation: "No tool calls to execute",
      };
    }

    if (toolCalls.length === 1) {
      return {
        batches: [toolCalls],
        levels: 1,
        parallelized: false,
        explanation: "Single tool call, no parallelization needed",
      };
    }

    // Build the dependency graph
    this.buildGraph(toolCalls);

    // Group nodes by level
    const levelGroups = new Map<number, GraphNode[]>();
    let maxLevel = 0;

    for (const node of this.nodes.values()) {
      const group = levelGroups.get(node.level) || [];
      group.push(node);
      levelGroups.set(node.level, group);
      maxLevel = Math.max(maxLevel, node.level);
    }

    // Build batches from level groups
    const batches: CodeBuddyToolCall[][] = [];
    for (let level = 0; level <= maxLevel; level++) {
      const group = levelGroups.get(level) || [];
      if (group.length > 0) {
        // Sort by priority within level
        group.sort((a, b) => {
          const metaA = this.getToolMetadata(a.toolName);
          const metaB = this.getToolMetadata(b.toolName);
          return metaB.priority - metaA.priority;
        });
        batches.push(group.map(n => n.toolCall));
      }
    }

    // Check if we achieved parallelization
    const parallelized = batches.some(b => b.length > 1);
    const totalBatches = batches.length;
    const originalLength = toolCalls.length;

    let explanation: string;
    if (parallelized) {
      const parallelBatches = batches.filter(b => b.length > 1).length;
      explanation = `Organized ${originalLength} tools into ${totalBatches} batches, ` +
        `${parallelBatches} with parallel execution`;
    } else if (totalBatches < originalLength) {
      explanation = `Sequential execution required due to dependencies`;
    } else {
      explanation = `All tools require sequential execution`;
    }

    return {
      batches,
      levels: maxLevel + 1,
      parallelized,
      explanation,
    };
  }

  /**
   * Check if a specific pair of tools can run in parallel
   */
  canRunInParallel(
    toolCall1: CodeBuddyToolCall,
    toolCall2: CodeBuddyToolCall
  ): boolean {
    const meta1 = this.getToolMetadata(toolCall1.function.name);
    const meta2 = this.getToolMetadata(toolCall2.function.name);

    // Both must be parallel-safe
    if (!meta1.parallelSafe || !meta2.parallelSafe) {
      return false;
    }

    // Check resource conflicts
    const resources1 = this.extractResources(toolCall1);
    const resources2 = this.extractResources(toolCall2);

    return !this.hasResourceConflict(resources1, resources2);
  }

  /**
   * Get a visualization of the dependency graph
   */
  visualize(): string {
    if (this.nodes.size === 0) {
      return "Empty graph";
    }

    const lines: string[] = ["Tool Dependency Graph", "====================", ""];

    // Group by level
    const levelGroups = new Map<number, GraphNode[]>();
    let maxLevel = 0;

    for (const node of this.nodes.values()) {
      const group = levelGroups.get(node.level) || [];
      group.push(node);
      levelGroups.set(node.level, group);
      maxLevel = Math.max(maxLevel, node.level);
    }

    // Print each level
    for (let level = 0; level <= maxLevel; level++) {
      const group = levelGroups.get(level) || [];
      lines.push(`Level ${level}: [${group.map(n => n.toolName).join(", ")}]`);

      for (const node of group) {
        if (node.dependencies.size > 0) {
          const deps = Array.from(node.dependencies)
            .map(id => this.nodes.get(id)?.toolName || id)
            .join(", ");
          lines.push(`  ${node.toolName} <- depends on: ${deps}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
  }
}

/**
 * Create a new ToolDependencyGraph instance
 */
export function createToolDependencyGraph(): ToolDependencyGraph {
  return new ToolDependencyGraph();
}

// Singleton instance
let graphInstance: ToolDependencyGraph | null = null;

/**
 * Get global ToolDependencyGraph instance
 */
export function getToolDependencyGraph(): ToolDependencyGraph {
  if (!graphInstance) {
    graphInstance = createToolDependencyGraph();
  }
  return graphInstance;
}

/**
 * Reset global ToolDependencyGraph
 */
export function resetToolDependencyGraph(): void {
  graphInstance = null;
}
