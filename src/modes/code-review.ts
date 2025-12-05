/**
 * Code Review Mode
 *
 * Provides AI-powered code review capabilities:
 * - Line-by-line analysis
 * - Security vulnerability detection
 * - Performance suggestions
 * - Best practice recommendations
 * - Refactoring opportunities
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export type ReviewSeverity = 'critical' | 'warning' | 'info' | 'suggestion';
export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'bug'
  | 'style'
  | 'documentation'
  | 'testing'
  | 'accessibility'
  | 'best-practice';

export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  column?: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  suggestion?: string;
  codeSnippet?: string;
  fixAvailable?: boolean;
  autoFix?: ReviewFix;
}

export interface ReviewFix {
  type: 'replace' | 'insert' | 'delete';
  line: number;
  endLine?: number;
  oldText?: string;
  newText?: string;
}

export interface ReviewSummary {
  totalFiles: number;
  totalComments: number;
  bySeverity: Record<ReviewSeverity, number>;
  byCategory: Record<ReviewCategory, number>;
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  highlights: string[];
  recommendations: string[];
}

export interface ReviewResult {
  files: FileReview[];
  summary: ReviewSummary;
  duration: number;
}

export interface FileReview {
  path: string;
  comments: ReviewComment[];
  linesReviewed: number;
  score: number;
}

export interface ReviewConfig {
  includePatterns: string[];
  excludePatterns: string[];
  maxFiles: number;
  maxLinesPerFile: number;
  categories: ReviewCategory[];
  severityThreshold: ReviewSeverity;
  enableAutoFix: boolean;
  gitDiffOnly: boolean;
  baseBranch?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ReviewConfig = {
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.*', '**/*.spec.*'],
  maxFiles: 50,
  maxLinesPerFile: 1000,
  categories: ['security', 'performance', 'maintainability', 'bug', 'best-practice'],
  severityThreshold: 'info',
  enableAutoFix: true,
  gitDiffOnly: false,
};

// ============================================================================
// Code Review Rules
// ============================================================================

interface ReviewRule {
  id: string;
  name: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  pattern: RegExp;
  message: string;
  suggestion?: string;
  languages: string[];
  autoFix?: (match: RegExpExecArray, line: string) => ReviewFix | null;
}

