/**
 * Code Explorer as a SOURCE for the Collective Knowledge Graph — the B↔C synergy. Pulls
 * insights from the code-knowledge-graph (hotspots, cycles, general insights) via the live MCP
 * client and turns each into a `discovery`, so the CKG holds BOTH scientific research AND
 * findings about the codebase, auto-linked together.
 *
 * Best-effort & NEVER-THROWS: returns [] when Code Explorer isn't connected or errors. The
 * client is injectable for tests (no MCP needed).
 *
 * @module research/code-explorer-source
 */

import { logger } from '../utils/logger.js';
import type { Publication } from './publication-sources.js';
import {
  resolveCodeExplorerRepo,
  type CodeExplorerClient,
} from '../plugins/code-explorer/code-explorer-client.js';

/** Insight ops to pull by default (each → one discovery). All read-only Code Explorer tools.
 *  `report`/`coverage` produce output on a freshly indexed toy repo; `hotspots` needs git
 *  churn and `get_insights` needs a symbol, so they are not the only defaults. */
const DEFAULT_OPS = ['report', 'coverage', 'find_cycles', 'hotspots'] as const;

export interface CodeInsightOptions {
  /** Repo path/id (else the default indexed repo). */
  repo?: string;
  /** Override the insight ops. */
  ops?: string[];
  /** Injected client (tests). Default: the live MCP-backed Code Explorer client. */
  client?: CodeExplorerClient;
  /** Injected MCP bootstrap (tests). Default: initializeMCPServers(). */
  ensureMcp?: () => Promise<void>;
}

/**
 * Fetch Code Explorer insights as publication-shaped discoveries. Ensures MCP servers are
 * initialized first (the CLI doesn't connect MCP by default). Returns [] if Code Explorer is
 * not connected.
 */
export async function fetchCodeExplorerInsights(opts: CodeInsightOptions = {}): Promise<Publication[]> {
  let client = opts.client;
  if (!client) {
    try {
      if (opts.ensureMcp) await opts.ensureMcp();
      else {
        const { initializeMCPServers } = await import('../codebuddy/tools.js');
        await initializeMCPServers();
      }
      const { getCodeExplorerClient } = await import('../plugins/code-explorer/code-explorer-client.js');
      client = getCodeExplorerClient();
    } catch (err) {
      logger.debug(`[code-explorer-source] init failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  if (!(await client.available())) {
    logger.debug('[code-explorer-source] Code Explorer not connected — no insights');
    return [];
  }
  // The insight ops return EMPTY without a `repo` arg — resolve it (explicit → list_repos
  // best-match on cwd → first indexed repo).
  const repo = await resolveCodeExplorerRepo(client, opts.repo);
  const ops = opts.ops ?? [...DEFAULT_OPS];
  const repoArgs = repo ? { repo } : {};
  const pubs: Publication[] = [];
  for (const op of ops) {
    const text = await client.call(op, repoArgs);
    if (text && text.trim()) {
      pubs.push({
        id: `codeexplorer:${op}${repo ? `:${repo}` : ''}`,
        title: `Analyse de code — ${op}${repo ? ` (${repo})` : ''}`,
        abstract: text.trim().slice(0, 1500),
        source: 'code-explorer',
      });
    }
  }
  if (pubs.length === 0) {
    const listed = await client.listRepos();
    const trimmed = listed.trim();
    if (trimmed && trimmed !== '[]') {
      pubs.push({
        id: `codeexplorer:list_repos${repo ? `:${repo}` : ''}`,
        title: `Analyse de code — dépôts indexés${repo ? ` (${repo})` : ''}`,
        abstract: trimmed.slice(0, 1500),
        source: 'code-explorer',
      });
    }
  }
  return pubs;
}


