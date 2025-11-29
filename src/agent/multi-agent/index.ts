/**
 * Multi-Agent System Module
 *
 * Exports all components of the multi-agent collaborative system.
 */

// Types
export * from "./types.js";

// Base Agent
export { BaseAgent, createId } from "./base-agent.js";

// Specialized Agents
export {
  OrchestratorAgent,
  createOrchestratorAgent,
} from "./agents/orchestrator-agent.js";

export {
  CoderAgent,
  createCoderAgent,
} from "./agents/coder-agent.js";

export {
  ReviewerAgent,
  createReviewerAgent,
  ReviewResult,
} from "./agents/reviewer-agent.js";

export {
  TesterAgent,
  createTesterAgent,
  TestResult,
  TestFailure,
} from "./agents/tester-agent.js";

// Main System
export {
  MultiAgentSystem,
  createMultiAgentSystem,
  getMultiAgentSystem,
  resetMultiAgentSystem,
} from "./multi-agent-system.js";
