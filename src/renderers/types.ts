/**
 * Renderer Types
 *
 * Common interfaces for the rendering system.
 * Renderers transform structured data into terminal-friendly output.
 */

// ============================================================================
// Render Context
// ============================================================================

/**
 * Display mode for rendering
 */
export type DisplayMode = 'plain' | 'fancy';

/**
 * Context passed to renderers for customization
 */
export interface RenderContext {
  /** Display mode: plain (minimal) or fancy (rich) */
  mode: DisplayMode;
  /** Whether to use colors */
  color: boolean;
  /** Whether to use emojis */
  emoji: boolean;
  /** Terminal width in characters */
  width: number;
  /** Terminal height in characters */
  height: number;
  /** Whether output is being piped (non-interactive) */
  piped: boolean;
}

/**
 * Default render context
 */
export function getDefaultRenderContext(): RenderContext {
  const isTTY = process.stdout.isTTY ?? false;
  return {
    mode: isTTY ? 'fancy' : 'plain',
    color: isTTY && !process.env.NO_COLOR,
    emoji: isTTY && !process.env.NO_EMOJI,
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
    piped: !isTTY,
  };
}

// ============================================================================
// Renderer Interface
// ============================================================================

/**
 * Base interface for all renderers
 *
 * @template T - The type of data this renderer can handle
 */
export interface Renderer<T = unknown> {
  /** Unique identifier for this renderer */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Priority (higher = checked first). Default: 0 */
  readonly priority?: number;

  /**
   * Type guard to check if this renderer can handle the given data
   * @param data - Unknown data to check
   * @returns True if this renderer can render the data
   */
  canRender(data: unknown): data is T;

  /**
   * Render the data to a string for terminal display
   * @param data - The data to render (already validated by canRender)
   * @param ctx - Render context with display options
   * @returns Formatted string for terminal output
   */
  render(data: T, ctx: RenderContext): string;
}

// ============================================================================
// Common Data Types for Renderers
// ============================================================================

/**
 * Diff data for DiffRenderer
 */
export interface DiffData {
  type: 'diff';
  filePath: string;
  oldContent?: string;
  newContent?: string;
  hunks?: DiffHunk[];
  stats?: {
    additions: number;
    deletions: number;
  };
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Test results for TestResultsRenderer
 */
export interface TestResultsData {
  type: 'test-results';
  framework?: string;
  duration?: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  suite?: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration?: number;
  error?: string;
  stack?: string;
}

/**
 * Code structure for CodeStructureRenderer
 */
export interface CodeStructureData {
  type: 'code-structure';
  filePath: string;
  language?: string;
  exports: CodeExport[];
  imports: CodeImport[];
  classes: CodeClass[];
  functions: CodeFunction[];
  variables: CodeVariable[];
}

export interface CodeExport {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'default';
  line?: number;
}

export interface CodeImport {
  source: string;
  names: string[];
  isDefault?: boolean;
  line?: number;
}

export interface CodeClass {
  name: string;
  line?: number;
  methods: string[];
  properties: string[];
  extends?: string;
  implements?: string[];
}

export interface CodeFunction {
  name: string;
  line?: number;
  params: string[];
  returnType?: string;
  async?: boolean;
  exported?: boolean;
}

export interface CodeVariable {
  name: string;
  line?: number;
  kind: 'const' | 'let' | 'var';
  type?: string;
  exported?: boolean;
}

/**
 * Weather data for WeatherRenderer
 */
export interface WeatherData {
  type: 'weather';
  location: string;
  current: {
    temperature: number;
    feelsLike?: number;
    condition: WeatherCondition;
    humidity?: number;
    windSpeed?: number;
    windDirection?: string;
  };
  forecast?: WeatherForecast[];
  units?: 'metric' | 'imperial';
}

export type WeatherCondition =
  | 'sunny' | 'clear'
  | 'partly-cloudy' | 'cloudy' | 'overcast'
  | 'rain' | 'drizzle' | 'showers'
  | 'thunderstorm'
  | 'snow' | 'sleet'
  | 'fog' | 'mist'
  | 'windy'
  | 'unknown';

export interface WeatherForecast {
  date: string;
  high: number;
  low: number;
  condition: WeatherCondition;
  precipitation?: number;
}

/**
 * Table data for TableRenderer
 */
export interface TableData {
  type: 'table';
  headers: string[];
  rows: (string | number | boolean | null)[][];
  title?: string;
  alignment?: ('left' | 'center' | 'right')[];
}

/**
 * Progress data for ProgressRenderer
 */
export interface ProgressData {
  type: 'progress';
  current: number;
  total: number;
  label?: string;
  unit?: string;
  startTime?: number;
}

/**
 * File tree data for TreeRenderer
 */
export interface TreeData {
  type: 'tree';
  root: string;
  nodes: TreeNode[];
  stats?: {
    files: number;
    directories: number;
    totalSize?: number;
  };
}

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: TreeNode[];
}

/**
 * JSON/Object data for JsonRenderer
 */
export interface JsonData {
  type: 'json';
  data: unknown;
  title?: string;
  collapsed?: boolean;
}

/**
 * Union type of all renderable data types
 */
export type RenderableData =
  | DiffData
  | TestResultsData
  | CodeStructureData
  | WeatherData
  | TableData
  | ProgressData
  | TreeData
  | JsonData;

/**
 * Helper to check if data has a specific type field
 */
function hasType(data: unknown, type: string): boolean {
  return typeof data === 'object' && data !== null && 'type' in data && (data as { type: unknown }).type === type;
}

/**
 * Type guard helpers
 */
export function isDiffData(data: unknown): data is DiffData {
  return hasType(data, 'diff');
}

export function isTestResultsData(data: unknown): data is TestResultsData {
  return hasType(data, 'test-results');
}

export function isCodeStructureData(data: unknown): data is CodeStructureData {
  return hasType(data, 'code-structure');
}

export function isWeatherData(data: unknown): data is WeatherData {
  return hasType(data, 'weather');
}

export function isTableData(data: unknown): data is TableData {
  return hasType(data, 'table');
}

export function isProgressData(data: unknown): data is ProgressData {
  return hasType(data, 'progress');
}

export function isTreeData(data: unknown): data is TreeData {
  return hasType(data, 'tree');
}

export function isJsonData(data: unknown): data is JsonData {
  return hasType(data, 'json');
}
