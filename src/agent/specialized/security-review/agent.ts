/**
 * Security Review Agent
 *
 * Comprehensive security analysis agent for codebase auditing.
 * Inspired by Claude Code's /security-review command.
 *
 * Features:
 * - OWASP Top 10 vulnerability detection
 * - Secret/credential scanning
 * - Dependency vulnerability audits
 * - Injection vulnerability detection (SQL, XSS, Command)
 * - Authentication flow analysis
 * - File permission audits
 * - Network security analysis
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import fg from 'fast-glob';

import type {
  SecuritySeverity,
  SecurityFinding,
  SecurityScanResult,
  SecurityReviewConfig,
  SecurityPattern,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import {
  ALL_PATTERNS,
  SECRET_PATTERNS,
  INJECTION_PATTERNS,
  XSS_PATTERNS,
  AUTH_PATTERNS,
  NETWORK_PATTERNS,
} from './patterns.js';
import {
  formatAsText,
  formatAsMarkdown,
  formatAsSarif,
  generateRecommendations,
} from './formatters.js';

// ============================================================================
// Security Review Agent Class
// ============================================================================

export class SecurityReviewAgent extends EventEmitter {
  private config: SecurityReviewConfig;
  private ready = false;
  private lastScanResult: SecurityScanResult | null = null;

  constructor(config: Partial<SecurityReviewConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    this.ready = true;
    this.emit('initialized');
  }

  /**
   * Check if agent is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Full security scan
   */
  async fullScan(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const findings: SecurityFinding[] = [];

      this.emit('scan:start', { path: targetPath, fileCount: files.length });

      for (const file of files) {
        const fileFindings = await this.scanFile(file);
        findings.push(...fileFindings);
      }

      const result = this.buildResult(findings, files.length, startTime);
      this.lastScanResult = result;

      this.emit('scan:complete', result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Quick scan (subset of patterns)
   */
  async quickScan(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const quickPatterns = ALL_PATTERNS.filter(p =>
        p.severity === 'critical' || p.severity === 'high'
      );

      const findings: SecurityFinding[] = [];

      for (const file of files.slice(0, 100)) {
        const fileFindings = await this.scanFileWithPatterns(file, quickPatterns);
        findings.push(...fileFindings);
      }

      const result = this.buildResult(findings, Math.min(files.length, 100), startTime);
      this.lastScanResult = result;
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Audit dependencies for vulnerabilities
   */
  async auditDependencies(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();
    const findings: SecurityFinding[] = [];

    try {
      // Check package.json
      const packageJsonPath = path.join(targetPath, 'package.json');
      try {
        const packageJsonContent = await fsPromises.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);

        // Check for known vulnerable patterns
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        for (const [pkg, version] of Object.entries(deps)) {
          // Check for wildcard versions
          if (version === '*' || version === 'latest') {
            findings.push({
              id: `dep-wildcard-${pkg}`,
              title: 'Wildcard Dependency Version',
              severity: 'medium',
              category: 'dependencies',
              description: `Package ${pkg} uses wildcard version "${version}"`,
              file: packageJsonPath,
              recommendation: 'Pin dependency versions for reproducible builds',
            });
          }

          // Check for git URLs
          if (typeof version === 'string' && (version.includes('git://') || version.includes('github:'))) {
            findings.push({
              id: `dep-git-${pkg}`,
              title: 'Git-based Dependency',
              severity: 'low',
              category: 'dependencies',
              description: `Package ${pkg} installed from git`,
              file: packageJsonPath,
              recommendation: 'Use published npm packages when possible',
            });
          }
        }
      } catch {
        // package.json doesn't exist or is invalid, skip
      }

      // Check requirements.txt for Python
      const requirementsPath = path.join(targetPath, 'requirements.txt');
      try {
        const requirements = await fsPromises.readFile(requirementsPath, 'utf-8');
        const lines = requirements.split('\n');

        for (const line of lines) {
          if (!line.trim() || line.startsWith('#')) continue;

          // Check for no version pinning
          if (!line.includes('==') && !line.includes('>=') && !line.includes('<=')) {
            const pkg = line.split('[')[0].trim();
            if (pkg) {
              findings.push({
                id: `dep-unpinned-${pkg}`,
                title: 'Unpinned Python Dependency',
                severity: 'low',
                category: 'dependencies',
                description: `Package ${pkg} has no version constraint`,
                file: requirementsPath,
                recommendation: 'Pin dependency versions',
              });
            }
          }
        }
      } catch {
        // requirements.txt doesn't exist or is invalid, skip
      }

      return this.buildResult(findings, 2, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Detect secrets and credentials
   */
  async detectSecrets(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const findings: SecurityFinding[] = [];

      for (const file of files) {
        const fileFindings = await this.scanFileWithPatterns(file, SECRET_PATTERNS);
        findings.push(...fileFindings);
      }

      return this.buildResult(findings, files.length, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Audit file permissions
   */
  async auditPermissions(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();
    const findings: SecurityFinding[] = [];

    try {
      // Check for overly permissive files
      const sensitiveFiles = [
        '.env',
        '.env.local',
        '.env.production',
        'credentials.json',
        'secrets.json',
        'config/secrets.yml',
        'private.key',
        'id_rsa',
      ];

      for (const sensitive of sensitiveFiles) {
        const filePath = path.join(targetPath, sensitive);
        try {
          const stats = await fsPromises.stat(filePath);
          const mode = stats.mode & 0o777;

          // Check if file is world-readable
          if (mode & 0o044) {
            findings.push({
              id: `perm-world-readable-${sensitive.replace(/\W/g, '-')}`,
              title: 'Sensitive File World-Readable',
              severity: 'high',
              category: 'permissions',
              description: `${sensitive} is readable by others (mode: ${mode.toString(8)})`,
              file: filePath,
              recommendation: 'Set permissions to 600 or more restrictive',
            });
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      // Check for .git exposure
      const gitPath = path.join(targetPath, '.git');
      try {
        await fsPromises.access(gitPath);
        // This is normal for dev, but flagged as info
        findings.push({
          id: 'git-directory-present',
          title: '.git Directory Present',
          severity: 'info',
          category: 'permissions',
          description: '.git directory found - ensure not exposed in production',
          file: gitPath,
          recommendation: 'Ensure .git is not accessible via web server',
        });
      } catch {
        // .git doesn't exist, skip
      }

      return this.buildResult(findings, sensitiveFiles.length, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Analyze network security
   */
  async analyzeNetworkSecurity(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const findings: SecurityFinding[] = [];

      for (const file of files) {
        const fileFindings = await this.scanFileWithPatterns(file, NETWORK_PATTERNS);
        findings.push(...fileFindings);
      }

      return this.buildResult(findings, files.length, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check for injection vulnerabilities
   */
  async checkInjectionVulns(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const findings: SecurityFinding[] = [];

      for (const file of files) {
        const fileFindings = await this.scanFileWithPatterns(file, INJECTION_PATTERNS);
        findings.push(...fileFindings);
      }

      return this.buildResult(findings, files.length, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check for XSS vulnerabilities
   */
  async checkXSSVulns(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const findings: SecurityFinding[] = [];

      for (const file of files) {
        const fileFindings = await this.scanFileWithPatterns(file, XSS_PATTERNS);
        findings.push(...fileFindings);
      }

      return this.buildResult(findings, files.length, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Review authentication flow
   */
  async reviewAuthFlow(targetPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now();

    try {
      const files = await this.getFilesToScan(targetPath);
      const findings: SecurityFinding[] = [];

      for (const file of files) {
        const fileFindings = await this.scanFileWithPatterns(file, AUTH_PATTERNS);
        findings.push(...fileFindings);
      }

      return this.buildResult(findings, files.length, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate security report
   */
  async generateReport(format: 'text' | 'json' | 'sarif' | 'markdown'): Promise<SecurityScanResult> {
    if (!this.lastScanResult) {
      return {
        success: false,
        error: 'No scan results available. Run a scan first.',
      };
    }

    const result = this.lastScanResult;

    switch (format) {
      case 'json':
        return {
          success: true,
          output: JSON.stringify(result.data, null, 2),
        };

      case 'sarif':
        return {
          success: true,
          output: formatAsSarif(result),
        };

      case 'markdown':
        return {
          success: true,
          output: formatAsMarkdown(result),
        };

      case 'text':
      default:
        return {
          success: true,
          output: formatAsText(result),
        };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async getFilesToScan(targetPath: string): Promise<string[]> {
    const resolvedPath = path.resolve(targetPath);

    // Check if target is a file
    try {
      const stats = await fsPromises.stat(resolvedPath);
      if (stats.isFile()) {
        return [resolvedPath];
      }
    } catch {
      // Path doesn't exist, proceed with glob
    }

    // Get files matching include patterns
    const files: string[] = [];

    for (const pattern of this.config.includePatterns) {
      const matches = await fg(pattern, {
        cwd: resolvedPath,
        ignore: this.config.excludePatterns,
        onlyFiles: true,
        absolute: true,
      });
      files.push(...matches);
    }

    // Dedupe and limit
    const uniqueFiles = [...new Set(files)].slice(0, this.config.maxFiles);
    return uniqueFiles;
  }

  private async scanFile(filePath: string): Promise<SecurityFinding[]> {
    return this.scanFileWithPatterns(filePath, ALL_PATTERNS);
  }

  private async scanFileWithPatterns(filePath: string, patterns: SecurityPattern[]): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const stats = await fsPromises.stat(filePath);
      if (stats.size > this.config.maxFileSize) {
        return findings;
      }

      const content = await fsPromises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const ext = path.extname(filePath).toLowerCase();

      for (const pattern of patterns) {
        // Check file type filter
        if (pattern.fileTypes && !pattern.fileTypes.includes(ext)) {
          continue;
        }

        // Reset regex lastIndex
        pattern.pattern.lastIndex = 0;

        let match;
        while ((match = pattern.pattern.exec(content)) !== null) {
          // Find line number
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;
          const line = lines[lineNumber - 1] || '';

          findings.push({
            id: `${pattern.id}-${filePath}-${lineNumber}`,
            title: pattern.title,
            severity: pattern.severity,
            category: pattern.category,
            description: pattern.description,
            file: filePath,
            line: lineNumber,
            code: line.trim().substring(0, 100),
            recommendation: pattern.recommendation,
            cwe: pattern.cwe,
            owasp: pattern.owasp,
          });

          // Prevent infinite loops
          if (pattern.pattern.lastIndex === match.index) {
            pattern.pattern.lastIndex++;
          }
        }
      }
    } catch {
      // Ignore file read errors
    }

    return findings;
  }

  private buildResult(findings: SecurityFinding[], filesScanned: number, startTime: number): SecurityScanResult {
    const summary = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
      total: findings.length,
    };

    // Filter by severity threshold
    const severityOrder: SecuritySeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const thresholdIndex = severityOrder.indexOf(this.config.severityThreshold);
    const filteredFindings = findings.filter(f =>
      severityOrder.indexOf(f.severity) <= thresholdIndex
    );

    // Generate recommendations
    const recommendations = generateRecommendations(findings);

    return {
      success: true,
      data: {
        findings: filteredFindings,
        summary,
        scanDuration: Date.now() - startTime,
        filesScanned,
      },
      summary,
      findings: filteredFindings,
      recommendations,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let agentInstance: SecurityReviewAgent | null = null;

export function getSecurityReviewAgent(config?: Partial<SecurityReviewConfig>): SecurityReviewAgent {
  if (!agentInstance) {
    agentInstance = new SecurityReviewAgent(config);
  }
  return agentInstance;
}

export function resetSecurityReviewAgent(): void {
  agentInstance = null;
}
