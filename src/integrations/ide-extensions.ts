/**
 * IDE Extensions Infrastructure
 *
 * Provides integration with popular IDEs:
 * - VS Code Extension Protocol
 * - JetBrains IDE Plugin Protocol
 * - Neovim integration
 * - Sublime Text integration
 *
 * Enables AI-powered features directly in editors:
 * - Inline code suggestions
 * - Code explanations
 * - Refactoring assistance
 * - Error diagnostics
 *
 * This module re-exports from the modular ide/ directory for
 * backwards compatibility.
 */

// Re-export all types
export type {
  IDEType,
  IDEConnection,
  IDERequest,
  IDEResponse,
  CompletionRequest,
  CompletionItem,
  DiagnosticRequest,
  Diagnostic,
  HoverRequest,
  HoverResult,
  CodeActionRequest,
  CodeAction,
  IDEExtensionsConfig
} from './ide/types.js';

// Re-export default config (for backwards compatibility)
export { DEFAULT_IDE_CONFIG as DEFAULT_CONFIG } from './ide/types.js';

// Re-export server and singleton
export {
  IDEExtensionsServer,
  getIDEExtensionsServer,
  resetIDEExtensionsServer
} from './ide/server.js';

// Re-export generators
export { generateVSCodeExtension } from './ide/vscode-generator.js';
export { generateNeovimPlugin } from './ide/neovim-generator.js';
