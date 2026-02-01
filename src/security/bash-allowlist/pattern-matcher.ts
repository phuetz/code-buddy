/**
 * Pattern Matcher
 *
 * Matches commands against patterns using various matching strategies:
 * - Exact: String equality
 * - Prefix: Command starts with pattern
 * - Glob: Shell-like glob patterns (*, ?, etc.)
 * - Regex: Full regular expression matching
 */

import type { PatternType, ApprovalPattern } from './types.js';

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Match a command against a pattern
 * @param command Command string to check
 * @param pattern Pattern to match against
 * @param type Type of pattern matching
 * @returns True if command matches pattern
 */
export function matchPattern(
  command: string,
  pattern: string,
  type: PatternType
): boolean {
  const normalizedCommand = normalizeCommand(command);
  const normalizedPattern = pattern.trim();

  switch (type) {
    case 'exact':
      return matchExact(normalizedCommand, normalizedPattern);

    case 'prefix':
      return matchPrefix(normalizedCommand, normalizedPattern);

    case 'glob':
      return matchGlob(normalizedCommand, normalizedPattern);

    case 'regex':
      return matchRegex(normalizedCommand, normalizedPattern);

    default:
      return false;
  }
}

/**
 * Match a command against an ApprovalPattern
 */
export function matchApprovalPattern(
  command: string,
  pattern: ApprovalPattern
): boolean {
  if (!pattern.enabled) {
    return false;
  }

  // Check expiration
  if (pattern.expiresAt && new Date() > new Date(pattern.expiresAt)) {
    return false;
  }

  return matchPattern(command, pattern.pattern, pattern.type);
}

/**
 * Find the best matching pattern from a list
 * @param command Command to match
 * @param patterns List of patterns to check
 * @returns Best matching pattern or undefined
 */
