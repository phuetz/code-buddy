/**
 * Agent Facades
 *
 * This module exports all facade classes that encapsulate specific responsibilities
 * extracted from the BaseAgent class. These facades follow the Facade pattern to
 * provide simplified interfaces to complex subsystems.
 *
 * Architecture:
 * - AgentContextFacade: Context window and memory management
 * - SessionFacade: Session persistence and checkpoint management
 * - ModelRoutingFacade: Model routing and cost tracking
 * - InfrastructureFacade: MCP, sandbox, hooks, and plugins
 * - MessageHistoryManager: Chat and LLM message history management
 */

// Context and Memory Management
export {
  AgentContextFacade,
  type AgentContextFacadeDeps,
  type ContextConfig,
  type ContextStats,
  type MemoryStats,
} from './agent-context-facade.js';

// Session and Checkpoint Management
export {
  SessionFacade,
  type SessionFacadeDeps,
  type RewindResult,
} from './session-facade.js';

// Model Routing and Cost Management
export {
  ModelRoutingFacade,
  type ModelRoutingFacadeDeps,
  type ModelRoutingStats,
} from './model-routing-facade.js';

// Infrastructure Services
export {
  InfrastructureFacade,
  type InfrastructureFacadeDeps,
  type CommandValidation,
  type PromptCacheStats,
} from './infrastructure-facade.js';

// Message History Management
export {
  MessageHistoryManager,
  type HistoryConfig,
  type HistoryStats,
} from './message-history-manager.js';
