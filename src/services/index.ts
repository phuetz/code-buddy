/**
 * Services Module
 *
 * Exports all service modules including:
 * - Plan Generator for structured task planning
 * - Codebase Explorer for project analysis
 *
 * Based on hurry-mode's service architecture.
 */

// Plan Generator
export {
  PlanGenerator,
  createPlanGenerator,
  getPlanGenerator,
  resetPlanGenerator,
  type PlanPhase,
  type PriorityLevel,
  type RiskLevel,
  type PlanStep,
  type PlanAction,
  type ActionType,
  type ExecutionPlan,
  type PlanMetadata,
  type PlanAnalysis,
  type PlanGeneratorOptions,
} from "./plan-generator.js";

// Codebase Explorer
export {
  CodebaseExplorer,
  createCodebaseExplorer,
  exploreCodebase,
  LANGUAGE_EXTENSIONS,
  type FileCategory,
  type FileInfo,
  type DirectoryInfo,
  type ProjectType,
  type ProjectInfo,
  type CodebaseStats,
  type ExplorationOptions,
} from "./codebase-explorer.js";
