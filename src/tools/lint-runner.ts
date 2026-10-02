import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
/**
 * Multi-Language Lint Runner
 *
 * Auto-detects project linters and runs them with structured output.
 * Supported linters:
 * - ESLint (.eslintrc* / eslint.config.*)
 * - Ruff (pyproject.toml [tool.ruff] / ruff.toml)
 * - Cargo Clippy (Cargo.toml)
 * - golangci-lint (go.mod)
 * - RuboCop (.rubocop.yml)
 * - PHPStan (phpstan.neon)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from '../utils/tool-process.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface LinterConfig {
  /** Linter name identifier */
  name: 'eslint' | 'ruff' | 'clippy' | 'golangci-lint' | 'rubocop' | 'phpstan';
  /** The CLI command to invoke */
  command: string;
  /** Whether the CLI binary is installed and available */
  available: boolean;
  /** File extension patterns this linter handles */
  filePatterns: string[];
  /** Config file that triggered detection */
  detectedVia: string;
}

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule?: string;
}

export interface LintResult {
  linter: string;
  success: boolean;
  issueCount: number;
  issues: LintIssue[];
  fixedCount: number;
  rawOutput: string;
  duration: number;
}

// ============================================================================
// CLI Detection
// ============================================================================

/**
 * Check if a CLI command is available on the system.
 */
