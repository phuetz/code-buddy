/**
 * Subsystem Reloader
 *
 * Handles reloading of individual subsystems when configuration changes.
 * Supports rollback on failure and dependency-aware reload ordering.
 */

import type {
  SubsystemId,
  SubsystemReloader,
  ConfigChange,
  ReloadResult,
} from './types.js';
import { SUBSYSTEM_PRIORITY, SUBSYSTEM_DEPENDENCIES } from './types.js';
import { groupChangesBySubsystem } from './diff.js';

/**
 * Subsystem reloader registry
 */
class ReloaderRegistry {
  private reloaders: Map<SubsystemId, SubsystemReloader> = new Map();
  private rollbackHandlers: Map<SubsystemId, (change: ConfigChange) => Promise<void>> = new Map();

  /**
   * Register a reloader for a subsystem
   */
  register(
    subsystem: SubsystemId,
    reloader: SubsystemReloader,
    rollbackHandler?: (change: ConfigChange) => Promise<void>
  ): void {
    this.reloaders.set(subsystem, reloader);
    if (rollbackHandler) {
      this.rollbackHandlers.set(subsystem, rollbackHandler);
    }
  }

  /**
   * Unregister a reloader
   */
  unregister(subsystem: SubsystemId): void {
    this.reloaders.delete(subsystem);
    this.rollbackHandlers.delete(subsystem);
  }

  /**
   * Get a reloader for a subsystem
   */
  get(subsystem: SubsystemId): SubsystemReloader | undefined {
    return this.reloaders.get(subsystem);
  }

  /**
   * Get a rollback handler
   */
  getRollback(subsystem: SubsystemId): ((change: ConfigChange) => Promise<void>) | undefined {
    return this.rollbackHandlers.get(subsystem);
  }

  /**
   * Check if a subsystem has a reloader
   */
  has(subsystem: SubsystemId): boolean {
    return this.reloaders.has(subsystem);
  }

  /**
   * Get all registered subsystems
   */
  getRegisteredSubsystems(): SubsystemId[] {
    return Array.from(this.reloaders.keys());
  }
}

// Singleton registry
const registry = new ReloaderRegistry();

/**
 * Register a subsystem reloader
 */
export function registerReloader(
  subsystem: SubsystemId,
  reloader: SubsystemReloader,
  rollbackHandler?: (change: ConfigChange) => Promise<void>
): void {
  registry.register(subsystem, reloader, rollbackHandler);
}

/**
 * Unregister a subsystem reloader
 */
export function unregisterReloader(subsystem: SubsystemId): void {
  registry.unregister(subsystem);
}

/**
 * Sort subsystems by priority and dependencies
 */
export function sortByPriority(subsystems: SubsystemId[]): SubsystemId[] {
  return [...subsystems].sort((a, b) => {
    const priorityA = SUBSYSTEM_PRIORITY[a] ?? 100;
    const priorityB = SUBSYSTEM_PRIORITY[b] ?? 100;
    return priorityA - priorityB;
  });
}

/**
 * Get all subsystems that need to be reloaded (including dependencies)
 */
export function getReloadOrder(subsystems: SubsystemId[]): SubsystemId[] {
  const toReload = new Set(subsystems);
  const visited = new Set<SubsystemId>();
  const order: SubsystemId[] = [];

  // Sort by priority first
  const sorted = sortByPriority(subsystems);

  function visit(subsystem: SubsystemId): void {
    if (visited.has(subsystem)) return;
    visited.add(subsystem);

    // Add this subsystem first
    if (toReload.has(subsystem)) {
      order.push(subsystem);
    }

    // Then add dependents
    const deps = SUBSYSTEM_DEPENDENCIES[subsystem] || [];
    for (const dep of deps) {
      if (toReload.has(dep)) {
        visit(dep);
      }
    }
  }

  for (const subsystem of sorted) {
    visit(subsystem);
  }

  return order;
}

/**
 * Reload a single subsystem
 */
