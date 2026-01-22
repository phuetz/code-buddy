/**
 * Agent Infrastructure Module
 *
 * Exports the AgentInfrastructure class and related types for
 * encapsulating agent dependencies.
 */

export {
  AgentInfrastructure,
  createAgentInfrastructure,
  createAgentInfrastructureSync,
  createTestInfrastructure,
} from './agent-infrastructure.js';

export type {
  AgentInfrastructureDeps,
  AgentInfrastructureConfig,
  MemoryContextOptions,
} from './agent-infrastructure.js';
