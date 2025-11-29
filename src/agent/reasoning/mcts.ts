/**
 * Monte Carlo Tree Search for Code Generation
 *
 * Implements MCTS with the Rethink mechanism for refining erroneous thoughts.
 * Based on RethinkMCTS (arXiv 2409.09584).
 */

import {
  ThoughtNode,
  ThoughtType,
  ThoughtState,
  MCTSConfig,
  MCTSStats,
  ReasoningResult,
  Problem,
  ExecutionResult,
  DEFAULT_MCTS_CONFIG,
} from "./types.js";

/**
 * Create a unique node ID
 */
function createNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Monte Carlo Tree Search implementation
 */
export class MCTS {
  private config: MCTSConfig;
  private root: ThoughtNode | null = null;
  private stats: MCTSStats;
  private startTime: number = 0;

  // Callbacks for external integration
  private generateThoughts: (node: ThoughtNode, problem: Problem) => Promise<string[]>;
  private evaluateThought: (node: ThoughtNode, problem: Problem) => Promise<number>;
  private executeCode: (code: string) => Promise<ExecutionResult>;
  private refineThought: (node: ThoughtNode, feedback: string) => Promise<string>;

  constructor(
    config: Partial<MCTSConfig> = {},
    callbacks: {
      generateThoughts: (node: ThoughtNode, problem: Problem) => Promise<string[]>;
      evaluateThought: (node: ThoughtNode, problem: Problem) => Promise<number>;
      executeCode: (code: string) => Promise<ExecutionResult>;
      refineThought: (node: ThoughtNode, feedback: string) => Promise<string>;
    }
  ) {
    this.config = { ...DEFAULT_MCTS_CONFIG, ...config };
    this.generateThoughts = callbacks.generateThoughts;
    this.evaluateThought = callbacks.evaluateThought;
    this.executeCode = callbacks.executeCode;
    this.refineThought = callbacks.refineThought;

    this.stats = {
      iterations: 0,
      nodesCreated: 0,
      nodesEvaluated: 0,
      nodesRefined: 0,
      maxDepthReached: 0,
      totalTime: 0,
      bestScore: 0,
    };
  }

  /**
   * Run MCTS search for a problem
   */
  async search(problem: Problem): Promise<ReasoningResult> {
    this.startTime = Date.now();
    this.stats = {
      iterations: 0,
      nodesCreated: 0,
      nodesEvaluated: 0,
      nodesRefined: 0,
      maxDepthReached: 0,
      totalTime: 0,
      bestScore: 0,
    };

    // Create root node
    this.root = this.createNode(
      `Understanding the problem: ${problem.description}`,
      "analysis",
      null,
      0
    );

    // Run MCTS iterations
    for (let i = 0; i < this.config.maxIterations; i++) {
      // Check time limit
      if (this.config.timeLimit && Date.now() - this.startTime > this.config.timeLimit) {
        break;
      }

      this.stats.iterations = i + 1;

      // 1. Selection
      const selectedNode = this.select(this.root);

      // 2. Expansion
      if (selectedNode.depth < this.config.maxDepth) {
        await this.expand(selectedNode, problem);
      }

      // 3. Simulation & Evaluation
      if (selectedNode.children.length > 0) {
        for (const child of selectedNode.children) {
          await this.simulate(child, problem);
        }
      }

      // 4. Backpropagation
      this.backpropagate(selectedNode);

      // 5. Rethink (if enabled)
      if (this.config.useRethink) {
        await this.rethink(selectedNode, problem);
      }

      // Check for solution
      const solution = this.findBestSolution();
      if (solution && solution.score > 0.9) {
        break;
      }
    }

    this.stats.totalTime = Date.now() - this.startTime;

    return this.buildResult();
  }

  /**
   * Create a thought node
   */
  private createNode(
    content: string,
    type: ThoughtType,
    parent: ThoughtNode | null,
    depth: number
  ): ThoughtNode {
    this.stats.nodesCreated++;

    return {
      id: createNodeId(),
      content,
      type,
      parent,
      children: [],
      score: 0,
      visits: 0,
      depth,
      metadata: {
        generationRound: this.stats.iterations,
      },
      state: "pending",
    };
  }

