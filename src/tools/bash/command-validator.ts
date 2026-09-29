/**
 * Command validation and environment filtering for BashTool.
 *
 * Contains:
 * - extractBaseCommand: Parses the base command from a shell string
 * - hasShellBypassFeatures: Detects shell features that could bypass validation
 * - validateCommand: Full security validation pipeline
 * - getFilteredEnv: Environment variable filtering for child processes
 *   (uses ShellEnvPolicy for user-configurable overrides — Codex-inspired #8)
 */

import {
  BLOCKED_PATTERNS,
  BLOCKED_CONTROL_CHARS,
  ANSI_ESCAPE_PATTERN,
  SAFE_ENV_VARS,
  BLOCKED_PATHS,
} from './security-patterns.js';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkSecretFileAccess, classifySecretPath, getHomeCredentialRoots } from '../../security/secret-files.js';
import { isPublicProjectNpmrc } from '../../security/public-project-npmrc.js';
import { parseShellCommand } from '../../security/bash-parser.js';
import { auditLogger } from '../../security/audit-logger.js';
import { checkUserDenyRules } from '../../security/bash-allowlist/deny-guard.js';

/**
 * Commands whose purpose is inherently host-wide and catastrophic.  Useful
 * workspace operations such as rm/chmod and user-service control are no longer
 * rejected merely by binary name; ExecPolicy confines or prompts for them.
 */
const HARD_BLOCKED_COMMANDS = new Set([
  'wipefs', 'mkfs', 'fdisk', 'parted', 'dd',
  'reboot', 'shutdown', 'poweroff', 'halt', 'init',
  'iptables', 'ip6tables', 'nft', 'firewall-cmd',
  'mount', 'umount',
  'insmod', 'rmmod', 'modprobe', 'sysctl',
  'useradd', 'userdel', 'usermod', 'groupadd',
  'passwd', 'chpasswd', 'visudo',
  // Windows host-wide disk, registry, boot and shadow-copy administration.
  'format', 'format-volume', 'diskpart', 'reg', 'bcdedit', 'vssadmin',
]);

/**
 * Extract the base command from a command string
 * Handles paths, env var prefixes, and common shell constructs
 */
export function extractBaseCommand(command: string): string | null {
  // Defensive: a malformed tool call can pass a non-string command.
  if (typeof command !== 'string') return null;
  // Trim and handle empty
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Skip leading environment variable assignments (VAR=value cmd)
  let remaining = trimmed;
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(remaining)) {
    remaining = remaining.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  }

  // Resolve a quoted executable first. For an unquoted absolute Windows path,
  // consume through `.exe` so `C:\Program Files\...\pwsh.exe` cannot be
  // misclassified as the binary `C:\Program`.
  const quotedMatch = remaining.match(/^(?:"([^"]+)"|'([^']+)')(?:\s|$)/);
  const windowsExecutableMatch = remaining.match(
    /^((?:[A-Za-z]:|\.{1,2})\\[\s\S]*?\.exe)(?=\s|$)/i,
  );
  const tokenMatch = remaining.match(/^(\S+)/);
  let cmd = quotedMatch?.[1]
    ?? quotedMatch?.[2]
    ?? windowsExecutableMatch?.[1]
    ?? tokenMatch?.[1];
  if (cmd === undefined) return null;

  const pathParts = cmd.split(/[\\/]/).filter(Boolean);
  cmd = pathParts.at(-1) ?? cmd;

  return cmd.replace(/\.exe$/i, '').toLowerCase();
}

/**
 * Check if command uses shell features that could bypass validation
 */
