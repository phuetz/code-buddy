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
import { checkSecretFileAccess, formatSecretRefusal } from './secret-files.js';
import { SECRET_PATTERNS, type SecretType, type SecretPattern } from './secret-patterns.js';

// Re-exported for API stability (consumers + the runtime scrubber import these).
export { SECRET_PATTERNS };
export type { SecretType, SecretPattern };

// ============================================================================
// Types
// ============================================================================

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
  if (shouldSkipFile(filePath) || checkSecretFileAccess(filePath, 'read').secret) return [];

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
    if (line === undefined) continue;

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

    if (checkSecretFileAccess(fullPath, 'read').secret) continue;

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
  if (checkSecretFileAccess(resolvedPath, 'read').secret) return [];
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
    const verdict = checkSecretFileAccess(args.path, 'read');
    if (verdict.secret) return { success: false, error: formatSecretRefusal(args.path, verdict) };
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
