/**
 * Declarative Permission Rules
 *
 * Standard declarative rules: Bash(npm *), Edit(src/**), Read, Glob
 * Stored in .codebuddy/settings.json under permissions.allow/deny
 *
 * Pattern syntax:
 *   "Read"            → allow all Read operations
 *   "Bash(npm *)"     → allow bash commands starting with "npm "
 *   "Bash(git *)"     → allow bash commands starting with "git "
 *   "Edit(src/**)"    → allow edits to files under src/
 *   "Write(docs/*)"   → allow writes to docs/ directory
 *
 * Checked BEFORE Guardian Agent — declarative rules are fast O(n) checks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { matchGlobPatterns, resolvePathPattern } from '../utils/glob-utils.js';

// ============================================================================
// Types
// ============================================================================

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface DeclarativePermissionExplanation {
  decision: PermissionDecision;
  matchedRule?: string;
}

export interface DeclarativePermissions {
  allow?: string[];
  deny?: string[];
}

interface ParsedRule {
  toolName: string;
  argPattern: string | null; // null = match all args
}

// ============================================================================
// Rule Parser
// ============================================================================

/**
 * Parse a declarative rule string like "Bash(npm *)" or "Edit(src/**,!src/tests/**)" into structured form.
 * CC15: Supports multiple comma-separated patterns with negation.
 */
function parseRule(rule: string): ParsedRule {
  const match = rule.match(/^(\w+)\((.+)\)$/);
  if (match) {
    return { toolName: match[1], argPattern: match[2] };
  }
  return { toolName: rule, argPattern: null };
}

/**
 * Convert a simple glob/wildcard pattern to a regex.
 * Only supports * (any chars) — not full glob.
 */
function patternToRegex(pattern: string): RegExp {
  // Defense-in-depth: a pathologically long pattern (e.g. injected via a compromised
  // .codebuddy/settings.json) could compile to an expensive regex. Cap the source length
  // and fail closed to a never-matching regex so the rule simply does not apply.
  if (pattern.length > 500) {
    logger.warn(
      `Declarative rule pattern too long (${pattern.length} chars > 500); refusing to compile — rule will not match`,
    );
    return /(?!)/;
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^]*')
    .replace(/§DOUBLESTAR§/g, '.*');
  return new RegExp('^' + escaped + '$');
}

/**
 * Extract the primary argument from tool input for matching.
 *
 * For Bash: the command string
 * For Edit/Write/Read: the file path
 * For Glob/Grep: the pattern or path
 */
function extractPrimaryArg(toolName: string, toolArgs: Record<string, unknown>): string | null {
  const name = toolName.toLowerCase();

  if (name === 'bash' || name === 'shell_exec') {
    return (toolArgs.command as string) || (toolArgs.cmd as string) || null;
  }

  if (name === 'edit' || name === 'str_replace_editor' || name === 'str_replace') {
    return (toolArgs.file_path as string) || (toolArgs.path as string) || null;
  }

  if (name === 'write' || name === 'create_file' || name === 'file_write') {
    return (toolArgs.file_path as string) || (toolArgs.path as string) || null;
  }

  if (name === 'read' || name === 'view_file' || name === 'file_read') {
    return (toolArgs.file_path as string) || (toolArgs.path as string) || null;
  }

  if (name === 'glob') {
    return (toolArgs.pattern as string) || null;
  }

  if (name === 'grep' || name === 'search') {
    return (toolArgs.path as string) || (toolArgs.pattern as string) || null;
  }

  if (name.includes('chrome') || name.includes('gui') || name.includes('computer')) {
    return (
      (toolArgs.url as string) ||
      (toolArgs.target as string) ||
      (toolArgs.app as string) ||
      (toolArgs.text as string) ||
      null
    );
  }

  // For other tools, try common arg names
  return (
    (toolArgs.url as string) ||
    (toolArgs.target as string) ||
    (toolArgs.app as string) ||
    (toolArgs.file_path as string) ||
    (toolArgs.path as string) ||
    (toolArgs.command as string) ||
    null
  );
}

/**
 * For compound bash commands (e.g. "npm test && git push"),
 * split into individual commands for per-command matching.
 */
function splitBashCommands(command: string): string[] {
  // Split on && || ; |
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map(c => c.trim())
    .filter(c => c.length > 0);
}

// ============================================================================
// Permission Checker
// ============================================================================

/** Cached permissions from settings */
let _permissionsCache: DeclarativePermissions | null = null;
let _permissionsCachePath: string | null = null;

/**
 * Clear cached permissions (for testing or reload).
 */
export function clearPermissionsCache(): void {
  _permissionsCache = null;
  _permissionsCachePath = null;
}

/**
 * Load declarative permissions from settings.
 */
export function loadPermissions(projectRoot: string = process.cwd()): DeclarativePermissions {
  const settingsPath = path.join(projectRoot, '.codebuddy', 'settings.json');

  if (_permissionsCache && _permissionsCachePath === settingsPath) {
    return _permissionsCache;
  }

  let permissions: DeclarativePermissions = {};

  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      if (settings.permissions) {
        permissions = {
          allow: Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [],
          deny: Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [],
        };
      }
    } catch (err) {
      logger.debug(`Failed to load declarative permissions: ${err}`);
    }
  }

  _permissionsCache = permissions;
  _permissionsCachePath = settingsPath;
  return permissions;
}

/**
 * Check a single rule against a tool call.
 */
