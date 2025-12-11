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
import * as path from 'path';
import fg from 'fast-glob';

// ============================================================================
// Types
// ============================================================================

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityFinding {
  id: string;
  title: string;
  severity: SecuritySeverity;
  category: string;
  description: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  recommendation?: string;
  cwe?: string;
  owasp?: string;
  references?: string[];
}

export interface SecurityScanResult {
  success: boolean;
  error?: string;
  output?: string;
  data?: {
    findings: SecurityFinding[];
    summary: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
      total: number;
    };
    scanDuration: number;
    filesScanned: number;
  };
  summary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  findings?: SecurityFinding[];
  recommendations?: string[];
}

export interface SecurityReviewConfig {
  /** Maximum files to scan */
  maxFiles: number;
  /** File size limit in bytes */
  maxFileSize: number;
  /** Exclude patterns */
  excludePatterns: string[];
  /** Include patterns */
  includePatterns: string[];
  /** Enable experimental checks */
  experimental: boolean;
  /** Severity threshold for reporting */
  severityThreshold: SecuritySeverity;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SecurityReviewConfig = {
  maxFiles: 1000,
  maxFileSize: 1024 * 1024, // 1MB
  excludePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.bundle.js',
  ],
  includePatterns: [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.rb',
    '**/*.go',
    '**/*.java',
    '**/*.php',
    '**/*.sql',
    '**/*.html',
    '**/*.yml',
    '**/*.yaml',
    '**/*.json',
    '**/*.env*',
    '**/Dockerfile*',
  ],
  experimental: false,
  severityThreshold: 'info',
};

// ============================================================================
// Security Patterns
// ============================================================================

interface SecurityPattern {
  id: string;
  title: string;
  pattern: RegExp;
  severity: SecuritySeverity;
  category: string;
  description: string;
  recommendation: string;
  cwe?: string;
  owasp?: string;
  fileTypes?: string[];
}

