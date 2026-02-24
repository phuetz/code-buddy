/**
 * Monte Carlo Tree Search for Code Generation
 *
 * Implements MCTS with the Rethink mechanism for refining erroneous thoughts.
 * Based on:
 * - RethinkMCTS (arXiv 2409.09584)
 * - MCTSr Q-value formula (arXiv 2406.07394)
 * - BFS beam search for Tree-of-Thought
 */

import {
  ThoughtNode,
  ThoughtType,
  ThoughtState,
  MCTSConfig,
  MCTSStats,
  MCTSProgressEvent,
  ReasoningResult,
  Problem,
  ExecutionResult,
  DEFAULT_MCTS_CONFIG,
  THINKING_MODE_CONFIG,
} from './types.js';

/**
 * Estimated tokens per LLM call type
 */
const TOKENS_PER_GENERATE = 500;
const TOKENS_PER_EVALUATE = 200;

/**
 * Categorical evaluation labels mapped to numeric scores
 */
const CATEGORICAL_SCORES: Record<string, number> = {
  'sure': 1.0,
  'likely': 0.6,
  'impossible': 0.1,
};

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
      tokensUsed: 0,
    };
  }

  /**
   * Public search router — dispatches to MCTS or BFS based on config
   */
  async search(problem: Problem): Promise<ReasoningResult> {
    if (this.config.progressiveDeepening) {
      return this.searchProgressive(problem);
    }

    if (this.config.searchAlgorithm === 'bfs') {
      return this.searchBFS(problem);
    }

    return this.searchMCTS(problem);
  }

  /**
   * Run classic MCTS search for a problem
   */
  async searchMCTS(problem: Problem): Promise<ReasoningResult> {
    this.startTime = Date.now();
    this.resetStats();

    // Create root node
    this.root = this.createNode(
      `Understanding the problem: ${problem.description}`,
      'analysis',
      null,
      0
    );

    // Run MCTS iterations
    for (let i = 0; i < this.config.maxIterations; i++) {
      // Check time limit
      if (this.config.timeLimit && Date.now() - this.startTime > this.config.timeLimit) {
        break;
      }

      // Check token budget
      if (this.isTokenBudgetExhausted()) {
        break;
      }

      this.stats.iterations = i + 1;

      // 1. Selection
      const selectedNode = this.select(this.root);

      // 2. Expansion
      if (selectedNode.depth < this.config.maxDepth) {
        await this.expand(selectedNode, problem);
        this.emitProgress('expansion', selectedNode.id);
      }

      // 3. Simulation & Evaluation
      if (selectedNode.children.length > 0) {
        for (const child of selectedNode.children) {
          if (this.isTokenBudgetExhausted()) break;
          await this.simulate(child, problem);
          this.emitProgress('evaluation', child.id);
        }
      }

      // 4. Backpropagation (MCTSr formula)
      this.backpropagate(selectedNode);

      // 5. Rethink (if enabled)
      if (this.config.useRethink) {
        await this.rethink(selectedNode, problem);
      }

      this.emitProgress('iteration');

      // Check for solution
      const solution = this.findBestSolution();
      if (solution && solution.score > 0.9) {
        this.emitProgress('solution_found', solution.id);
        break;
      }
    }

    this.stats.totalTime = Date.now() - this.startTime;

    return this.buildResult();
  }

  /**
   * BFS Beam Search mode
   *
   * At each depth level, keep top-b states (beamWidth) and discard the rest.
   * Uses categorical evaluation ("sure/likely/impossible") instead of numeric.
   */
  async searchBFS(problem: Problem): Promise<ReasoningResult> {
    this.startTime = Date.now();
    this.resetStats();

    const beamWidth = this.config.beamWidth ?? 3;

    // Create root node
    this.root = this.createNode(
      `Understanding the problem: ${problem.description}`,
      'analysis',
      null,
      0
    );

    let currentBeam: ThoughtNode[] = [this.root];

    for (let depth = 0; depth < this.config.maxDepth; depth++) {
      if (this.config.timeLimit && Date.now() - this.startTime > this.config.timeLimit) {
        break;
      }
      if (this.isTokenBudgetExhausted()) {
        break;
      }

      const candidates: ThoughtNode[] = [];

      // Expand all nodes in the current beam
      for (const node of currentBeam) {
        if (this.isTokenBudgetExhausted()) break;

        const thoughts = await this.generateThoughts(node, problem);
        this.stats.tokensUsed += TOKENS_PER_GENERATE;

        for (const thought of thoughts.slice(0, this.config.expansionCount)) {
          const childType = this.determineThoughtType(thought, depth + 1);
          const child = this.createNode(thought, childType, node, depth + 1);
          node.children.push(child);
          candidates.push(child);

          this.stats.maxDepthReached = Math.max(this.stats.maxDepthReached, child.depth);
        }

        node.state = 'evaluated';
        this.emitProgress('expansion', node.id);
      }

      if (candidates.length === 0) break;

      // Evaluate all candidates using categorical evaluation
      for (const candidate of candidates) {
        if (this.isTokenBudgetExhausted()) break;

        const rawScore = await this.evaluateThought(candidate, problem);
        this.stats.tokensUsed += TOKENS_PER_EVALUATE;

        // Map to categorical: nearest categorical label
        candidate.score = this.toCategoricalScore(rawScore);
        candidate.visits = 1;
        candidate.metadata.rewardSamples = [candidate.score];
        this.stats.nodesEvaluated++;

        // If implementation, try execution
        if (candidate.type === 'implementation') {
          const code = this.extractCode(candidate.content);
          if (code) {
            const result = await this.executeCode(code);
            candidate.metadata.codeGenerated = code;
            candidate.metadata.executionResult = result;

            if (result.success) {
              candidate.score = Math.min(1, candidate.score + 0.3);
              candidate.state = 'completed';
            } else {
              candidate.score = Math.max(0, candidate.score - 0.2);
              candidate.metadata.feedback = result.error;
            }
          }
        }

        this.stats.bestScore = Math.max(this.stats.bestScore, candidate.score);
        this.emitProgress('evaluation', candidate.id);
      }

      // Keep top-b candidates by score
      candidates.sort((a, b) => b.score - a.score);
      const kept = candidates.slice(0, beamWidth);
      const pruned = candidates.slice(beamWidth);

      for (const p of pruned) {
        p.state = 'pruned';
      }

      currentBeam = kept;
      this.stats.iterations++;
      this.emitProgress('iteration');

      // Check for solution
      const best = kept[0];
      if (best && best.score > 0.9) {
        this.emitProgress('solution_found', best.id);
        break;
      }
    }

    this.stats.totalTime = Date.now() - this.startTime;
    return this.buildResult();
  }

  /**
   * Progressive deepening search
   *
   * Starts with shallow config (5 iterations). If bestScore < 0.6,
   * escalates to medium, then deep, then exhaustive.
   */
  async searchProgressive(problem: Problem): Promise<ReasoningResult> {
    const escalationOrder: Array<'shallow' | 'medium' | 'deep' | 'exhaustive'> = [
      'shallow', 'medium', 'deep', 'exhaustive',
    ];
    const scoreThreshold = 0.6;

    let lastResult: ReasoningResult | null = null;

    for (const mode of escalationOrder) {
      const modeConfig = THINKING_MODE_CONFIG[mode];
      // Apply mode config but keep callbacks and overrides from original config
      this.config = {
        ...DEFAULT_MCTS_CONFIG,
        ...modeConfig,
        // Preserve user overrides for non-mode fields
        searchAlgorithm: this.config.searchAlgorithm,
        useRethink: this.config.useRethink,
        rethinkThreshold: this.config.rethinkThreshold,
        timeLimit: this.config.timeLimit,
        rewardSamples: this.config.rewardSamples,
        onProgress: this.config.onProgress,
        // Use mode token budget if no explicit override
        tokenBudget: this.config.tokenBudget ?? modeConfig.tokenBudget,
        // Disable progressive deepening to prevent recursion
        progressiveDeepening: false,
      };

      if (this.config.searchAlgorithm === 'bfs') {
        lastResult = await this.searchBFS(problem);
      } else {
        lastResult = await this.searchMCTS(problem);
      }

      if (lastResult.stats.bestScore >= scoreThreshold) {
        break;
      }

      // If we haven't reached the threshold, accumulate stats for next round
      // The next round starts fresh but benefits from higher iteration counts
    }

    return lastResult!;
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
        rewardSamples: [],
      },
      state: 'pending',
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
      if (child.state === 'pruned') continue;

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
   * Uses MCTSr Q-value: Q(a) = 0.5 * (min(R_a) + mean(R_a))
   */
  private calculateUCB1(node: ThoughtNode, parentVisits: number): number {
    if (node.visits === 0) {
      return Infinity; // Encourage exploration of unvisited nodes
    }

    const qValue = this.computeQValue(node);
    const exploration = this.config.explorationConstant *
      Math.sqrt(Math.log(parentVisits) / node.visits);

    return qValue + exploration;
  }

  /**
   * Compute MCTSr Q-value for a node
   * Q(a) = 0.5 * (min(R_a) + mean(R_a))
   * Falls back to simple score/visits if no reward samples
   */
  private computeQValue(node: ThoughtNode): number {
    const samples = node.metadata.rewardSamples;
    if (!samples || samples.length === 0) {
      // node.score is already a Q-value in [0,1], not cumulative — don't divide
      return node.score;
    }

    const minReward = Math.min(...samples);
    const meanReward = samples.reduce((sum, r) => sum + r, 0) / samples.length;

    return 0.5 * (minReward + meanReward);
  }

  /**
   * Expand a node by generating child thoughts
   */
  private async expand(node: ThoughtNode, problem: Problem): Promise<void> {
    node.state = 'exploring';

    // Generate new thoughts
    const thoughts = await this.generateThoughts(node, problem);
    this.stats.tokensUsed += TOKENS_PER_GENERATE;

    // Create child nodes
    for (const thought of thoughts.slice(0, this.config.expansionCount)) {
      const childType = this.determineThoughtType(thought, node.depth);
      const child = this.createNode(thought, childType, node, node.depth + 1);
      node.children.push(child);

      this.stats.maxDepthReached = Math.max(this.stats.maxDepthReached, child.depth);
    }

    node.state = 'evaluated';
  }

  /**
   * Determine the type of thought based on content and depth
   */
  private determineThoughtType(content: string, depth: number): ThoughtType {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('```') || lowerContent.includes('function') ||
        lowerContent.includes('class') || lowerContent.includes('def ')) {
      return 'implementation';
    }
    if (lowerContent.includes('test') || lowerContent.includes('verify') ||
        lowerContent.includes('check')) {
      return 'verification';
    }
    if (lowerContent.includes('improve') || lowerContent.includes('refine') ||
        lowerContent.includes('optimize')) {
      return 'refinement';
    }
    if (lowerContent.includes('therefore') || lowerContent.includes('conclusion') ||
        lowerContent.includes('solution')) {
      return 'conclusion';
    }
    if (depth <= 1) {
      return 'analysis';
    }

    return 'hypothesis';
  }

  /**
   * Simulate from a node (rollout)
   * Collects multiple reward samples per node for robust Q-value estimation
   */
  private async simulate(node: ThoughtNode, problem: Problem): Promise<void> {
    const numSamples = this.config.rewardSamples ?? 1;

    if (!node.metadata.rewardSamples) {
      node.metadata.rewardSamples = [];
    }

    // Collect reward samples
    for (let s = 0; s < numSamples; s++) {
      if (this.isTokenBudgetExhausted()) break;

      const score = await this.evaluateThought(node, problem);
      this.stats.tokensUsed += TOKENS_PER_EVALUATE;
      node.metadata.rewardSamples.push(score);
    }

    // Set node score as MCTSr Q-value
    node.score = this.computeQValue(node);
    node.visits = 1;
    this.stats.nodesEvaluated++;

    // If implementation, try to execute
    if (node.type === 'implementation') {
      const code = this.extractCode(node.content);
      if (code) {
        const result = await this.executeCode(code);
        node.metadata.codeGenerated = code;
        node.metadata.executionResult = result;

        // Adjust score based on execution
        if (result.success) {
          node.score = Math.min(1, node.score + 0.3);
          node.state = 'completed';
        } else {
          node.score = Math.max(0, node.score - 0.2);
          node.metadata.feedback = result.error;
        }
      }
    }

    this.stats.bestScore = Math.max(this.stats.bestScore, node.score);
  }

  /**
   * Backpropagate scores up the tree using MCTSr formula
   * Q'(parent) = 0.5 * (Q(parent) + max(Q(children)))
   */
  private backpropagate(node: ThoughtNode): void {
    let current: ThoughtNode | null = node;

    while (current !== null) {
      current.visits++;

      // Update score using MCTSr backpropagation formula
      if (current.children.length > 0) {
        const childQValues = current.children
          .filter(c => c.state !== 'pruned')
          .map(c => this.computeQValue(c));

        if (childQValues.length > 0) {
          const maxChildQ = Math.max(...childQValues);
          const parentQ = this.computeQValue(current);
          // MCTSr: Q'(parent) = 0.5 * (Q(parent) + max(Q(children)))
          current.score = 0.5 * (parentQ + maxChildQ);
        }
      }

      current = current.parent;
    }
  }

  /**
   * Rethink mechanism - refine erroneous thoughts
   */
  private async rethink(node: ThoughtNode, _problem: Problem): Promise<void> {
    // Find nodes that failed execution or have low scores
    const nodesToRethink = this.findNodesNeedingRethink(node);

    for (const n of nodesToRethink) {
      if (this.isTokenBudgetExhausted()) break;

      if (n.metadata.feedback) {
        const refinedContent = await this.refineThought(n, n.metadata.feedback);
        this.stats.tokensUsed += TOKENS_PER_GENERATE;

        // Create refined node as sibling
        const refinedNode = this.createNode(
          refinedContent,
          n.type,
          n.parent,
          n.depth
        );
        refinedNode.metadata.reasoning = `Refined from: ${n.id}`;
        refinedNode.state = 'refined';

        if (n.parent) {
          n.parent.children.push(refinedNode);
        }

        // Mark original as pruned
        n.state = 'pruned';
        this.stats.nodesRefined++;

        this.emitProgress('refinement', refinedNode.id);
      }
    }
  }

  /**
   * Find nodes that need rethinking
   */
  private findNodesNeedingRethink(node: ThoughtNode): ThoughtNode[] {
    const result: ThoughtNode[] = [];

    const traverse = (n: ThoughtNode) => {
      if (n.state !== 'pruned' &&
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
      if (node.state !== 'pruned' &&
          (node.type === 'implementation' || node.type === 'conclusion') &&
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
          node.state !== 'pruned' &&
          (node.type === 'implementation' || node.type === 'conclusion') &&
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
    if (content.includes('function') || content.includes('class') ||
        content.includes('const') || content.includes('def ')) {
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
   * Reset stats for a new search
   */
  private resetStats(): void {
    this.stats = {
      iterations: 0,
      nodesCreated: 0,
      nodesEvaluated: 0,
      nodesRefined: 0,
      maxDepthReached: 0,
      totalTime: 0,
      bestScore: 0,
      tokensUsed: 0,
    };
  }

  /**
   * Check if the token budget has been exhausted
   */
  private isTokenBudgetExhausted(): boolean {
    if (!this.config.tokenBudget) return false;
    return this.stats.tokensUsed >= this.config.tokenBudget;
  }

  /**
   * Map a numeric score to the nearest categorical score
   * Categories: "sure" (1.0), "likely" (0.6), "impossible" (0.1)
   */
  private toCategoricalScore(raw: number): number {
    const entries = Object.entries(CATEGORICAL_SCORES);
    let closest = entries[0][1];
    let minDist = Math.abs(raw - closest);

    for (const [, value] of entries) {
      const dist = Math.abs(raw - value);
      if (dist < minDist) {
        minDist = dist;
        closest = value;
      }
    }

    return closest;
  }

  /**
   * Emit a progress event if a callback is configured
   */
  private emitProgress(
    type: MCTSProgressEvent['type'],
    nodeId?: string,
    message?: string
  ): void {
    if (!this.config.onProgress) return;

    this.config.onProgress({
      type,
      iteration: this.stats.iterations,
      nodesCreated: this.stats.nodesCreated,
      nodesEvaluated: this.stats.nodesEvaluated,
      bestScore: this.stats.bestScore,
      tokensUsed: this.stats.tokensUsed,
      nodeId,
      message,
    });
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
  formatTree(node: ThoughtNode = this.root!, indent: string = ''): string {
    if (!node) return 'Empty tree';

    const stateEmoji: Record<ThoughtState, string> = {
      pending: '⏳',
      exploring: '🔍',
      evaluated: '📊',
      refined: '🔄',
      completed: '✅',
      failed: '❌',
      pruned: '✂️',
    };

    const typeEmoji: Record<ThoughtType, string> = {
      analysis: '🔬',
      hypothesis: '💡',
      implementation: '💻',
      verification: '✔️',
      refinement: '🔧',
      conclusion: '🎯',
    };

    let output = `${indent}${stateEmoji[node.state]} ${typeEmoji[node.type]} `;
    output += `[${node.score.toFixed(2)}, v:${node.visits}] `;
    output += `${node.content.slice(0, 50)}${node.content.length > 50 ? '...' : ''}\n`;

    for (const child of node.children) {
      output += this.formatTree(child, indent + '  ');
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
