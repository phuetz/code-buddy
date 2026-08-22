/**
 * CodeExplorer Plugin — Barrel Export
 *
 * Code graph analysis via CodeExplorer MCP server integration.
 */

export {
  CodeExplorerManager,
  getCodeExplorerManager,
  clearCodeExplorerManagerCache,
} from './CodeExplorerManager.js';

export type {
  CodeExplorerStats,
  CodeExplorerFreshness,
  CodeExplorerFreshnessOptions,
} from './CodeExplorerManager.js';
