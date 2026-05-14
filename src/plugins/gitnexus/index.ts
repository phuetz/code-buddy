/**
 * GitNexus Plugin — Barrel Export
 *
 * Code graph analysis via GitNexus MCP server integration.
 */

export {
  GitNexusManager,
  getGitNexusManager,
  clearGitNexusManagerCache,
} from './GitNexusManager.js';

export { GitNexusMCPClient } from './GitNexusMCPClient.js';

export type {
  GNQueryResult,
  GNContextResult,
  GNImpactResult,
  GNCluster,
  GNProcess,
  GitNexusMCPTransport,
} from './GitNexusMCPClient.js';

export type { GitNexusStats } from './GitNexusManager.js';