function matchesRule(rule: string, toolName: string, primaryArg: string | null): boolean {
  const parsed = parseRule(rule);

  // Tool name must match (case-insensitive)
  if (parsed.toolName.toLowerCase() !== toolName.toLowerCase()) {
    // Also try common aliases
    const aliases: Record<string, string[]> = {
      bash: ['shell_exec', 'bash'],
      edit: ['str_replace_editor', 'str_replace', 'edit'],
      write: ['create_file', 'file_write', 'write'],
      read: ['view_file', 'file_read', 'read'],
    };

    const normalizedTool = toolName.toLowerCase();
    const normalizedRule = parsed.toolName.toLowerCase();

    let aliasMatch = false;
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      if (
        (aliasList.includes(normalizedRule) || normalizedRule === canonical) &&
        (aliasList.includes(normalizedTool) || normalizedTool === canonical)
      ) {
        aliasMatch = true;
        break;
      }
    }

    if (!aliasMatch) return false;
  }

  // No arg pattern = match all invocations of this tool
  if (parsed.argPattern === null) return true;

  // Need a primary arg to match against
  if (primaryArg === null) return false;

  // CC15: Check if pattern contains path-like patterns (with /, ~, or //)
  const isPathTool = ['edit', 'write', 'read', 'str_replace_editor', 'create_file',
    'file_write', 'view_file', 'file_read', 'glob', 'grep'].includes(toolName.toLowerCase());

  if (isPathTool && (parsed.argPattern.includes('/') || parsed.argPattern.startsWith('~') || parsed.argPattern.includes('**'))) {
    // Parse comma-separated patterns with potential negation
    const patterns = parsed.argPattern.split(',').map(p => p.trim());
    const projectRoot = process.cwd();

    // Resolve path prefixes (~/, //, /)
    const resolvedPatterns = patterns.map(p => {
      const isNeg = p.startsWith('!');
      const raw = isNeg ? p.slice(1) : p;
      const resolved = resolvePathPattern(raw, projectRoot);
      return isNeg ? `!${resolved}` : resolved;
    });

    // Normalize the primary arg for comparison
    const normalizedArg = primaryArg.replace(/\\/g, '/');
    return matchGlobPatterns(normalizedArg, resolvedPatterns);
  }

  // Fallback: simple wildcard matching for bash commands etc.
  const regex = patternToRegex(parsed.argPattern);
  return regex.test(primaryArg);
}

/**
 * Check declarative permission for a tool call.
 *
 * @param toolName - The tool being called (e.g. "Bash", "Edit")
 * @param toolArgs - The tool's arguments
 * @param projectRoot - Project root directory
 * @returns 'allow' if explicitly allowed, 'deny' if explicitly denied, 'ask' if no rule matches
 */
export function checkDeclarativePermission(
  toolName: string,
  toolArgs: Record<string, unknown>,
  projectRoot: string = process.cwd(),
): PermissionDecision {
  return explainDeclarativePermission(toolName, toolArgs, projectRoot).decision;
}

export function explainDeclarativePermission(
  toolName: string,
  toolArgs: Record<string, unknown>,
  projectRoot: string = process.cwd(),
): DeclarativePermissionExplanation {
  const permissions = loadPermissions(projectRoot);
  return explainDeclarativePermissionFromPermissions(toolName, toolArgs, permissions);
}

export function explainDeclarativePermissionFromPermissions(
  toolName: string,
  toolArgs: Record<string, unknown>,
  permissions: DeclarativePermissions,
): DeclarativePermissionExplanation {
  const primaryArg = extractPrimaryArg(toolName, toolArgs);

  // For compound bash commands, ALL sub-commands must be allowed
  if ((toolName.toLowerCase() === 'bash' || toolName.toLowerCase() === 'shell_exec') && primaryArg) {
    const subCommands = splitBashCommands(primaryArg);
    if (subCommands.length > 1) {
      // Check deny first — any denied sub-command blocks everything
      for (const sub of subCommands) {
        const subResult = explainSingleCommand(toolName, sub, permissions);
        if (subResult.decision === 'deny') {
          logger.debug(`Declarative deny: compound command blocked by "${sub}"`);
          return subResult;
        }
      }
      // Then check allow — all must be allowed
      let matchedRule: string | undefined;
      for (const sub of subCommands) {
        const subResult = explainSingleCommand(toolName, sub, permissions);
        if (subResult.decision !== 'allow') return { decision: 'ask' };
        matchedRule ||= subResult.matchedRule;
      }
      return { decision: 'allow', matchedRule };
    }
  }

  return explainSingleCommand(toolName, primaryArg, permissions);
}

function explainSingleCommand(
  toolName: string,
  primaryArg: string | null,
  permissions: DeclarativePermissions,
): DeclarativePermissionExplanation {
  // Deny rules take precedence
  if (permissions.deny) {
    for (const rule of permissions.deny) {
      if (matchesRule(rule, toolName, primaryArg)) {
        logger.debug(`Declarative deny: ${toolName} matched rule "${rule}"`);
        return { decision: 'deny', matchedRule: rule };
      }
    }
  }

  // Then check allow rules
  if (permissions.allow) {
    for (const rule of permissions.allow) {
      if (matchesRule(rule, toolName, primaryArg)) {
        logger.debug(`Declarative allow: ${toolName} matched rule "${rule}"`);
        return { decision: 'allow', matchedRule: rule };
      }
    }
  }

  // No matching rule
  return { decision: 'ask' };
}

/**
 * Convenience: check if a tool call should skip confirmation.
 */
export function shouldAutoApprove(
  toolName: string,
  toolArgs: Record<string, unknown>,
  projectRoot?: string,
): boolean {
  return checkDeclarativePermission(toolName, toolArgs, projectRoot) === 'allow';
}

/**
 * Convenience: check if a tool call should be blocked.
 */
export function shouldBlock(
  toolName: string,
  toolArgs: Record<string, unknown>,
  projectRoot?: string,
): boolean {
  return checkDeclarativePermission(toolName, toolArgs, projectRoot) === 'deny';
}