  /**
   * Select the most promising node using UCB1
   */
  private select(node: ThoughtNode): ThoughtNode {
    // If leaf node or not fully expanded, return it
    if (node.children.length === 0 || node.visits === 0) {
      return node;
    }

    // Calculate UCB1 for each child
    let bestChild: ThoughtNode | null = null;
    let bestUCB = -Infinity;

    for (const child of node.children) {
      if (child.state === "pruned") continue;

      const ucb = this.calculateUCB1(child, node.visits);
      if (ucb > bestUCB) {
        bestUCB = ucb;
        bestChild = child;
      }
    }

    // If no viable child, return current node
    if (!bestChild) return node;

    // Recursively select
    return this.select(bestChild);
  }

  /**
   * Calculate UCB1 value for a node
   */
  private calculateUCB1(node: ThoughtNode, parentVisits: number): number {
    if (node.visits === 0) {
      return Infinity; // Encourage exploration of unvisited nodes
    }

    const exploitation = node.score / node.visits;
    const exploration = this.config.explorationConstant *
      Math.sqrt(Math.log(parentVisits) / node.visits);

    return exploitation + exploration;
  }

  /**
   * Expand a node by generating child thoughts
   */
  private async expand(node: ThoughtNode, problem: Problem): Promise<void> {
    node.state = "exploring";

    // Generate new thoughts
    const thoughts = await this.generateThoughts(node, problem);

    // Create child nodes
    for (const thought of thoughts.slice(0, this.config.expansionCount)) {
      const childType = this.determineThoughtType(thought, node.depth);
      const child = this.createNode(thought, childType, node, node.depth + 1);
      node.children.push(child);

      this.stats.maxDepthReached = Math.max(this.stats.maxDepthReached, child.depth);
    }

    node.state = "evaluated";
  }

  /**
   * Determine the type of thought based on content and depth
   */
  private determineThoughtType(content: string, depth: number): ThoughtType {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes("```") || lowerContent.includes("function") ||
        lowerContent.includes("class") || lowerContent.includes("def ")) {
      return "implementation";
    }
    if (lowerContent.includes("test") || lowerContent.includes("verify") ||
        lowerContent.includes("check")) {
      return "verification";
    }
    if (lowerContent.includes("improve") || lowerContent.includes("refine") ||
        lowerContent.includes("optimize")) {
      return "refinement";
    }
    if (lowerContent.includes("therefore") || lowerContent.includes("conclusion") ||
        lowerContent.includes("solution")) {
      return "conclusion";
    }
    if (depth <= 1) {
      return "analysis";
    }

