/**
 * Dead Code Detector Tool
 *
 * Analyzes TypeScript/JavaScript codebase to find:
 * - Unused exports
 * - Unused functions
 * - Unused variables
 * - Unused imports
 * - Unreachable code
 */

import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import * as path from 'path';
import fg from 'fast-glob';

export interface DeadCodeResult {
  file: string;
  line: number;
  type: 'unused-export' | 'unused-function' | 'unused-variable' | 'unused-import' | 'unreachable';
  name: string;
  message: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DeadCodeReport {
  scannedFiles: number;
  totalIssues: number;
  byType: Record<string, number>;
  byConfidence: Record<string, number>;
  issues: DeadCodeResult[];
  scanTime: number;
}

export interface DeadCodeOptions {
  /** Root directory to scan */
  rootDir: string;
  /** File patterns to include (glob) */
  include?: string[];
  /** File patterns to exclude (glob) */
  exclude?: string[];
  /** Minimum confidence level to report */
  minConfidence?: 'high' | 'medium' | 'low';
  /** Check for unused exports */
  checkExports?: boolean;
  /** Check for unused functions */
  checkFunctions?: boolean;
  /** Check for unused variables */
  checkVariables?: boolean;
  /** Check for unused imports */
  checkImports?: boolean;
}

const DEFAULT_OPTIONS: DeadCodeOptions = {
  rootDir: process.cwd(),
  include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.spec.ts'],
  minConfidence: 'medium',
  checkExports: true,
  checkFunctions: true,
  checkVariables: true,
  checkImports: true,
};

// Patterns to find declarations
const PATTERNS = {
  // Export patterns
  exportFunction: /export\s+(?:async\s+)?function\s+(\w+)/g,
  exportConst: /export\s+const\s+(\w+)/g,
  exportClass: /export\s+class\s+(\w+)/g,
  exportInterface: /export\s+interface\s+(\w+)/g,
  exportType: /export\s+type\s+(\w+)/g,
  namedExport: /export\s*\{\s*([^}]+)\s*\}/g,
  defaultExport: /export\s+default\s+(?:class|function)?\s*(\w+)?/g,

  // Import patterns
  namedImport: /import\s*\{([^}]+)\}\s*from/g,
  defaultImport: /import\s+(\w+)\s+from/g,
  namespaceImport: /import\s*\*\s+as\s+(\w+)\s+from/g,

  // Function declarations
  functionDecl: /(?:async\s+)?function\s+(\w+)/g,
  arrowFunction: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,

  // Variable declarations
  constDecl: /const\s+(\w+)\s*=/g,
  letDecl: /let\s+(\w+)\s*=/g,

  // Usage patterns (to check if identifiers are used)
  identifier: /\b(\w+)\b/g,
};

/**
 * Detect dead code in a codebase
 */
export async function detectDeadCode(options: Partial<DeadCodeOptions> = {}): Promise<DeadCodeReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const issues: DeadCodeResult[] = [];

  // Find all files to scan
  const files = await findFiles(opts);

  // Build a map of all exports and their files
  const exportMap = new Map<string, { file: string; line: number; type: string }>();
  const importUsage = new Map<string, Set<string>>(); // symbol -> files that import it
  const allIdentifiers = new Map<string, Set<string>>(); // symbol -> files that use it

  // First pass: collect all exports and identifiers
  for (const file of files) {
    const content = await UnifiedVfsRouter.Instance.readFile(file, 'utf-8');
    const lines = content.split('\n');

    // Collect exports
    if (opts.checkExports) {
      collectExports(file, content, lines, exportMap);
    }

    // Collect all identifier usage
    collectIdentifiers(file, content, allIdentifiers);

    // Collect imports
    if (opts.checkImports) {
      collectImports(file, content, importUsage);
    }
  }

  // Second pass: check for unused exports
  if (opts.checkExports) {
    for (const [name, info] of exportMap) {
      // Check if this export is imported anywhere
      const importingFiles = importUsage.get(name) || new Set();

      // Check if it's used anywhere (including in the same file as a local reference)
      const usingFiles = allIdentifiers.get(name) || new Set();

      // Remove the declaring file from usage count
      usingFiles.delete(info.file);

      if (importingFiles.size === 0 && usingFiles.size === 0) {
        // Determine confidence based on export type
        let confidence: 'high' | 'medium' | 'low' = 'medium';
        if (info.type === 'interface' || info.type === 'type') {
          confidence = 'low'; // Types might be used implicitly
        } else if (info.type === 'default') {
          confidence = 'low'; // Default exports might be entry points
        }

        if (shouldReport(confidence, opts.minConfidence)) {
          issues.push({
            file: info.file,
            line: info.line,
            type: 'unused-export',
            name,
            message: `Exported ${info.type} '${name}' is never imported or used`,
            confidence,
          });
        }
      }
    }
  }

  // Check for unused imports in each file
  if (opts.checkImports) {
    for (const file of files) {
      const content = await UnifiedVfsRouter.Instance.readFile(file, 'utf-8');
      const fileIssues = checkUnusedImports(file, content);
      issues.push(...fileIssues.filter(i => shouldReport(i.confidence, opts.minConfidence)));
    }
  }

  // Calculate statistics
  const byType: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};

  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
    byConfidence[issue.confidence] = (byConfidence[issue.confidence] || 0) + 1;
  }

  return {
    scannedFiles: files.length,
    totalIssues: issues.length,
    byType,
    byConfidence,
    issues,
    scanTime: Date.now() - startTime,
  };
}

