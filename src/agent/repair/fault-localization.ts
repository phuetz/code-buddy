/**
 * Fault Localization Module
 *
 * Implements spectrum-based fault localization techniques to identify
 * suspicious code locations that may contain bugs.
 *
 * Based on research:
 * - Tarantula (Jones et al., 2002)
 * - Ochiai (Abreu et al., 2007)
 * - DStar (Wong et al., 2014)
 */

import {
  Fault,
  FaultType,
  FaultSeverity,
  SourceLocation,
  SuspiciousStatement,
  SuspiciousnessMetric,
  FaultLocalizationResult,
  FaultLocalizationConfig,
  TestCoverage,
  FileReader,
} from "./types.js";

/**
 * Default fault localization configuration
 */
const DEFAULT_FL_CONFIG: FaultLocalizationConfig = {
  metric: "ochiai",
  threshold: 0.3,
  maxStatements: 20,
  useStackTrace: true,
  useStaticAnalysis: true,
};

/**
 * Error patterns for static analysis
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  type: FaultType;
  severity: FaultSeverity;
  extractLocation: (match: RegExpMatchArray, content: string) => Partial<SourceLocation> | null;
}> = [
  // TypeScript errors
  {
    pattern: /(.+)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)/,
    type: "type_error",
    severity: "high",
    extractLocation: (match) => ({
      file: match[1],
      startLine: parseInt(match[2], 10),
      startColumn: parseInt(match[3], 10),
      endLine: parseInt(match[2], 10),
    }),
  },
  // ESLint errors
  {
    pattern: /(.+):(\d+):(\d+):\s*(error|warning)\s+(.+)/,
    type: "lint_error",
    severity: "medium",
    extractLocation: (match) => ({
      file: match[1],
      startLine: parseInt(match[2], 10),
      startColumn: parseInt(match[3], 10),
      endLine: parseInt(match[2], 10),
    }),
  },
  // Node.js stack traces
  {
    pattern: /at\s+(?:(.+)\s+)?\(?(.+):(\d+):(\d+)\)?/,
    type: "runtime_error",
    severity: "high",
    extractLocation: (match) => ({
      file: match[2],
      startLine: parseInt(match[3], 10),
      startColumn: parseInt(match[4], 10),
      endLine: parseInt(match[3], 10),
    }),
  },
  // SyntaxError
  {
    pattern: /SyntaxError:\s*(.+)\s+at\s+(.+):(\d+)/i,
    type: "syntax_error",
    severity: "critical",
    extractLocation: (match) => ({
      file: match[2],
      startLine: parseInt(match[3], 10),
      endLine: parseInt(match[3], 10),
    }),
  },
  // TypeError / ReferenceError
  {
    pattern: /(TypeError|ReferenceError):\s*(.+)\s+at\s+(.+):(\d+)/i,
    type: "runtime_error",
    severity: "high",
    extractLocation: (match) => ({
      file: match[3],
      startLine: parseInt(match[4], 10),
      endLine: parseInt(match[4], 10),
    }),
  },
  // Jest test failures
  {
    pattern: /●\s+(.+)\s+›\s+(.+)/,
    type: "test_failure",
    severity: "medium",
    extractLocation: () => null, // Needs further analysis
  },
  // Python errors
  {
    pattern: /File\s+"([^"]+)",\s+line\s+(\d+)/,
    type: "runtime_error",
    severity: "high",
    extractLocation: (match) => ({
      file: match[1],
      startLine: parseInt(match[2], 10),
      endLine: parseInt(match[2], 10),
    }),
  },
];

/**
 * Fault Localization Engine
 */
export class FaultLocalizer {
  private config: FaultLocalizationConfig;
  private fileReader?: FileReader;

  constructor(
    config: Partial<FaultLocalizationConfig> = {},
    fileReader?: FileReader
  ) {
    this.config = { ...DEFAULT_FL_CONFIG, ...config };
    this.fileReader = fileReader;
  }

  /**
   * Localize faults from error output
   */
  async localize(
    errorOutput: string,
    coverage?: TestCoverage
  ): Promise<FaultLocalizationResult> {
    const startTime = Date.now();

    // Step 1: Parse error output to extract faults
    const faults = this.parseErrorOutput(errorOutput);

    // Step 2: Extract stack trace locations
    if (this.config.useStackTrace) {
      const stackLocations = this.extractStackTrace(errorOutput);
      this.enhanceFaultsWithStackTrace(faults, stackLocations);
    }

    // Step 3: Calculate suspiciousness using spectrum-based analysis
    let suspiciousStatements: SuspiciousStatement[] = [];
    if (coverage) {
      suspiciousStatements = this.calculateSuspiciousness(coverage);
    }

    // Step 4: Merge and rank all suspicious locations
    const rankedFaults = this.rankFaults(faults, suspiciousStatements);

    // Step 5: Read code snippets for context
    if (this.fileReader) {
      await this.addCodeSnippets(rankedFaults);
    }

    return {
      faults: rankedFaults.slice(0, this.config.maxStatements),
      suspiciousStatements: suspiciousStatements.slice(0, this.config.maxStatements),
      coverage,
      analysisTime: Date.now() - startTime,
    };
  }

