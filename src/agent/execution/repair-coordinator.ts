/**
 * Repair Coordinator Module
 *
 * Coordinates auto-repair orchestration for bash execution errors.
 * Detects error patterns that can be repaired and manages repair attempts.
 *
 * Integrates with the RepairEngine from src/agent/repair to provide
 * intelligent automated program repair capabilities.
 */

import { EventEmitter } from "events";
import { getErrorMessage } from "../../types/index.js";
import {
  RepairEngine,
  RepairResult as EngineRepairResult,
  RepairConfig as EngineRepairConfig,
  createRepairEngine,
  TestExecutor,
  CommandExecutor,
  FileReader,
  FileWriter,
} from "../repair/index.js";

/**
 * Configuration for the RepairCoordinator
 */
export interface RepairConfig {
  /** Whether auto-repair is enabled */
  enabled: boolean;
  /** Maximum number of repair attempts per error */
  maxAttempts: number;
  /** Timeout for each repair attempt in milliseconds */
  timeout: number;
  /** Patterns that trigger auto-repair */
  patterns: RegExp[];
  /** Engine configuration passed to RepairEngine */
  engineConfig?: Partial<EngineRepairConfig>;
}

/**
 * Default repair patterns that can be auto-repaired
 */
export const DEFAULT_REPAIR_PATTERNS: RegExp[] = [
  /error TS\d+:/i,           // TypeScript errors
  /SyntaxError:/i,           // Syntax errors
  /ReferenceError:/i,        // Reference errors
  /TypeError:/i,             // Type errors
  /eslint.*error/i,          // ESLint errors
  /FAIL.*test/i,             // Test failures
  /npm ERR!/i,               // npm errors
  /Build failed/i,           // Build failures
];

/**
 * Default configuration for RepairCoordinator
 */
export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  enabled: true,
  maxAttempts: 3,
  timeout: 120000, // 2 minutes
  patterns: DEFAULT_REPAIR_PATTERNS,
};

/**
 * Result from a repair attempt
 */
export interface RepairResult {
  /** Whether a repair was attempted */
  attempted: boolean;
  /** Whether the repair was successful */
  success: boolean;
  /** List of fixes that were applied */
  fixes: string[];
  /** Human-readable message about the repair */
  message: string;
  /** Number of attempts made */
  attempts?: number;
  /** Duration of the repair process in milliseconds */
  duration?: number;
  /** Detailed results from the repair engine */
  engineResults?: EngineRepairResult[];
}

/**
 * Events emitted by RepairCoordinator
 */
export interface RepairCoordinatorEvents {
  "repair:start": { errorOutput: string; command?: string };
  "repair:success": { fixes: string[]; attempts: number };
  "repair:failed": { reason: string; attempts: number };
  "repair:error": { error: string };
  "repair:enabled": { enabled: boolean };
  "repair:patterns:updated": { patterns: RegExp[] };
}

/**
 * RepairCoordinator - Orchestrates auto-repair for bash execution errors
 *
 * This class serves as the coordination layer between bash execution
 * and the underlying RepairEngine, providing:
 * - Error pattern detection
 * - Repair attempt management
 * - Configuration management
 * - Event-based progress tracking
 */
export class RepairCoordinator extends EventEmitter {
  private config: RepairConfig;
  private repairEngine: RepairEngine | null = null;
  private attemptCounts: Map<string, number> = new Map();

  constructor(
    config: Partial<RepairConfig> = {},
    private apiKey?: string,
    private baseURL?: string
  ) {
    super();
    this.config = { ...DEFAULT_REPAIR_CONFIG, ...config };
  }

  /**
   * Initialize the repair engine lazily
   */
  private getRepairEngine(): RepairEngine {
    if (!this.repairEngine) {
      this.repairEngine = createRepairEngine(
        this.config.engineConfig,
        this.apiKey,
        this.baseURL
      );
    }
    return this.repairEngine;
  }

