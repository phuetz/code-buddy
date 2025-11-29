/**
 * Parallel Model Execution Types
 *
 * Defines types for executing multiple models in parallel and
 * aggregating their results for improved accuracy and reliability.
 *
 * Based on research:
 * - Mixture of Experts (MoE)
 * - Self-consistency decoding
 * - Ensemble methods for LLMs
 */

/**
 * Model configuration
 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: "grok" | "openai" | "anthropic" | "local" | "custom";
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  weight?: number; // Weight for aggregation (0-1)
  enabled: boolean;
  capabilities?: ModelCapability[];
  costPerToken?: number;
  latencyMs?: number; // Average latency
}

/**
 * Model capabilities
 */
export type ModelCapability =
  | "code_generation"
  | "code_review"
  | "reasoning"
  | "math"
  | "creative"
  | "factual"
  | "long_context"
  | "tool_use"
  | "vision";

/**
 * Execution strategy
 */
export type ExecutionStrategy =
  | "all"              // Run all models
  | "fastest"          // Return first response
  | "best"             // Run all, return best
  | "consensus"        // Run all, require agreement
  | "cascade"          // Try models in order until success
  | "route"            // Route to best model for task
  | "ensemble"         // Aggregate all responses
  | "debate";          // Models critique each other

/**
 * Aggregation method for combining responses
 */
export type AggregationMethod =
  | "majority_vote"    // Most common answer
  | "weighted_vote"    // Weighted by model quality
  | "best_confidence"  // Highest confidence response
  | "average"          // Average of numeric responses
  | "concatenate"      // Combine all responses
  | "synthesize"       // LLM synthesizes responses
  | "rank"             // Rank and pick top
  | "debate_winner";   // Winner of debate

/**
 * A single model's response
 */
export interface ModelResponse {
  modelId: string;
  modelName: string;
  content: string;
  confidence: number;
  latency: number;
  tokensUsed: number;
  cost?: number;
  metadata: Record<string, unknown>;
  error?: string;
}

/**
 * Result of parallel execution
 */
export interface ParallelExecutionResult {
  strategy: ExecutionStrategy;
  aggregationMethod?: AggregationMethod;
  responses: ModelResponse[];
  aggregatedResponse?: string;
  confidence: number;
  totalLatency: number;
  effectiveLatency: number; // Parallel execution time
  totalTokens: number;
  totalCost?: number;
  selectedModel?: string;
  consensus?: ConsensusResult;
  debate?: DebateResult;
  metadata: Record<string, unknown>;
}

/**
 * Consensus checking result
 */
export interface ConsensusResult {
  reached: boolean;
  agreementLevel: number; // 0-1
  agreeingModels: string[];
  disagreements: Array<{
    modelId: string;
    position: string;
  }>;
  consensusAnswer?: string;
}

/**
 * Debate result between models
 */
export interface DebateResult {
  rounds: DebateRound[];
  winner?: string;
  winningArgument?: string;
  finalPosition: string;
  confidence: number;
}

/**
 * A single round in a debate
 */
export interface DebateRound {
  roundNumber: number;
  positions: Array<{
    modelId: string;
    argument: string;
    critique?: string;
    confidence: number;
  }>;
  summary: string;
}

/**
 * Routing decision
 */
export interface RoutingDecision {
  selectedModel: string;
  reason: string;
  confidence: number;
  alternatives: Array<{
    modelId: string;
    score: number;
    reason: string;
  }>;
}

/**
 * Configuration for parallel execution
 */
export interface ParallelConfig {
  models: ModelConfig[];
  strategy: ExecutionStrategy;
  aggregation: AggregationMethod;
  timeout: number;
  maxRetries: number;
  requireConsensus: boolean;
  consensusThreshold: number; // 0-1
  debateRounds: number;
  fallbackModel?: string;
  cacheResponses: boolean;
  costLimit?: number;
  preferLowLatency: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_PARALLEL_CONFIG: ParallelConfig = {
  models: [],
  strategy: "best",
  aggregation: "best_confidence",
  timeout: 60000,
  maxRetries: 2,
  requireConsensus: false,
  consensusThreshold: 0.7,
  debateRounds: 2,
  cacheResponses: true,
  preferLowLatency: false,
};

/**
 * Task for routing
 */
export interface RoutingTask {
  prompt: string;
  type?: TaskType;
  complexity?: "simple" | "moderate" | "complex";
  requiredCapabilities?: ModelCapability[];
  maxLatency?: number;
  maxCost?: number;
}

/**
 * Task types for routing
 */
export type TaskType =
  | "code_generation"
  | "code_review"
  | "debugging"
  | "explanation"
  | "math"
  | "creative_writing"
  | "factual_qa"
  | "reasoning"
  | "general";

/**
 * Routing rules
 */
export interface RoutingRule {
  id: string;
  name: string;
  condition: RoutingCondition;
  targetModel: string;
  priority: number;
}

/**
 * Routing condition
 */
export interface RoutingCondition {
  taskTypes?: TaskType[];
  complexityLevels?: string[];
  requiredCapabilities?: ModelCapability[];
  maxLatency?: number;
  maxCost?: number;
  customCheck?: (task: RoutingTask) => boolean;
}

/**
 * Events emitted during parallel execution
 */
export interface ParallelEvents {
  "parallel:start": { task: string; strategy: ExecutionStrategy; models: string[] };
  "parallel:model:start": { modelId: string };
  "parallel:model:complete": { response: ModelResponse };
  "parallel:model:error": { modelId: string; error: string };
  "parallel:aggregation": { method: AggregationMethod; responses: ModelResponse[] };
  "parallel:consensus": { result: ConsensusResult };
  "parallel:debate:round": { round: DebateRound };
  "parallel:complete": { result: ParallelExecutionResult };
  "parallel:route": { decision: RoutingDecision };
}

/**
 * Cache entry for responses
 */
export interface CacheEntry {
  prompt: string;
  modelId: string;
  response: ModelResponse;
  timestamp: number;
  hits: number;
}