function isCommandAvailable(command: string): boolean {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(whichCmd, [command], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      stdio: 'pipe',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Linter Detection
// ============================================================================

/**
 * Detection rules for each linter.
 */
const LINTER_DETECTORS: Array<{
  name: LinterConfig['name'];
  command: string;
  filePatterns: string[];
  detect: (projectRoot: string) => string | null;
}> = [
  {
    name: 'eslint',
    command: 'eslint',
    filePatterns: ['*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs'],
    detect: (root) => {
      const candidates = [
        '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json',
        '.eslintrc.yml', '.eslintrc.yaml',
        'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
        'eslint.config.ts', 'eslint.config.mts',
      ];
      for (const file of candidates) {
        if (existsSync(resolveToolPath(join(root, file)))) return file;
      }
      // Also check package.json for eslintConfig key
      const pkgPath = join(root, 'package.json');
      if (existsSync(resolveToolPath(pkgPath))) {
        try {
          const pkg = JSON.parse(readFileSync(resolveToolPath(pkgPath), 'utf-8'));
          if (pkg.eslintConfig) return 'package.json (eslintConfig)';
        } catch {
          // ignore
        }
      }
      return null;
    },
  },
  {
    name: 'ruff',
    command: 'ruff',
    filePatterns: ['*.py', '*.pyi'],
    detect: (root) => {
      if (existsSync(resolveToolPath(join(root, 'ruff.toml')))) return 'ruff.toml';
      if (existsSync(resolveToolPath(join(root, '.ruff.toml')))) return '.ruff.toml';
      // Check pyproject.toml for [tool.ruff]
      const pyproject = join(root, 'pyproject.toml');
      if (existsSync(resolveToolPath(pyproject))) {
        try {
          const content = readFileSync(resolveToolPath(pyproject), 'utf-8');
          if (content.includes('[tool.ruff]')) return 'pyproject.toml [tool.ruff]';
        } catch {
          // ignore
        }
      }
      return null;
    },
  },
  {
    name: 'clippy',
    command: 'cargo',
    filePatterns: ['*.rs'],
    detect: (root) => {
      if (existsSync(resolveToolPath(join(root, 'Cargo.toml')))) return 'Cargo.toml';
      return null;
    },
  },
  {
    name: 'golangci-lint',
    command: 'golangci-lint',
    filePatterns: ['*.go'],
    detect: (root) => {
      if (existsSync(resolveToolPath(join(root, 'go.mod')))) return 'go.mod';
      return null;
    },
  },
  {
    name: 'rubocop',
    command: 'rubocop',
    filePatterns: ['*.rb', '*.rake', 'Gemfile', 'Rakefile'],
    detect: (root) => {
      if (existsSync(resolveToolPath(join(root, '.rubocop.yml')))) return '.rubocop.yml';
      if (existsSync(resolveToolPath(join(root, '.rubocop.yaml')))) return '.rubocop.yaml';
      return null;
    },
  },
  {
    name: 'phpstan',
    command: 'phpstan',
    filePatterns: ['*.php'],
    detect: (root) => {
      if (existsSync(resolveToolPath(join(root, 'phpstan.neon')))) return 'phpstan.neon';
      if (existsSync(resolveToolPath(join(root, 'phpstan.neon.dist')))) return 'phpstan.neon.dist';
      return null;
    },
  },
];

// ============================================================================
// LintRunner Implementation
// ============================================================================

export interface LintRunner {
  /** Auto-detect which linters apply to the project. */
  detect(projectRoot: string): Promise<LinterConfig[]>;
  /** Run a linter in check mode. */
  run(config: LinterConfig, files?: string[]): Promise<LintResult>;
  /** Run a linter in fix/auto-correct mode. */
  fix(config: LinterConfig, files?: string[]): Promise<LintResult>;
}

/**
 * Create a LintRunner instance.
 */
export function createLintRunner(): LintRunner {
  return {
    detect,
    run: runLinter,
    fix: fixLinter,
  };
}

/**
 * Detect all applicable linters for a project.
 */
async function detect(projectRoot: string): Promise<LinterConfig[]> {
  const configs: LinterConfig[] = [];

  for (const detector of LINTER_DETECTORS) {
    const detectedVia = detector.detect(projectRoot);
    if (detectedVia) {
      const available = isCommandAvailable(detector.command);
      configs.push({
        name: detector.name,
        command: detector.command,
        available,
        filePatterns: detector.filePatterns,
        detectedVia,
      });
    }
  }

  return configs;
}

/**
 * Run a linter in check mode.
 */
async function runLinter(config: LinterConfig, files?: string[]): Promise<LintResult> {
  if (!config.available) {
    return {
      linter: config.name,
      success: false,
      issueCount: 0,
      issues: [],
      fixedCount: 0,
      rawOutput: `${config.command} is not installed. Install it to use ${config.name}.`,
      duration: 0,
    };
  }

  const start = Date.now();
  const { command, args } = buildLintCommand(config, files, false);

  const result = spawnSync(command, args, {
    cwd: getToolWorkingDirectory(),
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
  });

  const duration = Date.now() - start;
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const issues = parseIssues(config.name, rawOutput);

  return {
    linter: config.name,
    success: result.status === 0,
    issueCount: issues.length,
    issues,
    fixedCount: 0,
    rawOutput: truncateOutput(rawOutput, 10000),
    duration,
  };
}

/**
 * Run a linter in fix/auto-correct mode.
 */
async function fixLinter(config: LinterConfig, files?: string[]): Promise<LintResult> {
  if (!config.available) {
    return {
      linter: config.name,
      success: false,
      issueCount: 0,
      issues: [],
      fixedCount: 0,
      rawOutput: `${config.command} is not installed. Install it to use ${config.name}.`,
      duration: 0,
    };
  }

  const start = Date.now();
  const { command, args } = buildLintCommand(config, files, true);

  const result = spawnSync(command, args, {
    cwd: getToolWorkingDirectory(),
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
  });

  const duration = Date.now() - start;
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const issues = parseIssues(config.name, rawOutput);

  // Estimate fixed count (issues that existed before but not after)
  const fixedCount = result.status === 0 ? 0 : 0; // actual count requires diff

  return {
    linter: config.name,
    success: result.status === 0,
    issueCount: issues.length,
    issues,
    fixedCount,
    rawOutput: truncateOutput(rawOutput, 10000),
    duration,
  };
}

// ============================================================================
// Command Building
// ============================================================================

function buildLintCommand(
  config: LinterConfig,
  files: string[] | undefined,
  fix: boolean
): { command: string; args: string[] } {
  const fileArgs = files && files.length > 0 ? files : ['.'];

  switch (config.name) {
    case 'eslint': {
      const args = fix
        ? ['--fix', '--format', 'stylish', ...fileArgs]
        : ['--format', 'stylish', ...fileArgs];
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      return { command: cmd, args: ['eslint', ...args] };
    }

    case 'ruff': {
      if (fix) {
        return { command: 'ruff', args: ['check', '--fix', '--output-format', 'text', ...fileArgs] };
      }
      return { command: 'ruff', args: ['check', '--output-format', 'text', ...fileArgs] };
    }

    case 'clippy': {
      // cargo clippy doesn't have a fix mode per se, but cargo fix does
      if (fix) {
        return { command: 'cargo', args: ['fix', '--allow-dirty', '--allow-staged'] };
      }
      return { command: 'cargo', args: ['clippy', '--message-format', 'short', '--', '-W', 'clippy::all'] };
    }

    case 'golangci-lint': {
      if (fix) {
        return { command: 'golangci-lint', args: ['run', '--fix', ...fileArgs] };
      }
      return { command: 'golangci-lint', args: ['run', ...fileArgs] };
    }

    case 'rubocop': {
      if (fix) {
        return { command: 'rubocop', args: ['--autocorrect', '--format', 'simple', ...fileArgs] };
      }
      return { command: 'rubocop', args: ['--format', 'simple', ...fileArgs] };
    }

    case 'phpstan': {
      // phpstan doesn't have a fix mode
      return { command: 'phpstan', args: ['analyse', '--no-progress', ...fileArgs] };
    }

    default:
      return { command: config.command, args: fileArgs };
  }
}

// ============================================================================
// Output Parsing
// ============================================================================

/**
 * Parse linter output into structured issues.
 * This is best-effort; structured formats (JSON) would be ideal but not always available.
 */
function parseIssues(linterName: string, output: string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!output) return issues;

  const lines = output.split('\n');

  for (const line of lines) {
    const issue = parseSingleLine(linterName, line);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues.slice(0, 200); // cap to avoid huge arrays
}

/**
 * Parse a single output line into a LintIssue.
 * Supports common formats: file:line:col: message
 */
function parseSingleLine(linterName: string, line: string): LintIssue | null {
  // Common format: file:line:col: severity: message (rule)
  // ESLint stylish: line:col  severity  message  rule
  // Ruff: file:line:col: code message
  // Generic: file:line:col: message

  // Try ESLint-style (indented lines under file headers)
  const eslintMatch = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/);
  if (eslintMatch) {
    const [, lineNo, colNo, severityStr, messageStr, ruleStr] = eslintMatch;
    if (
      lineNo === undefined ||
      colNo === undefined ||
      severityStr === undefined ||
      messageStr === undefined ||
      ruleStr === undefined
    ) {
      return null;
    }
    return {
      file: '', // ESLint groups under file headers
      line: parseInt(lineNo, 10),
      column: parseInt(colNo, 10),
      severity: severityStr as 'error' | 'warning',
      message: messageStr.trim(),
      rule: ruleStr,
    };
  }

  // Generic file:line:col: message format (ruff, clippy, golangci-lint, rubocop)
  const genericMatch = line.match(/^(.+?):(\d+):(\d+):\s*(?:(error|warning|info|note|E|W|C|R|F)\w*[\s:]*)?(.+)$/i);
  if (genericMatch) {
    const [, fileStr, lineNo, colNo, severityGroup, messageStr] = genericMatch;
    if (
      fileStr === undefined ||
      lineNo === undefined ||
      colNo === undefined ||
      messageStr === undefined
    ) {
      return null;
    }
    const severityRaw = (severityGroup ?? '').toLowerCase();
    let severity: 'error' | 'warning' | 'info' = 'warning';
    if (severityRaw.startsWith('e') || severityRaw === 'error') severity = 'error';
    else if (severityRaw === 'info' || severityRaw === 'note') severity = 'info';

    return {
      file: fileStr,
      line: parseInt(lineNo, 10),
      column: parseInt(colNo, 10),
      severity,
      message: messageStr.trim(),
    };
  }

  return null;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format lint results for display.
 */
export function formatLintResults(results: LintResult[]): string {
  if (results.length === 0) {
    return 'No linters detected for this project.';
  }

  const sections: string[] = [];

  for (const result of results) {
    const statusIcon = result.success ? '[PASS]' : '[FAIL]';
    const header = `${statusIcon} ${result.linter} (${result.duration}ms)`;
    const lines = [header];

    if (result.issueCount > 0) {
      const errorCount = result.issues.filter(i => i.severity === 'error').length;
      const warningCount = result.issues.filter(i => i.severity === 'warning').length;
      lines.push(`  ${errorCount} error(s), ${warningCount} warning(s)`);

      // Show first few issues
      const display = result.issues.slice(0, 10);
      for (const issue of display) {
        const loc = issue.file ? `${issue.file}:${issue.line}:${issue.column}` : `${issue.line}:${issue.column}`;
        const rule = issue.rule ? ` (${issue.rule})` : '';
        lines.push(`  ${issue.severity.toUpperCase()} ${loc}: ${issue.message}${rule}`);
      }
      if (result.issueCount > 10) {
        lines.push(`  ... and ${result.issueCount - 10} more`);
      }
    } else if (result.success) {
      lines.push('  No issues found.');
    } else {
      lines.push('  Linter exited with errors. See output below.');
    }

    if (!result.success && result.rawOutput && result.issueCount === 0) {
      lines.push('');
      lines.push('  Output:');
      const outputLines = result.rawOutput.split('\n').slice(0, 15);
      for (const ol of outputLines) {
        lines.push(`  ${ol}`);
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Format detected linters for display.
 */
export function formatDetectedLinters(configs: LinterConfig[]): string {
  if (configs.length === 0) {
    return 'No linters detected for this project.';
  }

  const lines = ['Detected linters:', ''];
  for (const config of configs) {
    const status = config.available ? 'installed' : 'NOT installed';
    lines.push(`  ${config.name} (${status})`);
    lines.push(`    Command: ${config.command}`);
    lines.push(`    Detected via: ${config.detectedVia}`);
    lines.push(`    File patterns: ${config.filePatterns.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Utilities
// ============================================================================

function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) return output;
  const half = Math.floor(maxLength / 2) - 20;
  return output.substring(0, half) + '\n\n... (truncated) ...\n\n' + output.substring(output.length - half);
}
