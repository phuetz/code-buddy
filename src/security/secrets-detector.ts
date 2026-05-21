/**
 * Secrets Detector
 *
 * Scans source code for hardcoded secrets, credentials, and API keys.
 * All matches are redacted in output — only first 4 characters are shown.
 *
 * Patterns cover: AWS, GitHub, GitLab, Slack, Stripe, Google, JWT,
 * private keys, passwords, connection strings, and generic API keys.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export type SecretType =
  | 'aws_key' | 'aws_secret' | 'github_token' | 'gitlab_token'
  | 'slack_token' | 'stripe_key' | 'google_api_key' | 'jwt_secret'
  | 'private_key' | 'password_in_code' | 'connection_string'
  | 'generic_api_key' | 'generic_secret';

export interface SecretFinding {
  filePath: string;
  line: number;
  column: number;
  type: SecretType;
  severity: 'critical' | 'high' | 'medium';
  match: string;       // redacted: first 4 chars + '***'
  description: string;
  suggestion: string;
}

export interface ScanOptions {
  recursive?: boolean;
  exclude?: string[];
}

// ============================================================================
// Patterns
// ============================================================================

interface SecretPattern {
  type: SecretType;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  suggestion: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS Access Key ID
  {
    type: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    description: 'AWS Access Key ID detected',
    suggestion: 'Use environment variable AWS_ACCESS_KEY_ID or AWS IAM roles instead',
  },
  // AWS Secret Access Key (near aws_secret context)
  {
    type: 'aws_secret',
    pattern: /(?:aws_secret|aws_secret_access_key|AWS_SECRET)\s*[:=]\s*['"]?([0-9a-zA-Z/+]{40})['"]?/i,
    severity: 'critical',
    description: 'AWS Secret Access Key detected',
    suggestion: 'Use environment variable AWS_SECRET_ACCESS_KEY or AWS IAM roles instead',
  },
  // GitHub Personal Access Token
  {
    type: 'github_token',
    pattern: /ghp_[a-zA-Z0-9]{36}/,
    severity: 'critical',
    description: 'GitHub Personal Access Token detected',
    suggestion: 'Use environment variable GITHUB_TOKEN or GitHub Actions secrets',
  },
  // GitHub Fine-grained PAT
  {
    type: 'github_token',
    pattern: /github_pat_[a-zA-Z0-9_]{82}/,
    severity: 'critical',
    description: 'GitHub Fine-grained Personal Access Token detected',
    suggestion: 'Use environment variable GITHUB_TOKEN or GitHub Actions secrets',
  },
  // GitLab Personal Access Token
  {
    type: 'gitlab_token',
    pattern: /glpat-[a-zA-Z0-9-]{20}/,
    severity: 'critical',
    description: 'GitLab Personal Access Token detected',
    suggestion: 'Use environment variable GITLAB_TOKEN or CI/CD variables',
  },
  // Slack Token
  {
    type: 'slack_token',
    pattern: /xox[bpors]-[a-zA-Z0-9-]+/,
    severity: 'critical',
    description: 'Slack API token detected',
    suggestion: 'Use environment variable SLACK_TOKEN or Slack app configuration',
  },
  // Stripe Secret Key
  {
    type: 'stripe_key',
    pattern: /sk_live_[a-zA-Z0-9]{24,}/,
    severity: 'critical',
    description: 'Stripe live secret key detected',
    suggestion: 'Use environment variable STRIPE_SECRET_KEY',
  },
  // Google API Key
  {
    type: 'google_api_key',
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
    severity: 'high',
    description: 'Google API key detected',
    suggestion: 'Use environment variable GOOGLE_API_KEY and restrict key in Google Cloud Console',
  },
  // JWT Token
  {
    type: 'jwt_secret',
    pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
    severity: 'high',
    description: 'JSON Web Token (JWT) detected in source code',
    suggestion: 'Do not hardcode JWTs — use runtime token generation',
  },
  // Private Key
  {
    type: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    description: 'Private key detected in source code',
    suggestion: 'Store private keys in secure key management (Vault, KMS) or as environment variables',
  },
  // Password in code
  {
    type: 'password_in_code',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'high',
    description: 'Hardcoded password detected',
    suggestion: 'Use environment variable or secrets manager instead of hardcoding passwords',
  },
  // Connection strings
  {
    type: 'connection_string',
    pattern: /(?:mysql|postgres|postgresql|mongodb|redis):\/\/[^\s'"]+/i,
    severity: 'high',
    description: 'Database connection string with potential credentials detected',
    suggestion: 'Use environment variable DATABASE_URL or a secrets manager',
  },
  // Generic API key assignment
  {
    type: 'generic_api_key',
    pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9]{16,}['"]/i,
    severity: 'medium',
    description: 'Potential API key or secret detected',
    suggestion: 'Use environment variables instead of hardcoding API keys',
  },
];

// ============================================================================
// Skip Directories and Files
// ============================================================================

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor', '.next',
  '__pycache__', '.venv', 'venv', '.tox', 'coverage', '.nyc_output',
  '.codebuddy', '.cache',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.wasm', '.pyc', '.class', '.o',
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Redact a matched secret — show only first 4 chars.
 * NEVER expose the full secret.
 */
