/**
 * Cyclomatic Complexity Analyzer
 *
 * Automated analysis of code complexity:
 * - Cyclomatic complexity per function
 * - Cognitive complexity
 * - Lines of code metrics
 * - Maintainability index
 */

import fs from 'fs-extra';
import { glob } from 'fast-glob';

export interface FunctionComplexity {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  linesOfCode: number;
  parameters: number;
  rating: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface FileComplexity {
  filePath: string;
  functions: FunctionComplexity[];
  averageComplexity: number;
  maxComplexity: number;
  totalLinesOfCode: number;
  maintainabilityIndex: number;
  rating: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface ComplexityReport {
  files: FileComplexity[];
  summary: {
    totalFiles: number;
    totalFunctions: number;
    averageComplexity: number;
    maxComplexity: number;
    totalLinesOfCode: number;
    complexFunctions: number; // CC > 10
    veryComplexFunctions: number; // CC > 20
    overallRating: 'A' | 'B' | 'C' | 'D' | 'F';
  };
  hotspots: FunctionComplexity[];
  recommendations: string[];
  generatedAt: Date;
}

export interface AnalyzerOptions {
  /** Directory to analyze */
  rootPath?: string;
  /** File patterns to include */
  include?: string[];
  /** Patterns to exclude */
  exclude?: string[];
  /** Complexity threshold for warnings */
  complexityThreshold?: number;
  /** Maximum functions to report in hotspots */
  maxHotspots?: number;
}

const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  rootPath: process.cwd(),
  include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.*', '**/*.spec.*'],
  complexityThreshold: 10,
  maxHotspots: 20,
};

// Decision points that increase cyclomatic complexity
const DECISION_PATTERNS = [
  /\bif\s*\(/g,
  /\belse\s+if\s*\(/g,
  /\bfor\s*\(/g,
  /\bwhile\s*\(/g,
  /\bdo\s*\{/g,
  /\bcase\s+[^:]+:/g,
  /\bcatch\s*\(/g,
  /\?\s*[^:]+\s*:/g, // Ternary
  /&&/g,
  /\|\|/g,
  /\?\?/g, // Nullish coalescing
];

// Patterns that increase cognitive complexity
const COGNITIVE_PATTERNS = [
  { pattern: /\bif\s*\(/g, weight: 1, nesting: true },
  { pattern: /\belse\s+if\s*\(/g, weight: 1, nesting: true },
  { pattern: /\belse\s*\{/g, weight: 1, nesting: false },
  { pattern: /\bfor\s*\(/g, weight: 1, nesting: true },
  { pattern: /\bwhile\s*\(/g, weight: 1, nesting: true },
  { pattern: /\bdo\s*\{/g, weight: 1, nesting: true },
  { pattern: /\bswitch\s*\(/g, weight: 1, nesting: true },
  { pattern: /\bcatch\s*\(/g, weight: 1, nesting: true },
  { pattern: /&&/g, weight: 1, nesting: false },
  { pattern: /\|\|/g, weight: 1, nesting: false },
  { pattern: /\bbreak\s+\w+/g, weight: 1, nesting: false }, // Labeled break
  { pattern: /\bcontinue\s+\w+/g, weight: 1, nesting: false }, // Labeled continue
  { pattern: /\?.*:/g, weight: 1, nesting: true }, // Ternary
];

/**
 * Analyze complexity of a codebase
 */
export async function analyzeComplexity(options: AnalyzerOptions = {}): Promise<ComplexityReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const files = await glob(opts.include, {
    cwd: opts.rootPath,
    ignore: opts.exclude,
    absolute: true,
  });

  // Analyze files in parallel for better performance
  const analysisResults = await Promise.allSettled(
    files.map(filePath => analyzeFile(filePath))
  );

  const fileComplexities: FileComplexity[] = analysisResults
    .filter((result): result is PromiseFulfilledResult<FileComplexity> =>
      result.status === 'fulfilled' && result.value.functions.length > 0
    )
    .map(result => result.value);

  const summary = calculateSummary(fileComplexities, opts.complexityThreshold);
  const hotspots = findHotspots(fileComplexities, opts.maxHotspots);
  const recommendations = generateRecommendations(fileComplexities, opts.complexityThreshold);

  return {
    files: fileComplexities,
    summary,
    hotspots,
    recommendations,
    generatedAt: new Date(),
  };
}

/**
 * Analyze a single file
 */
async function analyzeFile(filePath: string): Promise<FileComplexity> {
  const content = await fs.readFile(filePath, 'utf-8');
  const functions = extractFunctions(content, filePath);

  const avgComplexity = functions.length > 0
    ? functions.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) / functions.length
    : 0;

  const maxComplexity = functions.length > 0
    ? Math.max(...functions.map(f => f.cyclomaticComplexity))
    : 0;

  const totalLoc = content.split('\n').length;
  const maintainabilityIndex = calculateMaintainabilityIndex(avgComplexity, totalLoc, functions.length);

