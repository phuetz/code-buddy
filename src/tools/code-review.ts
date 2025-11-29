/**
 * AI Code Review Tool
 *
 * Automatically reviews code changes for bugs, security issues,
 * and best practice violations.
 */

import { EventEmitter } from 'events';
import { GrokClient, GrokMessage } from '../grok/client.js';
import { BashTool } from './bash.js';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface ReviewIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: ReviewCategory;
  file: string;
  line?: number;
  endLine?: number;
  message: string;
  suggestion?: string;
  code?: string;
  fixAvailable?: boolean;
  autoFixable?: boolean;
}

export type ReviewCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'style'
  | 'maintainability'
  | 'complexity'
  | 'documentation'
  | 'type_safety'
  | 'error_handling'
  | 'best_practice';

export interface ReviewResult {
  files: string[];
  issues: ReviewIssue[];
  summary: ReviewSummary;
  timestamp: Date;
  duration: number;
}

export interface ReviewSummary {
  totalIssues: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  passedChecks: string[];
  score: number; // 0-100
}

export interface ReviewConfig {
  // What to check
  checkBugs: boolean;
  checkSecurity: boolean;
  checkPerformance: boolean;
  checkStyle: boolean;
  checkComplexity: boolean;
  checkDocumentation: boolean;
  checkTypesSafety: boolean;

  // Thresholds
  maxComplexity: number;
  maxFileLength: number;
  maxFunctionLength: number;

  // Filters
  excludePatterns: string[];
  includeOnlyPatterns: string[];

  // AI settings
  model: string;
  contextLines: number;
}

const DEFAULT_CONFIG: ReviewConfig = {
  checkBugs: true,
  checkSecurity: true,
  checkPerformance: true,
  checkStyle: true,
  checkComplexity: true,
  checkDocumentation: false,
  checkTypesSafety: true,
  maxComplexity: 10,
  maxFileLength: 500,
  maxFunctionLength: 50,
  excludePatterns: ['node_modules', 'dist', 'build', '.git', '*.min.js'],
  includeOnlyPatterns: [],
  model: 'grok-3-latest',
  contextLines: 5,
};

const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the provided code for:
1. Bugs and logic errors
2. Security vulnerabilities (XSS, SQL injection, command injection, etc.)
3. Performance issues
4. Type safety issues
5. Error handling problems
6. Code complexity
7. Best practice violations

For each issue found, respond in this exact JSON format:
{
  "issues": [
    {
      "severity": "critical|high|medium|low|info",
      "category": "bug|security|performance|style|maintainability|complexity|documentation|type_safety|error_handling|best_practice",
      "line": <line_number>,
      "endLine": <end_line_number_optional>,
      "message": "Description of the issue",
      "suggestion": "How to fix it",
      "autoFixable": true|false
    }
  ],
  "passedChecks": ["List of checks that passed"],
  "score": <0-100>
}

