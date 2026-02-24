/**
 * Tree-of-Thought Reasoning Types
 *
 * Types for advanced reasoning with Tree-of-Thought and MCTS.
 * Based on research from:
 * - Tree of Thoughts (ToT) - Yao et al., 2023
 * - RethinkMCTS (arXiv 2409.09584)
 * - MCTSr (arXiv 2406.07394) - Q-value refinement
 * - Chain of Preference Optimization (NeurIPS 2024)
 */

/**
 * A thought node in the reasoning tree
 */
export interface ThoughtNode {
  id: string;
  content: string;
  type: ThoughtType;
  parent: ThoughtNode | null;
  children: ThoughtNode[];
  score: number;
  visits: number;
  depth: number;
  metadata: ThoughtMetadata;
  state: ThoughtState;
}

/**
 * Type of thought
 */
export type ThoughtType =
  | "analysis"      // Understanding the problem
  | "hypothesis"    // Possible approach
  | "implementation" // Concrete code/action
  | "verification"  // Testing the approach
  | "refinement"    // Improving based on feedback
  | "conclusion";   // Final answer

/**
 * State of a thought node
 */
export type ThoughtState =
  | "pending"       // Not yet evaluated
  | "exploring"     // Currently being explored
  | "evaluated"     // Has been scored
  | "refined"       // Has been improved
  | "completed"     // Successfully verified
  | "failed"        // Verification failed
  | "pruned";       // Removed from consideration

/**
 * Metadata for a thought node
 */
export interface ThoughtMetadata {
  generationRound: number;
  reasoning?: string;
  codeGenerated?: string;
  executionResult?: ExecutionResult;
  feedback?: string;
  alternatives?: string[];
  confidence?: number;
  rewardSamples?: number[];
}

/**
 * Result of code execution
 */
export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

/**
 * Complexity level for adaptive reasoning dispatch
 */
export type ComplexityLevel = 'none' | 'cot' | 'tot' | 'mcts';

/**
 * Complexity score with signals explaining the classification
 */
export interface ComplexityScore {
  level: ComplexityLevel;
  score: number;
  signals: string[];
}

/**
 * Progress event emitted during MCTS search
 */
export interface MCTSProgressEvent {
  type: 'iteration' | 'expansion' | 'evaluation' | 'refinement' | 'solution_found';
  iteration: number;
  nodesCreated: number;
  nodesEvaluated: number;
  bestScore: number;
  tokensUsed: number;
  nodeId?: string;
  message?: string;
}

/**
 * Configuration for MCTS
 */
export interface MCTSConfig {
  maxIterations: number;        // Maximum MCTS iterations
  maxDepth: number;             // Maximum tree depth
  explorationConstant: number;  // UCB1 exploration parameter (c)
  expansionCount: number;       // Number of children to generate
  simulationDepth: number;      // Depth for simulation
  timeLimit?: number;           // Time limit in ms
  useRethink: boolean;          // Enable rethink mechanism
  rethinkThreshold: number;     // Score threshold for rethinking
  tokenBudget?: number;         // Maximum token budget for search
  rewardSamples?: number;       // Number of evaluation samples per node for robust Q (default: 1)
  searchAlgorithm?: 'bfs' | 'mcts'; // Search algorithm to use (default: 'mcts')
  beamWidth?: number;           // Beam width for BFS mode (default: 3)
  progressiveDeepening?: boolean; // Enable progressive deepening (auto-escalation)
  onProgress?: (event: MCTSProgressEvent) => void; // Optional progress callback
}

/**
 * Default MCTS configuration
 */
export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  maxIterations: 50,
  maxDepth: 10,
  explorationConstant: 1.41, // sqrt(2)
  expansionCount: 3,
  simulationDepth: 3,
  useRethink: true,
  rethinkThreshold: 0.3,
  rewardSamples: 1,
  searchAlgorithm: 'mcts',
  beamWidth: 3,
  progressiveDeepening: false,
};

/**
 * Statistics for MCTS run
 */
export interface MCTSStats {
  iterations: number;
  nodesCreated: number;
  nodesEvaluated: number;
  nodesRefined: number;
  maxDepthReached: number;
  totalTime: number;
  bestScore: number;
  tokensUsed: number;
}

/**
 * Result from Tree-of-Thought reasoning
 */
export interface ReasoningResult {
  success: boolean;
  solution: ThoughtNode | null;
  path: ThoughtNode[];
  alternatives: ThoughtNode[];
  stats: MCTSStats;
  tree: ThoughtNode;
}

/**
 * Problem description for reasoning
 */
export interface Problem {
  description: string;
  context?: string;
  constraints?: string[];
  successCriteria?: string[];
  examples?: ProblemExample[];
}

/**
 * Example for a problem
 */
export interface ProblemExample {
  input: string;
  expectedOutput: string;
  explanation?: string;
}

/**
 * Evaluation criteria for thoughts
 */
export interface EvaluationCriteria {
  correctness: number;    // Does it solve the problem?
  completeness: number;   // Does it cover all cases?
  elegance: number;       // Is it well-designed?
  efficiency: number;     // Is it performant?
}

/**
 * Action types for the reasoning agent
 */
export type ReasoningAction =
  | { type: "generate_thought"; prompt: string }
  | { type: "evaluate_thought"; thought: ThoughtNode }
  | { type: "execute_code"; code: string }
  | { type: "refine_thought"; thought: ThoughtNode; feedback: string }
  | { type: "backtrack"; to: ThoughtNode }
  | { type: "conclude"; solution: ThoughtNode };

/**
 * Thinking mode for the agent
 */
export type ThinkingMode =
  | "shallow"     // Quick, single-pass reasoning
  | "medium"      // Moderate exploration
  | "deep"        // Thorough exploration
  | "exhaustive"; // Full tree search

/**
 * Configuration for thinking mode
 */
export const THINKING_MODE_CONFIG: Record<ThinkingMode, Partial<MCTSConfig>> = {
  shallow: {
    maxIterations: 5,
    maxDepth: 3,
    expansionCount: 2,
    tokenBudget: 15000,
  },
  medium: {
    maxIterations: 20,
    maxDepth: 6,
    expansionCount: 3,
    tokenBudget: 50000,
  },
  deep: {
    maxIterations: 50,
    maxDepth: 10,
    expansionCount: 4,
    tokenBudget: 150000,
  },
  exhaustive: {
    maxIterations: 100,
    maxDepth: 15,
    expansionCount: 5,
    tokenBudget: 400000,
  },
};

/**
 * Prompt template for thought generation
 */
export interface ThoughtPromptTemplate {
  system: string;
  userPrefix: string;
  format: string;
}

/**
 * Chain-of-thought step
 */
export interface CoTStep {
  step: number;
  thought: string;
  action?: string;
  observation?: string;
}

/**
 * Chain-of-thought result
 */
export interface CoTResult {
  steps: CoTStep[];
  finalAnswer: string;
  confidence: number;
}
