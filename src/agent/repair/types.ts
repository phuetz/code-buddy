/**
 * Automated Program Repair (APR) Types
 *
 * Defines types for advanced program repair based on research from:
 * - ITER (arXiv 2403.00418) - Iterative template repair
 * - AgentCoder (Huang et al., 2023) - Test-driven repair
 * - RepairAgent (ICSE 2024) - LLM-guided repair
 */

/**
 * Types of faults that can be detected
 */
export type FaultType =
  | "syntax_error"
  | "type_error"
  | "runtime_error"
  | "logic_error"
  | "null_reference"
  | "boundary_error"
  | "resource_leak"
  | "concurrency_error"
  | "security_vulnerability"
  | "performance_issue"
  | "test_failure"
  | "lint_error"
  | "unknown";

/**
 * Severity levels for faults
 */
export type FaultSeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * A location in source code
 */
export interface SourceLocation {
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: string;
}

/**
 * A detected fault in the code
 */
export interface Fault {
  id: string;
  type: FaultType;
  severity: FaultSeverity;
  message: string;
  location: SourceLocation;
  stackTrace?: string;
  relatedLocations?: SourceLocation[];
  suspiciousness: number; // 0-1, from fault localization
  metadata: Record<string, unknown>;
}

/**
 * Result from fault localization
 */
export interface FaultLocalizationResult {
  faults: Fault[];
  suspiciousStatements: SuspiciousStatement[];
  coverage?: TestCoverage;
  analysisTime: number;
}

/**
 * A suspicious statement from spectrum-based analysis
 */
export interface SuspiciousStatement {
  location: SourceLocation;
  suspiciousness: number;
  metric: SuspiciousnessMetric;
  executedByFailingTests: number;
  executedByPassingTests: number;
  notExecutedByFailingTests: number;
  notExecutedByPassingTests: number;
}

/**
 * Suspiciousness metrics for fault localization
 */
export type SuspiciousnessMetric =
  | "tarantula"
  | "ochiai"
  | "jaccard"
  | "dstar"
  | "barinel"
  | "op2";

/**
 * Test coverage information
 */
export interface TestCoverage {
  totalTests: number;
  passingTests: number;
  failingTests: number;
  statementCoverage: Map<string, Set<number>>; // file -> covered lines
  branchCoverage?: Map<string, Map<number, boolean[]>>; // file -> line -> branches
}

/**
 * A repair patch candidate
 */
export interface RepairPatch {
  id: string;
  fault: Fault;
  changes: PatchChange[];
  strategy: RepairStrategy;
  confidence: number;
  explanation: string;
  generatedBy: "template" | "search" | "llm" | "hybrid";
  validated: boolean;
  testResults?: TestValidationResult;
}

/**
 * A single change in a patch
 */
export interface PatchChange {
  file: string;
  type: "insert" | "delete" | "replace";
  startLine: number;
  endLine: number;
  originalCode: string;
  newCode: string;
}

/**
 * Repair strategy categories
 */
export type RepairStrategy =
  | "add_null_check"
  | "fix_off_by_one"
  | "fix_operator"
  | "fix_type"
  | "add_missing_return"
  | "fix_method_call"
  | "add_exception_handling"
  | "fix_import"
  | "fix_variable_scope"
  | "fix_condition"
  | "refactor_logic"
  | "llm_generated"
  | "template_instantiation"
  | "search_based";

/**
 * Result from test validation
 */
export interface TestValidationResult {
  success: boolean;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failingTests: string[];
  newFailures: string[];
  regressions: string[];
  duration: number;
}

/**
 * A repair template
 */
export interface RepairTemplate {
  id: string;
  name: string;
  description: string;
  applicableTo: FaultType[];
  pattern: string; // Regex pattern to match
  fix: string; // Fix template with $1, $2, etc. placeholders
  conditions?: TemplateCondition[];
  priority: number;
  successRate?: number;
}

/**
 * Condition for template application
 */
export interface TemplateCondition {
  type: "context" | "syntax" | "semantic" | "type";
  check: string;
  value: string | RegExp;
}

/**
 * Configuration for the repair engine
 */
export interface RepairConfig {
  maxCandidates: number;
  maxIterations: number;
  timeout: number;
  strategies: RepairStrategy[];
  useLLM: boolean;
  useTemplates: boolean;
  useSearchBased: boolean;
  validateWithTests: boolean;
  parallelValidation: boolean;
  learningEnabled: boolean;
  faultLocalization: FaultLocalizationConfig;
}

/**
 * Configuration for fault localization
 */
export interface FaultLocalizationConfig {
  metric: SuspiciousnessMetric;
  threshold: number;
  maxStatements: number;
  useStackTrace: boolean;
  useStaticAnalysis: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  maxCandidates: 10,
  maxIterations: 5,
  timeout: 120000, // 2 minutes
  strategies: [
    "add_null_check",
    "fix_off_by_one",
    "fix_operator",
    "fix_type",
    "add_missing_return",
    "fix_method_call",
    "llm_generated",
  ],
  useLLM: true,
  useTemplates: true,
  useSearchBased: false,
  validateWithTests: true,
  parallelValidation: false,
  learningEnabled: true,
  faultLocalization: {
    metric: "ochiai",
    threshold: 0.3,
    maxStatements: 20,
    useStackTrace: true,
    useStaticAnalysis: true,
  },
};

/**
 * Result from the repair process
 */
export interface RepairResult {
  success: boolean;
  fault: Fault;
  appliedPatch?: RepairPatch;
  candidatesGenerated: number;
  candidatesTested: number;
  allPatches: RepairPatch[];
  iterations: number;
  duration: number;
  reason?: string;
}

/**
 * Repair session tracking
 */
export interface RepairSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  faults: Fault[];
  results: RepairResult[];
  config: RepairConfig;
  stats: RepairStats;
}

/**
 * Statistics from repair sessions
 */
export interface RepairStats {
  totalFaults: number;
  repairedFaults: number;
  failedFaults: number;
  averageIterations: number;
  averageCandidates: number;
  averageDuration: number;
  strategySuccessRates: Map<RepairStrategy, number>;
  templateSuccessRates: Map<string, number>;
}

/**
 * Learning data for repair improvement
 */
export interface RepairLearningData {
  fault: Fault;
  successfulPatch: RepairPatch;
  failedPatches: RepairPatch[];
  codeContext: string;
  fileType: string;
  projectType?: string;
}

/**
 * Event types for repair process
 */
export interface RepairEvents {
  "repair:start": { fault: Fault; config: RepairConfig };
  "repair:localization": { result: FaultLocalizationResult };
  "repair:candidate": { patch: RepairPatch };
  "repair:validation": { patch: RepairPatch; result: TestValidationResult };
  "repair:success": { result: RepairResult };
  "repair:failure": { result: RepairResult };
  "repair:progress": { message: string; progress: number };
}

/**
 * Function type for executing tests
 */
export type TestExecutor = (
  testCommand?: string
) => Promise<TestValidationResult>;

/**
 * Function type for executing commands
 */
export type CommandExecutor = (command: string) => Promise<{
  success: boolean;
  output: string;
  error?: string;
}>;

/**
 * Function type for reading files
 */
export type FileReader = (path: string) => Promise<string>;

/**
 * Function type for writing files
 */
export type FileWriter = (path: string, content: string) => Promise<void>;
