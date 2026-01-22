/**
 * Agent Interfaces Module
 *
 * Exports all agent-related interfaces for dependency injection
 * and type-safe implementations.
 */

export type {
  // Chat types
  ChatEntryType,
  IChatEntry,
  StreamingChunkType,
  IStreamingChunk,
  // Tool types
  IToolCall,
  IParsedToolCall,
  // Core agent
  IAgent,
  // Extended agent
  AgentModeType,
  IExtendedAgent,
  // Specialized agent
  AgentCapabilityType,
  IAgentTask,
  IAgentResult,
  ISpecializedAgentConfig,
  ISpecializedAgent,
  // Factory
  IAgentOptions,
  IAgentFactory,
} from './agent.interface.js';
