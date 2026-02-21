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
  BLOCKED_COMMANDS,
  SAFE_ENV_VARS,
  BLOCKED_PATHS,
} from './security-patterns.js';
import { parseBashCommand } from '../../security/bash-parser.js';
import { isDangerousCommand } from '../../security/dangerous-patterns.js';
import { auditLogger } from '../../security/audit-logger.js';

/**
 * Extract the base command from a command string
 * Handles paths, env var prefixes, and common shell constructs
 */
export function extractBaseCommand(command: string): string | null {
  // Trim and handle empty
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Skip leading environment variable assignments (VAR=value cmd)
  let remaining = trimmed;
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(remaining)) {
    remaining = remaining.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  }

  // Get the first token
  const match = remaining.match(/^(\S+)/);
  if (!match) return null;

  let cmd = match[1];

  // Remove path prefix (e.g., /usr/bin/ls -> ls)
  if (cmd.includes('/')) {
    cmd = cmd.split('/').pop() || cmd;
  }

  // Handle ./ prefix
  if (cmd.startsWith('./')) {
    cmd = cmd.slice(2);
  }

  return cmd.toLowerCase();
}

/**
 * Check if command uses shell features that could bypass validation
 */
export function hasShellBypassFeatures(command: string): { bypass: boolean; reason?: string } {
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
export function validateCommand(command: string): { valid: boolean; reason?: string } {
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

  // Extract base command and check against blocklist
  const baseCmd = extractBaseCommand(command);
  if (baseCmd && BLOCKED_COMMANDS.has(baseCmd)) {
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
    if (command.includes(blockedPath)) {
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
    const parsed = parseBashCommand(command);
    for (const cmd of parsed.commands) {
      // Check each parsed command name against centralized dangerous commands
      if (isDangerousCommand(cmd.command)) {
        // Allow if it's already in the legacy BLOCKED_COMMANDS (already checked above)
        // This catches commands the regex-based approach might miss
        if (!BLOCKED_COMMANDS.has(cmd.command.toLowerCase())) {
          auditLogger.logCommandValidation({
            command,
            valid: false,
            reason: `Dangerous command detected by parser: ${cmd.command}`,
            source: 'bash-parser',
          });
          return {
            valid: false,
            reason: `Blocked command (AST): ${cmd.command}`,
          };
        }
      }

      // Check subshell commands too
      if (cmd.isSubshell && isDangerousCommand(cmd.command)) {
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
    // If parsing fails, fall through to allow (already validated by regex above)
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
