/**
 * Specialized Agents Module
 *
 * Provides domain-specific agents for handling specialized tasks:
 * - PDFAgent: PDF extraction and analysis
 * - ExcelAgent: Excel/CSV manipulation
 * - DataAnalysisAgent: Data analysis and transformation
 * - SQLAgent: SQL queries on data files
 * - ArchiveAgent: Archive management (zip, tar, etc.)
 * - CodeGuardianAgent: Code analysis, review, and improvement (CodeBuddynette)
 */

// Types
export {
  SpecializedAgent,
  type AgentCapability,
  type SpecializedAgentConfig,
  type AgentTask,
  type AgentResult,
} from './types.js';

// PDF Agent
export { PDFAgent, getPDFAgent, createPDFAgent } from './pdf-agent.js';

// Excel Agent
export { ExcelAgent, getExcelAgent, createExcelAgent } from './excel-agent.js';

// Data Analysis Agent
export { DataAnalysisAgent, getDataAnalysisAgent, createDataAnalysisAgent } from './data-analysis-agent.js';

// SQL Agent
export { SQLAgent, getSQLAgent, createSQLAgent } from './sql-agent.js';

// Archive Agent
export { ArchiveAgent, getArchiveAgent, createArchiveAgent } from './archive-agent.js';

// Code Guardian Agent (re-exports from code-guardian/ subdirectory)
export {
  CodeGuardianAgent, getCodeGuardianAgent, resetCodeGuardianAgent,
  CODE_GUARDIAN_CONFIG, ACTION_HELP, SUPPORTED_ACTIONS,
  formatSize, getSeverityIcon, groupIssuesBySeverity,
  formatFileAnalysis, formatCodeAnalysis, formatRefactorSuggestions,
  formatPatchPlan, formatPatchDiffs, formatIssuesList, formatDependencyGraph,
} from './code-guardian-agent.js';
export type {
  CodeGuardianMode, IssueSeverity, IssueType, CodeIssue,
  FileDependency, FileAnalysis, CodeAnalysis,
  RefactorSuggestion, PatchStep, PatchPlan, PatchDiff,
} from './code-guardian-agent.js';

// Verifier Agent (independent fresh-context verifier — evidence over claims)
export {
  VerifierAgent,
  getVerifierAgent,
  resetVerifierAgent,
  VERIFIER_SYSTEM_PROMPT,
  VERIFIER_AGENT_CONFIG,
  VERIFIER_ALLOWED_TOOLS,
  VERIFIER_DENIED_TOOLS,
} from './verifier-agent.js';

// Agent Registry
export {
  AgentRegistry,
  getAgentRegistry,
  initializeAgentRegistry,
  type AgentRegistryConfig,
  type AgentMatch,
} from './agent-registry.js';
