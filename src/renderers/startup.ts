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
import type { Renderer } from './types.js';
import { logger } from '../utils/logger.js';

export type SpecializedRendererBundle = {
  testResultsRenderer: Renderer;
  weatherRenderer: Renderer;
  codeStructureRenderer: Renderer;
  diffRenderer: Renderer;
  tableRenderer: Renderer;
  treeRenderer: Renderer;
};

export type SpecializedRendererLoader = () => Promise<SpecializedRendererBundle>;

const defaultLoadSpecializedRenderers: SpecializedRendererLoader = async () => {
  const [testResults, weather, codeStructure, diff, table, tree] = await Promise.all([
    import('./test-results-renderer.js'),
    import('./weather-renderer.js'),
    import('./code-structure-renderer.js'),
    import('./diff-renderer.js'),
    import('./table-renderer.js'),
    import('./tree-renderer.js'),
  ]);
  return {
    testResultsRenderer: testResults.testResultsRenderer,
    weatherRenderer: weather.weatherRenderer,
    codeStructureRenderer: codeStructure.codeStructureRenderer,
    diffRenderer: diff.diffRenderer,
    tableRenderer: table.tableRenderer,
    treeRenderer: tree.treeRenderer,
  };
};

let loadSpecializedRenderers: SpecializedRendererLoader = defaultLoadSpecializedRenderers;
let specializedRenderersReady: Promise<void> | undefined;
let renderersDegraded = false;
let renderersDegradedError: string | undefined;

export function areSpecializedRenderersDegraded(): boolean {
  return renderersDegraded;
}

export function getSpecializedRenderersDegradedError(): string | undefined {
  return renderersDegradedError;
}

export function setSpecializedRendererLoaderForTests(
  loader?: SpecializedRendererLoader,
): void {
  loadSpecializedRenderers = loader ?? defaultLoadSpecializedRenderers;
}

export function resetSpecializedRendererBootstrapForTests(): void {
  specializedRenderersReady = undefined;
  renderersDegraded = false;
  renderersDegradedError = undefined;
  loadSpecializedRenderers = defaultLoadSpecializedRenderers;
}

function markRenderersDegraded(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  renderersDegraded = true;
  renderersDegradedError = message;
  logger.warn('Specialized renderer bootstrap failed; generic rendering remains available', {
    error: message,
    renderersDegraded: true,
  });
  return error instanceof Error ? error : new Error(message);
}

/**
 * Start loading the specialized renderers without blocking the first TUI
 * paint. Network/LLM work cannot begin before these imports settle, so a
 * structured response still observes the same renderer registry in normal
 * operation; only the initial shell is allowed to paint first.
 *
 * On failure the returned promise **rejects** after exposing
 * `areSpecializedRenderersDegraded()`. Callers must catch if they want a
 * degraded TUI rather than aborting the rerender.
 */
export function initializeRenderers(): Promise<void> {
  if (specializedRenderersReady) return specializedRenderersReady;

  specializedRenderersReady = loadSpecializedRenderers()
    .then((bundle) => {
      const manager = getRenderManager();
      manager.register(bundle.testResultsRenderer);
      manager.register(bundle.weatherRenderer);
      manager.register(bundle.codeStructureRenderer);
      manager.register(bundle.diffRenderer);
      manager.register(bundle.tableRenderer);
      manager.register(bundle.treeRenderer);
    })
    .catch((error: unknown) => {
      throw markRenderersDegraded(error);
    });

  return specializedRenderersReady;
}

export { configureRenderContext, getRenderManager };