export function hasShellBypassFeatures(command: string): { bypass: boolean; reason?: string } {
  const powerShellBypassPatterns = [
    {
      pattern: /(?:^|[|;&]\s*|\s)(?:invoke-expression|iex)(?=\s|$)/i,
      reason: 'PowerShell Invoke-Expression execution detected',
    },
    {
      pattern: /(?:^|[|;&]\s*)start-process(?=\s|$)/i,
      reason: 'PowerShell Start-Process execution detected',
    },
    {
      pattern: /(?:^|[|;&]\s*)\.\\[^\s"'|;&]+\.ps1(?=\s|$)/i,
      reason: 'Direct PowerShell script execution detected',
    },
    {
      pattern: /\b(?:powershell|pwsh)(?:\.exe)?\b[\s\S]*-(?:encodedcommand|enc)(?=\s|$)/i,
      reason: 'PowerShell encoded command detected',
    },
  ];

  for (const { pattern, reason } of powerShellBypassPatterns) {
    if (pattern.test(command)) return { bypass: true, reason };
  }

  // Check for multiple commands via && || ; |
  // But allow single pipes for grep, etc.
  const multiCommandPatterns = [
    { pattern: /;\s*\S/, reason: 'Command chaining with semicolon' },
    { pattern: /&&\s*\S/, reason: 'Command chaining with &&' },
    { pattern: /\|\|\s*\S/, reason: 'Command chaining with ||' },
    { pattern: /\|\s*(?:bash|sh|zsh|ksh|csh|fish|dash)\b/i, reason: 'Pipe to shell' },
  ];

  for (const { pattern, reason } of multiCommandPatterns) {
    if (pattern.test(command)) {
      // Check if this is a safe pipe (e.g., grep | wc)
      if (reason === 'Pipe to shell') {
        return { bypass: true, reason };
      }
      // For other chaining, check if the second command is safe
      // For now, we'll allow chaining but each command gets validated separately
    }
  }

  // Check for process substitution
  if (/[<>]\(/.test(command)) {
    return { bypass: true, reason: 'Process substitution detected' };
  }

  // Check for here-string/here-doc that could contain encoded payloads
  if (/<<</.test(command)) {
    return { bypass: true, reason: 'Here-string detected' };
  }

  return { bypass: false };
}

/**
 * Validate command for dangerous patterns
 *
 * Security checks performed (in order):
 * 1. Control characters - blocks terminal manipulation
 * 2. ANSI escape sequences - blocks display manipulation
 * 3. Shell bypass features - blocks process substitution, here-strings, etc.
 * 4. Base command blocklist - blocks known dangerous commands
 * 5. Blocked command patterns - blocks known dangerous patterns
 * 6. Protected paths - blocks access to sensitive directories
 *
 * Note: Sandbox manager validation is performed separately by the caller
 * since it requires instance state.
 */
export function validateCommand(command: string, shell?: string, cwd: string = process.cwd()): { valid: boolean; reason?: string } {
  // User-defined deny rules (/allowlist deny <pattern>) are a HARD stop in
  // every mode — YOLO skips confirmations, never validation. Checked first so
  // a user rule wins even over commands the static checks would tolerate.
  const denyVerdict = checkUserDenyRules(command);
  if (denyVerdict.denied) {
    return {
      valid: false,
      reason:
        `Blocked by user deny rule "${denyVerdict.pattern}"` +
        (denyVerdict.description ? ` (${denyVerdict.description})` : '') +
        ' — manage with /allowlist',
    };
  }

  // Check for dangerous control characters
  if (BLOCKED_CONTROL_CHARS.test(command)) {
    return {
      valid: false,
      reason: 'Command contains blocked control characters'
    };
  }

  // Check for ANSI escape sequences that could manipulate terminal
  if (ANSI_ESCAPE_PATTERN.test(command)) {
    return {
      valid: false,
      reason: 'Command contains blocked ANSI escape sequences'
    };
  }

  // Check for shell bypass features
  const bypassCheck = hasShellBypassFeatures(command);
  if (bypassCheck.bypass) {
    return {
      valid: false,
      reason: `Shell bypass blocked: ${bypassCheck.reason}`
    };
  }

  // Only inherently host-wide commands are blocked by binary name. Other
  // dangerous-looking binaries continue to the argv-aware execution policy.
  const baseCmd = extractBaseCommand(command);
  if (baseCmd && HARD_BLOCKED_COMMANDS.has(baseCmd)) {
    return {
      valid: false,
      reason: `Blocked command: ${baseCmd}`
    };
  }

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `Blocked command pattern detected: ${pattern.source}`
      };
    }
  }

  // Check for access to blocked paths. `~`, `$HOME`, `${HOME}` (quoted or
  // not) are all expanded: a bare `.includes()` on the raw text missed
  // `cat $HOME/.ssh/id_rsa`.
  const commandWithExpandedHome = expandHomeReferences(command);
  for (const blockedPath of BLOCKED_PATHS) {
    const isWindowsPath = blockedPath.includes('\\');
    const commandVariants = [command, commandWithExpandedHome];
    const containsBlockedPath = isWindowsPath
      ? commandVariants.some((variant) =>
          variant.replace(/\//g, '\\').toLowerCase().includes(blockedPath.toLowerCase()),
        )
      : commandVariants.some((variant) => variant.includes(blockedPath));
    if (containsBlockedPath) {
      auditLogger.logCommandValidation({ command, valid: false, reason: `Protected path: ${blockedPath}`, source: 'command-validator' });
      return {
        valid: false,
        reason: `Access to protected path blocked: ${blockedPath}`
      };
    }
  }

  // Credential files (codex-auth.json, ~/.codebuddy/*.env, *auth*.json under
  // the Code Buddy / sibling CLI homes, private keys…) — same deny list as the
  // file tools (src/security/secret-files.ts). Best-effort on the command
  // text: a path assembled at runtime by the interpreter is out of reach of
  // any static filter; CODEBUDDY_NATIVE_SANDBOX is the containment for that.
  const secretToken = findCredentialPathInCommand(command, process.platform, cwd);
  if (secretToken) {
    auditLogger.logCommandValidation({ command, valid: false, reason: `Credential path: ${secretToken}`, source: 'command-validator' });
    return {
      valid: false,
      reason: `Access to a credential/secret file blocked: ${secretToken}`
    };
  }

  // Phase 2: AST-based validation via bash-parser
  // Parse the command into individual commands and validate each
  try {
    const parsed = parseShellCommand(command, { shell });
    const powerShellWarning = parsed.warnings.find(warning => warning.startsWith('PowerShell parser'));
    if (powerShellWarning) {
      auditLogger.logCommandValidation({
        command,
        valid: false,
        reason: powerShellWarning,
        source: 'powershell-parser',
      });
      return {
        valid: false,
        reason: `PowerShell parser refused command: ${powerShellWarning}`,
      };
    }
    for (const cmd of parsed.commands) {
      const parsedBaseCommand = extractBaseCommand(cmd.command);
      if (parsedBaseCommand && HARD_BLOCKED_COMMANDS.has(parsedBaseCommand)) {
        auditLogger.logCommandValidation({
          command,
          valid: false,
          reason: `Host-destructive command detected by parser: ${cmd.command}`,
          source: 'bash-parser',
        });
        return {
          valid: false,
          reason: `Blocked host-destructive command (AST): ${cmd.command}`,
        };
      }

      // Check subshell commands too
      if (cmd.isSubshell && parsedBaseCommand && HARD_BLOCKED_COMMANDS.has(parsedBaseCommand)) {
        auditLogger.logCommandValidation({
          command,
          valid: false,
          reason: `Dangerous command in subshell: ${cmd.command}`,
          source: 'bash-parser',
        });
        return {
          valid: false,
          reason: `Blocked command in subshell: ${cmd.command}`,
        };
      }
    }
  } catch {
    auditLogger.logCommandValidation({
      command,
      valid: false,
      reason: 'Shell parser failed unexpectedly',
      source: 'command-validator',
    });
    return {
      valid: false,
      reason: 'Shell parser failed unexpectedly; command refused',
    };
  }

  auditLogger.logCommandValidation({ command, valid: true, source: 'command-validator' });
  return { valid: true };
}

/**
 * Filter environment variables to only include safe ones
 * This prevents credential leakage to child processes
 *
 * Security measures:
 * - Only allowlisted variable names are passed through
 * - Values containing shell metacharacters are sanitized
 * - Values that look like secrets are excluded
 */
export function getFilteredEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};

  // Patterns that suggest a value is a secret (even if var name is allowed)
  const secretPatterns = [
    /^sk-[a-zA-Z0-9]{20,}$/,      // OpenAI-style keys
    /^xai-[a-zA-Z0-9]{20,}$/,     // xAI keys
    /^ghp_[a-zA-Z0-9]{36}$/,      // GitHub PAT
    /^gho_[a-zA-Z0-9]{36}$/,      // GitHub OAuth
    /^github_pat_/i,              // GitHub fine-grained PAT
    /^AKIA[A-Z0-9]{16}$/,         // AWS Access Key
    /^npm_[a-zA-Z0-9]{36}$/,      // NPM token
    /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, // JWT
    /^[a-f0-9]{64}$/i,            // Hex-encoded secrets (64 chars)
    /^-----BEGIN.*PRIVATE KEY-----/m, // Private keys
  ];

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // Only allow safe variable names
    if (!SAFE_ENV_VARS.has(key)) continue;

    // Check if value looks like a secret
    const looksLikeSecret = secretPatterns.some(pattern => pattern.test(value));
    if (looksLikeSecret) continue;

    // Sanitize value - remove control characters
    // eslint-disable-next-line no-control-regex
    const sanitized = value.replace(/[\x00-\x1f\x7f]/g, '');

    filtered[key] = sanitized;
  }

  // Note: ShellEnvPolicy (src/security/shell-env-policy.ts) provides a
  // user-configurable layer on top of this base filter for `set` overrides
  // (e.g. NODE_ENV=production injected into every subprocess). Callers can
  // apply it after getFilteredEnv() if needed.

  return filtered;
}


