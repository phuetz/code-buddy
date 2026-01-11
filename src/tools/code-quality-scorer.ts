/**
 * Code Quality Scorer
 *
 * Analyzes code quality and provides scores:
 * - Complexity metrics
 * - Code smells detection
 * - Best practices compliance
 * - Maintainability index
 */

import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import * as path from 'path';

export interface QualityMetrics {
  /** Cyclomatic complexity score */
  complexity: number;
  /** Lines of code */
  linesOfCode: number;
  /** Source lines of code (excluding comments/blanks) */
  sourceLinesOfCode: number;
  /** Comment ratio (0-100) */
  commentRatio: number;
  /** Average function length */
  avgFunctionLength: number;
  /** Max function length */
  maxFunctionLength: number;
  /** Number of functions */
  functionCount: number;
  /** Nesting depth max */
  maxNestingDepth: number;
  /** Magic numbers count */
  magicNumbers: number;
  /** Long lines count (>120 chars) */
  longLines: number;
  /** TODO/FIXME count */
  todoCount: number;
  /** Duplicate code estimate */
  duplicateRatio: number;
}

export interface CodeSmell {
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  line?: number;
  suggestion?: string;
}

export interface QualityScore {
  /** Overall score (0-100) */
  overall: number;
  /** Complexity score (0-100) */
  complexity: number;
  /** Maintainability score (0-100) */
  maintainability: number;
  /** Readability score (0-100) */
  readability: number;
  /** Best practices score (0-100) */
  bestPractices: number;
  /** Letter grade */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface QualityReport {
  filePath: string;
  language: string;
  metrics: QualityMetrics;
  score: QualityScore;
  smells: CodeSmell[];
  suggestions: string[];
}

/**
 * Analyze code quality for a file
 */
export async function analyzeCodeQuality(filePath: string): Promise<QualityReport> {
  const content = await UnifiedVfsRouter.Instance.readFile(filePath, 'utf-8');
  const language = detectLanguage(filePath);

  const metrics = calculateMetrics(content, language);
  const smells = detectCodeSmells(content, language);
  const score = calculateScore(metrics, smells);
  const suggestions = generateSuggestions(metrics, smells);

  return {
    filePath,
    language,
    metrics,
    score,
    smells,
    suggestions,
  };
}

/**
 * Analyze code quality for a string
 */
export function analyzeCodeQualityString(
  content: string,
  language: string = 'typescript'
): Omit<QualityReport, 'filePath'> {
  const metrics = calculateMetrics(content, language);
  const smells = detectCodeSmells(content, language);
  const score = calculateScore(metrics, smells);
  const suggestions = generateSuggestions(metrics, smells);

  return {
    language,
    metrics,
    score,
    smells,
    suggestions,
  };
}

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
  };
  return mapping[ext] || 'unknown';
}

/**
 * Calculate code metrics
 */
function calculateMetrics(content: string, language: string): QualityMetrics {
  const lines = content.split('\n');
  const linesOfCode = lines.length;

  // Calculate source lines (non-blank, non-comment)
  let sourceLinesOfCode = 0;
  let commentLines = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Handle block comments
    if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      inBlockComment = true;
      commentLines++;
      if (trimmed.endsWith('*/')) inBlockComment = false;
      continue;
    }

    if (inBlockComment) {
      commentLines++;
      if (trimmed.endsWith('*/')) inBlockComment = false;
      continue;
    }

    // Line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      commentLines++;
      continue;
    }

    sourceLinesOfCode++;
  }

  const commentRatio = linesOfCode > 0 ? (commentLines / linesOfCode) * 100 : 0;

  // Calculate complexity (simplified cyclomatic complexity)
  const complexity = calculateComplexity(content, language);

  // Function metrics
  const functions = extractFunctions(content, language);
  const functionLengths = functions.map(f => f.length);
  const avgFunctionLength = functionLengths.length > 0
    ? functionLengths.reduce((a, b) => a + b, 0) / functionLengths.length
    : 0;
  const maxFunctionLength = functionLengths.length > 0
    ? Math.max(...functionLengths)
    : 0;

  // Max nesting depth
  const maxNestingDepth = calculateMaxNesting(content);

  // Magic numbers
  const magicNumbers = countMagicNumbers(content);

  // Long lines
  const longLines = lines.filter(l => l.length > 120).length;

  // TODOs
  const todoCount = (content.match(/TODO|FIXME|HACK|XXX/gi) || []).length;

  // Duplicate ratio (simplified)
  const duplicateRatio = estimateDuplication(content);

  return {
    complexity,
    linesOfCode,
    sourceLinesOfCode,
    commentRatio,
    avgFunctionLength,
    maxFunctionLength,
    functionCount: functions.length,
    maxNestingDepth,
    magicNumbers,
    longLines,
    todoCount,
    duplicateRatio,
  };
}

/**
 * Calculate cyclomatic complexity
 */