const SECRET_PATTERNS: SecurityPattern[] = [
  {
    id: 'hardcoded-api-key',
    title: 'Hardcoded API Key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`]([a-zA-Z0-9_-]{20,})['"`]/gi,
    severity: 'critical',
    category: 'secrets',
    description: 'API key hardcoded in source code',
    recommendation: 'Use environment variables or a secrets manager',
    cwe: 'CWE-798',
    owasp: 'A3:2017',
  },
  {
    id: 'hardcoded-password',
    title: 'Hardcoded Password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"`]([^'"`]{6,})['"`]/gi,
    severity: 'critical',
    category: 'secrets',
    description: 'Password hardcoded in source code',
    recommendation: 'Use environment variables or a secrets manager',
    cwe: 'CWE-798',
    owasp: 'A3:2017',
  },
  {
    id: 'aws-access-key',
    title: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
    category: 'secrets',
    description: 'AWS Access Key ID found in code',
    recommendation: 'Use IAM roles or AWS Secrets Manager',
    cwe: 'CWE-798',
  },
  {
    id: 'aws-secret-key',
    title: 'AWS Secret Key',
    pattern: /(?:aws)?[_-]?(?:secret)?[_-]?(?:access)?[_-]?key\s*[:=]\s*['"`]([A-Za-z0-9/+=]{40})['"`]/gi,
    severity: 'critical',
    category: 'secrets',
    description: 'AWS Secret Access Key found in code',
    recommendation: 'Use IAM roles or AWS Secrets Manager',
    cwe: 'CWE-798',
  },
  {
    id: 'github-token',
    title: 'GitHub Token',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    severity: 'critical',
    category: 'secrets',
    description: 'GitHub Personal Access Token found',
    recommendation: 'Use GitHub Actions secrets or environment variables',
    cwe: 'CWE-798',
  },
  {
    id: 'private-key',
    title: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'critical',
    category: 'secrets',
    description: 'Private key found in source code',
    recommendation: 'Store private keys in a secure key management system',
    cwe: 'CWE-321',
  },
  {
    id: 'jwt-secret',
    title: 'JWT Secret',
    pattern: /(?:jwt[_-]?secret|secret[_-]?key)\s*[:=]\s*['"`]([^'"`]{16,})['"`]/gi,
    severity: 'high',
    category: 'secrets',
    description: 'JWT secret hardcoded in code',
    recommendation: 'Use environment variables for JWT secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'database-connection',
    title: 'Database Connection String',
    pattern: /(?:mongodb|mysql|postgres|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
    severity: 'high',
    category: 'secrets',
    description: 'Database connection string with credentials',
    recommendation: 'Use environment variables for database credentials',
    cwe: 'CWE-798',
  },
];

const INJECTION_PATTERNS: SecurityPattern[] = [
  {
    id: 'sql-injection',
    title: 'Potential SQL Injection',
    pattern: /(?:query|execute|exec)\s*\(\s*[`'"].*\$\{.*\}.*[`'"]\s*\)/gi,
    severity: 'high',
    category: 'injection',
    description: 'String interpolation in SQL query',
    recommendation: 'Use parameterized queries or prepared statements',
    cwe: 'CWE-89',
    owasp: 'A1:2017',
    fileTypes: ['.ts', '.js', '.py', '.php', '.java'],
  },
  {
    id: 'sql-injection-concat',
    title: 'SQL Injection via Concatenation',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\+\s*(?:req\.|request\.|params\.|body\.)/gi,
    severity: 'high',
    category: 'injection',
    description: 'SQL query built with string concatenation',
    recommendation: 'Use parameterized queries',
    cwe: 'CWE-89',
    owasp: 'A1:2017',
  },
  {
    id: 'command-injection',
    title: 'Potential Command Injection',
    pattern: /(?:exec|spawn|system|popen)\s*\([^)]*\$\{.*\}[^)]*\)/gi,
    severity: 'critical',
    category: 'injection',
    description: 'User input in shell command',
    recommendation: 'Validate and sanitize input, use safe APIs',
    cwe: 'CWE-78',
    owasp: 'A1:2017',
  },
  {
    id: 'eval-injection',
    title: 'Dangerous eval() Usage',
    pattern: /eval\s*\(\s*(?:req\.|request\.|params\.|body\.|user)/gi,
    severity: 'critical',
    category: 'injection',
    description: 'User input passed to eval()',
    recommendation: 'Never use eval() with user input',
    cwe: 'CWE-94',
    owasp: 'A1:2017',
  },
  {
    id: 'xpath-injection',
    title: 'Potential XPath Injection',
    pattern: /xpath\s*\([^)]*\$\{.*\}[^)]*\)/gi,
    severity: 'high',
    category: 'injection',
    description: 'User input in XPath query',
    recommendation: 'Use parameterized XPath queries',
    cwe: 'CWE-643',
  },
  {
    id: 'ldap-injection',
    title: 'Potential LDAP Injection',
    pattern: /(?:ldap|search)\s*\([^)]*\$\{.*\}[^)]*\)/gi,
    severity: 'high',
    category: 'injection',
    description: 'User input in LDAP query',
    recommendation: 'Sanitize LDAP special characters',
    cwe: 'CWE-90',
  },
];

