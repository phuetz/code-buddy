/**
 * Agent Context Module
 *
 * Exports context building utilities for the agent.
 */

export {
  MemoryContextBuilder,
  createMemoryContextBuilder,
  getMemoryContextBuilder,
  resetMemoryContextBuilder,
  DEFAULT_MEMORY_CONTEXT_CONFIG,
} from "./memory-context-builder.js";

export type {
  MemoryContextConfig,
  ContextItem,
  BuiltContext,
  MemoryContextEvents,
} from "./memory-context-builder.js";