Be thorough but avoid false positives. Only report genuine issues.`;

/**
 * AI Code Review Tool
 */
export class CodeReviewTool extends EventEmitter {
  private config: ReviewConfig;
  private client: GrokClient | null = null;
  private bash: BashTool;
  private issueIdCounter: number = 0;

  constructor(config: Partial<ReviewConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bash = new BashTool();
  }

  /**
   * Initialize the AI client
   */
  private ensureClient(): GrokClient {
    if (!this.client) {
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      this.client = new GrokClient(apiKey, this.config.model);
    }
    return this.client;
  }

  /**
   * Review git diff (staged or unstaged changes)
   */
  async reviewGitDiff(options: { staged?: boolean; branch?: string } = {}): Promise<ReviewResult> {
    const startTime = Date.now();
    const { staged = false, branch } = options;

    this.emit('review:start', { type: 'git-diff', staged, branch });

    // Get diff
    let diffCommand = 'git diff';
    if (staged) {
      diffCommand = 'git diff --cached';
    } else if (branch) {
      diffCommand = `git diff ${branch}...HEAD`;
    }

    const diffResult = await this.bash.execute(diffCommand);
    if (!diffResult.success || !diffResult.output) {
      return this.createEmptyResult([], startTime);
    }

    // Parse diff to get changed files and their content
    const changedFiles = await this.parseGitDiff(diffResult.output);

    if (changedFiles.length === 0) {
      return this.createEmptyResult([], startTime);
    }

    // Review each file
    const allIssues: ReviewIssue[] = [];
    const files: string[] = [];

    for (const file of changedFiles) {
      if (this.shouldExclude(file.path)) continue;

      files.push(file.path);
      this.emit('review:file', { file: file.path });

      const issues = await this.reviewFileContent(
        file.path,
        file.content,
        file.hunks
      );
      allIssues.push(...issues);
    }

    const result = this.createResult(files, allIssues, startTime);
    this.emit('review:complete', { result });

    return result;
  }

  /**
   * Review specific files
   */
  async reviewFiles(filePaths: string[]): Promise<ReviewResult> {
    const startTime = Date.now();
    const allIssues: ReviewIssue[] = [];
    const files: string[] = [];

    this.emit('review:start', { type: 'files', count: filePaths.length });

    for (const filePath of filePaths) {
      if (this.shouldExclude(filePath)) continue;
      if (!await fs.pathExists(filePath)) continue;

      const content = await fs.readFile(filePath, 'utf-8');
      files.push(filePath);

      this.emit('review:file', { file: filePath });

      const issues = await this.reviewFileContent(filePath, content);
      allIssues.push(...issues);
    }

    const result = this.createResult(files, allIssues, startTime);
    this.emit('review:complete', { result });

    return result;
  }

  /**
   * Review a single file
   */
  async reviewFile(filePath: string): Promise<ReviewResult> {
    return this.reviewFiles([filePath]);
  }

  /**
   * Review file content with AI
   */
  private async reviewFileContent(
    filePath: string,
    content: string,
    hunks?: Array<{ startLine: number; lines: string[] }>
  ): Promise<ReviewIssue[]> {
    const client = this.ensureClient();
    const ext = path.extname(filePath);
    const language = this.detectLanguage(ext);

    // Build context for review
    let reviewContent: string;
    if (hunks && hunks.length > 0) {
      // Review only changed sections with context
      reviewContent = hunks.map(hunk => {
        const lineNumbers = hunk.lines.map((_, i) => hunk.startLine + i);
        return hunk.lines.map((line, i) => `${lineNumbers[i]}: ${line}`).join('\n');
      }).join('\n\n---\n\n');
    } else {
      // Review entire file
      const lines = content.split('\n');
      reviewContent = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
    }

    // Truncate if too long
    if (reviewContent.length > 50000) {
      reviewContent = reviewContent.substring(0, 50000) + '\n... (truncated)';
    }

    const userPrompt = `Review this ${language} code from file "${filePath}":

