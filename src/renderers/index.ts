/**
 * Renderers Module
 *
 * Central export for the rendering system.
 * Provides specialized renderers for different data types.
 */

// Types
export * from './types.js';

// Core
export {
  RenderManager,
  getRenderManager,
  resetRenderManager,
  renderResponse,
  registerRenderer,
  configureRenderContext,
} from './render-manager.js';

// Specialized Renderers
export { testResultsRenderer } from './test-results-renderer.js';
export { weatherRenderer } from './weather-renderer.js';
export { codeStructureRenderer } from './code-structure-renderer.js';

// ============================================================================
// Auto-Registration
// ============================================================================

import { getRenderManager } from './render-manager.js';
import { testResultsRenderer } from './test-results-renderer.js';
import { weatherRenderer } from './weather-renderer.js';
import { codeStructureRenderer } from './code-structure-renderer.js';

/**
 * Initialize the render system with all built-in renderers
 * Call this once at application startup
 */
export function initializeRenderers(): void {
  const manager = getRenderManager();

  // Register all built-in renderers
  manager.register(testResultsRenderer);
  manager.register(weatherRenderer);
  manager.register(codeStructureRenderer);

  // Future renderers can be added here:
  // manager.register(diffRenderer);
  // manager.register(tableRenderer);
  // manager.register(treeRenderer);
}

/**
 * Check if renderers are initialized
 */
export function areRenderersInitialized(): boolean {
  return getRenderManager().getRenderers().length > 0;
}