const XSS_PATTERNS: SecurityPattern[] = [
  {
    id: 'xss-innerhtml',
    title: 'Potential XSS via innerHTML',
    pattern: /\.innerHTML\s*=\s*(?:req\.|request\.|params\.|body\.|user)/gi,
    severity: 'high',
    category: 'xss',
    description: 'User input assigned to innerHTML',
    recommendation: 'Use textContent or sanitize HTML',
    cwe: 'CWE-79',
    owasp: 'A7:2017',
    fileTypes: ['.ts', '.tsx', '.js', '.jsx', '.html'],
  },
  {
    id: 'xss-document-write',
    title: 'Potential XSS via document.write',
    pattern: /document\.write\s*\([^)]*(?:req\.|request\.|params\.|body\.|user)/gi,
    severity: 'high',
    category: 'xss',
    description: 'User input in document.write()',
    recommendation: 'Avoid document.write(), use DOM methods',
    cwe: 'CWE-79',
    owasp: 'A7:2017',
  },
  {
    id: 'xss-dangerously-set',
    title: 'React dangerouslySetInnerHTML',
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*(?:req\.|request\.|params\.|body\.|user|props\.)/gi,
    severity: 'high',
    category: 'xss',
    description: 'User input in dangerouslySetInnerHTML',
    recommendation: 'Sanitize HTML with DOMPurify before use',
    cwe: 'CWE-79',
    owasp: 'A7:2017',
    fileTypes: ['.tsx', '.jsx'],
  },
  {
    id: 'xss-href-javascript',
    title: 'JavaScript Protocol in href',
    pattern: /href\s*=\s*[`'"]javascript:/gi,
    severity: 'medium',
    category: 'xss',
    description: 'JavaScript protocol in href attribute',
    recommendation: 'Validate URL protocols',
    cwe: 'CWE-79',
  },
];

const AUTH_PATTERNS: SecurityPattern[] = [
  {
    id: 'weak-password-hash',
    title: 'Weak Password Hashing',
    pattern: /(?:md5|sha1)\s*\(\s*(?:password|passwd|pwd)/gi,
    severity: 'high',
    category: 'authentication',
    description: 'Using weak hash algorithm for passwords',
    recommendation: 'Use bcrypt, scrypt, or Argon2 for password hashing',
    cwe: 'CWE-328',
    owasp: 'A3:2017',
  },
  {
    id: 'hardcoded-jwt-secret',
    title: 'Hardcoded JWT Secret',
    pattern: /jwt\.sign\s*\([^)]+,\s*['"`][^'"`]{8,}['"`]/gi,
    severity: 'high',
    category: 'authentication',
    description: 'JWT signed with hardcoded secret',
    recommendation: 'Use environment variable for JWT secret',
    cwe: 'CWE-798',
  },
  {
    id: 'session-no-httponly',
    title: 'Session Cookie Without HttpOnly',
    pattern: /(?:session|cookie).*httpOnly\s*:\s*false/gi,
    severity: 'medium',
    category: 'authentication',
    description: 'Session cookie without HttpOnly flag',
    recommendation: 'Set HttpOnly: true for session cookies',
    cwe: 'CWE-1004',
  },
  {
    id: 'session-no-secure',
    title: 'Session Cookie Without Secure Flag',
    pattern: /(?:session|cookie).*secure\s*:\s*false/gi,
    severity: 'medium',
    category: 'authentication',
    description: 'Session cookie without Secure flag',
    recommendation: 'Set Secure: true for session cookies in production',
    cwe: 'CWE-614',
  },
];

const NETWORK_PATTERNS: SecurityPattern[] = [
  {
    id: 'http-insecure',
    title: 'Insecure HTTP Connection',
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/gi,
    severity: 'medium',
    category: 'network',
    description: 'Using HTTP instead of HTTPS',
    recommendation: 'Use HTTPS for all connections',
    cwe: 'CWE-319',
  },
  {
    id: 'ssl-verify-disabled',
    title: 'SSL Verification Disabled',
    pattern: /(?:rejectUnauthorized|verify_ssl|ssl_verify)\s*[:=]\s*false/gi,
    severity: 'high',
    category: 'network',
    description: 'SSL certificate verification disabled',
    recommendation: 'Enable SSL verification in production',
    cwe: 'CWE-295',
  },
  {
    id: 'cors-allow-all',
    title: 'CORS Allow All Origins',
    pattern: /(?:Access-Control-Allow-Origin|cors)\s*[:=]?\s*['"]\*['"]/gi,
    severity: 'medium',
    category: 'network',
    description: 'CORS allows all origins',
    recommendation: 'Restrict CORS to trusted origins',
    cwe: 'CWE-942',
  },
];

const ALL_PATTERNS = [
  ...SECRET_PATTERNS,
  ...INJECTION_PATTERNS,
  ...XSS_PATTERNS,
  ...AUTH_PATTERNS,
  ...NETWORK_PATTERNS,
];

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
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

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
      }

      // Check requirements.txt for Python
      const requirementsPath = path.join(targetPath, 'requirements.txt');
      if (fs.existsSync(requirementsPath)) {
        const requirements = fs.readFileSync(requirementsPath, 'utf-8');
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
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
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
        }
      }

      // Check for .git exposure
      const gitPath = path.join(targetPath, '.git');
      if (fs.existsSync(gitPath)) {
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
          output: this.toSarif(result),
        };

      case 'markdown':
        return {
          success: true,
          output: this.toMarkdown(result),
        };

      case 'text':
      default:
        return {
          success: true,
          output: this.toText(result),
        };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async getFilesToScan(targetPath: string): Promise<string[]> {
    const resolvedPath = path.resolve(targetPath);

    // Check if target is a file
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      return [resolvedPath];
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
      const stats = fs.statSync(filePath);
      if (stats.size > this.config.maxFileSize) {
        return findings;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
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
    const recommendations = this.generateRecommendations(findings);

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

  private generateRecommendations(findings: SecurityFinding[]): string[] {
    const recs: string[] = [];
    const categories = new Set(findings.map(f => f.category));

    if (categories.has('secrets')) {
      recs.push('Use a secrets manager (AWS Secrets Manager, HashiCorp Vault) for credentials');
      recs.push('Implement pre-commit hooks to prevent secrets from being committed');
    }

    if (categories.has('injection')) {
      recs.push('Use parameterized queries for all database operations');
      recs.push('Implement input validation and sanitization');
    }

    if (categories.has('xss')) {
      recs.push('Use a Content Security Policy (CSP) header');
      recs.push('Sanitize HTML with DOMPurify before rendering');
    }

    if (categories.has('authentication')) {
      recs.push('Use bcrypt or Argon2 for password hashing');
      recs.push('Implement proper session management with secure cookies');
    }

    if (categories.has('network')) {
      recs.push('Use HTTPS for all connections');
      recs.push('Implement proper CORS configuration');
    }

    return recs;
  }

  private toText(result: SecurityScanResult): string {
    const lines: string[] = [
      '='.repeat(60),
      'SECURITY SCAN REPORT',
      '='.repeat(60),
      '',
      `Scan Duration: ${result.data?.scanDuration || 0}ms`,
      `Files Scanned: ${result.data?.filesScanned || 0}`,
      '',
      'SUMMARY',
      '-'.repeat(30),
      `Critical: ${result.summary?.critical || 0}`,
      `High: ${result.summary?.high || 0}`,
      `Medium: ${result.summary?.medium || 0}`,
      `Low: ${result.summary?.low || 0}`,
      `Info: ${result.summary?.info || 0}`,
      `Total: ${result.summary?.total || 0}`,
      '',
    ];

    if (result.findings && result.findings.length > 0) {
      lines.push('FINDINGS', '-'.repeat(30));
      for (const finding of result.findings) {
        lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
        if (finding.file) {
          lines.push(`  File: ${finding.file}:${finding.line || ''}`);
        }
        lines.push(`  ${finding.description}`);
        if (finding.recommendation) {
          lines.push(`  Fix: ${finding.recommendation}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private toMarkdown(result: SecurityScanResult): string {
    const lines: string[] = [
      '# Security Scan Report',
      '',
      '## Summary',
      '',
      '| Severity | Count |',
      '|----------|-------|',
      `| Critical | ${result.summary?.critical || 0} |`,
      `| High | ${result.summary?.high || 0} |`,
      `| Medium | ${result.summary?.medium || 0} |`,
      `| Low | ${result.summary?.low || 0} |`,
      `| Info | ${result.summary?.info || 0} |`,
      '',
      `**Total Findings:** ${result.summary?.total || 0}`,
      '',
    ];

    if (result.findings && result.findings.length > 0) {
      lines.push('## Findings', '');
      for (const finding of result.findings) {
        lines.push(`### ${finding.title}`);
        lines.push('');
        lines.push(`**Severity:** ${finding.severity}`);
        if (finding.file) {
          lines.push(`**Location:** \`${finding.file}:${finding.line || ''}\``);
        }
        lines.push('');
        lines.push(finding.description);
        if (finding.recommendation) {
          lines.push('');
          lines.push(`**Recommendation:** ${finding.recommendation}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private toSarif(result: SecurityScanResult): string {
    const sarif = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [{
        tool: {
          driver: {
            name: 'Grok Security Review',
            version: '1.0.0',
            informationUri: 'https://github.com/grok-cli',
            rules: ALL_PATTERNS.map(p => ({
              id: p.id,
              name: p.title,
              shortDescription: { text: p.description },
              help: { text: p.recommendation },
              defaultConfiguration: {
                level: p.severity === 'critical' || p.severity === 'high' ? 'error' : 'warning',
              },
            })),
          },
        },
        results: (result.findings || []).map(f => ({
          ruleId: f.id.split('-').slice(0, -2).join('-'),
          level: f.severity === 'critical' || f.severity === 'high' ? 'error' : 'warning',
          message: { text: f.description },
          locations: f.file ? [{
            physicalLocation: {
              artifactLocation: { uri: f.file },
              region: { startLine: f.line || 1 },
            },
          }] : [],
        })),
      }],
    };

    return JSON.stringify(sarif, null, 2);
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