/**
 * Replace `~`, `$HOME`, `${HOME}` with the home directory (POSIX shells).
 * Only the forms a shell would expand to the home directory are handled.
 */
export function expandHomeReferences(command: string): string {
  const home = os.homedir();
  return command
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$HOME(?![A-Za-z0-9_])/g, home)
    .replace(/(^|[\s'"=:(])~(?=[\\/]|$|[\s'";|&)])/g, (_m, lead: string) => `${lead}${home}`);
}

/** Universal credential store names, dangerous even as a relative path in bash. */
const BASH_CREDENTIAL_BASENAMES = new Set([
  'codex-auth.json',
  'xai-auth.json',
  'gemini-auth.json',
  'nous_auth.json',
  'mcp-tokens.json',
  'auth-profiles.json',
  '.credentials.json',
  'credentials.enc',
  '.git-credentials',
]);

/** Readers that dump a whole directory tree when handed a credential root. */
const RECURSIVE_READERS = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'tar', 'zip', '7z', 'cp', 'rsync', 'scp',
  'find', 'cat', 'xargs', 'base64', 'xxd', 'od', 'strings', 'head', 'tail', 'less', 'more',
  'curl', 'wget', 'nc', 'ncat', 'socat', 'python', 'python3', 'node', 'perl', 'ruby',
  'awk', 'sed', 'diff', 'cmp', 'tee', 'openssl',
]);

/** Only explicit public placeholders may be traversed in classified env files. */
function isPublicProjectEnvPlaceholder(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (base !== '.env.test' && base !== '.env.local') return false;
  if (base === '.env.test' && !path.normalize(file).split(path.sep).includes('node_modules')) return false;
  try {
    const real = fs.realpathSync(file);
    const home = path.resolve(os.homedir());
    if (real === home || real.startsWith(home + path.sep)) return false;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4_096) return false;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('\uFFFD')) return false;
    return content.split(/\r?\n/).every((line) => {
      const entry = line.trim();
      if (!entry) return true;
      const match = entry.match(/^([A-Z][A-Z0-9_]*)=(world|test|example|dummy|localhost|true|false|[0-9]+)$/i);
      return !!match && !/(?:KEY|TOKEN|SECRET|PASS|PWD|AUTH|CREDENTIAL)/i.test(match[1]!);
    });
  } catch { return false; }
}

function directoryContainsSecret(directory: string): boolean {
  const pending = [directory];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    let canonical: string;
    try { canonical = fs.realpathSync(current); } catch { return true; }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return true; }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (checkSecretFileAccess(child, 'read').secret &&
          !isPublicProjectNpmrc(child) && !isPublicProjectEnvPlaceholder(child)) return true;
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isSymbolicLink()) {
        try { if (fs.statSync(child).isDirectory()) pending.push(child); } catch { return true; }
      }
    }
  }
  return false;
}

/** Bash expands comma braces before globbing, including nested braces. */
function expandShellBraces(candidate: string): string[] | null {
  let variants = [candidate];
  while (true) {
    const next: string[] = [];
    let expanded = false;
    for (const variant of variants) {
      const match = /\{([^{}]*,[^{}]*)\}/.exec(variant);
      if (!match) {
        next.push(variant);
        continue;
      }
      expanded = true;
      for (const part of match[1]!.split(',')) {
        next.push(variant.slice(0, match.index) + part + variant.slice(match.index + match[0].length));
        if (next.length > 64) return null;
      }
    }
    if (!expanded) return variants;
    variants = next;
  }
}

/** Expand static shell globs without executing the shell or opening file content. */
function globContainsSecret(candidate: string): boolean {
  if (!/[*?[\]{}]/.test(candidate)) return false;
  const variants = expandShellBraces(candidate);
  if (!variants) return true;
  return variants.some((variant) => globVariantContainsSecret(variant));
}

function globVariantContainsSecret(candidate: string): boolean {
  const root = path.parse(candidate).root;
  let paths = [root];
  for (const segment of candidate.slice(root.length).split(path.sep).filter(Boolean)) {
    if (!/[*?[\]]/.test(segment)) {
      paths = paths.map((parent) => path.join(parent, segment));
      continue;
    }
    const escaped = segment.replace(/[.+^${}()|\\]/g, '\\$&')
      .replace(/\[!([^\]]+)\]/g, '[^$1]')
      .replace(/\*/g, '.*').replace(/\?/g, '.');
    let matcher: RegExp;
    try { matcher = new RegExp(`^${escaped}$`, process.platform === 'win32' || process.platform === 'darwin' ? 'i' : ''); }
    catch { return false; } // An invalid character class is literal to the shell.
    const next: string[] = [];
    for (const parent of paths) {
      let names: string[];
      try { names = fs.readdirSync(parent); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue;
        return true;
      }
      for (const name of names) {
        if ((process.platform === 'win32' || !name.startsWith('.') || segment.startsWith('.')) && matcher.test(name)) {
          next.push(path.join(parent, name));
          // An unbounded expansion is not safe to declare free of secrets.
          if (next.length > 4096) return true;
        }
      }
    }
    paths = next;
    if (paths.length === 0) return false;
  }
  return paths.some((file) => checkSecretFileAccess(file, 'read').secret);
}

interface GitInvocation {
  cwd: string;
  /** Global options that affect Git's object or path resolution in preflight. */
  preflight: string[];
  /** The option was parsed, but its effect on content cannot be reproduced safely. */
  unsafeConfiguration: boolean;
  unsafePager: boolean;
  informationOnly: boolean;
  subcommand: string;
  args: string[];
}

const GIT_GLOBAL_FLAGS = new Set([
  '-p', '--paginate', '-P', '--no-pager', '--bare', '--no-replace-objects',
  '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
  '--icase-pathspecs', '--no-optional-locks', '--no-lazy-fetch',
  '-v', '--version', '-h', '--help', '--html-path', '--man-path', '--info-path',
]);
const GIT_INFORMATION_FLAGS = new Set([
  '-v', '--version', '-h', '--help', '--html-path', '--man-path', '--info-path',
]);
const GIT_GLOBAL_VALUES = new Set([
  '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env',
  '--super-prefix', '--attr-source', '--list-cmds',
]);

function executableName(value: string): string {
  return path.win32.basename(value.replace(/^\\+/, '')).replace(/\.exe$/i, '').toLowerCase();
}