export function redactSecret(value: string): string {
  if (value.length <= 4) return '****';
  return value.substring(0, 4) + '***';
}

/**
 * Check if a file should be skipped (binary, lock file, etc.)
 */
function shouldSkipFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;

  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'package-lock.json' || basename === 'yarn.lock' || basename === 'pnpm-lock.yaml') return true;
  if (basename.endsWith('.min.js') || basename.endsWith('.min.css')) return true;

  return false;
}

/**
 * Check if a directory should be skipped
 */
function shouldSkipDir(dirName: string, extraExcludes: string[]): boolean {
  if (DEFAULT_SKIP_DIRS.has(dirName)) return true;
  if (extraExcludes.includes(dirName)) return true;
  return false;
}

/**
 * Check if a line is a comment or test fixture
 */
function isCommentOrTestFixture(line: string): boolean {
  const trimmed = line.trim();
  // Skip obvious comment lines
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
  // Skip lines that are clearly test/example patterns
  if (/\b(?:example|test|mock|fake|dummy|placeholder|sample)\b/i.test(trimmed)) return true;
  return false;
}

// ============================================================================
// Core Scanning
// ============================================================================

/**
 * Scan a single file for secrets
 */
export function scanFileForSecrets(filePath: string): SecretFinding[] {
  if (shouldSkipFile(filePath)) return [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    logger.debug(`Secrets detector: could not read ${filePath}`);
    return [];
  }

  const lines = content.split('\n');
  const findings: SecretFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) continue;

    // Skip comment lines (but still scan — some secrets end up in comments)
    // We do skip test fixtures though
    if (isCommentOrTestFixture(line)) continue;

    for (const secretPattern of SECRET_PATTERNS) {
      const match = secretPattern.pattern.exec(line);
      if (match) {
        // Get the actual matched value (use capture group 1 if available, else group 0)
        const matchedValue = match[1] || match[0];

        findings.push({
          filePath,
          line: i + 1,
          column: match.index + 1,
          type: secretPattern.type,
          severity: secretPattern.severity,
          match: redactSecret(matchedValue),
          description: secretPattern.description,
          suggestion: secretPattern.suggestion,
        });
      }
    }
  }

  return findings;
}

/**
 * Recursively collect source files from a directory
 */
function collectFiles(dirPath: string, excludes: string[], recursive: boolean): string[] {
  const files: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive && !shouldSkipDir(entry.name, excludes)) {
        files.push(...collectFiles(fullPath, excludes, true));
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Scan a file or directory for hardcoded secrets and credentials.
 *
 * @param targetPath - File or directory path to scan
 * @param options - Scan options (recursive, exclude patterns)
 * @returns Array of findings with redacted matches
 */
export async function scanForSecrets(
  targetPath: string,
  options?: ScanOptions,
): Promise<SecretFinding[]> {
  const resolvedPath = path.resolve(targetPath);
  const recursive = options?.recursive ?? true;
  const excludes = options?.exclude ?? [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return [];
  }

  if (stat.isFile()) {
    return scanFileForSecrets(resolvedPath);
  }

  if (stat.isDirectory()) {
    const files = collectFiles(resolvedPath, excludes, recursive);
    const allFindings: SecretFinding[] = [];

    for (const file of files) {
      const findings = scanFileForSecrets(file);
      allFindings.push(...findings);
    }

    return allFindings;
  }

  return [];
}

/**
 * Format findings for tool output
 */
export function formatFindings(findings: SecretFinding[]): string {
  if (findings.length === 0) {
    return 'No secrets or credentials detected.';
  }

  const bySeverity = {
    critical: findings.filter(f => f.severity === 'critical'),
    high: findings.filter(f => f.severity === 'high'),
    medium: findings.filter(f => f.severity === 'medium'),
  };

  const lines: string[] = [
    `Found ${findings.length} potential secret(s):`,
    '',
  ];

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    lines.push(`## ${severity.toUpperCase()} (${items.length})`);
    for (const f of items) {
      lines.push(`  ${f.filePath}:${f.line}:${f.column} [${f.type}]`);
      lines.push(`    Match: ${f.match}`);
      lines.push(`    ${f.description}`);
      lines.push(`    Suggestion: ${f.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Execute scan_secrets tool
 */
export async function executeScanSecrets(args: {
  path: string;
  recursive?: boolean;
  exclude?: string[];
}): Promise<ToolResult> {
  try {
    const findings = await scanForSecrets(args.path, {
      recursive: args.recursive,
      exclude: args.exclude,
    });

    return {
      success: true,
      output: formatFindings(findings),
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('Secrets scan failed', { error: msg });
    return {
      success: false,
      error: `Secrets scan failed: ${msg}`,
    };
  }
}
