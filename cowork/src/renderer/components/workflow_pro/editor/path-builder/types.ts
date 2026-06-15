// @ts-nocheck
/**
 * Path Builder Types
 * All type definitions for the Visual Path Builder component
 */

import type { UnknownRecord } from '../../type-mocks';

// ============================================================================
// PATH NODE TYPES
// ============================================================================

export type PathNodeType = 'condition' | 'action' | 'merge' | 'split' | 'loop' | 'switch';

export interface PathNode {
  id: string;
  type: PathNodeType;
  name: string;
  description?: string;
  position: Position;
  data: PathNodeData;
  connections: PathConnection[];
  metadata: PathNodeMetadata;
  validation: ValidationState;
  execution?: ExecutionState;
}

export interface Position {
  x: number;
  y: number;
}

export interface PathNodeData {
  conditions?: Condition[];
  actions?: Action[];
  mergeStrategy?: MergeStrategy;
  splitStrategy?: SplitStrategy;
  loopConfig?: LoopConfig;
  switchConfig?: SwitchConfig;
  variables?: Variable[];
  errorHandling?: ErrorHandling;
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

export type ConnectionType = 'success' | 'error' | 'conditional' | 'default';

export interface PathConnection {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  type: ConnectionType;
  condition?: Condition;
  label?: string;
  animated?: boolean;
  style?: ConnectionStyle;
}

export interface ConnectionStyle {
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  fill?: string;
  opacity?: number;
}

// ============================================================================
// CONDITION TYPES
// ============================================================================

export type OperatorType =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'greater_than' | 'less_than'
  | 'greater_or_equal' | 'less_or_equal'
  | 'between' | 'not_between'
  | 'in' | 'not_in'
  | 'is_empty' | 'is_not_empty'
  | 'is_null' | 'is_not_null'
  | 'matches_regex' | 'not_matches_regex'
  | 'is_true' | 'is_false'
  | 'before' | 'after' | 'date_between'
  | 'custom';

export type DataType =
  | 'string' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'time'
  | 'array' | 'object' | 'any';

export interface Condition {
  id: string;
  field: string;
  operator: OperatorType;
  value: unknown;
  dataType: DataType;
  logic?: 'and' | 'or';
  group?: string;
  negate?: boolean;
  caseSensitive?: boolean;
}

// ============================================================================
// ACTION TYPES
// ============================================================================

export type ActionType =
  | 'set_variable' | 'transform_data'
  | 'api_call' | 'database_query'
  | 'send_email' | 'send_notification'
  | 'delay' | 'schedule'
  | 'run_script' | 'execute_workflow'
  | 'custom';

export interface Action {
  id: string;
  type: ActionType;
  name: string;
  config: ActionConfig;
  outputVariable?: string;
  continueOnError?: boolean;
}

export interface ActionConfig {
  [key: string]: unknown;
}

// ============================================================================
// STRATEGY TYPES
// ============================================================================

export type AggregationType =
  | 'concat' | 'merge' | 'sum' | 'average'
  | 'min' | 'max' | 'first' | 'last'
  | 'custom';

export interface MergeStrategy {
  type: 'wait_all' | 'wait_any' | 'wait_n' | 'race' | 'custom';
  waitCount?: number;
  timeout?: number;
  defaultValue?: unknown;
  aggregation?: AggregationType;
}

export interface SplitStrategy {
  type: 'parallel' | 'sequential' | 'conditional' | 'round_robin' | 'load_balance';
  maxConcurrency?: number;
  conditions?: Condition[];
  weights?: number[];
}

export interface LoopConfig {
  type: 'for_each' | 'while' | 'do_while' | 'for' | 'recursive';
  source?: string;
  condition?: Condition;
  maxIterations?: number;
  breakCondition?: Condition;
  continueCondition?: Condition;
  iteratorVariable?: string;
  accumulatorVariable?: string;
}

export interface SwitchConfig {
  expression: string;
  cases: SwitchCase[];
  defaultCase?: PathNode;
}

export interface SwitchCase {
  value: unknown;
  operator?: OperatorType;
  path: PathNode;
  break?: boolean;
}

// ============================================================================
// VARIABLE & ERROR HANDLING TYPES
// ============================================================================

export interface Variable {
  name: string;
  type: DataType;
  value?: unknown;
  source?: 'input' | 'output' | 'constant' | 'expression' | 'previous';
  expression?: string;
  scope?: 'local' | 'global' | 'path';
  mutable?: boolean;
}

export interface ErrorHandling {
  strategy: 'retry' | 'fallback' | 'skip' | 'fail' | 'compensate';
  retryConfig?: RetryConfig;
  fallbackPath?: string;
  compensationPath?: string;
  errorVariable?: string;
  logErrors?: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  delay: number;
  backoffMultiplier?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

// ============================================================================
// METADATA & METRICS TYPES
// ============================================================================

export interface PathNodeMetadata {
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  version?: number;
  tags?: string[];
  documentation?: string;
  testData?: UnknownRecord;
  metrics?: NodeMetrics;
}

export interface NodeMetrics {
  executions: number;
  successRate: number;
  averageTime: number;
  lastExecutionTime?: Date;
  errors: number;
}

// ============================================================================
// VALIDATION & EXECUTION TYPES
// ============================================================================

export interface ValidationState {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

export interface ExecutionState {
  status: 'idle' | 'running' | 'success' | 'error' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  input?: unknown;
  output?: unknown;
  error?: Error;
  path?: string[];
}

// ============================================================================
// BUILDER CONFIGURATION TYPES
// ============================================================================

export interface PathBuilderConfig {
  id: string;
  name: string;
  description?: string;
  nodes: PathNode[];
  connections: PathConnection[];
  variables: Variable[];
  settings: PathBuilderSettings;
  metadata: PathBuilderMetadata;
}

export interface PathBuilderSettings {
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  zoomLevel: number;
  panPosition: Position;
  theme: 'light' | 'dark' | 'auto';
  animateConnections: boolean;
  showMinimap: boolean;
  showDebugInfo: boolean;
  autoSave: boolean;
  autoSaveInterval: number;
  validateOnChange: boolean;
  testMode: boolean;
}

export interface PathBuilderMetadata {
  version: string;
  lastSaved?: Date;
  lastTested?: Date;
  deploymentStatus?: 'draft' | 'testing' | 'staging' | 'production';
  permissions?: PathPermissions;
}

export interface PathPermissions {
  owner: string;
  editors: string[];
  viewers: string[];
  public: boolean;
}

// ============================================================================
// TESTING & SIMULATION TYPES
// ============================================================================

export interface TestScenario {
  id: string;
  name: string;
  description?: string;
  input: UnknownRecord;
  expectedOutput?: unknown;
  expectedPath?: string[];
  assertions?: Assertion[];
  coverage?: PathCoverage;
}

export interface Assertion {
  type: 'equals' | 'contains' | 'matches' | 'exists' | 'custom';
  path: string;
  expected: unknown;
  message?: string;
}

export interface PathCoverage {
  nodes: Set<string>;
  connections: Set<string>;
  conditions: Set<string>;
  percentage: number;
}

export interface SimulationResult {
  scenario: TestScenario;
  success: boolean;
  actualOutput: unknown;
  actualPath: string[];
  executionTime: number;
  nodeResults: Map<string, ExecutionState>;
  assertionResults: AssertionResult[];
  coverage: PathCoverage;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: unknown;
  error?: string;
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export interface PathTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  thumbnail?: string;
  nodes: PathNode[];
  connections: PathConnection[];
  variables: Variable[];
  tags: string[];
  popularity: number;
  author?: string;
  version: string;
}

export interface PathPattern {
  name: string;
  description: string;
  applicability: string[];
  structure: {
    nodes: Partial<PathNode>[];
    connections: Partial<PathConnection>[];
  };
  benefits: string[];
  drawbacks: string[];
  examples: PathTemplate[];
}
