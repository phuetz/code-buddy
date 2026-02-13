/**
 * Shell Environment Snapshots
 *
 * Captures the user's shell environment for better context awareness.
 * Includes shell type, env vars (filtered for safety), aliases, rc files,
 * and common tool versions.
 *
 * Can be injected into the system prompt to help the agent understand
 * the user's development environment.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ShellSnapshot {
  /** Detected shell (bash, zsh, fish, sh) */
  shell: string;
  /** Filtered environment variables (safe ones only) */
  env: Record<string, string>;
  /** Parsed aliases from rc files */
  aliases: string[];
  /** Shell function names */
  functions: string[];
  /** Which rc files exist */
  rcFiles: string[];
  /** Node.js version */
  nodeVersion?: string;
  /** npm version */
  npmVersion?: string;
  /** Git version */
  gitVersion?: string;
  /** Python version */
  pythonVersion?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Environment variables that are safe and useful to include.
 * Explicitly listed to avoid leaking secrets.
 */
const SAFE_ENV_VARS = new Set([
  'SHELL',
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'EDITOR',
  'VISUAL',
  'TERM',
  'LANG',
  'LC_ALL',
  'COLORTERM',
  'TERM_PROGRAM',
  'PWD',
  'OLDPWD',
  'HOSTNAME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'NODE_ENV',
  'NPM_CONFIG_PREFIX',
  'GOPATH',
  'GOROOT',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'JAVA_HOME',
  'VIRTUAL_ENV',
  'CONDA_DEFAULT_ENV',
  'PYENV_ROOT',
  'NVM_DIR',
  'FNM_DIR',
  'VOLTA_HOME',
  'PNPM_HOME',
  'BUN_INSTALL',
  'DOCKER_HOST',
  'KUBECONFIG',
  'WSL_DISTRO_NAME',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'SSH_AUTH_SOCK',
]);

/**
 * Patterns that indicate a secret - never include these.
 */
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /private[_-]?key/i,
  /auth/i,
  /access[_-]?key/i,
];

// ============================================================================
// Helpers
// ============================================================================

function execSafe(command: string, timeoutMs: number = 3000): string | undefined {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readFileSafe(filePath: string): string | null {
  try {
    if (!fileExists(filePath)) {
      return null;
    }
    const stat = fs.statSync(filePath);
    // Skip files larger than 100KB to avoid loading huge rc files
    if (stat.size > 100 * 1024) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function isSafeEnvVar(key: string): boolean {
  if (SAFE_ENV_VARS.has(key)) {
    return true;
  }
  // Reject anything matching secret patterns
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(key)) {
      return false;
    }
  }
  return false;
}

// ============================================================================
// Alias Parsing
// ============================================================================

function parseAliasesFromContent(content: string): string[] {
  const aliases: string[] = [];
  const aliasRegex = /^\s*alias\s+([^\s=]+)=['"]?([^'"]*?)['"]?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = aliasRegex.exec(content)) !== null) {
    aliases.push(`${match[1]}=${match[2]}`);
  }
  return aliases;
}

function parseFunctionsFromContent(content: string): string[] {
  const functions: string[] = [];
  // Match bash/zsh function declarations
  const funcRegex = /^\s*(?:function\s+)?(\w+)\s*\(\)\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }
  return functions;
}

function parseFishAliases(content: string): string[] {
  const aliases: string[] = [];
  // Fish uses: abbr -a name command  or  alias name command
  const abbrRegex = /^\s*abbr\s+(?:-a\s+)?(\S+)\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = abbrRegex.exec(content)) !== null) {
    aliases.push(`${match[1]}=${match[2]}`);
  }
  const aliasRegex = /^\s*alias\s+(\S+)\s+['"]?(.+?)['"]?\s*$/gm;
  while ((match = aliasRegex.exec(content)) !== null) {
    aliases.push(`${match[1]}=${match[2]}`);
  }
  return aliases;
}

function parseFishFunctions(content: string): string[] {
  const functions: string[] = [];
  const funcRegex = /^\s*function\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }
  return functions;
}

// ============================================================================
// Core Implementation
// ============================================================================

/**
 * Capture a snapshot of the current shell environment.
 */