  return {
    filePath,
    functions,
    averageComplexity: avgComplexity,
    maxComplexity,
    totalLinesOfCode: totalLoc,
    maintainabilityIndex,
    rating: getRating(avgComplexity),
  };
}

/**
 * Extract functions from source code
 */
function extractFunctions(content: string, filePath: string): FunctionComplexity[] {
  const functions: FunctionComplexity[] = [];
  const lines = content.split('\n');

  // Regex patterns for function detection
  const functionPatterns = [
    // Regular functions: function name(
    /function\s+(\w+)\s*\(/,
    // Arrow functions assigned: const name = (...) =>
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
    // Arrow functions assigned: const name = async (...) =>
    /(?:const|let|var)\s+(\w+)\s*=\s*async\s+\([^)]*\)\s*=>/,
    // Method definitions: name(
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/,
    // Class methods: name() {
    /^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
  ];

  let currentFunction: { name: string; startLine: number; content: string[] } | null = null;
  let braceCount = 0;
  let inFunction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFunction) {
      // Look for function start
      for (const pattern of functionPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          currentFunction = {
            name: match[1],
            startLine: i + 1,
            content: [line],
          };
          braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          inFunction = braceCount > 0 || line.includes('=>');

          // Handle single-line arrow functions
          if (line.includes('=>') && !line.includes('{')) {
            functions.push(analyzeFunctionContent(
              currentFunction.name,
              filePath,
              currentFunction.startLine,
              i + 1,
              [line]
            ));
            currentFunction = null;
            inFunction = false;
          }
          break;
        }
      }
    } else if (currentFunction) {
      currentFunction.content.push(line);
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount <= 0) {
        functions.push(analyzeFunctionContent(
          currentFunction.name,
          filePath,
          currentFunction.startLine,
          i + 1,
          currentFunction.content
        ));
        currentFunction = null;
        inFunction = false;
      }
    }
  }

  return functions;
}

/**
 * Analyze function content for complexity
 */
function analyzeFunctionContent(
  name: string,
  filePath: string,
  startLine: number,
  endLine: number,
  contentLines: string[]
): FunctionComplexity {
  const content = contentLines.join('\n');

  // Calculate cyclomatic complexity
  let cyclomaticComplexity = 1; // Base complexity
  for (const pattern of DECISION_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      cyclomaticComplexity += matches.length;
    }
  }

  // Calculate cognitive complexity
  let cognitiveComplexity = 0;
  let nestingLevel = 0;

  for (const line of contentLines) {
    // Track nesting
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;

    for (const { pattern, weight, nesting } of COGNITIVE_PATTERNS) {
      const matches = line.match(pattern);
      if (matches) {
        const increment = nesting ? weight + nestingLevel : weight;
        cognitiveComplexity += increment * matches.length;
      }
    }

    nestingLevel += openBraces - closeBraces;
    nestingLevel = Math.max(0, nestingLevel);
  }

  // Count parameters
  const paramMatch = content.match(/\(([^)]*)\)/);
  const parameters = paramMatch && paramMatch[1].trim()
    ? paramMatch[1].split(',').length
    : 0;

  return {
    name,
    filePath,
    startLine,
    endLine,
    cyclomaticComplexity,
    cognitiveComplexity,
    linesOfCode: endLine - startLine + 1,
    parameters,
    rating: getRating(cyclomaticComplexity),
  };
}

/**
 * Calculate maintainability index
 */
function calculateMaintainabilityIndex(
  avgComplexity: number,
  linesOfCode: number,
  functionCount: number
): number {
  // Simplified Maintainability Index formula
  // MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)
  // We use a simplified version
  const halsteadVolume = linesOfCode * Math.log2(functionCount + 1);
  const mi = 171 - 5.2 * Math.log(halsteadVolume + 1) - 0.23 * avgComplexity - 16.2 * Math.log(linesOfCode + 1);
  return Math.max(0, Math.min(100, mi));
}

/**
 * Get rating from complexity
 */
function getRating(complexity: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (complexity <= 5) return 'A';
  if (complexity <= 10) return 'B';
  if (complexity <= 20) return 'C';
  if (complexity <= 30) return 'D';
  return 'F';
}

/**
 * Calculate summary statistics
 */
function calculateSummary(
  files: FileComplexity[],
  threshold: number
): ComplexityReport['summary'] {
  const allFunctions = files.flatMap(f => f.functions);

  const totalComplexity = allFunctions.reduce((sum, f) => sum + f.cyclomaticComplexity, 0);
  const avgComplexity = allFunctions.length > 0 ? totalComplexity / allFunctions.length : 0;
  const maxComplexity = allFunctions.length > 0
    ? Math.max(...allFunctions.map(f => f.cyclomaticComplexity))
    : 0;

  const complexFunctions = allFunctions.filter(f => f.cyclomaticComplexity > threshold).length;
  const veryComplexFunctions = allFunctions.filter(f => f.cyclomaticComplexity > 20).length;

  return {
    totalFiles: files.length,
    totalFunctions: allFunctions.length,
    averageComplexity: avgComplexity,
    maxComplexity,
    totalLinesOfCode: files.reduce((sum, f) => sum + f.totalLinesOfCode, 0),
    complexFunctions,
    veryComplexFunctions,
    overallRating: getRating(avgComplexity),
  };
}

