/**
 * GitNexus MCP Client
 *
 * Talks to a GitNexus MCP server to query the code graph.
 *
 * Tools exposed by GitNexus MCP:
 *   - query   — natural-language search over the code graph
 *   - context — symbol-level call/import graph + process membership
 *   - impact  — blast-radius analysis (upstream/downstream)
 *   - cypher  — raw Cypher queries against the graph
 *
 * Resources:
 *   - clusters         — module clusters with cohesion scores
 *   - processes         — detected business processes
 *   - repo-context      — high-level repo metadata
 *   - architecture-map  — Mermaid architecture diagram
 */

import { logger } from '../../utils/logger.js';

// ── Response Types ──────────────────────────────────────────────────

export interface GNQueryResult {
  processes: Array<{
    summary: string;
    priority: number;
    symbol_count: number;
  }>;
  definitions: Array<{
    name: string;
    type: string;
    filePath: string;
  }>;
}

export interface GNContextResult {
  symbol: {
    uid: string;
    kind: string;
    filePath: string;
    startLine: number;
  };
  incoming: {
    calls: string[];
    imports: string[];
  };
  outgoing: {
    calls: string[];
    imports: string[];
  };
  processes: Array<{
    name: string;
    step: string;
  }>;
}

export interface GNImpactResult {
  target: string;
  affected: Array<{
    name: string;
    depth: number;
    risk: 'high' | 'medium' | 'low';
  }>;
  affectedProcesses: string[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
}

export interface GNCluster {
  name: string;
  cohesion: number;
  members: string[];
  filePaths: string[];
}

export interface GNProcess {
  name: string;
  steps: Array<{
    symbol: string;
    filePath: string;
    stepIndex: number;
  }>;
}

export interface GitNexusMCPTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  callTool(name: 'query', input: { query: string; repo: string }): Promise<GNQueryResult>;
  callTool(name: 'context', input: { symbol: string; repo: string }): Promise<GNContextResult>;
  callTool(name: 'impact', input: { target: string; direction: 'upstream' | 'downstream'; repo: string }): Promise<GNImpactResult>;
  callTool(name: 'cypher', input: { query: string; repo: string }): Promise<unknown[]>;
  readResource(name: 'clusters', input: { repo: string }): Promise<GNCluster[]>;
  readResource(name: 'processes', input: { repo: string }): Promise<GNProcess[]>;
  readResource(name: 'repo-context', input: { repo: string }): Promise<Record<string, unknown>>;
  readResource(name: 'architecture-map', input: { repo: string }): Promise<string>;
}

// ── Client ──────────────────────────────────────────────────────────

export class GitNexusMCPClient {
  private repoName: string;
  private connected = false;
  private transport?: GitNexusMCPTransport;

  constructor(repoName: string, transport?: GitNexusMCPTransport) {
    this.repoName = repoName;
    this.transport = transport;
  }

  /**
   * Connect to the GitNexus MCP server.
   */
  async connect(): Promise<void> {
    if (!this.transport) {
      throw new Error(
        'GitNexus MCP transport is not configured. Start a real GitNexus MCP server and pass a transport before querying the code graph.'
      );
    }

    await this.transport.connect();
    this.connected = true;
    logger.debug('GitNexus MCP client connected', {
      repo: this.repoName,
    });
  }

  /** Disconnect from the MCP server. */
  async disconnect(): Promise<void> {
    if (this.connected && this.transport) {
      await this.transport.disconnect();
    }
    this.connected = false;
    logger.debug('GitNexus MCP client disconnected', {
      repo: this.repoName,
    });
  }

  /** Whether the client is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }

  /** The repo name this client is targeting. */
  getRepoName(): string {
    return this.repoName;
  }

  // ── Tools ───────────────────────────────────────────────────────

  /**
   * Natural-language query against the code graph.
   * Returns matching processes and symbol definitions.
   */
  async query(q: string): Promise<GNQueryResult> {
    this.assertConnected();
    logger.debug('GitNexus query', { query: q, repo: this.repoName });
    return this.requireTransport().callTool('query', { query: q, repo: this.repoName });
  }

  /**
   * Get the full context for a symbol: call graph, import graph,
   * and the business processes it participates in.
   */
  async context(symbolName: string): Promise<GNContextResult> {
    this.assertConnected();
    logger.debug('GitNexus context', { symbol: symbolName, repo: this.repoName });
    return this.requireTransport().callTool('context', { symbol: symbolName, repo: this.repoName });
  }

  /**
   * Blast-radius / impact analysis for a given symbol or file.
   *
   * @param target    - Symbol or file path to analyze
   * @param direction - 'upstream' (what depends on target) or 'downstream' (what target depends on)
   */
  async impact(
    target: string,
    direction: 'upstream' | 'downstream' = 'upstream',
  ): Promise<GNImpactResult> {
    this.assertConnected();
    logger.debug('GitNexus impact', { target, direction, repo: this.repoName });
    return this.requireTransport().callTool('impact', { target, direction, repo: this.repoName });
  }

  /**
   * Execute a raw Cypher query against the GitNexus graph database.
   */
  async cypher(query: string): Promise<unknown[]> {
    this.assertConnected();
    logger.debug('GitNexus cypher', { query, repo: this.repoName });
    return this.requireTransport().callTool('cypher', { query, repo: this.repoName });
  }

  // ── Resources ───────────────────────────────────────────────────

  /** Get all detected module clusters with cohesion scores. */
  async getClusters(): Promise<GNCluster[]> {
    this.assertConnected();
    return this.requireTransport().readResource('clusters', { repo: this.repoName });
  }

  /** Get all detected business processes. */
  async getProcesses(): Promise<GNProcess[]> {
    this.assertConnected();
    return this.requireTransport().readResource('processes', { repo: this.repoName });
  }

  /** Get high-level repository context metadata. */
  async getRepoContext(): Promise<Record<string, unknown>> {
    this.assertConnected();
    return this.requireTransport().readResource('repo-context', { repo: this.repoName });
  }

  /** Get a Mermaid architecture diagram of the repository. */
  async getArchitectureMap(): Promise<string> {
    this.assertConnected();
    return this.requireTransport().readResource('architecture-map', { repo: this.repoName });
  }

  // ── Internal ────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error('GitNexusMCPClient is not connected. Call connect() first.');
    }
  }

  private requireTransport(): GitNexusMCPTransport {
    if (!this.transport) {
      throw new Error('GitNexus MCP transport is not configured.');
    }
    return this.transport;
  }
}
