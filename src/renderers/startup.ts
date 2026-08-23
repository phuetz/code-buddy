/**
 * Minimal renderer bootstrap for the interactive CLI.
 *
 * The full renderer barrel intentionally remains available for consumers that
 * need every renderer. The CLI only needs the manager and its context during
 * the first paint, so specialized renderers are registered asynchronously.
 */

import {
  configureRenderContext,
  getRenderManager,
} from './render-manager.js';
import { logger } from '../utils/logger.js';

let specializedRenderersReady: Promise<void> | undefined;

/**
 * Start loading the specialized renderers without blocking the first TUI
 * paint. Network/LLM work cannot begin before these imports settle, so a
 * structured response still observes the same renderer registry in normal
 * operation; only the initial shell is allowed to paint first.
 */
export function initializeRenderers(): Promise<void> {
  if (specializedRenderersReady) return specializedRenderersReady;

  specializedRenderersReady = Promise.all([
    import('./test-results-renderer.js'),
    import('./weather-renderer.js'),
    import('./code-structure-renderer.js'),
    import('./diff-renderer.js'),
    import('./table-renderer.js'),
    import('./tree-renderer.js'),
  ]).then(([testResults, weather, codeStructure, diff, table, tree]) => {
    const manager = getRenderManager();
    manager.register(testResults.testResultsRenderer);
    manager.register(weather.weatherRenderer);
    manager.register(codeStructure.codeStructureRenderer);
    manager.register(diff.diffRenderer);
    manager.register(table.tableRenderer);
    manager.register(tree.treeRenderer);
  }).catch((error: unknown) => {
    logger.warn('Specialized renderer bootstrap failed; generic rendering remains available', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return specializedRenderersReady;
}

export { configureRenderContext, getRenderManager };
