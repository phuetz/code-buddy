import { resolveToolPath } from '../utils/tool-execution-context.js';
/**
 * Bug Finder Tool
 *
 * Regex-based static analysis tool that detects common bug patterns
 * across multiple languages (TypeScript, JavaScript, Python, Go, Rust, Java).
 *
 * This is a v1 implementation — no AST parsing, purely pattern-based.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { checkSecretFileAccess } from '../security/secret-files.js';
import type { ToolResult } from '../types/index.js';

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low';
export type BugCategory =
  | 'null-access'
  | 'unchecked-error'
  | 'resource-leak'
  | 'race-condition'
  | 'security'
  | 'dead-code'
  | 'type-error'
  | 'logic-error';

export interface BugReport {
  file: string;
  line: number;
  severity: BugSeverity;
  category: BugCategory;
  message: string;
  suggestion: string;
}

interface BugPattern {
  pattern: RegExp;
  severity: BugSeverity;
  category: BugCategory;
  message: string;
  suggestion: string;
  /** Languages this pattern applies to (empty = all) */
  languages: string[];
}

/**
 * Language detection based on file extension
 */
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
  };
  return langMap[ext] || 'unknown';
}

/**
 * Bug patterns for regex-based detection
 */
const BUG_PATTERNS: BugPattern[] = [
  // === Null/Undefined Access ===
  {
    pattern: /(?:let|var)\s+\w+\s*;\s*$/,
    severity: 'low',
    category: 'null-access',
    message: 'Variable declared without initialization — will be undefined',
    suggestion: 'Initialize with a default value or use const with assignment',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /(\w+)\s*==\s*null\b/,
    severity: 'low',
    category: 'null-access',
    message: 'Loose equality null check (== null) — also matches undefined',
    suggestion: 'Use strict equality (=== null) or (=== undefined) for clarity',
    languages: ['typescript', 'javascript'],
  },

  // === Unchecked Error Returns ===
  {
    pattern: /await\s+\w+\([^)]*\)\s*;?\s*$/,
    severity: 'medium',
    category: 'unchecked-error',
    message: 'Async call without try/catch or .catch() — errors may be unhandled',
    suggestion: 'Wrap in try/catch or chain .catch() to handle rejections',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /\.then\(\s*(?:\([^)]*\)|[^,)]+)\s*\)\s*(?!\.catch)/,
    severity: 'medium',
    category: 'unchecked-error',
    message: 'Promise .then() without .catch() — rejections may be silently swallowed',
    suggestion: 'Add .catch() handler or use async/await with try/catch',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /if\s+err\s*!=\s*nil\s*\{\s*$/,
    severity: 'low',
    category: 'unchecked-error',
    message: 'Go error check found — ensure error is handled (not just checked)',
    suggestion: 'Return or log the error, do not ignore it inside the block',
    languages: ['go'],
  },
  {
    pattern: /,\s*_\s*:?=\s*\w+\(/,
    severity: 'high',
    category: 'unchecked-error',
    message: 'Error return value discarded with _ placeholder',
    suggestion: 'Handle the error return value instead of discarding it',
    languages: ['go'],
  },
  {
    pattern: /except\s*:\s*$/,
    severity: 'high',
    category: 'unchecked-error',
    message: 'Bare except clause catches all exceptions including SystemExit and KeyboardInterrupt',
    suggestion: 'Specify exception types: except (ValueError, TypeError):',
    languages: ['python'],
  },
  {
    pattern: /except\s+Exception\s*(?:as\s+\w+)?\s*:\s*\n\s*pass/,
    severity: 'high',
    category: 'unchecked-error',
    message: 'Exception caught and silently passed — errors will be invisible',
    suggestion: 'At minimum, log the exception: logger.error(e)',
    languages: ['python'],
  },

  // === Resource Leaks ===
  {
    pattern: /(?:createReadStream|createWriteStream|open\()\s*(?!.*\.close|.*\.end|.*\.destroy)/,
    severity: 'high',
    category: 'resource-leak',
    message: 'Stream/file opened without visible close/end/destroy in the same scope',
    suggestion: 'Use try/finally or using/with patterns to ensure cleanup',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /new\s+(?:WebSocket|EventSource)\s*\(/,
    severity: 'medium',
    category: 'resource-leak',
    message: 'WebSocket/EventSource opened — ensure it is closed on cleanup',
    suggestion: 'Close in a finally block, component unmount, or signal handler',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /setInterval\s*\(/,
    severity: 'medium',
    category: 'resource-leak',
    message: 'setInterval without clearInterval — may cause memory leaks',
    suggestion: 'Store the interval ID and clear it when no longer needed',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /open\s*\([^)]+\)\s*$/,
    severity: 'medium',
    category: 'resource-leak',
    message: 'File opened without context manager — may not be closed on error',
    suggestion: 'Use "with open(...) as f:" for automatic cleanup',
    languages: ['python'],
  },

  // === Race Condition Indicators ===
  {
    pattern: /(?:let|var)\s+\w+\s*=.*;\s*(?:.*\n)*?\s*(?:setTimeout|setInterval|addEventListener)/,
    severity: 'medium',
    category: 'race-condition',
    message: 'Mutable variable accessed from async callback — potential race condition',
    suggestion: 'Use const, closures, or synchronization primitives',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /global\s+\w+/,
    severity: 'medium',
    category: 'race-condition',
    message: 'Global variable modification — shared mutable state risk',
    suggestion: 'Pass values as function parameters instead of using globals',
    languages: ['python'],
  },

  // === Security Issues ===
  {
    pattern: /\beval\s*\(/,
    severity: 'critical',
    category: 'security',
    message: 'eval() usage — allows arbitrary code execution',
    suggestion: 'Use JSON.parse(), Function constructor, or safer alternatives',
    languages: ['typescript', 'javascript', 'python'],
  },
  {
    pattern: /\.innerHTML\s*=/,
    severity: 'critical',
    category: 'security',
    message: 'innerHTML assignment — XSS vulnerability if content is user-controlled',
    suggestion: 'Use textContent for text, or sanitize HTML with DOMPurify',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /document\.write\s*\(/,
    severity: 'critical',
    category: 'security',
    message: 'document.write() — can overwrite the entire page and enables XSS',
    suggestion: 'Use DOM manipulation methods (createElement, appendChild)',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b.*\+\s*\w/i,
    severity: 'critical',
    category: 'security',
    message: 'SQL query built with string concatenation — SQL injection risk',
    suggestion: 'Use parameterized queries or an ORM',
    languages: ['typescript', 'javascript', 'python', 'java', 'go'],
  },
  {
    pattern: /\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b/i,
    severity: 'critical',
    category: 'security',
    message: 'SQL query built with string concatenation — SQL injection risk',
    suggestion: 'Use parameterized queries or an ORM',
    languages: ['typescript', 'javascript', 'python', 'java', 'go'],
  },
  {
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b.*\$\{/i,
    severity: 'critical',
    category: 'security',
    message: 'SQL query built with template literal interpolation — SQL injection risk',
    suggestion: 'Use parameterized queries or an ORM',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /`\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
    severity: 'critical',
    category: 'security',
    message: 'SQL query built with template literal interpolation — SQL injection risk',
    suggestion: 'Use parameterized queries or an ORM',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\(\s*[`'"]?\$\{/,
    severity: 'critical',
    category: 'security',
    message: 'Shell command with interpolated variables — command injection risk',
    suggestion: 'Use execFile/spawnSync with array args, or validate/escape input',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /os\.system\s*\(\s*f['"]|subprocess\.(?:call|run|Popen)\s*\(\s*f['"]|subprocess\.(?:call|run|Popen)\s*\(\s*[^[\]]*\+/,
    severity: 'critical',
    category: 'security',
    message: 'Shell command with f-string or concatenation — command injection risk',
    suggestion: 'Use subprocess.run() with a list of args, not shell=True',
    languages: ['python'],
  },
  {
    pattern: /(?:password|secret|token|api_key|apiKey)\s*[:=]\s*['"][^'"]+['"]/,
    severity: 'high',
    category: 'security',
    message: 'Hardcoded credential detected',
    suggestion: 'Use environment variables or a secrets manager',
    languages: [],
  },

  // === Dead Code ===
  {
    pattern: /\breturn\b[^;]*;\s*\n\s*(?!}|\*\/|\/\/|case\b|default\b)\S/,
    severity: 'low',
    category: 'dead-code',
    message: 'Code after return statement — unreachable code',
    suggestion: 'Remove unreachable code or move the return statement',
    languages: ['typescript', 'javascript', 'java'],
  },
  {
    pattern: /\bthrow\b[^;]*;\s*\n\s*(?!}|\*\/|\/\/|catch\b)\S/,
    severity: 'low',
    category: 'dead-code',
    message: 'Code after throw statement — unreachable code',
    suggestion: 'Remove unreachable code or restructure the error handling',
    languages: ['typescript', 'javascript', 'java'],
  },
  {
    pattern: /if\s*\(\s*false\s*\)/,
    severity: 'low',
    category: 'dead-code',
    message: 'Condition is always false — code block is dead code',
    suggestion: 'Remove the dead code block',
    languages: ['typescript', 'javascript', 'java'],
  },
  {
    pattern: /if\s*\(\s*true\s*\)/,
    severity: 'low',
    category: 'dead-code',
    message: 'Condition is always true — if statement is redundant',
    suggestion: 'Remove the if wrapper, keep the body',
    languages: ['typescript', 'javascript', 'java'],
  },

  // === Type Errors ===
  {
    pattern: /as\s+any\b/,
    severity: 'medium',
    category: 'type-error',
    message: '"as any" type assertion — bypasses type safety',
    suggestion: 'Use a proper type or "as unknown as T" with justification',
    languages: ['typescript'],
  },
  {
    pattern: /@ts-ignore\b/,
    severity: 'medium',
    category: 'type-error',
    message: '@ts-ignore suppresses all type errors on the next line',
    suggestion: 'Use @ts-expect-error which fails if the error is fixed',
    languages: ['typescript'],
  },

  // === Logic Errors ===
  {
    pattern: /===?\s*(?:NaN\b)/,
    severity: 'high',
    category: 'logic-error',
    message: 'Comparison with NaN always returns false — NaN !== NaN',
    suggestion: 'Use Number.isNaN(value) instead',
    languages: ['typescript', 'javascript'],
  },
  {
    pattern: /typeof\s+\w+\s*===?\s*['"]undefined['"]/,
    severity: 'low',
    category: 'logic-error',
    message: 'typeof check for undefined — consider using strict equality',
    suggestion: 'Use value === undefined (safe in modern JS) for clarity',
    languages: ['typescript', 'javascript'],
  },

  // === Rust-specific ===
  {
    pattern: /\.unwrap\(\)/,
    severity: 'high',
    category: 'unchecked-error',
    message: '.unwrap() will panic on None/Err — unsafe in production code',
    suggestion: 'Use .unwrap_or(), .unwrap_or_default(), match, or ? operator',
    languages: ['rust'],
  },
  {
    pattern: /unsafe\s*\{/,
    severity: 'high',
    category: 'security',
    message: 'Unsafe block — bypasses Rust safety guarantees',
    suggestion: 'Minimize unsafe scope and document safety invariants',
    languages: ['rust'],
  },

  // === Java-specific ===
  {
    pattern: /catch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*\}/,
    severity: 'high',
    category: 'unchecked-error',
    message: 'Empty catch block — exception silently swallowed',
    suggestion: 'At minimum, log the exception',
    languages: ['java'],
  },
  {
    pattern: /==\s*(?:new\s+\w+|"\w+")/,
    severity: 'medium',
    category: 'logic-error',
    message: 'Object/String comparison with == instead of .equals()',
    suggestion: 'Use .equals() for value comparison in Java',
    languages: ['java'],
  },
];

/**
 * Scan a single file for bug patterns
 */
export function scanFile(filePath: string, severityFilter?: BugSeverity): BugReport[] {
  const language = detectLanguage(filePath);
  if (language === 'unknown') return [];
  if (checkSecretFileAccess(filePath, 'read').secret) return [];

  let content: string;
  try {
    content = fs.readFileSync(resolveToolPath(filePath), 'utf-8');
  } catch (err) {
    logger.debug(`Bug finder: could not read ${filePath}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const lines = content.split('\n');
  const bugs: BugReport[] = [];
  const severityOrder: Record<BugSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  const filterLevel = severityFilter
    ? severityOrder[severityFilter]
    : severityOrder.low;

  for (const bugPattern of BUG_PATTERNS) {
    // Skip patterns not applicable to this language
    if (bugPattern.languages.length > 0 && !bugPattern.languages.includes(language)) {
      continue;
    }

    // Skip if severity is below filter
    if (severityOrder[bugPattern.severity] > filterLevel) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      // Skip comment lines (but allow comment-directive patterns like @ts-ignore)
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
      if (isComment && bugPattern.category !== 'type-error') {
        continue;
      }

      if (bugPattern.pattern.test(line)) {
        bugs.push({
          file: filePath,
          line: i + 1,
          severity: bugPattern.severity,
          category: bugPattern.category,
          message: bugPattern.message,
          suggestion: bugPattern.suggestion,
        });
      }
    }
  }

  // Deduplicate by line + category (multiple patterns may match same line)
  const seen = new Set<string>();
  return bugs.filter(bug => {
    const key = `${bug.file}:${bug.line}:${bug.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Scan a directory recursively for bug patterns
 */
export function scanDirectory(
  dirPath: string,
  severityFilter?: BugSeverity,
  maxFiles: number = 100
): BugReport[] {
  const supportedExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java',
  ]);

  const bugs: BugReport[] = [];
  let filesScanned = 0;

  function walkDir(dir: string): void {
    if (filesScanned >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(resolveToolPath(dir), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (filesScanned >= maxFiles) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip common non-source directories
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', 'target', '.codebuddy'].includes(entry.name)) {
          continue;
        }
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.has(ext)) {
          filesScanned++;
          const fileBugs = scanFile(fullPath, severityFilter);
          bugs.push(...fileBugs);
        }
      }
    }
  }

  walkDir(dirPath);
  return bugs;
}

/**
 * Format bug reports into a readable string
 */
function formatBugReports(bugs: BugReport[]): string {
  if (bugs.length === 0) {
    return 'No potential bugs found.';
  }

  // Sort by severity (critical first), then by file and line
  const severityOrder: Record<BugSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  bugs.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const fileDiff = a.file.localeCompare(b.file);
    if (fileDiff !== 0) return fileDiff;
    return a.line - b.line;
  });

  const lines = [`Found ${bugs.length} potential bug(s):\n`];

  // Group by severity
  const grouped = new Map<BugSeverity, BugReport[]>();
  for (const bug of bugs) {
    const list = grouped.get(bug.severity) || [];
    list.push(bug);
    grouped.set(bug.severity, list);
  }

  for (const severity of ['critical', 'high', 'medium', 'low'] as BugSeverity[]) {
    const group = grouped.get(severity);
    if (!group || group.length === 0) continue;

    const icon = severity === 'critical' ? '[CRITICAL]'
      : severity === 'high' ? '[HIGH]'
      : severity === 'medium' ? '[MEDIUM]'
      : '[LOW]';

    lines.push(`\n--- ${icon} ${severity.toUpperCase()} (${group.length}) ---\n`);

    for (const bug of group) {
      lines.push(`  ${bug.file}:${bug.line}`);
      lines.push(`    [${bug.category}] ${bug.message}`);
      lines.push(`    Fix: ${bug.suggestion}`);
      lines.push('');
    }
  }

  // Summary
  const criticalCount = grouped.get('critical')?.length ?? 0;
  const highCount = grouped.get('high')?.length ?? 0;
  const mediumCount = grouped.get('medium')?.length ?? 0;
  const lowCount = grouped.get('low')?.length ?? 0;

  lines.push(`\nSummary: ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low`);

  return lines.join('\n');
}

/**
 * Execute the bug finder tool
 */
export async function executeFindBugs(args: {
  path: string;
  severity?: 'all' | 'critical' | 'high';
}): Promise<ToolResult> {
  const targetPath = args.path;
  const severityFilter: BugSeverity | undefined =
    args.severity === 'critical' ? 'critical'
    : args.severity === 'high' ? 'high'
    : undefined; // 'all' or undefined = no filter

  try {
    let bugs: BugReport[];

    const stat = fs.statSync(resolveToolPath(targetPath));
    if (stat.isDirectory()) {
      bugs = scanDirectory(targetPath, severityFilter);
    } else if (stat.isFile()) {
      bugs = scanFile(targetPath, severityFilter);
    } else {
      return { success: false, error: `Path is neither a file nor directory: ${targetPath}` };
    }

    const output = formatBugReports(bugs);
    return { success: true, output };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Bug finder error: ${msg}` };
  }
}