async function reloadSubsystem(
  subsystem: SubsystemId,
  changes: ConfigChange[]
): Promise<ReloadResult> {
  const reloader = registry.get(subsystem);

  if (!reloader) {
    return {
      success: true,
      subsystem,
      duration: 0,
      error: `No reloader registered for ${subsystem}`,
    };
  }

  const startTime = Date.now();

  try {
    // Apply each change
    for (const change of changes) {
      const result = await reloader(change);
      if (!result.success) {
        return {
          success: false,
          subsystem,
          duration: Date.now() - startTime,
          error: result.error,
        };
      }
    }

    return {
      success: true,
      subsystem,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      subsystem,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Rollback a subsystem to previous state
 */
async function rollbackSubsystem(
  subsystem: SubsystemId,
  changes: ConfigChange[]
): Promise<boolean> {
  const rollbackHandler = registry.getRollback(subsystem);

  if (!rollbackHandler) {
    return false;
  }

  try {
    // Rollback in reverse order
    for (const change of [...changes].reverse()) {
      const rollbackChange: ConfigChange = {
        ...change,
        oldValue: change.newValue,
        newValue: change.oldValue,
      };
      await rollbackHandler(rollbackChange);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reload all affected subsystems
 */
export async function reloadSubsystems(
  changes: ConfigChange[],
  options: {
    rollbackOnFailure?: boolean;
    stopOnFirstError?: boolean;
    parallel?: boolean;
  } = {}
): Promise<ReloadResult[]> {
  const {
    rollbackOnFailure = true,
    stopOnFirstError = false,
    parallel = false,
  } = options;

  const results: ReloadResult[] = [];
  const successfulReloads: Array<{ subsystem: SubsystemId; changes: ConfigChange[] }> = [];

  // Group changes by subsystem
  const grouped = groupChangesBySubsystem(changes);
  const subsystems = Array.from(grouped.keys());

  // Get reload order
  const reloadOrder = getReloadOrder(subsystems);

  if (parallel) {
    // Reload in parallel (ignoring order)
    const promises = reloadOrder.map(async (subsystem) => {
      const subsystemChanges = grouped.get(subsystem) || [];
      return reloadSubsystem(subsystem, subsystemChanges);
    });

    const parallelResults = await Promise.all(promises);
    results.push(...parallelResults);
  } else {
    // Reload sequentially in order
    for (const subsystem of reloadOrder) {
      const subsystemChanges = grouped.get(subsystem) || [];
      const result = await reloadSubsystem(subsystem, subsystemChanges);
      results.push(result);

      if (result.success) {
        successfulReloads.push({ subsystem, changes: subsystemChanges });
      } else {
        if (stopOnFirstError) {
          break;
        }
      }
    }
  }

  // Check for failures and rollback if needed
  const hasFailures = results.some(r => !r.success);

  if (hasFailures && rollbackOnFailure && successfulReloads.length > 0) {
    // Rollback in reverse order
    for (const { subsystem, changes: subsystemChanges } of [...successfulReloads].reverse()) {
      const rolled = await rollbackSubsystem(subsystem, subsystemChanges);
      const result = results.find(r => r.subsystem === subsystem);
      if (result) {
        result.rollback = rolled;
      }
    }
  }

  return results;
}

/**
 * Check if all required reloaders are registered
 */
export function hasAllReloaders(subsystems: SubsystemId[]): boolean {
  return subsystems.every(s => registry.has(s));
}

/**
 * Get missing reloaders for subsystems
 */
export function getMissingReloaders(subsystems: SubsystemId[]): SubsystemId[] {
  return subsystems.filter(s => !registry.has(s));
}

/**
 * Create a no-op reloader (for subsystems that don't need special handling)
 */
export function createNoOpReloader(subsystem: SubsystemId): SubsystemReloader {
  return async (_change: ConfigChange): Promise<ReloadResult> => ({
    success: true,
    subsystem,
    duration: 0,
  });
}

/**
 * Create a simple reloader from a callback
 */
export function createSimpleReloader(
  subsystem: SubsystemId,
  callback: (newValue: unknown) => Promise<void>
): SubsystemReloader {
  return async (change: ConfigChange): Promise<ReloadResult> => {
    const startTime = Date.now();
    try {
      await callback(change.newValue);
      return {
        success: true,
        subsystem,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        subsystem,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}

// Export registry for testing
export { registry as _registry };
