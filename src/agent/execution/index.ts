/**
 * Agent Execution Module
 *
 * Contains strategy classes for various agent execution concerns:
 * - Tool selection and caching
 * - Repair coordination and orchestration
 * - (Future) Tool execution orchestration
 * - (Future) Response streaming
 */

// Tool Selection Strategy
export {
  ToolSelectionStrategy,
  getToolSelectionStrategy,
  resetToolSelectionStrategy,
  type ToolSelectionConfig,
  type SelectionResult,
  type ToolCategory,
  type QueryClassification,
  type ToolSelectionResult,
  type ToolSelectionMetrics,
} from './tool-selection-strategy.js';

// Repair Coordinator
export {
  RepairCoordinator,
  createRepairCoordinator,
  getRepairCoordinator,
  resetRepairCoordinator,
  DEFAULT_REPAIR_CONFIG,
  DEFAULT_REPAIR_PATTERNS,
} from './repair-coordinator.js';

// Repair Coordinator Types
export type {
  RepairConfig,
  RepairResult,
  RepairCoordinatorEvents,
  TestExecutor,
  CommandExecutor,
  FileReader,
  FileWriter,
} from './repair-coordinator.js';

// Tool Execution Orchestrator
export {
  ToolExecutionOrchestrator,
  createToolOrchestrator,
  getToolOrchestrator,
  resetToolOrchestrator,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './tool-orchestrator.js';

// Tool Orchestrator Types
export type {
  OrchestratorConfig,
  BatchExecutionResult,
  ExecutionMetrics,
  OrchestratorEvents,
  ToolExecutor,
} from './tool-orchestrator.js';

// Tool Dependency Graph
export {
  ToolDependencyGraph,
  createToolDependencyGraph,
  getToolDependencyGraph,
  resetToolDependencyGraph,
  TOOL_METADATA,
} from './tool-dependency-graph.js';

// Tool Dependency Graph Types
export type {
  ResourceType,
  AccessMode,
  ResourceAccess,
  ToolMetadata,
  GraphNode,
  ExecutionPlan,
} from './tool-dependency-graph.js';
