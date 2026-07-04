/**
 * Specialized Agent Types
 *
 * Common types and interfaces for specialized agents.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Base Agent Types
// ============================================================================

export type AgentCapability =
  | 'pdf-extract'
  | 'pdf-analyze'
  | 'excel-read'
  | 'excel-write'
  | 'csv-parse'
  | 'data-transform'
  | 'data-visualize'
  | 'sql-query'
  | 'archive-extract'
  | 'archive-create'
  | 'code-analyze'
  | 'code-review'
  | 'code-refactor'
  | 'code-security'
  | 'code-edit'
  | 'code-debug'
  | 'code-verify';

export interface SpecializedAgentConfig {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Agent description */
  description: string;
  /** Supported capabilities */
  capabilities: AgentCapability[];
  /** File extensions this agent handles */
  fileExtensions: string[];
  /** Maximum file size in bytes (0 = unlimited) */
  maxFileSize?: number;
  /** Required external tools/binaries */
  requiredTools?: string[];
  /**
   * Role/doctrine system prompt for LLM-driven agents (e.g. the Verifier).
   * Deterministic agents (PDF, Excel, …) leave this unset.
   */
  systemPrompt?: string;
  /**
   * Positive allowlist of tool names this agent may execute. When set and
   * non-empty, any tool outside the list is refused by `isToolAllowed()`.
   * Unset/empty ⇒ no allowlist restriction.
   */
  allowedTools?: string[];
  /**
   * Explicit denylist of tool names (e.g. destructive writes for a read-only
   * verifier). A denied tool is refused even if it also appears in the
   * allowlist — deny wins (fail-closed).
   */
  deniedTools?: string[];
  /** Optional configuration */
  options?: Record<string, unknown>;
}

export interface AgentTask {
  /** Task type/action */
  action: string;
  /** Input file path(s) */
  inputFiles?: string[];
  /** Output file path */
  outputFile?: string;
  /** Task-specific parameters */
  params?: Record<string, unknown>;
  /** Raw input data (alternative to files) */
  data?: unknown;
}

export interface AgentResult {
  /** Whether the task succeeded */
  success: boolean;
  /** Result data (structure depends on agent/action) */
  data?: unknown;
  /** Output file path if applicable */
  outputFile?: string;
  /** Human-readable output message */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Execution duration in ms */
  duration?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Base Agent Class
// ============================================================================

export abstract class SpecializedAgent extends EventEmitter {
  protected config: SpecializedAgentConfig;
  protected isInitialized: boolean = false;

  constructor(config: SpecializedAgentConfig) {
    super();
    this.config = config;
  }

  /** Get agent configuration (shallow copy) */
  getConfig(): SpecializedAgentConfig {
    return { ...this.config };
  }

  /** Set option overrides on the agent config */
  setOptions(options: Record<string, unknown>): void {
    if (!this.config.options) this.config.options = {};
    Object.assign(this.config.options, options);
  }

  /** Get agent ID */
  getId(): string {
    return this.config.id;
  }

  /** Get agent name */
  getName(): string {
    return this.config.name;
  }

  /** Check if agent supports a capability */
  hasCapability(capability: AgentCapability): boolean {
    return this.config.capabilities.includes(capability);
  }

  /** Check if agent can handle a file extension */
  canHandleExtension(ext: string): boolean {
    const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext;
    return this.config.fileExtensions.includes(normalizedExt.toLowerCase());
  }

  /** Role/doctrine system prompt, if this agent is LLM-driven */
  getSystemPrompt(): string | undefined {
    return this.config.systemPrompt;
  }

  /** Tools this agent is explicitly allowed to execute (allowlist, may be empty) */
  getAllowedTools(): string[] {
    return this.config.allowedTools ?? [];
  }

  /** Tools this agent is explicitly forbidden from executing */
  getDeniedTools(): string[] {
    return this.config.deniedTools ?? [];
  }

  /**
   * Toolset gate. Deny wins (fail-closed): a denied tool is never permitted.
   * If an allowlist is configured, only listed tools pass; with no allowlist
   * the agent is unrestricted (backwards-compatible for the deterministic
   * agents, which set neither field).
   */
  isToolAllowed(tool: string): boolean {
    if (this.config.deniedTools?.includes(tool)) return false;
    const allow = this.config.allowedTools;
    if (allow && allow.length > 0) return allow.includes(tool);
    return true;
  }