export async function captureShellSnapshot(): Promise<ShellSnapshot> {
  const home = os.homedir();
  const shell = detectShell();
  const env = captureFilteredEnv();
  const rcFiles = detectRcFiles(home, shell);

  // Parse aliases and functions from rc files
  let aliases: string[] = [];
  let functions: string[] = [];
  for (const rcFile of rcFiles) {
    const content = readFileSafe(rcFile);
    if (!content) continue;

    if (shell === 'fish') {
      aliases.push(...parseFishAliases(content));
      functions.push(...parseFishFunctions(content));
    } else {
      aliases.push(...parseAliasesFromContent(content));
      functions.push(...parseFunctionsFromContent(content));
    }
  }

  // Deduplicate
  aliases = [...new Set(aliases)];
  functions = [...new Set(functions)];

  // Tool versions
  const nodeVersion = execSafe('node --version');
  const npmVersion = execSafe('npm --version');
  const gitVersion = execSafe('git --version')?.replace('git version ', '');
  const pythonVersion = execSafe('python3 --version')?.replace('Python ', '')
    ?? execSafe('python --version')?.replace('Python ', '');

  return {
    shell,
    env,
    aliases,
    functions,
    rcFiles,
    nodeVersion,
    npmVersion,
    gitVersion,
    pythonVersion,
  };
}

/**
 * Detect the current shell.
 */
function detectShell(): string {
  const shellEnv = process.env['SHELL'] || '';
  const shellName = path.basename(shellEnv);

  if (['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh'].includes(shellName)) {
    return shellName;
  }

  // Fallback: try to detect from parent process
  const parentShell = execSafe('ps -p $PPID -o comm=');
  if (parentShell) {
    const name = path.basename(parentShell);
    if (['bash', 'zsh', 'fish'].includes(name)) {
      return name;
    }
  }

  return shellName || 'sh';
}

/**
 * Capture filtered environment variables (exclude secrets).
 */
function captureFilteredEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value && isSafeEnvVar(key)) {
      // Truncate very long values (e.g., PATH)
      filtered[key] = value.length > 500 ? value.substring(0, 500) + '...' : value;
    }
  }

  return filtered;
}

/**
 * Detect which rc/config files exist for the user's shell.
 */
function detectRcFiles(home: string, shell: string): string[] {
  const candidates: string[] = [];

  // Common rc files
  const possibleFiles = [
    '.profile',
    '.bashrc',
    '.bash_profile',
    '.bash_aliases',
    '.zshrc',
    '.zprofile',
    '.zshenv',
    '.config/fish/config.fish',
    '.config/fish/fish_variables',
  ];

  for (const file of possibleFiles) {
    const fullPath = path.join(home, file);
    if (fileExists(fullPath)) {
      candidates.push(fullPath);
    }
  }

  return candidates;
}

/**
 * Format a shell snapshot as a concise prompt string for system prompt injection.
 */
export function formatSnapshotForPrompt(snapshot: ShellSnapshot): string {
  const lines: string[] = [];

  lines.push(`## Shell Environment`);
  lines.push(`- Shell: ${snapshot.shell}`);

  if (snapshot.nodeVersion) {
    lines.push(`- Node: ${snapshot.nodeVersion}`);
  }
  if (snapshot.npmVersion) {
    lines.push(`- npm: ${snapshot.npmVersion}`);
  }
  if (snapshot.gitVersion) {
    lines.push(`- Git: ${snapshot.gitVersion}`);
  }
  if (snapshot.pythonVersion) {
    lines.push(`- Python: ${snapshot.pythonVersion}`);
  }

  // Key env vars
  const editor = snapshot.env['EDITOR'] || snapshot.env['VISUAL'];
  if (editor) {
    lines.push(`- Editor: ${editor}`);
  }

  const term = snapshot.env['TERM_PROGRAM'] || snapshot.env['TERM'];
  if (term) {
    lines.push(`- Terminal: ${term}`);
  }

  const wsl = snapshot.env['WSL_DISTRO_NAME'];
  if (wsl) {
    lines.push(`- WSL: ${wsl}`);
  }

  const virtualEnv = snapshot.env['VIRTUAL_ENV'] || snapshot.env['CONDA_DEFAULT_ENV'];
  if (virtualEnv) {
    lines.push(`- Virtual env: ${virtualEnv}`);
  }

  // Aliases (show count, not full list to save tokens)
  if (snapshot.aliases.length > 0) {
    lines.push(`- Shell aliases: ${snapshot.aliases.length} defined`);
  }
  if (snapshot.functions.length > 0) {
    lines.push(`- Shell functions: ${snapshot.functions.length} defined`);
  }

  return lines.join('\n');
}