/** A literal Git executable anywhere in a shell segment needs a proved-safe parse. */
function containsGitExecutable(text: string): boolean {
  const executable = /(?:^|[^\w.-])\\?git(?:\.exe)?(?=$|[^\w.-])/i;
  // POSIX shell removes backslashes from executable words before lookup.
  // Apply that lexical rule to *all* escaped characters, rather than adding
  // special cases for each spelling of Git. Keep the raw check for Windows
  // paths, whose backslashes are separators instead.
  return executable.test(text) || executable.test(text.replace(/\\([^\r\n])/g, '$1'));
}

function hasActiveShellSyntax(text: string): boolean {
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  for (const char of text) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote !== 'single') { escaped = true; continue; }
    if (quote === 'single') { if (char === "'") quote = null; continue; }
    if (quote === 'double') {
      if (char === '"') quote = null;
      else if (char === '$' || char === '`') return true;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (/[|;&<>`$()]/.test(char)) return true;
  }
  return quote !== null;
}

function hasUnsafeGitEnvironment(text: string): boolean {
  return /(?:^|\s)GIT_(?!OPTIONAL_LOCKS=|CONFIG_NOSYSTEM=|TERMINAL_PROMPT=)[A-Z0-9_]+=/i.test(text);
}

/** Follow command prefixes that execute their remaining arguments as a program. */
function unwrapGitPrefix(parsed: { command: string; args: string[]; raw: string }, cwd: string):
  { command: string; args: string[]; cwd: string; unsafe: boolean; dynamic: boolean; shellPayload?: string } | null {
  let command = parsed.command;
  let args = [...parsed.args];
  let directory = cwd;
  let unsafe = hasUnsafeGitEnvironment(parsed.raw);
  for (let depth = 0; depth < 12; depth += 1) {
    const name = executableName(command);
    if (name === 'git') return { command, args, cwd: directory, unsafe, dynamic: false };
    if (['sh', 'bash', 'zsh'].includes(name) && /^-[a-z]*c$/i.test(args[0] ?? '')) {
      // The fallback parser strips redirections even inside the quoted -c
      // payload. Recover the shell's complete argument from the raw segment.
      const quoted = parsed.raw.match(/\b(?:sh|bash|zsh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1\s*$/i);
      return { command, args, cwd: directory, unsafe, dynamic: false,
        shellPayload: quoted?.[2] ?? args[1] };
    }
    if (name === 'env') {
      while (args.length) {
        const first = args[0]!;
        if (first === '--') { args.shift(); break; }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
          if (hasUnsafeGitEnvironment(first)) unsafe = true;
          args.shift(); continue;
        }
        if (first === '-C' || first === '--chdir' || first.startsWith('--chdir=') ||
            first.startsWith('-C') && first.length > 2) {
          const value = first === '-C' || first === '--chdir' ? args[1] :
            first.startsWith('--chdir=') ? first.slice(8) : first.slice(2);
          if (!value) return /\bgit\b/i.test(parsed.raw)
            ? { command, args, cwd: directory, unsafe: true, dynamic: true } : null;
          directory = path.resolve(directory, value);
          args.splice(0, first === '-C' || first === '--chdir' ? 2 : 1);
          continue;
        }
        if (['-i', '--ignore-environment', '-0', '--null'].includes(first)) { args.shift(); continue; }
        if (['-u', '--unset'].includes(first)) { args.splice(0, 2); continue; }
        if (first.startsWith('-')) return /\bgit\b/i.test(parsed.raw)
          ? { command, args, cwd: directory, unsafe: true, dynamic: true } : null;
        break;
      }
    } else if (name === 'nice') {
      if (['-n', '--adjustment'].includes(args[0] ?? '')) {
        args.shift();
        // tree-sitter omits numeric arguments from ParsedCommand.args.
        if (/^[+-]?\d+$/.test(args[0] ?? '')) args.shift();
      }
      else if (/^(?:-n|--adjustment=)/.test(args[0] ?? '')) args.shift();
    } else if (name === 'timeout') {
      while (args[0]?.startsWith('-')) {
        const option = args.shift()!;
        if (['-s', '--signal', '-k', '--kill-after'].includes(option) &&
            args[0] && executableName(args[0]) !== 'git') args.shift();
      }
      // The grammar also omits a bare numeric duration. Consume it only when
      // present, leaving the executable intact in either parser mode.
      if (/^\d+(?:\.\d+)?[smhd]?$/.test(args[0] ?? '')) args.shift();
    } else if (name === 'stdbuf') {
      while (/^-(?:[ioe].*|--(?:input|output|error)=.*)$/.test(args[0] ?? '')) args.shift();
    } else if (name === 'command') {
      if (args[0] === '-p') args.shift();
    } else if (name === 'exec') {
      while (['-c', '-l'].includes(args[0] ?? '')) args.shift();
      if (args[0] === '-a') args.splice(0, 2);
      if (args[0] === '--') args.shift();
    } else if (name === 'nohup') {
      if (args[0] === '--') args.shift();
    } else if (name === 'xargs') {
      while (args[0]?.startsWith('-')) {
        const option = args.shift()!;
        if (['-I', '-L', '-n', '-P', '-d', '-s', '-a', '--replace', '--max-lines',
          '--max-args', '--max-procs', '--delimiter', '--max-chars', '--arg-file'].includes(option)) args.shift();
      }
      if (executableName(args[0] ?? '') === 'git') {
        args.shift();
        return { command: 'git', args, cwd: directory, unsafe: true, dynamic: args.length === 0 };
      }
      return null;
    } else return null;
    if (!args.length) return null;
    command = args.shift()!;
  }
  return { command, args, cwd: directory, unsafe: true, dynamic: true };
}

/** Parse Git's global-option prefix once, before interpreting its subcommand. */
function parseGitInvocations(command: string, baseDir: string): { commands: GitInvocation[]; error: string | null } {
  const commands: GitInvocation[] = [];
  let segmentCwd = baseDir;
  const parsedCommands = parseShellCommand(command).commands;
  for (const parsed of parsedCommands) {
    if ((parsed.command === 'cd' || parsed.command === 'pushd') && parsed.args[0]) {
      segmentCwd = path.resolve(segmentCwd, parsed.args[0]);
      continue;
    }
    const unwrapped = unwrapGitPrefix(parsed, segmentCwd);
    if (!unwrapped) {
      // A shell, eval, time, xargs or other wrapper may execute Git without
      // being understood by this parser. Do not treat that as absence of Git.
      if (containsGitExecutable(parsed.raw) &&
          !(parsedCommands.length === 1 &&
            ['echo', 'printf'].includes(executableName(parsed.command)) &&
            !hasActiveShellSyntax(command))) {
        return { commands, error: 'Git invocation could not be checked' };
      }
      continue;
    }
    if (unwrapped.shellPayload) {
      const nested = parseGitInvocations(unwrapped.shellPayload, unwrapped.cwd);
      if (nested.error) return { commands, error: nested.error };
      if (containsGitExecutable(unwrapped.shellPayload) && nested.commands.length === 0)
        return { commands, error: 'Git invocation could not be checked' };
      commands.push(...nested.commands.map((item) => ({
        ...item, unsafeConfiguration: item.unsafeConfiguration || unwrapped.unsafe,
      })));
      continue;
    }
    if (unwrapped.dynamic) return { commands, error: 'Dynamic Git command could not be checked' };
    const args = [...unwrapped.args];
    let gitCwd = unwrapped.cwd;
    const preflight: string[] = [];
    let unsafeConfiguration = unwrapped.unsafe;
    let unsafePager = false;
    let informationOnly = false;
    while (args.length > 0) {
      const arg = args[0]!;
      if (!arg.startsWith('-')) break;
      if (GIT_GLOBAL_FLAGS.has(arg)) {
        args.shift();
        if (GIT_INFORMATION_FLAGS.has(arg)) informationOnly = true;
        else if (arg === '-p' || arg === '--paginate') unsafePager = true;
        else if (!['-P', '--no-pager'].includes(arg)) preflight.push(arg);
        continue;
      }
      if (arg === '-C' || arg.startsWith('-C') && !arg.startsWith('--')) {
        const value = arg === '-C' ? args[1] : arg.slice(2);
        if (!value) return { commands, error: 'Git global option -C needs a path' };
        gitCwd = path.resolve(gitCwd, value);
        args.splice(0, arg === '-C' ? 2 : 1);
        continue;
      }
      if (arg === '-c' || arg.startsWith('-c') && !arg.startsWith('--')) {
        const value = arg === '-c' ? args[1] : arg.slice(2);
        if (!value || !/^[A-Za-z][A-Za-z0-9.-]*=[^\r\n]*$/.test(value))
          return { commands, error: 'Invalid Git global configuration' };
        // Parse all -c forms, including common commit identity overrides.
        // Content inspection fails closed if the configuration can alter Git's
        // object lookup or launch a helper during preflight.
        if (!/^(?:user\.(?:name|email)|color\.ui|color\.pager|core\.quotePath)=[^\r\n]*$/i.test(value) &&
            !/^core\.pager=cat$/i.test(value))
          unsafeConfiguration = true;
        args.splice(0, arg === '-c' ? 2 : 1);
        continue;
      }
      const name = arg.split('=', 1)[0]!;
      if (GIT_GLOBAL_VALUES.has(name)) {
        const inline = arg.startsWith(`${name}=`);
        const value = inline ? arg.slice(name.length + 1) : args[1];
        if (!value) return { commands, error: `Git global option ${name} needs a value` };
        args.splice(0, inline ? 1 : 2);
        if (name === '--config-env') {
          if (!/^[A-Za-z][A-Za-z0-9.-]*=[A-Za-z_][A-Za-z0-9_]*$/.test(value))
            return { commands, error: 'Invalid Git global configuration' };
          unsafeConfiguration = true;
        } else if (name === '--list-cmds') {
          informationOnly = true;
        } else if (name === '--exec-path') {
          unsafePager = true;
        } else {
          preflight.push(`${name}=${value}`);
        }
        continue;
      }
      return { commands, error: `Unknown Git global option: ${arg}` };
    }
    const subcommand = args.shift();
    if (!subcommand) continue;
    commands.push({ cwd: gitCwd, preflight, unsafeConfiguration, unsafePager, informationOnly, subcommand, args });
  }
  return { commands, error: null };
}

function gitOutput(invocation: GitInvocation, query: string[], noMatchesAllowed = false): string | null {
  try {
    return execFileSync('git', [...invocation.preflight, ...query], {
      cwd: invocation.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000, maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    if (noMatchesAllowed && (error as { status?: number }).status === 1) return '';
    return null;
  }
}

/** A null answer is unsafe: history or the selected worktree could not be inventoried. */
function hasTrackedSecretPath(invocation: GitInvocation): boolean | null {
  const root = gitOutput(invocation, ['rev-parse', '--show-toplevel'])?.trim();
  if (!root) return null;
  const index = gitOutput(invocation, ['ls-files', '-z']);
  const history = gitOutput(invocation, ['log', '--all', '--reflog', '--name-only', '-z', '--format=']);
  if (index === null || history === null) return null;
  for (const relative of index.split('\0')) {
    if (relative && checkSecretFileAccess(path.resolve(root, relative), 'read').secret) return true;
  }
  for (const relative of history.split('\0')) {
    if (relative && checkSecretFileAccess(path.resolve(root, relative), 'read').secret) return true;
  }
  return false;
}

/** Only these forms cannot print a tracked blob or materialize it elsewhere. */
function isGitMetadataOnly(invocation: GitInvocation): boolean {
  const { subcommand, args } = invocation;
  if (['status', 'rev-parse', 'ls-files', 'ls-tree', 'rev-list'].includes(subcommand)) return true;
  if (subcommand === 'cat-file') return ['-t', '-s', '--batch-check'].includes(args[0] ?? '');
  if (subcommand === 'stash') return args[0] === 'list';
  return false;
}

/** Prove a cat-file blob belongs only to public tracked paths. */
function isPublicGitBlob(invocation: GitInvocation): boolean {
  const { args } = invocation;
  const spec = args.length === 2 && (args[0] === '-p' || args[0] === 'blob') ? args[1] : undefined;
  if (!spec) return false;
  const root = gitOutput(invocation, ['rev-parse', '--show-toplevel'])?.trim();
  const oid = gitOutput(invocation, ['rev-parse', '--verify', `${spec}^{object}`])?.trim();
  if (!root || !oid || gitOutput(invocation, ['cat-file', '-t', oid])?.trim() !== 'blob') return false;
  const history = gitOutput(invocation, ['rev-list', '--objects', '--all', '--reflog']);
  // rev-list --objects names an object only once. A blob shared by a public
  // file and a secret file can therefore look public there. Inspect every
  // historical file change before accepting that provenance.
  const rawChanges = gitOutput(invocation, [
    'log', '--all', '--reflog', '--root', '-m', '--no-renames', '--raw', '--no-abbrev', '-z', '--format=',
  ]);
  const index = gitOutput(invocation, ['ls-files', '--stage', '-z']);
  if (history === null || rawChanges === null || index === null) return false;
  const changePattern = /:[0-7]{6} [0-7]{6} [0-9a-f]{40,64} ([0-9a-f]{40,64}) [A-Z][0-9]*\0([^\0]*)\0/g;
  for (const match of rawChanges.matchAll(changePattern)) {
    if (match[1] === oid && checkSecretFileAccess(path.resolve(root, match[2]!), 'read').secret)
      return false;
  }
  if (rawChanges.replace(changePattern, '').replace(/[\0\r\n]/g, '') !== '') return false;
  const paths: string[] = [];
  for (const line of history.split('\n')) {
    if (line.startsWith(`${oid} `)) paths.push(line.slice(oid.length + 1));
  }
  for (const entry of index.split('\0')) {
    const match = entry.match(/^[0-7]{6} ([0-9a-f]+) \d+\t([\s\S]+)$/);
    if (match?.[1] === oid) paths.push(match[2]!);
  }
  return paths.length > 0 && paths.every((relative) =>
    !checkSecretFileAccess(path.resolve(root, relative), 'read').secret);
}

function isPublicGitBlame(invocation: GitInvocation): boolean {
  if (invocation.args.length === 0 || invocation.args.some((arg) =>
    arg.startsWith('-') && !['--', '-p', '--porcelain', '--line-porcelain', '-w'].includes(arg))) return false;
  const relative = invocation.args.at(-1)!;
  if (relative === '--' || relative.startsWith('-')) return false;
  const root = gitOutput(invocation, ['rev-parse', '--show-toplevel'])?.trim();
  return !!root && !checkSecretFileAccess(path.resolve(invocation.cwd, relative), 'read').secret;
}

const CHECKED_GIT_CONTENT = new Set([
  'show', 'log', 'grep', 'archive', 'format-patch', 'whatchanged', 'diff-tree', 'diff',
]);

function unverifiedGitContent(invocation: GitInvocation): string | null {
  if (invocation.unsafeConfiguration) return 'Git configuration could not be checked';
  if (invocation.unsafePager && hasTrackedSecretPath(invocation) !== false)
    return 'Git pager or executable path could expose a tracked secret';
  if (invocation.subcommand === 'cat-file') return isGitMetadataOnly(invocation) ||
    isPublicGitBlob(invocation) ? null : 'Git cat-file blob could not be proven public';
  if (invocation.subcommand === 'blame') return isPublicGitBlame(invocation) ? null :
    'Git blame path could not be proven public';
  if (invocation.informationOnly || isGitMetadataOnly(invocation) ||
      CHECKED_GIT_CONTENT.has(invocation.subcommand) ||
      invocation.subcommand === 'stash' && invocation.args[0] === 'show') return null;
  // Git aliases, plumbing and future subcommands are content-capable until
  // proven otherwise. This also covers hashes obtained in an earlier turn.
  return hasTrackedSecretPath(invocation) === false ? null :
    `Git subcommand ${invocation.subcommand} could expose a tracked secret`;
}

function trackedSecretForGitDiff(invocation: GitInvocation): string | null {
  if (invocation.informationOnly) return null;
  if (invocation.subcommand !== 'diff') return null;
  if (invocation.unsafeConfiguration) return 'Git diff configuration could not be checked';
  const args = invocation.args;
  const unsupported = 'Git diff could not be checked';
  // The preflight must observe the same file selection as the command sent
  // to Git. Unknown options (including --output) can change that selection
  // or write a result to a file that another tool reads in a later turn.
  const safeOptions = new Set([
    '-p', '--patch', '--binary', '--raw', '--stat', '--numstat',
    '--name-only', '--name-status', '--check', '--quiet',
    '--cached', '--staged', '--no-ext-diff', '--no-textconv',
    '--no-color', '--no-renames', '--exit-code',
  ]);
  const pathspecAt = args.indexOf('--');
  const beforePathspec = pathspecAt < 0 ? args : args.slice(0, pathspecAt);
  if (beforePathspec.some((arg) => arg.startsWith('-') &&
    !safeOptions.has(arg) && !/^--unified=\d+$/.test(arg) && !/^-U\d+$/.test(arg))) return unsupported;
  const metadataOnly = args.some((arg) =>
    ['--name-only', '--name-status', '--stat', '--numstat', '--check', '--quiet'].includes(arg));
  if (metadataOnly && !args.some((arg) => ['-p', '--patch', '--binary'].includes(arg))) return null;
  const queryArgs = args.filter((arg) => !['-p', '--patch', '--binary', '--raw', '--stat'].includes(arg));
  if (queryArgs.some((arg) => ['--ext-diff', '--textconv'].includes(arg))) return unsupported;
  const root = gitOutput(invocation, ['rev-parse', '--show-toplevel'])?.trim();
  const names = gitOutput(invocation, ['diff', '--name-only', '-z', ...queryArgs]);
  if (!root || names === null) return unsupported;
  return names.split('\0').find((file) =>
    file && checkSecretFileAccess(path.resolve(root, file), 'read').secret) ?? null;
}

/** Inspect Git path metadata before allowing commands that print file contents. */
function trackedSecretForGitContent(invocation: GitInvocation): string | null {
  if (invocation.informationOnly) return null;
  const { subcommand, args } = invocation;
  const stashShow = subcommand === 'stash' && args.shift() === 'show';
  if (!['show', 'log', 'grep', 'archive', 'format-patch', 'whatchanged', 'diff-tree'].includes(subcommand) && !stashShow) return null;
  const unsupported = 'Git content command could not be checked';
  if (invocation.unsafeConfiguration) return unsupported;
  const root = gitOutput(invocation, ['rev-parse', '--show-toplevel'])?.trim();
  if (!root) return unsupported;
  const secretInNames = (output: string): string | null => {
    for (const raw of output.split(/[\0\n]/)) {
      const name = raw.trim();
      if (!name) continue;
      // `git grep <revision>` prefixes paths with `<revision>:`.
      const relative = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
      if (checkSecretFileAccess(path.resolve(root, relative), 'read').secret) return relative;
    }
    return null;
  };
  const gitNames = (query: string[], noMatchesAllowed = false): string | null =>
    gitOutput(invocation, query, noMatchesAllowed);

  if (subcommand === 'show') {
    const pathspecAt = args.indexOf('--');
    const revisions = (pathspecAt < 0 ? args : args.slice(0, pathspecAt))
      .filter((arg) => !arg.startsWith('-'));
    for (const revision of revisions.length ? revisions : ['HEAD']) {
      if (revision.includes(':')) {
        const file = revision.slice(revision.lastIndexOf(':') + 1);
        if (checkSecretFileAccess(path.resolve(root, file), 'read').secret) return file;
        continue;
      }
      // `git show <blob hash>` prints raw blob bytes even with `--stat`.
      const type = gitNames(['cat-file', '-t', `${revision}^{}`]);
      if (type?.trim() !== 'commit') return unsupported;
    }
    if (revisions.length > 0 && revisions.every((revision) => revision.includes(':')) && pathspecAt < 0) return null;
    const patchRequested = args.some((arg) => arg === '-p' || arg === '--patch');
    if (!patchRequested && args.some((arg) =>
      ['--no-patch', '--stat', '--name-only', '--name-status', '--summary'].includes(arg))) return null;
    const queryArgs = args.filter((arg) => !['-p', '--patch', '--stat'].includes(arg));
    if (queryArgs.some((arg) => arg.startsWith('-') && !['--', '--root'].includes(arg))) return unsupported;
    const output = gitNames(['show', '--format=', '--name-only', '-z', ...(queryArgs.length ? queryArgs : ['HEAD'])]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (subcommand === 'log') {
    if (!args.some((arg) => ['-p', '--patch', '--word-diff'].includes(arg))) return null;
    const queryArgs = args.filter((arg) => !['-p', '--patch', '--word-diff'].includes(arg));
    if (queryArgs.some((arg) => arg.startsWith('-') &&
      !['--all', '--branches', '--tags', '--remotes', '--first-parent', '--reverse', '--'].includes(arg) &&
      !/^-[0-9]+$/.test(arg))) return unsupported;
    const output = gitNames(['log', '--format=', '--name-only', '-z', ...queryArgs]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (subcommand === 'grep') {
    const queryArgs: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i] ?? '';
      if (arg === '-f' || arg === '--file') {
        const patternFile = args[i + 1];
        if (!patternFile) return unsupported;
        if (checkSecretFileAccess(path.resolve(invocation.cwd, patternFile), 'read').secret) return patternFile;
      } else if (arg.startsWith('-f') && arg.length > 2) {
        const patternFile = arg.slice(2);
        if (checkSecretFileAccess(path.resolve(invocation.cwd, patternFile), 'read').secret) return patternFile;
      } else if (arg.startsWith('--file=')) {
        const patternFile = arg.slice('--file='.length);
        if (checkSecretFileAccess(path.resolve(invocation.cwd, patternFile), 'read').secret) return patternFile;
      }
      if (['-h', '-n', '-c', '-o', '--line-number', '--count', '--only-matching'].includes(arg)) continue;
      if (arg.startsWith('-') && !arg.startsWith('-f') && !arg.startsWith('--file=') &&
        !['--cached', '-i', '-F', '-E', '-P', '-e', '--file', '--', '--ignore-case', '--fixed-strings'].includes(arg)) {
        return unsupported;
      }
      queryArgs.push(arg);
    }
    const output = gitNames(['grep', '-l', '-z', ...queryArgs], true);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (stashShow && args.some((arg) => arg === '-p' || arg === '--patch')) {
    const refs = args.filter((arg) => !arg.startsWith('-'));
    const output = gitNames(['stash', 'show', '--name-only', '-z', ...refs]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (subcommand === 'archive') {
    const tree = args.find((arg) => !arg.startsWith('-'));
    if (!tree || args.some((arg) => arg.startsWith('-') &&
      !['--', '--worktree-attributes'].includes(arg) &&
      !/^--(?:format|prefix|output)=/.test(arg))) return unsupported;
    const pathspecAt = args.indexOf('--');
    const paths = pathspecAt < 0 ? args.slice(args.indexOf(tree) + 1).filter((arg) => !arg.startsWith('-')) : args.slice(pathspecAt + 1);
    const output = gitNames(['ls-tree', '-r', '--name-only', '-z', tree, ...(paths.length ? ['--', ...paths] : [])]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (subcommand === 'format-patch') {
    const queryArgs = args.filter((arg) => !['--stdout', '--no-signature'].includes(arg));
    if (queryArgs.some((arg) => arg.startsWith('-') && arg !== '--' && !/^-[0-9]+$/.test(arg))) return unsupported;
    const output = gitNames(['log', '--format=', '--name-only', '-z', ...queryArgs]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (subcommand === 'whatchanged') {
    if (!args.some((arg) => ['-p', '--patch'].includes(arg))) return null;
    const queryArgs = args.filter((arg) => !['-p', '--patch'].includes(arg));
    if (queryArgs.some((arg) => arg.startsWith('-') && arg !== '--' && !/^-[0-9]+$/.test(arg))) return unsupported;
    const output = gitNames(['log', '--format=', '--name-only', '-z', ...queryArgs]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  } else if (subcommand === 'diff-tree') {
    if (!args.some((arg) => ['-p', '--patch'].includes(arg))) return null;
    const queryArgs = args.filter((arg) => !['-p', '--patch'].includes(arg));
    if (queryArgs.some((arg) => arg.startsWith('-') && !['--', '--root', '-r', '--recursive'].includes(arg))) return unsupported;
    const output = gitNames(['diff-tree', '--name-only', '--root', '-r', '-z', ...queryArgs]);
    if (output === null) return unsupported;
    const secret = secretInNames(output);
    if (secret) return secret;
  }
  return null;
}

/**
 * Return the first token of `command` that designates a credential file (or a
 * glob / recursive read over a credential root), or null.
 */
export function findCredentialPathInCommand(command: string, platform: NodeJS.Platform = process.platform, cwd: string = process.cwd()): string | null {
  if (typeof command !== 'string' || !command) return null;
  // Shell joins adjacent quoted fragments and removes escaping before opening
  // paths. A backslash-newline (LF or CRLF) disappears before tokenization.
  // On Windows backslashes are path separators, not POSIX escapes.
  const joined = expandHomeReferences(command.replace(/\\\r?\n/g, ''));
  const expanded = joined
    .replace(/\$(?:""|'')/g, '')
    .replace(/\\([^\n])/g, platform === 'win32' ? '/$1' : '$1')
    .replace(/["']/g, '');
  const gitInvocations = parseGitInvocations(joined, cwd);
  if (gitInvocations.error) return gitInvocations.error;
  for (const invocation of gitInvocations.commands) {
    const unchecked = unverifiedGitContent(invocation);
    if (unchecked) return unchecked;
    const trackedSecret = trackedSecretForGitDiff(invocation);
    if (trackedSecret) return trackedSecret;
    const gitContentSecret = trackedSecretForGitContent(invocation);
    if (gitContentSecret) return gitContentSecret;
  }
  // A single Git metadata command names a path without reading its bytes.
  // Keep `rev-parse HEAD:.env` and `cat-file -t/-s` usable for inspection;
  // compound commands still pass through the ordinary secret-path checks.
  if (gitInvocations.commands.length === 1 &&
      parseShellCommand(joined).commands.length === 1 &&
      isGitMetadataOnly(gitInvocations.commands[0]!)) return null;
  const roots = getHomeCredentialRoots();
  // Keep commas inside shell brace expansion, e.g. `{notes.txt,.env}`.
  const tokens = expanded.split(/[\s`;|&<>()=]+/).filter(Boolean);
  const words = new Set(
    tokens.map((token) => token.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? ''),
  );
  const usesRecursiveReader = Array.from(words).some((word) => RECURSIVE_READERS.has(word));
  const usesSearchReader = ['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'].some((word) => words.has(word));
  const searchPatterns = new Set<number>();
  for (let i = 0; i < tokens.length; i += 1) {
    if (!['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'].includes(tokens[i]?.toLowerCase() ?? '')) continue;
    let patternFromOption = false;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const arg = tokens[j] ?? '';
      if (arg === '-e' || arg === '--regexp') {
        searchPatterns.add(j + 1);
        patternFromOption = true;
        j += 1;
        continue;
      }
      if (arg === '-f' || arg === '--file') {
        patternFromOption = true;
        j += 1; // This argument is a file to read, not a search expression.
        continue;
      }
      if (arg.startsWith('-e') && arg.length > 2) {
        patternFromOption = true;
        continue;
      }
      if (arg.startsWith('-f') && arg.length > 2) {
        patternFromOption = true;
        continue;
      }
      if (arg.startsWith('-')) continue;
      if (!patternFromOption) searchPatterns.add(j);
      break;
    }
  }
  const compact = expanded.replace(/[\s+]/g, '').toLowerCase();
  if (usesRecursiveReader &&
      /(?:\.codebuddy|\.codex|\.claude|\.grok|\.gemini|\.ssh|\.aws)/.test(compact) &&
      /(?:codex-auth|mcp-tokens|skill-signing|key\.pem|id_rsa|credentials|secrets|auth\.json)/.test(compact)) {
    return 'dynamically composed credential path';
  }
  const redirectionTargets = new Set(
    Array.from(expanded.matchAll(/>{1,2}\s*([^\s;|&<>]+)/g), match => match[1]),
  );
  // A plain filename query constrained to source files does not read file
  // content. This exception applies to that single command only.
  const namesOnlyFind = /^\s*find\s/.test(expanded) && !/[;&|]/.test(expanded) &&
    /\s-name\s+\*\.tsx?(?:\s|$)/.test(expanded) && !/\s-exec\b/.test(expanded);

  // A dynamic suffix under a credential root cannot be resolved statically.
  // Refuse that narrow case for readers before tokenization splits `$()`.
  if (usesRecursiveReader) {
    const dynamicPath = expanded.split(/[\s;|&<>]+/).find((token) =>
      roots.some((root) => {
        const normalizedRoot = platform === 'win32' ? root.replace(/\\/g, '/') : root;
        const separator = platform === 'win32' ? '/' : path.sep;
        return token.includes(`${normalizedRoot}${separator}`) && /\$|`/.test(token);
      }),
    );
    if (dynamicPath) return dynamicPath;
  }

  // `cd <credential root>` then a RELATIVE name: resolve relative tokens
  // against the last `cd` target seen in the command text.
  let cdTarget = cwd;
  for (let i = 0; i < tokens.length; i += 1) {
    // The search expression is data, even when it is `.` or a directory name.
    if (searchPatterns.has(i)) continue;
    const raw = tokens[i] ?? '';
    const token = usesSearchReader && /^-f[^-]/.test(raw)
      ? raw.slice(2) // grep/rg `-fFILE` reads FILE as a pattern file.
      : raw.replace(/^--?[A-Za-z0-9-]+=/, '');
    const base = path.basename(token).toLowerCase();
    if (BASH_CREDENTIAL_BASENAMES.has(base)) return raw;
    if (i > 0 && (tokens[i - 1] === 'cd' || tokens[i - 1] === 'pushd')) {
      cdTarget = path.isAbsolute(token) ? path.normalize(token) : path.resolve(cdTarget, token);
    }
    let candidate = token;
    if (!path.isAbsolute(token)) {
      if (token.startsWith('-')) continue;
      candidate = path.resolve(cdTarget, token);
    }
    const normalized = path.normalize(candidate).replace(/[\\/]+$/, '') || path.sep;
    const firstWord = tokens[0]?.toLowerCase();
    const isWriteDestination = i === tokens.lastIndexOf(raw) && (
      redirectionTargets.has(raw) ||
      (i === tokens.length - 1 && ['cp', 'mv', 'tee'].includes(firstWord ?? ''))
    );
    // Any command can receive the paths produced by shell expansion. A glob
    // that reaches a secret is unsafe even when the command is not on a list
    // of known readers (sort, plugins and user binaries included).
    if (globContainsSecret(normalized)) return raw;
    if (isWriteDestination && !checkSecretFileAccess(normalized, 'write').secret) continue;
    if (classifySecretPath(normalized).secret) return raw;
    let canonical = normalized;
    try { canonical = fs.realpathSync(normalized); } catch { /* missing path */ }
    const underRoot = roots.find(
      (root) => canonical === root || canonical.startsWith(root + path.sep),
    );
    if (/[*?[\]{}]/.test(normalized) && underRoot) return raw;
    const isCdTarget = i > 0 && (tokens[i - 1] === 'cd' || tokens[i - 1] === 'pushd');
    let isDirectory = false;
    try { isDirectory = fs.statSync(normalized).isDirectory(); } catch { /* missing path */ }
    // A recursive reader can reach a secret through an innocuous parent
    // (`grep -r pattern $HOME`, `tar -C ~ .`, `find . -exec cat`). Check the
    // directory operand itself, not only paths below a credential root.
    if (usesRecursiveReader && isDirectory && !isCdTarget && !namesOnlyFind && directoryContainsSecret(normalized)) return raw;
  }
  // grep -r PATTERN and rg PATTERN search cwd when no path was supplied.
  for (const match of expanded.matchAll(/(?:^|[;&|]\s*)(grep|egrep|fgrep|rg|ag|ack)\s+([^;&|]+)/g)) {
    const reader = match[1] ?? '';
    const args = (match[2] ?? '').trim().split(/\s+/);
    const positional = args.filter((arg) => !arg.startsWith('-'));
    const recursive = reader === 'rg' || reader === 'ag' || reader === 'ack' ||
      args.some((arg) => /^-[A-Za-z]*[rR]/.test(arg) || arg === '--recursive');
    if (recursive && positional.length === 1 && directoryContainsSecret(cdTarget)) return cdTarget;
  }
  return null;
}
