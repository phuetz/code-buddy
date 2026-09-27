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

function directoryContainsSecret(directory: string): boolean {
  const pending = [directory];
  const seen = new Set<string>();
  let inspected = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    let canonical: string;
    try { canonical = fs.realpathSync(current); } catch { return true; }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return true; }
    for (const entry of entries) {
      if (++inspected > 10_000) return true;
      const child = path.join(current, entry.name);
      if (checkSecretFileAccess(child, 'read').secret) return true;
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isSymbolicLink()) {
        try { if (fs.statSync(child).isDirectory()) pending.push(child); } catch { return true; }
      }
    }
  }
  return false;
}

/** Expand one shell glob segment without executing the shell or opening files. */
function globContainsSecret(candidate: string): boolean {
  const parent = path.dirname(candidate);
  const pattern = path.basename(candidate);
  if (/[*?[\]{}]/.test(parent) || (!/[*?]/.test(pattern) && !pattern.includes('['))) return false;
  let names: string[];
  try { names = fs.readdirSync(parent); } catch { return false; }
  const escaped = pattern.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.');
  let matcher: RegExp;
  try { matcher = new RegExp(`^${escaped}$`); } catch { return false; }
  return names.some((name) =>
    (!name.startsWith('.') || pattern.startsWith('.')) &&
    matcher.test(name) && checkSecretFileAccess(path.join(parent, name), 'read').secret,
  );
}

function trackedSecretForGitDiff(command: string, baseDir: string): string | null {
  const invocation = command.match(/(?:^|[;&|]\s*)git\s+(?:-C\s+([^\s;&|]+)\s+)?diff(?:\s|$)/i);
  if (!invocation) return null;
  const prior = command.slice(0, invocation.index ?? 0);
  const cdMatches = Array.from(prior.matchAll(/(?:^|[;&|]\s*)cd\s+([^\s;&|]+)/g));
  const gitCwd = invocation[1] ?? cdMatches.at(-1)?.[1] ?? baseDir;
  const cwd = path.resolve(baseDir, gitCwd);
  const tail = command.slice((invocation.index ?? 0) + invocation[0].length).split(/[;&|]/, 1)[0] ?? '';
  const pathspecs = tail.match(/(?:^|\s)--\s+(.+)$/)?.[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
  try {
    const names = execFileSync('git', ['ls-files', '--cached', '-z', ...(pathspecs.length ? ['--', ...pathspecs] : [])], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000,
    });
    return names.split('\0').find(file => file && checkSecretFileAccess(path.resolve(cwd, file), 'read').secret) ?? null;
  } catch {
    return null;
  }
}

/**
 * Return the first token of `command` that designates a credential file (or a
 * glob / recursive read over a credential root), or null.
 */
export function findCredentialPathInCommand(command: string, platform: NodeJS.Platform = process.platform, cwd: string = process.cwd()): string | null {
  if (typeof command !== 'string' || !command) return null;
  // Shell joins adjacent quoted fragments and removes escaping before opening
  // paths. On Windows backslashes are path separators, not POSIX escapes.
  const expanded = expandHomeReferences(command)
    .replace(/\$(?:""|'')/g, '')
    .replace(/\\([^\n])/g, platform === 'win32' ? '/$1' : '$1')
    .replace(/["']/g, '');
  const trackedSecret = trackedSecretForGitDiff(expanded, cwd);
  if (trackedSecret) return trackedSecret;
  const roots = getHomeCredentialRoots();
  const tokens = expanded.split(/[\s`;|&<>()=,]+/).filter(Boolean);
  const words = new Set(
    tokens.map((token) => token.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? ''),
  );
  const usesRecursiveReader = Array.from(words).some((word) => RECURSIVE_READERS.has(word));
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
    const raw = tokens[i] ?? '';
    const token = raw.replace(/^--?[A-Za-z0-9-]+=/, '');
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
    if (isWriteDestination && !checkSecretFileAccess(normalized, 'write').secret) continue;
    if (classifySecretPath(normalized).secret) return raw;
    if (usesRecursiveReader && globContainsSecret(normalized)) return raw;
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