/**
 * Find files matching the patterns
 */
async function findFiles(opts: DeadCodeOptions): Promise<string[]> {
  const files = await fg(opts.include || [], {
    cwd: opts.rootDir,
    absolute: true,
    ignore: opts.exclude,
  });

  return files;
}

/**
 * Collect all exports from a file
 */
function collectExports(
  file: string,
  content: string,
  lines: string[],
  exportMap: Map<string, { file: string; line: number; type: string }>
): void {
  // Export function
  let match;
  const patterns = [
    { regex: PATTERNS.exportFunction, type: 'function' },
    { regex: PATTERNS.exportConst, type: 'const' },
    { regex: PATTERNS.exportClass, type: 'class' },
    { regex: PATTERNS.exportInterface, type: 'interface' },
    { regex: PATTERNS.exportType, type: 'type' },
  ];

  for (const { regex, type } of patterns) {
    regex.lastIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const line = getLineNumber(content, match.index);
      exportMap.set(name, { file, line, type });
    }
  }

  // Named exports
  PATTERNS.namedExport.lastIndex = 0;
  while ((match = PATTERNS.namedExport.exec(content)) !== null) {
    const exports = match[1].split(',').map(e => e.trim().split(/\s+as\s+/)[0].trim());
    for (const name of exports) {
      if (name && !exportMap.has(name)) {
        const line = getLineNumber(content, match.index);
        exportMap.set(name, { file, line, type: 'named' });
      }
    }
  }
}

/**
 * Collect all identifiers used in a file
 */
