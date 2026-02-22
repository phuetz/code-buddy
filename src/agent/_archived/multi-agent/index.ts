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

// Session Registry (OpenClaw-inspired inter-session communication)
export type {
  SessionKind,
  SessionStatus,
  SessionInfo,
  SessionMessage,
  SessionRegistryConfig,
} from "./session-registry.js";

export {
  SessionRegistry,
  getSessionRegistry,
  resetSessionRegistry,
  DEFAULT_SESSION_REGISTRY_CONFIG,
} from "./session-registry.js";

// Session Tools
export type { SessionToolResult } from "./session-tools.js";

export {
  SESSIONS_LIST_TOOL,
  SESSIONS_HISTORY_TOOL,
  SESSIONS_SEND_TOOL,
  SESSIONS_SPAWN_TOOL,
  SESSION_TOOLS,
  SessionToolExecutor,
  getSessionToolExecutor,
  resetSessionToolExecutor,
} from "./session-tools.js";