  /** Initialize the agent (check dependencies, etc.) */
  abstract initialize(): Promise<void>;

  /** Check if agent is ready to execute tasks */
  isReady(): boolean {
    return this.isInitialized;
  }

  /** Execute a task */
  abstract execute(task: AgentTask): Promise<AgentResult>;

  /** Get supported actions for this agent */
  abstract getSupportedActions(): string[];

  /** Get help text for an action */
  abstract getActionHelp(action: string): string;

  /** Cleanup resources */
  async cleanup(): Promise<void> {
    this.isInitialized = false;
  }
}

// ============================================================================
// PDF Types
// ============================================================================

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
  pageCount: number;
  fileSize: number;
}

export interface PDFPage {
  pageNumber: number;
  text: string;
  width?: number;
  height?: number;
}

export interface PDFExtractResult {
  metadata: PDFMetadata;
  pages: PDFPage[];
  text: string;
  images?: Array<{
    page: number;
    index: number;
    path?: string;
  }>;
}

// ============================================================================
// Excel Types
// ============================================================================

export interface ExcelSheet {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  data: unknown[][];
  headers?: string[];
}

export interface ExcelWorkbook {
  filename: string;
  sheets: ExcelSheet[];
  sheetNames: string[];
  metadata?: {
    creator?: string;
    lastModifiedBy?: string;
    created?: Date;
    modified?: Date;
  };
}

export interface ExcelWriteOptions {
  sheetName?: string;
  headers?: string[];
  startRow?: number;
  startCol?: number;
  autoWidth?: boolean;
  freezeHeader?: boolean;
}

// ============================================================================
// Data Analysis Types
// ============================================================================

export interface DataColumn {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'null' | 'mixed';
  nullable: boolean;
  uniqueCount?: number;
  sampleValues?: unknown[];
}

/** Statistics for a numeric column */
export interface NumericColumnStats {
  count: number;
  mean: number;
  std: number;
  min: number;
  '25%'?: number;
  '50%'?: number;
  '75%'?: number;
  max: number;
}

/** Statistics for a categorical column */
export interface CategoricalColumnStats {
  count: number;
  unique: number;
  top: unknown;
  type?: 'categorical';
  freq?: number;
  missingCount?: number;
}

/** Column description - either numeric or categorical */
export type ColumnDescriptionStats = NumericColumnStats | CategoricalColumnStats;

/** Data description keyed by column name */
export type DataDescription = Record<string, ColumnDescriptionStats>;

export interface DataStats {
  rowCount: number;
  columnCount: number;
  columns: DataColumn[];
  missingValues: Record<string, number>;
  numericStats?: Record<string, {
    min: number;
    max: number;
    mean: number;
    median?: number;
    stdDev?: number;
  }>;
}

export interface DataTransformOperation {
  type: 'filter' | 'sort' | 'select' | 'rename' | 'aggregate' | 'join' | 'pivot';
  params: Record<string, unknown>;
}

// ============================================================================
// SQL Types
// ============================================================================

export interface SQLQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  duration: number;
}

export interface SQLTableInfo {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
  }>;
  rowCount: number;
}

// ============================================================================
// Archive Types
// ============================================================================

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'tgz' | 'tar.bz2' | '7z' | 'rar';

export interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
  compressedSize?: number;
  isDirectory: boolean;
  modifiedDate?: Date;
  permissions?: string;
}

export interface ArchiveInfo {
  format: ArchiveFormat;
  filename: string;
  totalSize: number;
  compressedSize: number;
  entryCount: number;
  entries: ArchiveEntry[];
}

export interface ArchiveCreateOptions {
  format: ArchiveFormat;
  compressionLevel?: number; // 0-9
  includeHidden?: boolean;
  excludePatterns?: string[];
  password?: string;
}

export interface ArchiveExtractOptions {
  outputDir: string;
  overwrite?: boolean;
  preserveStructure?: boolean;
  filterPatterns?: string[];
  password?: string;
}
