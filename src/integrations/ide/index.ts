/**
 * IDE Extensions Module
 *
 * Exports IDE integration server, types, and generators.
 */

// Types
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
} from './types.js';

export { DEFAULT_IDE_CONFIG } from './types.js';

// Server
export {
  IDEExtensionsServer,
  getIDEExtensionsServer,
  resetIDEExtensionsServer
} from './server.js';

// Generators
export { generateVSCodeExtension, type VSCodeExtensionOutput } from './vscode-generator.js';
export { generateNeovimPlugin } from './neovim-generator.js';
