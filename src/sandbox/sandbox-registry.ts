/**
 * Sandbox Registry
 *
 * Strategy pattern registry that routes to the best available sandbox backend.
 * Native Engine v2026.3.14 — pluggable sandbox backends.
 */

import { logger } from '../utils/logger.js';
import type { SandboxBackendInterface, SandboxExecOptions, SandboxExecResult } from './sandbox-backend.js';

// ============================================================================
// Registry
// ============================================================================

/** Registered backends, ordered by priority (highest first) */
const backends: Array<{ priority: number; backend: SandboxBackendInterface }> = [];

/** Cached active backend (resolved on first use) */
let activeBackend: SandboxBackendInterface | null = null;

/**
 * Register a sandbox backend with a given priority.
 * Higher priority backends are preferred.
 */
export function registerSandboxBackend(backend: SandboxBackendInterface, priority: number = 0): void {
  backends.push({ priority, backend });
  backends.sort((a, b) => b.priority - a.priority);
  // Invalidate cache when a new backend is registered
  activeBackend = null;
  logger.debug(`Sandbox backend registered: ${backend.name} (priority=${priority})`);
}

/**
 * Get the best available sandbox backend.
 * Checks backends in priority order and returns the first available one.
 */
export async function getActiveSandboxBackend(): Promise<SandboxBackendInterface | null> {
  if (activeBackend) return activeBackend;

  for (const { backend } of backends) {
    try {
      const available = await backend.isAvailable();
      if (available) {
        activeBackend = backend;
        logger.debug(`Active sandbox backend: ${backend.name}`);
        return backend;
      }
    } catch {
      logger.debug(`Sandbox backend ${backend.name} availability check failed`);
    }
  }

  logger.warn('No sandbox backend available');
  return null;
}

/**
 * Execute a command using the best available sandbox backend.
 */
export async function sandboxExecute(
  command: string,
  opts?: SandboxExecOptions,
): Promise<SandboxExecResult> {
  const backend = await getActiveSandboxBackend();
  if (!backend) {
    const error = 'No sandbox backend available';
    return {
      success: false,
      output: error,
      error,
      exitCode: 1,
      durationMs: 0,
    };
  }
  return backend.execute(command, opts);
}

/**
 * Get all registered backends and their availability status.
 */
export async function listSandboxBackends(): Promise<Array<{
  name: string;
  priority: number;
  available: boolean;
}>> {
  const results = [];
  for (const { priority, backend } of backends) {
    let available = false;
    try {
      available = await backend.isAvailable();
    } catch { /* ignore */ }
    results.push({ name: backend.name, priority, available });
  }
  return results;
}

/**
 * Reset registry state (for testing).
 */
export function resetSandboxRegistry(): void {
  backends.length = 0;
  activeBackend = null;
}