\`\`\`${language}
${reviewContent}
\`\`\`

Provide your analysis in JSON format as specified.`;

    const messages: GrokMessage[] = [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await client.chat(messages, []);
      const responseText = response.choices[0]?.message?.content || '';

      // Parse JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return (parsed.issues || []).map((issue: {
        severity: string;
        category: string;
        line?: number;
        endLine?: number;
        message: string;
        suggestion?: string;
        autoFixable?: boolean;
      }) => ({
        id: `issue_${++this.issueIdCounter}`,
        severity: issue.severity || 'medium',
        category: issue.category || 'best_practice',
        file: filePath,
        line: issue.line,
        endLine: issue.endLine,
        message: issue.message,
        suggestion: issue.suggestion,
        autoFixable: issue.autoFixable || false,
        fixAvailable: !!issue.suggestion,
      }));
    } catch (error) {
      this.emit('review:error', { file: filePath, error });
      return [];
    }
  }

  /**
   * Parse git diff output
   */
  private async parseGitDiff(diff: string): Promise<Array<{
    path: string;
    content: string;
    hunks: Array<{ startLine: number; lines: string[] }>;
  }>> {
    const files: Array<{
      path: string;
      content: string;
      hunks: Array<{ startLine: number; lines: string[] }>;
    }> = [];

    const fileDiffs = diff.split(/^diff --git/m).filter(Boolean);

    for (const fileDiff of fileDiffs) {
      const pathMatch = fileDiff.match(/a\/(.+?) b\/(.+)/);
      if (!pathMatch) continue;

      const filePath = pathMatch[2];

      // Skip binary files
      if (fileDiff.includes('Binary files')) continue;

      // Parse hunks
      const hunks: Array<{ startLine: number; lines: string[] }> = [];
      const hunkMatches = fileDiff.matchAll(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@[^\n]*\n([\s\S]*?)(?=@@|\z)/g);

      for (const match of hunkMatches) {
        const startLine = parseInt(match[1], 10);
        const hunkContent = match[2];
        const lines = hunkContent
          .split('\n')
          .filter(line => line.startsWith('+') || line.startsWith(' '))
          .map(line => line.substring(1));

        hunks.push({ startLine, lines });
      }

      // Get full file content
      let content = '';
      try {
        if (await fs.pathExists(filePath)) {
          content = await fs.readFile(filePath, 'utf-8');
        }
      } catch {
        // File might be deleted
      }

      files.push({ path: filePath, content, hunks });
    }

    return files;
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.cs': 'csharp',
    };
    return map[ext.toLowerCase()] || 'code';
  }

  /**
   * Check if file should be excluded
   */
  private shouldExclude(filePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        if (regex.test(filePath)) return true;
      } else if (filePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Create result object
   */
  private createResult(
    files: string[],
    issues: ReviewIssue[],
    startTime: number
  ): ReviewResult {
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const issue of issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    }

    // Calculate score
    let score = 100;
    score -= (bySeverity['critical'] || 0) * 20;
    score -= (bySeverity['high'] || 0) * 10;
    score -= (bySeverity['medium'] || 0) * 5;
    score -= (bySeverity['low'] || 0) * 2;
    score = Math.max(0, Math.min(100, score));

    const passedChecks: string[] = [];
    if (!byCategory['security']) passedChecks.push('No security issues');
    if (!byCategory['bug']) passedChecks.push('No bugs detected');
    if (!bySeverity['critical']) passedChecks.push('No critical issues');

    return {
      files,
      issues,
      summary: {
        totalIssues: issues.length,
        bySeverity,
        byCategory,
        passedChecks,
        score,
      },
      timestamp: new Date(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Create empty result
   */
  private createEmptyResult(files: string[], startTime: number): ReviewResult {
    return {
      files,
      issues: [],
      summary: {
        totalIssues: 0,
        bySeverity: {},
        byCategory: {},
        passedChecks: ['No changes to review'],
        score: 100,
      },
      timestamp: new Date(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Format result for display
   */
  formatResult(result: ReviewResult): string {
    const lines: string[] = [];

    // Header
    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║                    AI CODE REVIEW REPORT                     ║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');

    // Summary
    const scoreEmoji = result.summary.score >= 80 ? '✅' : result.summary.score >= 50 ? '⚠️' : '❌';
    lines.push(`║ Score: ${scoreEmoji} ${result.summary.score}/100                                          `);
    lines.push(`║ Files reviewed: ${result.files.length}                                       `);
    lines.push(`║ Issues found: ${result.summary.totalIssues}                                         `);
    lines.push(`║ Duration: ${result.duration}ms                                        `);

    // By severity
    if (result.summary.totalIssues > 0) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ By Severity:                                                 ║');
      for (const [severity, count] of Object.entries(result.summary.bySeverity)) {
        const emoji = this.getSeverityEmoji(severity);
        lines.push(`║   ${emoji} ${severity}: ${count}                                              `.slice(0, 66) + '║');
      }
    }

    // Passed checks
    if (result.summary.passedChecks.length > 0) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ Passed Checks:                                               ║');
      for (const check of result.summary.passedChecks) {
        lines.push(`║   ✓ ${check}                                              `.slice(0, 66) + '║');
      }
    }

    lines.push('╚══════════════════════════════════════════════════════════════╝');

    // Issues
    if (result.issues.length > 0) {
      lines.push('');
      lines.push('ISSUES:');
      lines.push('');

      for (const issue of result.issues) {
        const emoji = this.getSeverityEmoji(issue.severity);
        lines.push(`${emoji} [${issue.severity.toUpperCase()}] ${issue.category}`);
        lines.push(`   File: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
        lines.push(`   ${issue.message}`);
        if (issue.suggestion) {
          lines.push(`   💡 Fix: ${issue.suggestion}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get emoji for severity
   */
  private getSeverityEmoji(severity: string): string {
    const map: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🔵',
      info: 'ℹ️',
    };
    return map[severity] || '•';
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ReviewConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): ReviewConfig {
    return { ...this.config };
  }
}

// Singleton instance
let codeReviewInstance: CodeReviewTool | null = null;

export function getCodeReviewTool(config?: Partial<ReviewConfig>): CodeReviewTool {
  if (!codeReviewInstance) {
    codeReviewInstance = new CodeReviewTool(config);
  }
  return codeReviewInstance;
}

export function resetCodeReviewTool(): void {
  codeReviewInstance = null;
}
