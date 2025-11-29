/**
 * Extended Thinking Mode Types
 *
 * Defines types for the extended thinking system that enables
 * deep, structured reasoning before generating responses.
 *
 * Inspired by:
 * - Claude's Extended Thinking
 * - Chain-of-Thought prompting
 * - Self-consistency decoding
 */

/**
 * Thinking depth levels
 */
export type ThinkingDepth = "minimal" | "standard" | "extended" | "deep";

/**
 * A single thought in the thinking process
 */
export interface Thought {
  id: string;
  type: ThoughtType;
  content: string;
  confidence: number;
  reasoning?: string;
  evidence?: string[];
  alternatives?: string[];
  timestamp: number;
}

/**
 * Types of thoughts
 */
export type ThoughtType =
  | "observation"     // Initial observation about the problem
  | "analysis"        // Deeper analysis
  | "hypothesis"      // Potential explanation or solution
  | "verification"    // Checking a hypothesis
  | "contradiction"   // Found issue with current reasoning
  | "synthesis"       // Combining multiple thoughts
  | "conclusion"      // Final conclusion
  | "uncertainty"     // Noting uncertainty
  | "question"        // Question to explore
  | "action_plan";    // Planned action

/**
 * A reasoning chain - sequence of connected thoughts
 */
export interface ReasoningChain {
  id: string;
  thoughts: Thought[];
  status: "in_progress" | "completed" | "abandoned";
  conclusion?: string;
  confidence: number;
  branches?: ReasoningChain[]; // Alternative paths explored
}

/**
 * Thinking session containing multiple chains
 */
export interface ThinkingSession {
  id: string;
  problem: string;
  context?: string;
  depth: ThinkingDepth;
  chains: ReasoningChain[];
  activeChainId: string | null;
  startTime: number;
  endTime?: number;
  finalAnswer?: ThinkingResult;
  metadata: Record<string, unknown>;
}

/**
 * Result of extended thinking
 */
export interface ThinkingResult {
  answer: string;
  reasoning: string;
  confidence: number;
  thinkingTime: number;
  thoughtCount: number;
  chainsExplored: number;
  keyInsights: string[];
  uncertainties: string[];
  alternativeAnswers?: AlternativeAnswer[];
}

/**
 * An alternative answer considered
 */
export interface AlternativeAnswer {
  answer: string;
  confidence: number;
  reasoning: string;
  whyNotChosen: string;
}

/**
 * Configuration for extended thinking
 */
export interface ThinkingConfig {
  depth: ThinkingDepth;
  maxThoughts: number;
  maxChains: number;
  maxTime: number; // in milliseconds
  temperature: number;
  selfConsistency: boolean;
  explorationRate: number; // 0-1, probability to explore alternatives
  verificationEnabled: boolean;
  streamThinking: boolean;
  model?: string;
}

/**
 * Default configurations per depth
 */
export const THINKING_DEPTH_CONFIG: Record<ThinkingDepth, Partial<ThinkingConfig>> = {
  minimal: {
    maxThoughts: 3,
    maxChains: 1,
    maxTime: 5000,
    temperature: 0.3,
    selfConsistency: false,
    explorationRate: 0,
    verificationEnabled: false,
  },
  standard: {
    maxThoughts: 10,
    maxChains: 2,
    maxTime: 15000,
    temperature: 0.5,
    selfConsistency: true,
    explorationRate: 0.2,
    verificationEnabled: true,
  },
  extended: {
    maxThoughts: 25,
    maxChains: 4,
    maxTime: 45000,
    temperature: 0.6,
    selfConsistency: true,
    explorationRate: 0.4,
    verificationEnabled: true,
  },
  deep: {
    maxThoughts: 50,
    maxChains: 8,
    maxTime: 120000,
    temperature: 0.7,
    selfConsistency: true,
    explorationRate: 0.6,
    verificationEnabled: true,
  },
};

/**
 * Default configuration
 */
export const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
  depth: "standard",
  maxThoughts: 10,
  maxChains: 2,
  maxTime: 15000,
  temperature: 0.5,
  selfConsistency: true,
  explorationRate: 0.2,
  verificationEnabled: true,
  streamThinking: true,
};

/**
 * Thinking prompts for different thought types
 */
export const THINKING_PROMPTS: Record<ThoughtType, string> = {
  observation: "What are the key facts and observations about this problem?",
  analysis: "Let me analyze this more deeply...",
  hypothesis: "Based on my analysis, I hypothesize that...",
  verification: "Let me verify this by considering...",
  contradiction: "Wait, there's an issue with this reasoning...",
  synthesis: "Combining these insights, I can see that...",
  conclusion: "Therefore, my conclusion is...",
  uncertainty: "I'm uncertain about...",
  question: "An important question to consider is...",
  action_plan: "The plan of action should be...",
};

/**
 * Events emitted during thinking
 */
export interface ThinkingEvents {
  "thinking:start": { session: ThinkingSession };
  "thinking:thought": { thought: Thought; chain: ReasoningChain };
  "thinking:chain:start": { chain: ReasoningChain };
  "thinking:chain:complete": { chain: ReasoningChain };
  "thinking:branch": { parent: ReasoningChain; branch: ReasoningChain };
  "thinking:verification": { thought: Thought; verified: boolean };
  "thinking:complete": { result: ThinkingResult };
  "thinking:stream": { content: string };
}

/**
 * Verification result
 */
export interface VerificationResult {
  thought: Thought;
  verified: boolean;
  confidence: number;
  issues?: string[];
  corrections?: string[];
}

/**
 * Self-consistency result
 */
export interface SelfConsistencyResult {
  answers: Array<{ answer: string; confidence: number; reasoning: string }>;
  consensusAnswer: string;
  consensusConfidence: number;
  disagreements: string[];
}
