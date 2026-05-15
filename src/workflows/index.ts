/**
 * Workflows Module - Multi-step workflow execution engine
 *
 * Provides:
 * - Workflow definition and registration
 * - Step-by-step execution with state management
 * - Event-driven workflow lifecycle
 * - Conditional branching and error handling
 * - Workflow persistence and resume capability
 */

// Types
export type {
  WorkflowStatus,
  StepStatus,
  WorkflowStep,
  WorkflowDefinition,
  StepResult,
  StepExecution,
  WorkflowContext,
  WorkflowState,
  WorkflowResult,
  WorkflowExecutionOptions,
} from './types.js';

// Step Manager
export {
  NOOP_STEP_COMPLETED_WITHOUT_SIDE_EFFECTS,
  StepManager,
} from './step-manager.js';

// State Manager
export { WorkflowStateManager } from './state-manager.js';

// Workflow Engine
export {
  WorkflowEngine,
  getWorkflowEngine,
  resetWorkflowEngine,
} from './workflow-engine.js';

// Pipeline Compositor (Lobster-inspired)
export type {
  PipelineStep,
  PipelineOperator,
  PipelineToken,
  StepResult as PipelineStepResult,
  PipelineResult,
  ToolExecutor,
  PipelineConfig,
} from './pipeline.js';

export {
  PipelineCompositor,
  getPipelineCompositor,
  resetPipelineCompositor,
} from './pipeline.js';

// Pipeline CLI Utilities — import directly from 'src/commands/pipeline.js'
// (Re-export removed to break circular dependency: workflows/index → commands/pipeline → workflows/index)
