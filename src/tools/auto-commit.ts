import { getToolWorkingDirectory } from '../utils/tool-execution-context.js';
/**
 * Auto-Commit Tool
 *
 * Aider-style automatic git commits after AI-made file changes.
 * Only commits files explicitly changed by the agent — never touches
 * the user's uncommitted work.
 *
 * Commit message format follows Conventional Commits:
 *   feat(scope): AI-assisted: <description>
 */

import { execFile } from '../utils/tool-process.js';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export interface AutoCommitConfig {
  enabled: boolean;
  messageStyle: 'conventional' | 'descriptive' | 'short';
  includeFileList: boolean;
  signOff: boolean;
}

export interface AutoCommitResult {
  success: boolean;
  commitHash?: string;
  message?: string;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: AutoCommitConfig = {
  enabled: false,
  messageStyle: 'conventional',
  includeFileList: true,
  signOff: false,
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Run a git command and return stdout
 */
async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: cwd || getToolWorkingDirectory(),
      timeout: 15000,
    });
    return stdout.trim();
  } catch (error: unknown) {
    const msg = error instanceof Error ? (error as Error & { stderr?: string }).stderr || error.message : String(error);
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

/**
 * Check if the current directory is a git repository
 */
async function isGitRepo(cwd?: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive a scope from the changed files (deepest common directory)
 */
function deriveScope(files: string[]): string {
  if (files.length === 0) return '';

  // Normalize to forward slashes and get directory parts
  const dirs = files.map(f => {
    const normalized = f.replace(/\\/g, '/');
    const parts = path.dirname(normalized).split('/').filter(Boolean);
    return parts;
  });

  // Find the deepest common directory
  if (dirs.length === 1) {
    const d = dirs[0];
    if (d === undefined) return '';
    // Use the last meaningful directory part as scope
    const meaningful = d.filter(p => p !== 'src' && p !== '.');
    return meaningful[meaningful.length - 1] || d[d.length - 1] || '';
  }

  // Find common prefix
  const first = dirs[0];
  if (first === undefined) return '';
  let commonLen = 0;
  for (let i = 0; i < first.length; i++) {
    if (dirs.every(d => d[i] === first[i])) {
      commonLen = i + 1;
    } else {
      break;
    }
  }

  const common = first.slice(0, commonLen);
  const meaningful = common.filter(p => p !== 'src' && p !== '.');
  return meaningful[meaningful.length - 1] || common[common.length - 1] || '';
}

/**
 * Determine the commit type from the description and files
 */
function deriveCommitType(description: string, files: string[]): string {
  const descLower = description.toLowerCase();

  if (descLower.includes('fix') || descLower.includes('bug') || descLower.includes('repair')) return 'fix';
  if (descLower.includes('test')) return 'test';
  if (descLower.includes('doc') || descLower.includes('readme')) return 'docs';
  if (descLower.includes('refactor') || descLower.includes('cleanup')) return 'refactor';
  if (descLower.includes('style') || descLower.includes('format')) return 'style';

  // Check file patterns
  const hasTestFiles = files.some(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
  if (hasTestFiles && files.every(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'))) return 'test';

  return 'feat';
}

/**
 * Generate commit message based on style
 */
export function generateCommitMessage(
  changedFiles: string[],
  description: string,
  config: AutoCommitConfig,
): string {
  const style = config.messageStyle;

  if (style === 'short') {
    const maxLen = 72;
    const msg = `AI: ${description}`;
    return msg.length > maxLen ? msg.substring(0, maxLen - 3) + '...' : msg;
  }

  if (style === 'descriptive') {
    const lines = [`AI-assisted: ${description}`];
    if (config.includeFileList && changedFiles.length > 0) {
      lines.push('');
      lines.push('Changed files:');
      for (const f of changedFiles.slice(0, 20)) {
        lines.push(`  - ${f}`);
      }
      if (changedFiles.length > 20) {
        lines.push(`  ... and ${changedFiles.length - 20} more`);
      }
    }
    return lines.join('\n');
  }

  // Default: conventional
  const type = deriveCommitType(description, changedFiles);
  const scope = deriveScope(changedFiles);
  const scopePart = scope ? `(${scope})` : '';

  const subject = `${type}${scopePart}: AI-assisted: ${description}`;

  const lines = [subject.length > 72 ? subject.substring(0, 69) + '...' : subject];

  if (config.includeFileList && changedFiles.length > 0) {
    lines.push('');
    lines.push('Changed files:');
    for (const f of changedFiles.slice(0, 20)) {
      lines.push(`  - ${f}`);
    }
    if (changedFiles.length > 20) {
      lines.push(`  ... and ${changedFiles.length - 20} more`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Automatically commit files changed by the agent.
 *
 * Only stages and commits the specific files provided — never runs `git add -A`.
 * Checks that each file has actual modifications before staging.
 *
 * @param changedFiles - Files that were changed by the agent
 * @param description - Human-readable description of what was changed
 * @param config - Optional commit configuration overrides
 */
export async function autoCommitChanges(
  changedFiles: string[],
  description: string,
  config?: Partial<AutoCommitConfig>,
): Promise<AutoCommitResult> {
  const mergedConfig: AutoCommitConfig = { ...DEFAULT_CONFIG, ...config, enabled: true };

  if (changedFiles.length === 0) {
    return { success: false, message: 'No files to commit' };
  }

  // Verify we are in a git repository
  if (!(await isGitRepo())) {
    return { success: false, message: 'Not a git repository' };
  }

  // Filter to only files that have actual modifications in git
  const actuallyChanged: string[] = [];
  for (const file of changedFiles) {
    try {
      const status = await git(['status', '--porcelain', '--', file]);
      if (status.trim()) {
        actuallyChanged.push(file);
      }
    } catch {
      // File might not exist or path is invalid — skip
      logger.debug(`Auto-commit: skipping file ${file} — not in working tree`);
    }
  }

  if (actuallyChanged.length === 0) {
    return { success: false, message: 'No modified files to commit' };
  }

  // Stage only the specific changed files
  try {
    await git(['add', '--', ...actuallyChanged]);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to stage files: ${msg}` };
  }

  // Generate commit message
  const commitMessage = generateCommitMessage(actuallyChanged, description, mergedConfig);

  // Build commit command
  const commitArgs = ['commit', '-m', commitMessage];
  if (mergedConfig.signOff) {
    commitArgs.push('--signoff');
  }

  // Commit
  try {
    const output = await git(commitArgs);

    // Extract commit hash from output
    const hashMatch = output.match(/\[[\w/-]+\s+([a-f0-9]{7,})\]/);
    const commitHash = hashMatch ? hashMatch[1] : undefined;

    logger.info(`Auto-commit: committed ${actuallyChanged.length} file(s)`, {
      hash: commitHash,
      files: actuallyChanged.length,
    });

    return {
      success: true,
      commitHash,
      message: `Committed ${actuallyChanged.length} file(s): ${commitMessage.split('\n')[0]}`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Commit failed: ${msg}` };
  }
}

/**
 * Load auto-commit config from TOML config
 */
export function getAutoCommitConfig(): AutoCommitConfig {
  try {
    // Lazy-load to avoid circular dependency
     
    const { getTomlConfig } = require('../config/toml-config.js') as { getTomlConfig: () => Record<string, unknown> };
    const config = getTomlConfig();
    const agent = config.agent as Record<string, unknown> | undefined;

    if (agent?.auto_commit) {
      const ac = agent.auto_commit as Partial<AutoCommitConfig>;
      return {
        enabled: ac.enabled ?? false,
        messageStyle: ac.messageStyle ?? 'conventional',
        includeFileList: ac.includeFileList ?? true,
        signOff: ac.signOff ?? false,
      };
    }
  } catch {
    // Config not available — use defaults
  }

  return { ...DEFAULT_CONFIG };
}

// ============================================================================
// Agent-Executor Integration
// ============================================================================

/** Set of tool names that modify files */
const FILE_MODIFYING_TOOLS = new Set([
  'str_replace_editor',
  'create_file',
  'apply_patch',
  'multi_edit',
  'file_write',
]);

/**
 * Check if a tool call modified files and should trigger auto-commit.
 * Called from agent-executor after successful tool execution.
 *
 * @param toolName - Name of the executed tool
 * @param toolArgs - Tool arguments (JSON string)
 * @param description - Description of the change
 */
export async function maybeAutoCommit(
  toolName: string,
  toolArgs: string,
  description: string,
): Promise<AutoCommitResult | null> {
  if (!FILE_MODIFYING_TOOLS.has(toolName)) return null;

  const config = getAutoCommitConfig();
  if (!config.enabled) return null;

  // Extract file paths from tool arguments
  const files: string[] = [];
  try {
    const args = JSON.parse(toolArgs);
    if (args.path) files.push(args.path);
    if (args.file_path) files.push(args.file_path);
    if (args.target_file) files.push(args.target_file);
    if (args.file) files.push(args.file);
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  return autoCommitChanges(files, description, config);
}