export function findBestMatch(
  command: string,
  patterns: ApprovalPattern[]
): ApprovalPattern | undefined {
  const matches: Array<{ pattern: ApprovalPattern; score: number }> = [];

  for (const pattern of patterns) {
    if (matchApprovalPattern(command, pattern)) {
      // Calculate match score (more specific patterns score higher)
      const score = calculateMatchScore(command, pattern);
      matches.push({ pattern, score });
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  // Sort by score (highest first) then by decision (deny takes precedence)
  matches.sort((a, b) => {
    // Deny patterns have priority
    if (a.pattern.decision === 'deny' && b.pattern.decision !== 'deny') return -1;
    if (b.pattern.decision === 'deny' && a.pattern.decision !== 'deny') return 1;
    // Then by score
    return b.score - a.score;
  });

  return matches[0].pattern;
}

// ============================================================================
// Match Strategies
// ============================================================================

/**
 * Exact string match
 */
function matchExact(command: string, pattern: string): boolean {
  return command === pattern;
}

/**
 * Prefix match - command starts with pattern
 */
function matchPrefix(command: string, pattern: string): boolean {
  return command.startsWith(pattern);
}

/**
 * Glob pattern match
 * Supports: * (any chars), ? (single char), ** (any including /)
 */
function matchGlob(command: string, pattern: string): boolean {
  // Convert glob to regex
  const regexPattern = globToRegex(pattern);
  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(command);
  } catch {
    // Invalid pattern - no match
    return false;
  }
}

/**
 * Regular expression match
 */
function matchRegex(command: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(command);
  } catch {
    // Invalid regex - no match
    return false;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize a command for matching
 */
function normalizeCommand(command: string): string {
  return command
    .trim()
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Remove leading/trailing quotes
    .replace(/^["']|["']$/g, '');
}

/**
 * Convert a glob pattern to a regex pattern
 */
function globToRegex(glob: string): string {
  let regex = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i];

    switch (char) {
      case '*':
        // Check for **
        if (glob[i + 1] === '*') {
          regex += '.*';
          i++;
        } else {
          // Single * matches anything (including spaces and special chars)
          regex += '.*';
        }
        break;

      case '?':
        // Match any single character
        regex += '.';
        break;

      case '[':
        // Character class - pass through
        const closeIdx = glob.indexOf(']', i);
        if (closeIdx > i) {
          regex += glob.slice(i, closeIdx + 1);
          i = closeIdx;
        } else {
          regex += '\\[';
        }
        break;

      case '(':
      case ')':
      case '{':
      case '}':
      case '^':
      case '$':
      case '+':
      case '.':
      case '|':
      case '\\':
        // Escape regex special characters
        regex += '\\' + char;
        break;

      default:
        regex += char;
    }

    i++;
  }

  return regex;
}

/**
 * Calculate match score (higher = more specific match)
 */
function calculateMatchScore(command: string, pattern: ApprovalPattern): number {
  let score = 0;

  // Exact matches score highest
  if (pattern.type === 'exact') {
    score += 100;
  }

  // Longer patterns are more specific
  score += pattern.pattern.length;

  // Prefix matches score based on how much of command is matched
  if (pattern.type === 'prefix') {
    const coverage = pattern.pattern.length / command.length;
    score += coverage * 50;
  }

  // Patterns without wildcards are more specific
  if (pattern.type === 'glob') {
    const wildcardCount = (pattern.pattern.match(/[*?]/g) || []).length;
    score -= wildcardCount * 5;
  }

  // User patterns have slight priority over system
  if (pattern.source === 'user') {
    score += 10;
  }

  // Frequently used patterns get a small boost
  score += Math.min(pattern.useCount, 20);

  return score;
}

// ============================================================================
// Pattern Validation
// ============================================================================

/**
 * Validate a pattern before saving
 */
export function validatePattern(
  pattern: string,
  type: PatternType
): { valid: boolean; error?: string } {
  if (!pattern || pattern.trim().length === 0) {
    return { valid: false, error: 'Pattern cannot be empty' };
  }

  // Check pattern length
  if (pattern.length > 500) {
    return { valid: false, error: 'Pattern too long (max 500 chars)' };
  }

  // For regex, validate it's a valid regex
  if (type === 'regex') {
    try {
      new RegExp(pattern);
    } catch (error) {
      return {
        valid: false,
        error: `Invalid regex: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }

  // Check for overly broad patterns
  if (type === 'glob' && (pattern === '*' || pattern === '**')) {
    return {
      valid: false,
      error: 'Pattern too broad - would match all commands',
    };
  }

  if (type === 'regex' && (pattern === '.*' || pattern === '.+' || pattern === '^.*$')) {
    return {
      valid: false,
      error: 'Pattern too broad - would match all commands',
    };
  }

  return { valid: true };
}

/**
 * Generate a suggested pattern from a command
 */
export function suggestPattern(command: string): { pattern: string; type: PatternType } {
  const parts = command.trim().split(/\s+/);

  if (parts.length === 1) {
    // Single command - suggest exact match
    return { pattern: command, type: 'exact' };
  }

  // Multiple parts - suggest prefix or glob
  const baseCommand = parts[0];

  // Common patterns
  if (baseCommand === 'npm' || baseCommand === 'yarn' || baseCommand === 'pnpm') {
    // npm run <script> - suggest npm run <script>*
    if (parts[1] === 'run' && parts[2]) {
      return { pattern: `${baseCommand} run ${parts[2]}*`, type: 'glob' };
    }
    // npm <command> - suggest npm <command>*
    return { pattern: `${baseCommand} ${parts[1]}*`, type: 'glob' };
  }

  if (baseCommand === 'git') {
    // git <subcommand> - suggest git <subcommand>*
    return { pattern: `git ${parts[1]}*`, type: 'glob' };
  }

  // Default: suggest command prefix with wildcard
  if (parts.length >= 2) {
    return { pattern: `${parts[0]} ${parts[1]}*`, type: 'glob' };
  }

  return { pattern: command, type: 'exact' };
}

/**
 * Extract the base command (first word) from a command string
 */
export function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) {
    return trimmed;
  }
  return trimmed.slice(0, firstSpace);
}

/**
 * Check if a pattern would match dangerous commands
 */
export function isPatternDangerous(pattern: string, type: PatternType): boolean {
  // Check if the pattern itself starts with a dangerous command
  const dangerousPrefixes = [
    'rm', 'sudo', 'dd', 'mkfs', 'chmod', 'chown', 'curl', 'wget',
  ];

  const normalizedPattern = pattern.toLowerCase().trim();

  // Check if pattern starts with dangerous command
  for (const dangerous of dangerousPrefixes) {
    if (normalizedPattern.startsWith(dangerous + ' ') || normalizedPattern === dangerous) {
      return true;
    }
    // Also check if the pattern would match a dangerous command
    if (type === 'glob' || type === 'regex') {
      // Test if pattern could match just the dangerous command
      if (matchPattern(dangerous, pattern, type)) {
        return true;
      }
    }
  }

  // Check for specific dangerous patterns
  const dangerousPatterns = [
    /^rm\b/i,
    /^sudo\b/i,
    /^dd\b/i,
    /^mkfs\b/i,
    /^chmod\b/i,
    /^chown\b/i,
    /\|\s*(ba)?sh/i,
    />\s*\/dev\//i,
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return true;
    }
  }

  return false;
}
