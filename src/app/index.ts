/**
 * Application Module
 *
 * Provides application factory and configuration utilities.
 *
 * @module app
 */

// Types
export type {
  ApplicationConfig,
  CommandLineOptions,
  RunMode,
  IApplication,
  LazyImports,
} from './types.js';

// Factory functions
export {
  loadEnvironment,
  loadApiKey,
  loadBaseURL,
  loadModel,
  ensureUserSettings,
  setupSignalHandlers,
  buildConfig,
  validateConfig,
  bootstrap,
  saveSettings,
} from './application-factory.js';
