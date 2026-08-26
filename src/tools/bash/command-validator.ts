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
export function validateCommand(command: string, shell?: string): { valid: boolean; reason?: string } {
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

  // Check for access to blocked paths
  for (const blockedPath of BLOCKED_PATHS) {
    const isWindowsPath = blockedPath.includes('\\');
    const containsBlockedPath = isWindowsPath
      ? command.replace(/\//g, '\\').toLowerCase().includes(blockedPath.toLowerCase())
      : command.includes(blockedPath);
    if (containsBlockedPath) {
      auditLogger.logCommandValidation({ command, valid: false, reason: `Protected path: ${blockedPath}`, source: 'command-validator' });
      return {
        valid: false,
        reason: `Access to protected path blocked: ${blockedPath}`
      };
    }
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