function calculateComplexity(content: string, _language: string): number {
  // Count decision points
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bwhile\b/g,
    /\bfor\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?\s*[^:]+\s*:/g, // ternary
    /&&/g,
    /\|\|/g,
  ];

  let complexity = 1; // Base complexity

  for (const pattern of patterns) {
    const matches = content.match(pattern);
    complexity += matches ? matches.length : 0;
  }

  return complexity;
}

/**
 * Extract function definitions
 */
function extractFunctions(content: string, _language: string): Array<{ name: string; length: number }> {
  const functions: Array<{ name: string; length: number }> = [];
  const lines = content.split('\n');

  // Simple pattern matching for functions
  const functionPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/;

  let currentFunction: { name: string; startLine: number } | null = null;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!currentFunction) {
      const match = line.match(functionPattern);
      if (match) {
        currentFunction = {
          name: match[1] || match[2],
          startLine: i,
        };
        braceCount = 0;
      }
    }

    if (currentFunction) {
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;

      if (braceCount <= 0 && i > currentFunction.startLine) {
        functions.push({
          name: currentFunction.name,
          length: i - currentFunction.startLine + 1,
        });
        currentFunction = null;
      }
    }
  }

  return functions;
}

/**
 * Calculate max nesting depth
 */
function calculateMaxNesting(content: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of content) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

/**
 * Count magic numbers
 */
function countMagicNumbers(content: string): number {
  // Match numbers that aren't 0, 1, 2, or common values
  const matches = content.match(/(?<![.\w])\d+(?![.\w])/g) || [];
  const commonValues = new Set(['0', '1', '2', '10', '100', '1000', '60', '24', '7', '365']);

  return matches.filter(m => !commonValues.has(m) && parseInt(m) > 2).length;
}

/**
 * Estimate code duplication
 */
function estimateDuplication(content: string): number {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 10);
  const lineSet = new Set<string>();
  let duplicates = 0;

  for (const line of lines) {
    if (lineSet.has(line)) {
      duplicates++;
    } else {
      lineSet.add(line);
    }
  }

  return lines.length > 0 ? (duplicates / lines.length) * 100 : 0;
}

/**
 * Detect code smells
 */
function detectCodeSmells(content: string, _language: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split('\n');

  // Check for long functions
  const functions = extractFunctions(content, _language);
  for (const fn of functions) {
    if (fn.length > 50) {
      smells.push({
        type: 'long-function',
        severity: fn.length > 100 ? 'high' : 'medium',
        message: `Function '${fn.name}' is ${fn.length} lines long`,
        suggestion: 'Consider breaking this function into smaller, focused functions',
      });
    }
  }

  // Check for deeply nested code
  const maxNesting = calculateMaxNesting(content);
  if (maxNesting > 4) {
    smells.push({
      type: 'deep-nesting',
      severity: maxNesting > 6 ? 'high' : 'medium',
      message: `Maximum nesting depth is ${maxNesting}`,
      suggestion: 'Use early returns, extract methods, or flatten conditionals',
    });
  }

  // Check for long lines
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 120) {
      smells.push({
        type: 'long-line',
        severity: 'low',
        message: `Line ${i + 1} is ${lines[i].length} characters`,
        line: i + 1,
        suggestion: 'Break into multiple lines or extract variables',
      });
    }
  }

  // Check for magic numbers
  const magicCount = countMagicNumbers(content);
  if (magicCount > 5) {
    smells.push({
      type: 'magic-numbers',
      severity: magicCount > 15 ? 'high' : 'medium',
      message: `Found ${magicCount} magic numbers`,
      suggestion: 'Extract magic numbers to named constants',
    });
  }

  // Check for console.log statements
  const consoleLogs = (content.match(/console\.(log|debug|info|warn|error)/g) || []).length;
  if (consoleLogs > 3) {
    smells.push({
      type: 'console-statements',
      severity: 'low',
      message: `Found ${consoleLogs} console statements`,
      suggestion: 'Use a proper logging framework instead of console',
    });
  }

  // Check for any types in TypeScript
  const anyTypes = (content.match(/:\s*any\b/g) || []).length;
  if (anyTypes > 0) {
    smells.push({
      type: 'any-types',
      severity: anyTypes > 5 ? 'high' : 'medium',
      message: `Found ${anyTypes} 'any' types`,
      suggestion: 'Replace any with proper types for better type safety',
    });
  }

  // Check for TODO/FIXME
  const todos = (content.match(/TODO|FIXME|HACK|XXX/gi) || []).length;
  if (todos > 0) {
    smells.push({
      type: 'todo-comments',
      severity: 'low',
      message: `Found ${todos} TODO/FIXME comments`,
      suggestion: 'Address or track these items in your issue tracker',
    });
  }

  return smells;
}

/**
 * Calculate quality score
 */