const REVIEW_RULES: ReviewRule[] = [
  // Security Rules
  {
    id: 'SEC001',
    name: 'Hardcoded Secret',
    category: 'security',
    severity: 'critical',
    pattern: /(?:password|secret|api[_-]?key|token|auth)\s*[=:]\s*["'][^"']{8,}["']/gi,
    message: 'Potential hardcoded secret detected. Use environment variables instead.',
    suggestion: 'Move this value to an environment variable or configuration file.',
    languages: ['typescript', 'javascript', 'python'],
  },
  {
    id: 'SEC002',
    name: 'SQL Injection Risk',
    category: 'security',
    severity: 'critical',
    pattern: /(?:query|execute|exec)\s*\([^)]*\+[^)]*\)|(?:query|execute|exec)\s*\([^)]*\$\{[^}]+\}[^)]*\)/gi,
    message: 'Potential SQL injection vulnerability. Use parameterized queries.',
    suggestion: 'Use prepared statements or parameterized queries to prevent SQL injection.',
    languages: ['typescript', 'javascript', 'python'],
  },
  {
    id: 'SEC003',
    name: 'Dangerous eval()',
    category: 'security',
    severity: 'critical',
    pattern: /\beval\s*\(/g,
    message: 'Use of eval() is dangerous and can lead to code injection.',
    suggestion: 'Avoid eval(). Consider using JSON.parse() for data or safer alternatives.',
    languages: ['typescript', 'javascript'],
  },
  {
    id: 'SEC004',
    name: 'innerHTML Usage',
    category: 'security',
    severity: 'warning',
    pattern: /\.innerHTML\s*=/g,
    message: 'Direct innerHTML assignment can lead to XSS vulnerabilities.',
    suggestion: 'Use textContent for text or a sanitization library for HTML.',
    languages: ['typescript', 'javascript'],
  },

  // Performance Rules
  {
    id: 'PERF001',
    name: 'Nested Loops',
    category: 'performance',
    severity: 'warning',
    pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\([^)]+\)/g,
    message: 'Nested loops can cause O(n²) complexity. Consider optimization.',
    suggestion: 'Consider using a Map/Set for lookups or restructuring the algorithm.',
    languages: ['typescript', 'javascript', 'python'],
  },
  {
    id: 'PERF002',
    name: 'Sync File Operation',
    category: 'performance',
    severity: 'warning',
    pattern: /(?:readFileSync|writeFileSync|existsSync|statSync)\s*\(/g,
    message: 'Synchronous file operations block the event loop.',
    suggestion: 'Use async versions (readFile, writeFile) with await.',
    languages: ['typescript', 'javascript'],
  },
  {
    id: 'PERF003',
    name: 'Inefficient Array Method',
    category: 'performance',
    severity: 'info',
    pattern: /\.filter\([^)]+\)\.map\([^)]+\)/g,
    message: 'Chained filter().map() iterates twice. Consider using reduce() or a single loop.',
    suggestion: 'Use reduce() or flatMap() to combine operations.',
    languages: ['typescript', 'javascript'],
  },

  // Maintainability Rules
  {
    id: 'MAINT001',
    name: 'Long Function',
    category: 'maintainability',
    severity: 'info',
    pattern: /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{2000,}\}/g,
    message: 'Function is very long. Consider breaking it into smaller functions.',
    suggestion: 'Extract logical sections into separate functions.',
    languages: ['typescript', 'javascript'],
  },
  {
    id: 'MAINT002',
    name: 'Magic Number',
    category: 'maintainability',
    severity: 'info',
    pattern: /(?<![.\w])\d{4,}(?!\s*[,\]}])/g,
    message: 'Magic number detected. Consider using a named constant.',
    suggestion: 'Extract this number into a descriptive constant.',
    languages: ['typescript', 'javascript', 'python'],
  },
  {
    id: 'MAINT003',
    name: 'TODO Comment',
    category: 'maintainability',
    severity: 'info',
    pattern: /\/\/\s*TODO|#\s*TODO/gi,
    message: 'TODO comment found. Consider addressing or tracking this.',
    languages: ['typescript', 'javascript', 'python'],
  },

  // Bug-prone Code
  {
    id: 'BUG001',
    name: 'Loose Equality',
    category: 'bug',
    severity: 'warning',
    pattern: /[^!=]==[^=]/g,
    message: 'Use strict equality (===) instead of loose equality (==).',
    suggestion: 'Replace == with === for type-safe comparison.',
    languages: ['typescript', 'javascript'],
    autoFix: (_match, line) => ({
      type: 'replace',
      line: 0,
      oldText: '==',
      newText: '===',
    }),
  },
  {
    id: 'BUG002',
    name: 'Floating Promise',
    category: 'bug',
    severity: 'warning',
    pattern: /(?<!await\s)(?<!return\s)\b\w+\s*\.\s*(?:then|catch)\s*\(/g,
    message: 'Promise without await or return may cause unhandled rejections.',
    suggestion: 'Add await or return to handle the promise properly.',
    languages: ['typescript', 'javascript'],
  },
  {
    id: 'BUG003',
    name: 'Empty Catch Block',
    category: 'bug',
    severity: 'warning',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    message: 'Empty catch block silently swallows errors.',
    suggestion: 'At minimum, log the error. Consider proper error handling.',
    languages: ['typescript', 'javascript'],
  },

  // Best Practices
  {
    id: 'BP001',
    name: 'Console in Production',
    category: 'best-practice',
    severity: 'info',
    pattern: /console\.(log|debug|info|warn|error)\s*\(/g,
    message: 'Console statements should not be in production code.',
    suggestion: 'Use a proper logging library or remove debug statements.',
    languages: ['typescript', 'javascript'],
  },
  {
    id: 'BP002',
    name: 'Any Type',
    category: 'best-practice',
    severity: 'info',
    pattern: /:\s*any\b/g,
    message: 'Avoid using "any" type. It defeats TypeScript\'s type safety.',
    suggestion: 'Use a specific type, unknown, or generic types.',
    languages: ['typescript'],
  },
  {
    id: 'BP003',
    name: 'Commented Code',
    category: 'best-practice',
    severity: 'suggestion',
    pattern: /\/\/\s*(?:const|let|var|function|if|for|while|return)\s/g,
    message: 'Commented-out code should be removed.',
    suggestion: 'Remove dead code. Use version control for history.',
    languages: ['typescript', 'javascript'],
  },
];

// ============================================================================
// Code Review Engine
// ============================================================================

export class CodeReviewEngine extends EventEmitter {
  private config: ReviewConfig;
  private projectRoot: string;

  constructor(projectRoot: string, config: Partial<ReviewConfig> = {}) {
    super();
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run code review on the project
   */
  async review(): Promise<ReviewResult> {
    const startTime = Date.now();

    // Get files to review
    const files = await this.getFilesToReview();
    this.emit('progress', { phase: 'collecting', files: files.length });

    // Review each file
    const fileReviews: FileReview[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      this.emit('progress', { phase: 'reviewing', current: i + 1, total: files.length, file });

      try {
        const review = await this.reviewFile(file);
        if (review.comments.length > 0) {
          fileReviews.push(review);
        }
      } catch (error) {
        this.emit('error', { file, error });
      }
    }

    // Generate summary
    const summary = this.generateSummary(fileReviews);

    return {
      files: fileReviews,
      summary,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Review a single file
   */
  async reviewFile(filePath: string): Promise<FileReview> {
    const fullPath = path.join(this.projectRoot, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    const ext = path.extname(filePath);
    const language = this.getLanguage(ext);

    const comments: ReviewComment[] = [];

    // Apply rules
    for (const rule of REVIEW_RULES) {
      if (!rule.languages.includes(language)) continue;
      if (!this.config.categories.includes(rule.category)) continue;
      if (!this.meetsThreshold(rule.severity)) continue;

      // Check each line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matches = line.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags));

        for (const match of matches) {
          if (match.index === undefined) continue;

          const comment: ReviewComment = {
            id: `${rule.id}-${filePath}-${i + 1}-${match.index}`,
            file: filePath,
            line: i + 1,
            column: match.index + 1,
            severity: rule.severity,
            category: rule.category,
            message: rule.message,
            suggestion: rule.suggestion,
            codeSnippet: line.trim(),
          };

          if (rule.autoFix && this.config.enableAutoFix) {
            comment.fixAvailable = true;
            const fix = rule.autoFix(match, line);
            comment.autoFix = fix ?? undefined;
            if (comment.autoFix) {
              comment.autoFix.line = i + 1;
            }
          }

          comments.push(comment);
        }
      }
    }

    // Calculate file score
    const score = this.calculateFileScore(comments, lines.length);

    return {
      path: filePath,
      comments,
      linesReviewed: Math.min(lines.length, this.config.maxLinesPerFile),
      score,
    };
  }

  /**
   * Get files to review
   */
  private async getFilesToReview(): Promise<string[]> {
    if (this.config.gitDiffOnly) {
      return this.getGitDiffFiles();
    }

    return this.globFiles();
  }

  /**
   * Get files changed in git
   */
  private async getGitDiffFiles(): Promise<string[]> {
    return new Promise((resolve) => {
      const args = this.config.baseBranch
        ? ['diff', '--name-only', this.config.baseBranch]
        : ['diff', '--name-only', 'HEAD'];

      const proc = spawn('git', args, { cwd: this.projectRoot });
      let stdout = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('close', () => {
        const files = stdout
          .split('\n')
          .filter(f => f.trim())
          .filter(f => this.matchesPatterns(f));
        resolve(files.slice(0, this.config.maxFiles));
      });

      proc.on('error', () => {
        resolve([]);
      });
    });
  }

  /**
   * Glob files based on patterns
   */
  private async globFiles(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (files.length >= this.config.maxFiles) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (files.length >= this.config.maxFiles) break;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.projectRoot, fullPath);

          if (entry.isDirectory()) {
            if (!this.isExcluded(relativePath)) {
              await walk(fullPath);
            }
          } else if (this.matchesPatterns(relativePath)) {
            files.push(relativePath);
          }
        }
      } catch {
        // Ignore access errors
      }
    };

    await walk(this.projectRoot);
    return files;
  }

  /**
   * Check if path matches include/exclude patterns
   */
  private matchesPatterns(filePath: string): boolean {
    // Check excludes first
    if (this.isExcluded(filePath)) return false;

    // Check includes
    return this.config.includePatterns.some(pattern => {
      const regex = this.globToRegex(pattern);
      return regex.test(filePath);
    });
  }

  /**
   * Check if path is excluded
   */
  private isExcluded(filePath: string): boolean {
    return this.config.excludePatterns.some(pattern => {
      const regex = this.globToRegex(pattern);
      return regex.test(filePath);
    });
  }

  /**
   * Convert glob pattern to regex
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Get language from file extension
   */
  private getLanguage(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
    };
    return map[ext] || 'unknown';
  }

  /**
   * Check if severity meets threshold
   */
  private meetsThreshold(severity: ReviewSeverity): boolean {
    const order: ReviewSeverity[] = ['critical', 'warning', 'info', 'suggestion'];
    const thresholdIndex = order.indexOf(this.config.severityThreshold);
    const severityIndex = order.indexOf(severity);
    return severityIndex <= thresholdIndex;
  }

  /**
   * Calculate file score
   */
  private calculateFileScore(comments: ReviewComment[], totalLines: number): number {
    if (totalLines === 0) return 100;

    let penalty = 0;
    const severityPenalties: Record<ReviewSeverity, number> = {
      critical: 20,
      warning: 10,
      info: 3,
      suggestion: 1,
    };

    for (const comment of comments) {
      penalty += severityPenalties[comment.severity];
    }

    // Normalize by lines
    const normalizedPenalty = (penalty / totalLines) * 100;
    return Math.max(0, Math.round(100 - normalizedPenalty));
  }

  /**
   * Generate review summary
   */
  private generateSummary(fileReviews: FileReview[]): ReviewSummary {
    const allComments = fileReviews.flatMap(f => f.comments);

    const bySeverity: Record<ReviewSeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
      suggestion: 0,
    };

    const byCategory: Record<ReviewCategory, number> = {
      security: 0,
      performance: 0,
      maintainability: 0,
      bug: 0,
      style: 0,
      documentation: 0,
      testing: 0,
      accessibility: 0,
      'best-practice': 0,
    };

    for (const comment of allComments) {
      bySeverity[comment.severity]++;
      byCategory[comment.category]++;
    }

    // Calculate overall score
    const avgScore = fileReviews.length > 0
      ? fileReviews.reduce((acc, f) => acc + f.score, 0) / fileReviews.length
      : 100;

    // Determine grade
    const grade: ReviewSummary['grade'] = avgScore >= 90 ? 'A'
      : avgScore >= 80 ? 'B'
      : avgScore >= 70 ? 'C'
      : avgScore >= 60 ? 'D'
      : 'F';

    // Generate highlights
    const highlights: string[] = [];
    if (bySeverity.critical > 0) {
      highlights.push(`🚨 ${bySeverity.critical} critical issues require immediate attention`);
    }
    if (byCategory.security > 0) {
      highlights.push(`🔒 ${byCategory.security} security concerns found`);
    }
    if (byCategory.performance > 0) {
      highlights.push(`⚡ ${byCategory.performance} performance improvements possible`);
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (bySeverity.critical > 0) {
      recommendations.push('Address all critical issues before merging');
    }
    if (byCategory.security > 0) {
      recommendations.push('Review security issues with your security team');
    }
    if (avgScore < 70) {
      recommendations.push('Consider a more thorough code review');
    }

    return {
      totalFiles: fileReviews.length,
      totalComments: allComments.length,
      bySeverity,
      byCategory,
      score: Math.round(avgScore),
      grade,
      highlights,
      recommendations,
    };
  }

  /**
   * Apply auto-fixes
   */
  async applyFixes(fileReviews: FileReview[]): Promise<{ applied: number; failed: number }> {
    let applied = 0;
    let failed = 0;

    for (const review of fileReviews) {
      const fixableComments = review.comments.filter(c => c.autoFix);
      if (fixableComments.length === 0) continue;

      try {
        const fullPath = path.join(this.projectRoot, review.path);
        let content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        // Apply fixes in reverse order to preserve line numbers
        const sortedFixes = fixableComments
          .filter(c => c.autoFix)
          .sort((a, b) => (b.autoFix!.line - a.autoFix!.line));

        for (const comment of sortedFixes) {
          const fix = comment.autoFix!;
          const lineIndex = fix.line - 1;

          if (lineIndex >= 0 && lineIndex < lines.length) {
            if (fix.type === 'replace' && fix.oldText && fix.newText) {
              lines[lineIndex] = lines[lineIndex].replace(fix.oldText, fix.newText);
              applied++;
            }
          }
        }

        await fs.writeFile(fullPath, lines.join('\n'));
      } catch {
        failed += fixableComments.length;
      }
    }

    return { applied, failed };
  }

  /**
   * Format review result as text
   */
  formatAsText(result: ReviewResult): string {
    const lines: string[] = [];

    // Header
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                        CODE REVIEW REPORT                      ');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    // Summary
    lines.push(`Score: ${result.summary.score}/100 (Grade: ${result.summary.grade})`);
    lines.push(`Files Reviewed: ${result.summary.totalFiles}`);
    lines.push(`Total Issues: ${result.summary.totalComments}`);
    lines.push('');

    // By severity
    lines.push('Issues by Severity:');
    lines.push(`  🚨 Critical: ${result.summary.bySeverity.critical}`);
    lines.push(`  ⚠️  Warning: ${result.summary.bySeverity.warning}`);
    lines.push(`  ℹ️  Info: ${result.summary.bySeverity.info}`);
    lines.push(`  💡 Suggestion: ${result.summary.bySeverity.suggestion}`);
    lines.push('');

    // Highlights
    if (result.summary.highlights.length > 0) {
      lines.push('Highlights:');
      for (const h of result.summary.highlights) {
        lines.push(`  ${h}`);
      }
      lines.push('');
    }

    // File details
    if (result.files.length > 0) {
      lines.push('───────────────────────────────────────────────────────────────');
      lines.push('                        FILE DETAILS                            ');
      lines.push('───────────────────────────────────────────────────────────────');
      lines.push('');

      for (const file of result.files) {
        lines.push(`📄 ${file.path} (Score: ${file.score})`);
        for (const comment of file.comments) {
          const icon = comment.severity === 'critical' ? '🚨'
            : comment.severity === 'warning' ? '⚠️'
            : comment.severity === 'info' ? 'ℹ️'
            : '💡';

          lines.push(`  ${icon} Line ${comment.line}: ${comment.message}`);
          if (comment.codeSnippet) {
            lines.push(`     > ${comment.codeSnippet.slice(0, 60)}${comment.codeSnippet.length > 60 ? '...' : ''}`);
          }
          if (comment.suggestion) {
            lines.push(`     💡 ${comment.suggestion}`);
          }
        }
        lines.push('');
      }
    }

    // Recommendations
    if (result.summary.recommendations.length > 0) {
      lines.push('───────────────────────────────────────────────────────────────');
      lines.push('Recommendations:');
      for (const r of result.summary.recommendations) {
        lines.push(`  • ${r}`);
      }
    }

    lines.push('');
    lines.push(`Review completed in ${result.duration}ms`);

    return lines.join('\n');
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCodeReview(
  projectRoot: string,
  config?: Partial<ReviewConfig>
): CodeReviewEngine {
  return new CodeReviewEngine(projectRoot, config);
}

/**
 * Quick review function
 */
export async function reviewProject(
  projectRoot: string,
  options?: Partial<ReviewConfig>
): Promise<ReviewResult> {
  const engine = new CodeReviewEngine(projectRoot, options);
  try {
    return await engine.review();
  } finally {
    engine.dispose();
  }
}