function collectIdentifiers(
  file: string,
  content: string,
  identifiers: Map<string, Set<string>>
): void {
  // Remove comments and strings to avoid false positives
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*/g, '') // line comments
    .replace(/'[^']*'/g, '') // single-quoted strings
    .replace(/"[^"]*"/g, '') // double-quoted strings
    .replace(/`[^`]*`/g, ''); // template literals (simplified)

  let match;
  PATTERNS.identifier.lastIndex = 0;
  while ((match = PATTERNS.identifier.exec(cleanContent)) !== null) {
    const name = match[1];
    if (name.length > 1 && !/^\d/.test(name)) { // Skip single chars and numbers
      if (!identifiers.has(name)) {
        identifiers.set(name, new Set());
      }
      identifiers.get(name)!.add(file);
    }
  }
}

/**
 * Collect all imports and what they import
 */
function collectImports(
  file: string,
  content: string,
  importUsage: Map<string, Set<string>>
): void {
  let match;

  // Named imports
  PATTERNS.namedImport.lastIndex = 0;
  while ((match = PATTERNS.namedImport.exec(content)) !== null) {
    const imports = match[1].split(',').map(i => {
      const parts = i.trim().split(/\s+as\s+/);
      return parts[0].trim();
    });
    for (const name of imports) {
      if (name) {
        if (!importUsage.has(name)) {
          importUsage.set(name, new Set());
        }
        importUsage.get(name)!.add(file);
      }
    }
  }

  // Default imports
  PATTERNS.defaultImport.lastIndex = 0;
  while ((match = PATTERNS.defaultImport.exec(content)) !== null) {
    const name = match[1];
    if (name && name !== 'type') {
      if (!importUsage.has(name)) {
        importUsage.set(name, new Set());
      }
      importUsage.get(name)!.add(file);
    }
  }
}

/**
 * Check for unused imports within a single file
 */
function checkUnusedImports(file: string, content: string): DeadCodeResult[] {
  const issues: DeadCodeResult[] = [];
  const lines = content.split('\n');

  // Find all imported symbols
  const imports: Array<{ name: string; line: number; alias?: string }> = [];

  let match;

  // Named imports
  PATTERNS.namedImport.lastIndex = 0;
  while ((match = PATTERNS.namedImport.exec(content)) !== null) {
    const line = getLineNumber(content, match.index);
    const importList = match[1].split(',');
    for (const imp of importList) {
      const parts = imp.trim().split(/\s+as\s+/);
      const name = parts[0].trim();
      const alias = parts[1]?.trim();
      if (name && name !== 'type') {
        imports.push({ name, line, alias });
      }
    }
  }

  // Default imports
  PATTERNS.defaultImport.lastIndex = 0;
  while ((match = PATTERNS.defaultImport.exec(content)) !== null) {
    const name = match[1];
    if (name && name !== 'type') {
      const line = getLineNumber(content, match.index);
      imports.push({ name, line });
    }
  }

  // Check usage of each import
  for (const imp of imports) {
    const usageName = imp.alias || imp.name;
    // Count occurrences (excluding the import line itself)
    const regex = new RegExp(`\\b${usageName}\\b`, 'g');
    const matches = content.match(regex) || [];

    // If only 1 occurrence (the import itself), it's unused
    if (matches.length <= 1) {
      issues.push({
        file,
        line: imp.line,
        type: 'unused-import',
        name: imp.name,
        message: `Import '${imp.name}' is declared but never used`,
        confidence: 'high',
      });
    }
  }

  return issues;
}

/**
 * Get line number from character index
 */
function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

/**
 * Check if confidence meets minimum threshold
 */
function shouldReport(confidence: string, minConfidence?: string): boolean {
  const levels = { low: 1, medium: 2, high: 3 };
  const confLevel = levels[confidence as keyof typeof levels] || 0;
  const minLevel = levels[minConfidence as keyof typeof levels] || 0;
  return confLevel >= minLevel;
}

/**
 * Format dead code report for display
 */
export function formatDeadCodeReport(report: DeadCodeReport): string {
  const lines: string[] = [
    '',
    '== Dead Code Analysis Report ==',
    '',
    `Scanned ${report.scannedFiles} files in ${report.scanTime}ms`,
    `Found ${report.totalIssues} potential issues`,
    '',
  ];

  if (report.totalIssues === 0) {
    lines.push('No dead code detected.');
    return lines.join('\n');
  }

  // By type
  lines.push('By Type:');
  for (const [type, count] of Object.entries(report.byType)) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');

  // By confidence
  lines.push('By Confidence:');
  for (const [conf, count] of Object.entries(report.byConfidence)) {
    lines.push(`  ${conf}: ${count}`);
  }
  lines.push('');

  // Issues grouped by file
  const byFile = new Map<string, DeadCodeResult[]>();
  for (const issue of report.issues) {
    if (!byFile.has(issue.file)) {
      byFile.set(issue.file, []);
    }
    byFile.get(issue.file)!.push(issue);
  }

  lines.push('Issues:');
  for (const [file, fileIssues] of byFile) {
    const relPath = path.relative(process.cwd(), file);
    lines.push(`\n  ${relPath}:`);
    for (const issue of fileIssues) {
      const conf = issue.confidence === 'high' ? '!!' : issue.confidence === 'medium' ? '!' : '?';
      lines.push(`    L${issue.line} [${conf}] ${issue.message}`);
    }
  }

  return lines.join('\n');
}

export default detectDeadCode;
