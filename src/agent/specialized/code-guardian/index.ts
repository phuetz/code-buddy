/**
 * Code Guardian Module
 *
 * Exports all Code Guardian components from the modular structure.
 */

// Re-export configuration
export { CODE_GUARDIAN_CONFIG, ACTION_HELP, SUPPORTED_ACTIONS } from './config.js';

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
} from './formatters.js';

// Re-export agent and singleton
export {
  CodeGuardianAgent,
  getCodeGuardianAgent,
  resetCodeGuardianAgent,
} from './agent.js';