function calculateScore(metrics: QualityMetrics, smells: CodeSmell[]): QualityScore {
  // Complexity score (lower is better)
  const complexityScore = Math.max(0, 100 - (metrics.complexity * 2));

  // Maintainability score
  let maintainability = 100;
  if (metrics.avgFunctionLength > 30) maintainability -= 20;
  if (metrics.maxFunctionLength > 50) maintainability -= 10;
  if (metrics.maxNestingDepth > 4) maintainability -= 15;
  if (metrics.duplicateRatio > 10) maintainability -= 20;

  // Readability score
  let readability = 100;
  if (metrics.commentRatio < 5) readability -= 15;
  if (metrics.longLines > 5) readability -= 10;
  if (metrics.magicNumbers > 10) readability -= 15;

  // Best practices score
  let bestPractices = 100;
  for (const smell of smells) {
    switch (smell.severity) {
      case 'high': bestPractices -= 15; break;
      case 'medium': bestPractices -= 8; break;
      case 'low': bestPractices -= 3; break;
    }
  }
  bestPractices = Math.max(0, bestPractices);

  // Overall score
  const overall = Math.round(
    (complexityScore * 0.25) +
    (maintainability * 0.30) +
    (readability * 0.20) +
    (bestPractices * 0.25)
  );

  // Grade
  const grade: QualityScore['grade'] =
    overall >= 90 ? 'A' :
    overall >= 80 ? 'B' :
    overall >= 70 ? 'C' :
    overall >= 60 ? 'D' : 'F';

  return {
    overall,
    complexity: Math.round(complexityScore),
    maintainability: Math.round(Math.max(0, maintainability)),
    readability: Math.round(Math.max(0, readability)),
    bestPractices: Math.round(bestPractices),
    grade,
  };
}

/**
 * Generate improvement suggestions
 */
function generateSuggestions(metrics: QualityMetrics, smells: CodeSmell[]): string[] {
  const suggestions: string[] = [];

  if (metrics.complexity > 20) {
    suggestions.push('High cyclomatic complexity - consider breaking down complex functions');
  }

  if (metrics.avgFunctionLength > 30) {
    suggestions.push('Functions are too long on average - extract smaller functions');
  }

  if (metrics.maxNestingDepth > 4) {
    suggestions.push('Deep nesting detected - use early returns and guard clauses');
  }

  if (metrics.commentRatio < 5) {
    suggestions.push('Low comment ratio - add documentation for complex logic');
  }

  if (metrics.duplicateRatio > 10) {
    suggestions.push('Significant code duplication - extract common patterns');
  }

  // Add smell-specific suggestions
  const smellSuggestions = smells
    .filter(s => s.suggestion)
    .map(s => s.suggestion!)
    .filter((s, i, arr) => arr.indexOf(s) === i); // Dedupe

  suggestions.push(...smellSuggestions);

  return suggestions.slice(0, 10); // Limit suggestions
}

/**
 * Format quality report for display
 */
export function formatQualityReport(report: QualityReport): string {
  const { score, metrics, smells, suggestions } = report;

  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════',
    '              CODE QUALITY REPORT',
    '═══════════════════════════════════════════════════',
    '',
    `File: ${report.filePath}`,
    `Language: ${report.language}`,
    '',
    '───────────────────────────────────────────────────',
    `  OVERALL SCORE: ${score.overall}/100  [${score.grade}]`,
    '───────────────────────────────────────────────────',
    '',
    '  Scores:',
    `    Complexity:      ${createBar(score.complexity)} ${score.complexity}%`,
    `    Maintainability: ${createBar(score.maintainability)} ${score.maintainability}%`,
    `    Readability:     ${createBar(score.readability)} ${score.readability}%`,
    `    Best Practices:  ${createBar(score.bestPractices)} ${score.bestPractices}%`,
    '',
    '  Metrics:',
    `    Lines of Code:      ${metrics.linesOfCode}`,
    `    Source Lines:       ${metrics.sourceLinesOfCode}`,
    `    Functions:          ${metrics.functionCount}`,
    `    Complexity:         ${metrics.complexity}`,
    `    Max Nesting:        ${metrics.maxNestingDepth}`,
    `    Comment Ratio:      ${metrics.commentRatio.toFixed(1)}%`,
    '',
  ];

  if (smells.length > 0) {
    lines.push('  Code Smells:');
    for (const smell of smells.slice(0, 8)) {
      const icon = smell.severity === 'high' ? '!!' :
                   smell.severity === 'medium' ? '!' : '-';
      lines.push(`    [${icon}] ${smell.message}`);
    }
    if (smells.length > 8) {
      lines.push(`    ... and ${smells.length - 8} more`);
    }
    lines.push('');
  }

  if (suggestions.length > 0) {
    lines.push('  Suggestions:');
    for (const suggestion of suggestions.slice(0, 5)) {
      lines.push(`    → ${suggestion}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Create ASCII progress bar
 */
function createBar(percentage: number, width: number = 15): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export default analyzeCodeQuality;