    return "hypothesis";
  }

  /**
   * Simulate from a node (rollout)
   */
  private async simulate(node: ThoughtNode, problem: Problem): Promise<void> {
    // Evaluate the thought
    const score = await this.evaluateThought(node, problem);
    node.score = score;
    node.visits = 1;
    this.stats.nodesEvaluated++;

    // If implementation, try to execute
    if (node.type === "implementation") {
      const code = this.extractCode(node.content);
      if (code) {
        const result = await this.executeCode(code);
        node.metadata.codeGenerated = code;
        node.metadata.executionResult = result;

        // Adjust score based on execution
        if (result.success) {
          node.score = Math.min(1, node.score + 0.3);
          node.state = "completed";
        } else {
          node.score = Math.max(0, node.score - 0.2);
          node.metadata.feedback = result.error;
        }
      }
    }

    this.stats.bestScore = Math.max(this.stats.bestScore, node.score);
  }

  /**
   * Backpropagate scores up the tree
   */
  private backpropagate(node: ThoughtNode): void {
    let current: ThoughtNode | null = node;

    while (current !== null) {
      current.visits++;

      // Update score as average of children
      if (current.children.length > 0) {
        const childScores = current.children
          .filter(c => c.state !== "pruned")
          .map(c => c.score);

        if (childScores.length > 0) {
          current.score = Math.max(...childScores);
        }
      }

      current = current.parent;
    }
  }

  /**
   * Rethink mechanism - refine erroneous thoughts
   */
  private async rethink(node: ThoughtNode, problem: Problem): Promise<void> {
    // Find nodes that failed execution or have low scores
    const nodesToRethink = this.findNodesNeedingRethink(node);

    for (const n of nodesToRethink) {
      if (n.metadata.feedback) {
        const refinedContent = await this.refineThought(n, n.metadata.feedback);

        // Create refined node as sibling
        const refinedNode = this.createNode(
          refinedContent,
          n.type,
          n.parent,
          n.depth
        );
        refinedNode.metadata.reasoning = `Refined from: ${n.id}`;
        refinedNode.state = "refined";

        if (n.parent) {
          n.parent.children.push(refinedNode);
        }

        // Mark original as pruned
        n.state = "pruned";
        this.stats.nodesRefined++;
      }
    }
  }

  /**
   * Find nodes that need rethinking
   */
  private findNodesNeedingRethink(node: ThoughtNode): ThoughtNode[] {
    const result: ThoughtNode[] = [];

    const traverse = (n: ThoughtNode) => {
      if (n.state !== "pruned" &&
          n.score < this.config.rethinkThreshold &&
          n.metadata.feedback) {
        result.push(n);
      }

      for (const child of n.children) {
        traverse(child);
      }
    };

    traverse(node);
    return result.slice(0, 3); // Limit rethinking
  }

  /**
   * Find the best solution in the tree
   */
  private findBestSolution(): ThoughtNode | null {
    if (!this.root) return null;

    let best: ThoughtNode | null = null;
    let bestScore = -1;

    const traverse = (node: ThoughtNode) => {
      if (node.state !== "pruned" &&
          (node.type === "implementation" || node.type === "conclusion") &&
          node.score > bestScore) {
        bestScore = node.score;
        best = node;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);
    return best;
  }

  /**
   * Get the path from root to a node
   */
  private getPathToNode(node: ThoughtNode): ThoughtNode[] {
    const path: ThoughtNode[] = [];
    let current: ThoughtNode | null = node;

    while (current !== null) {
      path.unshift(current);
      current = current.parent;
    }

    return path;
  }

  /**
   * Get alternative solutions
   */
  private getAlternatives(best: ThoughtNode | null): ThoughtNode[] {
    if (!this.root) return [];

    const alternatives: ThoughtNode[] = [];

    const traverse = (node: ThoughtNode) => {
      if (node !== best &&
          node.state !== "pruned" &&
          (node.type === "implementation" || node.type === "conclusion") &&
          node.score > 0.5) {
        alternatives.push(node);
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);

    return alternatives
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  /**
   * Extract code from thought content
   */
  private extractCode(content: string): string | null {
    // Try to extract code blocks
    const codeBlockMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Check if content looks like code
    if (content.includes("function") || content.includes("class") ||
        content.includes("const") || content.includes("def ")) {
      return content;
    }

    return null;
  }

  /**
   * Build the final result
   */
  private buildResult(): ReasoningResult {
    const solution = this.findBestSolution();
    const path = solution ? this.getPathToNode(solution) : [];
    const alternatives = this.getAlternatives(solution);

    return {
      success: solution !== null && solution.score > 0.5,
      solution,
      path,
      alternatives,
      stats: { ...this.stats },
      tree: this.root!,
    };
  }

  /**
   * Get current statistics
   */
  getStats(): MCTSStats {
    return { ...this.stats };
  }

  /**
   * Get the tree root
   */
  getRoot(): ThoughtNode | null {
    return this.root;
  }

  /**
   * Format tree for display
   */
  formatTree(node: ThoughtNode = this.root!, indent: string = ""): string {
    if (!node) return "Empty tree";

    const stateEmoji: Record<ThoughtState, string> = {
      pending: "⏳",
      exploring: "🔍",
      evaluated: "📊",
      refined: "🔄",
      completed: "✅",
      failed: "❌",
      pruned: "✂️",
    };

    const typeEmoji: Record<ThoughtType, string> = {
      analysis: "🔬",
      hypothesis: "💡",
      implementation: "💻",
      verification: "✔️",
      refinement: "🔧",
      conclusion: "🎯",
    };

    let output = `${indent}${stateEmoji[node.state]} ${typeEmoji[node.type]} `;
    output += `[${node.score.toFixed(2)}, v:${node.visits}] `;
    output += `${node.content.slice(0, 50)}${node.content.length > 50 ? "..." : ""}\n`;

    for (const child of node.children) {
      output += this.formatTree(child, indent + "  ");
    }

    return output;
  }
}

/**
 * Create an MCTS instance with default callbacks
 */
export function createMCTS(
  config: Partial<MCTSConfig> = {},
  callbacks: {
    generateThoughts: (node: ThoughtNode, problem: Problem) => Promise<string[]>;
    evaluateThought: (node: ThoughtNode, problem: Problem) => Promise<number>;
    executeCode: (code: string) => Promise<ExecutionResult>;
    refineThought: (node: ThoughtNode, feedback: string) => Promise<string>;
  }
): MCTS {
  return new MCTS(config, callbacks);
}