/**
 * Find complexity hotspots
 */
function findHotspots(files: FileComplexity[], maxHotspots: number): FunctionComplexity[] {
  const allFunctions = files.flatMap(f => f.functions);
  return allFunctions
    .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity)
    .slice(0, maxHotspots);
}

/**
 * Generate recommendations
 */
function generateRecommendations(files: FileComplexity[], threshold: number): string[] {
  const recommendations: string[] = [];
  const allFunctions = files.flatMap(f => f.functions);

  // Check for very complex functions
  const veryComplex = allFunctions.filter(f => f.cyclomaticComplexity > 20);
  if (veryComplex.length > 0) {
    recommendations.push(
      `${veryComplex.length} functions have cyclomatic complexity > 20. Consider breaking them into smaller functions.`
    );
  }

  // Check for complex functions
  const complex = allFunctions.filter(f => f.cyclomaticComplexity > threshold && f.cyclomaticComplexity <= 20);
  if (complex.length > 0) {
    recommendations.push(
      `${complex.length} functions exceed complexity threshold of ${threshold}. Review for potential refactoring.`
    );
  }

  // Check for long functions
  const longFunctions = allFunctions.filter(f => f.linesOfCode > 50);
  if (longFunctions.length > 0) {
    recommendations.push(
      `${longFunctions.length} functions are longer than 50 lines. Consider extracting helper functions.`
    );
  }

  // Check for functions with many parameters
  const manyParams = allFunctions.filter(f => f.parameters > 5);
  if (manyParams.length > 0) {
    recommendations.push(
      `${manyParams.length} functions have more than 5 parameters. Consider using parameter objects.`
    );
  }

  // Check for low maintainability
  const lowMaintainability = files.filter(f => f.maintainabilityIndex < 40);
  if (lowMaintainability.length > 0) {
    recommendations.push(
      `${lowMaintainability.length} files have low maintainability index (< 40). These may need significant refactoring.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('Code complexity is within acceptable limits. Keep up the good work!');
  }

  return recommendations;
}

/**
 * Format complexity report for terminal display
 */
export function formatComplexityReport(report: ComplexityReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('                         COMPLEXITY ANALYSIS REPORT');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  lines.push(`  Files Analyzed:       ${report.summary.totalFiles}`);
  lines.push(`  Functions Analyzed:   ${report.summary.totalFunctions}`);
  lines.push(`  Total Lines of Code:  ${report.summary.totalLinesOfCode.toLocaleString()}`);
  lines.push(`  Average Complexity:   ${report.summary.averageComplexity.toFixed(2)}`);
  lines.push(`  Maximum Complexity:   ${report.summary.maxComplexity}`);
  lines.push(`  Overall Rating:       ${report.summary.overallRating}`);
  lines.push('');

  // Complexity distribution
  lines.push('COMPLEXITY DISTRIBUTION');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  const ratings = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const file of report.files) {
    for (const func of file.functions) {
      ratings[func.rating]++;
    }
  }
  const total = report.summary.totalFunctions || 1;
  for (const [rating, count] of Object.entries(ratings)) {
    const percent = ((count / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / total * 40));
    lines.push(`  ${rating}: ${bar} ${count} (${percent}%)`);
  }
  lines.push('');

  // Hotspots
  if (report.hotspots.length > 0) {
    lines.push('COMPLEXITY HOTSPOTS (Top 10)');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    for (const func of report.hotspots.slice(0, 10)) {
      const shortPath = func.filePath.split('/').slice(-2).join('/');
      lines.push(`  ${func.rating} CC=${func.cyclomaticComplexity.toString().padStart(2)} ${func.name.padEnd(30)} ${shortPath}:${func.startLine}`);
    }
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push(`Generated: ${report.generatedAt.toLocaleString()}`);

  return lines.join('\n');
}

/**
 * Export complexity data as JSON
 */
export function exportComplexityJSON(report: ComplexityReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Export complexity data as CSV
 */
export function exportComplexityCSV(report: ComplexityReport): string {
  const headers = ['file', 'function', 'line', 'cyclomatic', 'cognitive', 'loc', 'params', 'rating'];
  const rows = report.files.flatMap(file =>
    file.functions.map(func => [
      file.filePath,
      func.name,
      func.startLine,
      func.cyclomaticComplexity,
      func.cognitiveComplexity,
      func.linesOfCode,
      func.parameters,
      func.rating,
    ].join(','))
  );

  return [headers.join(','), ...rows].join('\n');
}

export default analyzeComplexity;