  /**
   * Parse error output to extract faults
   */
  private parseErrorOutput(errorOutput: string): Fault[] {
    const faults: Fault[] = [];
    const lines = errorOutput.split("\n");

    for (const line of lines) {
      for (const errorPattern of ERROR_PATTERNS) {
        const match = line.match(errorPattern.pattern);
        if (match) {
          const location = errorPattern.extractLocation(match, errorOutput);
          if (location && location.file) {
            faults.push({
              id: `fault-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: errorPattern.type,
              severity: errorPattern.severity,
              message: line.trim(),
              location: {
                file: location.file,
                startLine: location.startLine || 1,
                endLine: location.endLine || location.startLine || 1,
                startColumn: location.startColumn,
                endColumn: location.endColumn,
              },
              suspiciousness: 1.0, // Will be adjusted later
              metadata: { rawMatch: match },
            });
          }
          break; // Only match one pattern per line
        }
      }
    }

    // Deduplicate faults by location
    return this.deduplicateFaults(faults);
  }

  /**
   * Extract locations from stack trace
   */
  private extractStackTrace(errorOutput: string): SourceLocation[] {
    const locations: SourceLocation[] = [];
    const stackPattern = /at\s+(?:(.+)\s+)?\(?([^:]+):(\d+):(\d+)\)?/g;

    let match;
    while ((match = stackPattern.exec(errorOutput)) !== null) {
      const file = match[2];
      // Filter out node_modules and internal paths
      if (!file.includes("node_modules") && !file.startsWith("internal/")) {
        locations.push({
          file,
          startLine: parseInt(match[3], 10),
          endLine: parseInt(match[3], 10),
          startColumn: parseInt(match[4], 10),
        });
      }
    }

    return locations;
  }

  /**
   * Enhance faults with stack trace information
   */
  private enhanceFaultsWithStackTrace(
    faults: Fault[],
    stackLocations: SourceLocation[]
  ): void {
    for (const fault of faults) {
      // Find related locations from stack trace
      const relatedLocations = stackLocations.filter(
        (loc) =>
          loc.file !== fault.location.file ||
          loc.startLine !== fault.location.startLine
      );
      if (relatedLocations.length > 0) {
        fault.relatedLocations = relatedLocations.slice(0, 5);
      }
    }

    // If no faults found but we have stack locations, create faults from them
    if (faults.length === 0 && stackLocations.length > 0) {
      // Use the first non-filtered location as the primary fault
      const primaryLocation = stackLocations[0];
      faults.push({
        id: `fault-stack-${Date.now()}`,
        type: "runtime_error",
        severity: "high",
        message: "Error detected from stack trace",
        location: primaryLocation,
        relatedLocations: stackLocations.slice(1, 5),
        suspiciousness: 0.9,
        metadata: {},
      });
    }
  }

  /**
   * Calculate suspiciousness scores using spectrum-based analysis
   */
  private calculateSuspiciousness(coverage: TestCoverage): SuspiciousStatement[] {
    const statements: SuspiciousStatement[] = [];

    // For each file and line in coverage
    for (const [file, coveredLines] of coverage.statementCoverage) {
      const allLines = new Set(coveredLines);

      for (const line of allLines) {
        // Count test outcomes
        const ef = this.countExecutingFailingTests(file, line, coverage);
        const ep = this.countExecutingPassingTests(file, line, coverage);
        const nf = coverage.failingTests - ef;
        const np = coverage.passingTests - ep;

        // Calculate suspiciousness based on selected metric
        const suspiciousness = this.calculateMetric(
          this.config.metric,
          ef,
          ep,
          nf,
          np
        );

        if (suspiciousness >= this.config.threshold) {
          statements.push({
            location: {
              file,
              startLine: line,
              endLine: line,
            },
            suspiciousness,
            metric: this.config.metric,
            executedByFailingTests: ef,
            executedByPassingTests: ep,
            notExecutedByFailingTests: nf,
            notExecutedByPassingTests: np,
          });
        }
      }
    }

    // Sort by suspiciousness descending
    return statements.sort((a, b) => b.suspiciousness - a.suspiciousness);
  }

  /**
   * Calculate suspiciousness using a specific metric
   */
  private calculateMetric(
    metric: SuspiciousnessMetric,
    ef: number,
    ep: number,
    nf: number,
    np: number
  ): number {
    const totalFailed = ef + nf;
    const totalPassed = ep + np;

    switch (metric) {
      case "tarantula":
        // Tarantula: (ef/totalFailed) / ((ef/totalFailed) + (ep/totalPassed))
        if (totalFailed === 0 || totalPassed === 0) return 0;
        const failRatio = ef / totalFailed;
        const passRatio = ep / totalPassed;
        return failRatio / (failRatio + passRatio) || 0;

      case "ochiai":
        // Ochiai: ef / sqrt((ef + nf) * (ef + ep))
        const denominator = Math.sqrt(totalFailed * (ef + ep));
        return denominator === 0 ? 0 : ef / denominator;

      case "jaccard":
        // Jaccard: ef / (ef + nf + ep)
        const jDenom = ef + nf + ep;
        return jDenom === 0 ? 0 : ef / jDenom;

      case "dstar":
        // D*: ef^2 / (ep + nf)
        const dDenom = ep + nf;
        return dDenom === 0 ? 0 : (ef * ef) / dDenom;

      case "barinel":
        // Barinel: 1 - (ep / (ep + ef))
        const bDenom = ep + ef;
        return bDenom === 0 ? 0 : 1 - ep / bDenom;

      case "op2":
        // Op2: ef - ep / (totalPassed + 1)
        return ef - ep / (totalPassed + 1);

      default:
        return 0;
    }
  }

  /**
   * Count tests that execute a statement and fail
   */
  private countExecutingFailingTests(
    file: string,
    line: number,
    coverage: TestCoverage
  ): number {
    // Simplified: In a real implementation, we'd track per-test coverage
    const coveredLines = coverage.statementCoverage.get(file);
    if (!coveredLines || !coveredLines.has(line)) return 0;

    // Estimate based on coverage ratio
    return Math.round(
      coverage.failingTests *
        (coveredLines.size / (coverage.totalTests || 1))
    );
  }

  /**
   * Count tests that execute a statement and pass
   */
  private countExecutingPassingTests(
    file: string,
    line: number,
    coverage: TestCoverage
  ): number {
    const coveredLines = coverage.statementCoverage.get(file);
    if (!coveredLines || !coveredLines.has(line)) return 0;

    return Math.round(
      coverage.passingTests *
        (coveredLines.size / (coverage.totalTests || 1))
    );
  }

  /**
   * Rank faults by combining static analysis and spectrum-based scores
   */
  private rankFaults(
    faults: Fault[],
    suspiciousStatements: SuspiciousStatement[]
  ): Fault[] {
    // Create a map for quick lookup
    const statementMap = new Map<string, number>();
    for (const stmt of suspiciousStatements) {
      const key = `${stmt.location.file}:${stmt.location.startLine}`;
      statementMap.set(key, stmt.suspiciousness);
    }

    // Adjust fault suspiciousness based on spectrum analysis
    for (const fault of faults) {
      const key = `${fault.location.file}:${fault.location.startLine}`;
      const spectrumScore = statementMap.get(key);
      if (spectrumScore !== undefined) {
        // Combine scores (weighted average)
        fault.suspiciousness = 0.6 * fault.suspiciousness + 0.4 * spectrumScore;
      }
    }

    // Add high-suspicion statements not yet in faults
    for (const stmt of suspiciousStatements) {
      const exists = faults.some(
        (f) =>
          f.location.file === stmt.location.file &&
          f.location.startLine === stmt.location.startLine
      );
      if (!exists && stmt.suspiciousness >= 0.5) {
        faults.push({
          id: `fault-spectrum-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: "unknown",
          severity: "medium",
          message: "Suspicious statement from spectrum analysis",
          location: stmt.location,
          suspiciousness: stmt.suspiciousness,
          metadata: { fromSpectrum: true },
        });
      }
    }

    // Sort by suspiciousness descending
    return faults.sort((a, b) => b.suspiciousness - a.suspiciousness);
  }

  /**
   * Add code snippets to faults for context
   */
  private async addCodeSnippets(faults: Fault[]): Promise<void> {
    if (!this.fileReader) return;

    for (const fault of faults) {
      try {
        const content = await this.fileReader(fault.location.file);
        const lines = content.split("\n");

        // Get surrounding context (3 lines before and after)
        const startLine = Math.max(0, fault.location.startLine - 4);
        const endLine = Math.min(lines.length, fault.location.endLine + 3);

        fault.location.snippet = lines.slice(startLine, endLine).join("\n");
      } catch {
        // File not readable, skip snippet
      }
    }
  }

  /**
   * Deduplicate faults by location
   */
  private deduplicateFaults(faults: Fault[]): Fault[] {
    const seen = new Set<string>();
    return faults.filter((fault) => {
      const key = `${fault.location.file}:${fault.location.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Analyze a single error message
   */
  analyzeSingleError(errorMessage: string): Fault | null {
    for (const errorPattern of ERROR_PATTERNS) {
      const match = errorMessage.match(errorPattern.pattern);
      if (match) {
        const location = errorPattern.extractLocation(match, errorMessage);
        if (location && location.file) {
          return {
            id: `fault-${Date.now()}`,
            type: errorPattern.type,
            severity: errorPattern.severity,
            message: errorMessage.trim(),
            location: {
              file: location.file,
              startLine: location.startLine || 1,
              endLine: location.endLine || location.startLine || 1,
            },
            suspiciousness: 1.0,
            metadata: {},
          };
        }
      }
    }
    return null;
  }

  /**
   * Get configuration
   */
  getConfig(): FaultLocalizationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FaultLocalizationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a fault localizer instance
 */
export function createFaultLocalizer(
  config?: Partial<FaultLocalizationConfig>,
  fileReader?: FileReader
): FaultLocalizer {
  return new FaultLocalizer(config, fileReader);
}
