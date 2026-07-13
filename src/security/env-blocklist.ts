/**
 * Environment Variable Blocklist
 *
 * Prevents dangerous environment variables from being passed into
 * sandboxed execution environments. These variables can be used to
 * inject code, preload libraries, or hijack build tools.
 *
 * Part of Native Engine Phase 2: Hardening Sandbox.
 */

import { logger } from '../utils/logger.js';

/**
 * Exact env var names to block.
 * These are known vectors for code injection / library preloading.
 */
export const BLOCKED_ENV_VARS: Set<string> = new Set([
  // JVM
  '_JAVA_OPTIONS',
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',

  // glibc
  'GLIBC_TUNABLES',

  // .NET
  'DOTNET_STARTUP_HOOKS',
  'DOTNET_SHARED_STORE',

  // Python
  'PYTHONBREAKPOINT',

  // Node.js — NODE_OPTIONS supports --require/--import (arbitrary JS at startup);
  // NODE_PATH hijacks module resolution. The single most dangerous vars to inherit
  // for a Node/Bun agent. Also removed from SAFE_ENV_VARS (security-patterns.ts).
  'NODE_OPTIONS',
  'NODE_PATH',

  // Shared library injection
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_LIBRARY_PATH',

  // Build tool injection
  'GRADLE_OPTS',
  'MAVEN_OPTS',
  'SBT_OPTS',
  'ANT_OPTS',
]);

/**
 * Prefixes to block. Any env var whose name starts with one of these
 * is stripped from the sandbox environment.
 */
export const BLOCKED_ENV_PREFIXES: string[] = [
  'GIT_',
  'NPM_CONFIG_',
];

/**
 * Returns a new env object with all blocked variables removed.
 * Logs a debug message for each variable that is stripped.
 */
export function sanitizeEnvVars(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (BLOCKED_ENV_VARS.has(key)) {
      logger.debug(`Blocked env var (exact match): ${key}`);
      continue;
    }

    const prefixBlocked = BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (prefixBlocked) {
      logger.debug(`Blocked env var (prefix match): ${key}`);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