  /**
   * Enable or disable auto-repair
   */
  setRepairEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.emit("repair:enabled", { enabled });
  }

  /**
   * Check if auto-repair is enabled
   */
  isRepairEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if an error output is repairable based on configured patterns
   */
  isRepairableError(output: string): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return this.config.patterns.some(pattern => pattern.test(output));
  }

  /**
   * Get the error type that matched, if any
   */
  getMatchedErrorType(output: string): string | null {
    if (!this.config.enabled) {
      return null;
    }

    for (const pattern of this.config.patterns) {
      if (pattern.test(output)) {
        // Extract a meaningful error type name from the pattern
        const match = output.match(pattern);
        if (match) {
          return match[0];
        }
      }
    }
    return null;
  }

  /**
   * Attempt to repair an error
   *
   * @param errorOutput - The error output from bash execution
   * @param command - Optional command that produced the error
   * @returns RepairResult with details about the repair attempt
   */
  async attemptRepair(
    errorOutput: string,
    command?: string
  ): Promise<RepairResult> {
    const startTime = Date.now();

    // Check if repair is enabled and error is repairable
    if (!this.isRepairableError(errorOutput)) {
      return {
        attempted: false,
        success: false,
        fixes: [],
        message: "Error not recognized as repairable",
      };
    }

    // Create a unique key for tracking attempts
    const errorKey = this.createErrorKey(errorOutput);
    const currentAttempts = this.attemptCounts.get(errorKey) || 0;

    // Check if we've exceeded max attempts for this error
    if (currentAttempts >= this.config.maxAttempts) {
      return {
        attempted: false,
        success: false,
        fixes: [],
        message: `Maximum repair attempts (${this.config.maxAttempts}) exceeded for this error`,
        attempts: currentAttempts,
      };
    }

    // Increment attempt count
    this.attemptCounts.set(errorKey, currentAttempts + 1);

    this.emit("repair:start", { errorOutput, command });

    try {
      const engine = this.getRepairEngine();

      // Run repair with timeout
      const repairPromise = engine.repair(errorOutput, command);
      const timeoutPromise = new Promise<EngineRepairResult[]>((_, reject) => {
        setTimeout(
          () => reject(new Error("Repair timeout exceeded")),
          this.config.timeout
        );
      });

      const results = await Promise.race([repairPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      const successfulFixes = results.filter(r => r.success);
      const fixDescriptions = successfulFixes.map(r =>
        r.appliedPatch?.explanation || "Fix applied"
      );

      if (successfulFixes.length > 0) {
        // Clear attempt count on success
        this.attemptCounts.delete(errorKey);

        this.emit("repair:success", {
          fixes: fixDescriptions,
          attempts: currentAttempts + 1,
        });

        return {
          attempted: true,
          success: true,
          fixes: fixDescriptions,
          message: `Successfully applied ${successfulFixes.length} fix(es)`,
          attempts: currentAttempts + 1,
          duration,
          engineResults: results,
        };
      }

      this.emit("repair:failed", {
        reason: "No successful fixes found",
        attempts: currentAttempts + 1,
      });

      return {
        attempted: true,
        success: false,
        fixes: [],
        message: "Auto-repair attempted but no fixes were successful",
        attempts: currentAttempts + 1,
        duration,
        engineResults: results,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const duration = Date.now() - startTime;

      this.emit("repair:error", { error: errorMessage });

      return {
        attempted: true,
        success: false,
        fixes: [],
        message: `Auto-repair error: ${errorMessage}`,
        attempts: currentAttempts + 1,
        duration,
      };
    }
  }

  /**
   * Configure repair patterns
   *
   * @param patterns - New patterns to use for error detection
   * @param mode - 'replace' replaces all patterns, 'append' adds to existing
   */
  configurePatterns(
    patterns: RegExp[],
    mode: "replace" | "append" = "replace"
  ): void {
    if (mode === "replace") {
      this.config.patterns = patterns;
    } else {
      this.config.patterns = [...this.config.patterns, ...patterns];
    }
    this.emit("repair:patterns:updated", { patterns: this.config.patterns });
  }

  /**
   * Add a single pattern to the repair patterns
   */
  addPattern(pattern: RegExp): void {
    this.config.patterns.push(pattern);
    this.emit("repair:patterns:updated", { patterns: this.config.patterns });
  }

  /**
   * Remove a pattern from the repair patterns
   */
  removePattern(pattern: RegExp): boolean {
    const initialLength = this.config.patterns.length;
    this.config.patterns = this.config.patterns.filter(
      p => p.source !== pattern.source || p.flags !== pattern.flags
    );
    const removed = this.config.patterns.length < initialLength;
    if (removed) {
      this.emit("repair:patterns:updated", { patterns: this.config.patterns });
    }
    return removed;
  }

  /**
   * Get current repair patterns
   */
  getPatterns(): RegExp[] {
    return [...this.config.patterns];
  }

  /**
   * Set external executors for the repair engine
   */
  setExecutors(executors: {
    testExecutor?: TestExecutor;
    commandExecutor?: CommandExecutor;
    fileReader?: FileReader;
    fileWriter?: FileWriter;
  }): void {
    this.getRepairEngine().setExecutors(executors);
  }

  /**
   * Get current configuration
   */
  getConfig(): RepairConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RepairConfig>): void {
    this.config = { ...this.config, ...config };

    // Update engine config if provided
    if (config.engineConfig && this.repairEngine) {
      this.repairEngine.updateConfig(config.engineConfig);
    }
  }

  /**
   * Reset attempt counts for all errors
   */
  resetAttemptCounts(): void {
    this.attemptCounts.clear();
  }

  /**
   * Reset attempt count for a specific error
   */
  resetAttemptCount(errorOutput: string): void {
    const errorKey = this.createErrorKey(errorOutput);
    this.attemptCounts.delete(errorKey);
  }

  /**
   * Get repair statistics from the engine
   */
  getStatistics() {
    if (!this.repairEngine) {
      return null;
    }
    return this.repairEngine.getStatistics();
  }

  /**
   * Get repair history from the engine
   */
  getHistory() {
    if (!this.repairEngine) {
      return [];
    }
    return this.repairEngine.getHistory();
  }

  /**
   * Clear repair history
   */
  clearHistory(): void {
    if (this.repairEngine) {
      this.repairEngine.clearHistory();
    }
    this.attemptCounts.clear();
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    if (this.repairEngine) {
      this.repairEngine.dispose();
      this.repairEngine = null;
    }
    this.attemptCounts.clear();
    this.removeAllListeners();
  }

  /**
   * Create a unique key for an error to track attempts
   */
  private createErrorKey(errorOutput: string): string {
    // Create a hash-like key from the first 200 characters of the error
    // This helps identify similar errors without exact matching
    const normalized = errorOutput
      .slice(0, 200)
      .replace(/\d+/g, "N") // Normalize numbers
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();
    return normalized;
  }
}

/**
 * Create a RepairCoordinator instance
 */
export function createRepairCoordinator(
  config?: Partial<RepairConfig>,
  apiKey?: string,
  baseURL?: string
): RepairCoordinator {
  return new RepairCoordinator(config, apiKey, baseURL);
}

// Singleton instance for global access
let coordinatorInstance: RepairCoordinator | null = null;

/**
 * Get the global RepairCoordinator instance
 */
export function getRepairCoordinator(
  apiKey?: string,
  baseURL?: string
): RepairCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = createRepairCoordinator({}, apiKey, baseURL);
  }
  return coordinatorInstance;
}

/**
 * Reset the global RepairCoordinator instance
 */
export function resetRepairCoordinator(): void {
  if (coordinatorInstance) {
    coordinatorInstance.dispose();
  }
  coordinatorInstance = null;
}

// Re-export types from repair module for convenience
export type {
  TestExecutor,
  CommandExecutor,
  FileReader,
  FileWriter,
} from "../repair/index.js";
