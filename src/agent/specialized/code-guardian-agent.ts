/**
 * CodeBuddynette - Code Guardian Agent
 *
 * Agent spécialisé dans l'analyse de code source, la revue d'architecture,
 * la proposition de correctifs et l'amélioration progressive du projet.
 *
 * Modes de fonctionnement:
 * - ANALYZE_ONLY: Lecture et analyse uniquement
 * - SUGGEST_REFACTOR: Analyse + suggestions de refactoring
 * - PATCH_PLAN: Plan de modifications structurées
 * - PATCH_DIFF: Diffs prêts à appliquer
 *
 * This module re-exports from the modular code-guardian/ directory for
 * backwards compatibility.
 */

// Re-export types from analysis module
export type {
  CodeGuardianMode,
  IssueSeverity,
  IssueType,
  CodeIssue,
  FileDependency,
  FileAnalysis,
  CodeAnalysis,
  RefactorSuggestion,
  PatchStep,
  PatchPlan,
  PatchDiff,
} from '../../services/analysis/types.js';

// Re-export configuration
export { CODE_GUARDIAN_CONFIG, ACTION_HELP, SUPPORTED_ACTIONS } from './code-guardian/config.js';

// Re-export formatters
export {
  formatSize,
  getSeverityIcon,
  groupIssuesBySeverity,
  formatFileAnalysis,
  formatCodeAnalysis,
  formatRefactorSuggestions,
  formatPatchPlan,
  formatPatchDiffs,
  formatIssuesList,
  formatDependencyGraph,
} from './code-guardian/formatters.js';

// Re-export agent and singleton
export {
  CodeGuardianAgent,
  getCodeGuardianAgent,
  resetCodeGuardianAgent,
} from './code-guardian/agent.js';
