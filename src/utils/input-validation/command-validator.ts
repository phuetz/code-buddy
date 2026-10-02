/**
 * Command Validation and Sanitization
 *
 * Validates shell commands for dangerous patterns and provides
 * shell-safe string escaping.
 */

import type { ValidationResult } from './types.js';

// ============================================================================
// Dangerous Command Patterns
// ============================================================================

/**
 * Dangerous command patterns for validation
 * These patterns detect various command injection and dangerous operation attempts
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // Filesystem destruction
  /rm\s+(-rf?|--recursive)\s+[/~]/i,          // rm -rf / or ~
  /rm\s+.*\/\s*$/i,                            // rm something/
  />\s*\/dev\/sd[a-z]/i,                       // Write to disk device
  /dd\s+.*if=.*of=\/dev/i,                     // dd to device
  /mkfs/i,                                      // Format filesystem
  /:\(\)\s*\{\s*:\|:&\s*\};:/,                 // Fork bomb :(){ :|:& };:
  /chmod\s+-R\s+777\s+\//i,                    // chmod 777 /

  // Remote code execution via pipe to shell
  /wget.*\|\s*(ba)?sh/i,                       // wget | sh
  /curl.*\|\s*(ba)?sh/i,                       // curl | sh
  /base64\s+(-d|--decode).*\|\s*(ba)?sh/i,    // base64 -d | sh

  // Sudo with dangerous commands
  /sudo\s+(rm|dd|mkfs)/i,

  // Command injection via command substitution
  /\$\([^)]*\b(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)\b/i,  // $(dangerous_cmd)
  /`[^`]*\b(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)\b/i,     // `dangerous_cmd`

  // Dangerous variable expansion that could leak secrets
  /\$\{?(?:GROK_API_KEY|AWS_SECRET|AWS_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|MORPH_API_KEY|DATABASE_URL|DB_PASSWORD|SECRET_KEY|PRIVATE_KEY|API_KEY|API_SECRET|AUTH_TOKEN|ACCESS_TOKEN)\}?/i,

  // Eval and exec injection
  /\beval\s+.*\$/i,                            // eval with variable expansion
  /\bexec\s+\d*[<>]/i,                         // exec with redirections

  // Hex/octal encoded commands (potential obfuscation)
  /\\x[0-9a-f]{2}/i,                           // Hex escape sequences
  /\\[0-7]{3}/,                                // Octal escape sequences
  /\$'\\x/i,                                   // ANSI-C quoting with hex

  // Network exfiltration and reverse shells
  /\|\s*(nc|netcat|curl|wget)\s+[^|]*(>|>>)/i, // pipe to network tool with redirect
  />\s*\/dev\/(tcp|udp)\//i,                   // bash network redirection
  /\bnc\s+-[elp]/i,                            // netcat listen/exec modes
  /\bbash\s+-i\s+>&?\s*\/dev\/(tcp|udp)/i,    // bash reverse shell

  // Python/Perl/Ruby one-liners that could be dangerous
  /python[23]?\s+-c\s+['"].*(?:socket|subprocess|os\.system|eval|exec)/i,
  /perl\s+-e\s+['"].*(?:socket|system|exec)/i,
  /ruby\s+-e\s+['"].*(?:socket|system|exec)/i,
];

// ============================================================================
// Command Validation
// ============================================================================

/**
 * Validate a command for dangerous patterns
 */
export function validateCommand(command: string): ValidationResult<string> {
  if (!command || typeof command !== 'string') {
    return { valid: false, error: 'Command must be a non-empty string' };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: `Dangerous command pattern detected` };
    }
  }

  return { valid: true, value: command };
}

/**
 * Sanitize a string for safe shell use
 */
export function sanitizeForShell(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // Escape single quotes by ending the quote, adding escaped quote, and reopening
  const escaped = input.replace(/'/g, "'\\''");

  // Wrap in single quotes for safety
  return `'${escaped}'`;
}
