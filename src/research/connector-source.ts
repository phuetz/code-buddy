/**
 * Personal MCP connectors as a source for the Collective Knowledge Graph. Pulls read-only
 * content from a configured connector and turns each result into a publication-shaped
 * discovery. Best-effort & NEVER-THROWS: unavailable or failing connectors yield [].
 *
 * @module research/connector-source
 */

import { getConnectorRegistry, type ConnectorConfig } from '../mcp/connectors.js';
import type { MCPServerConfig, MCPTool } from '../mcp/types.js';
import { logger } from '../utils/logger.js';
import type { Publication } from './publication-sources.js';

const READ_ONLY_VERBS = new Set(['search', 'list', 'get']);
/** Explicit allowlist, ordered by connector preference. No mutation-like tool is eligible. */
const CONNECTOR_READ_ONLY_TOOLS: Record<string, string[]> = {
  notion: [
    'search', 'search_pages', 'list_pages', 'list_databases', 'list_blocks',
    'get_page', 'get_database', 'get_block',
  ],
  slack: [
    'search_messages', 'search', 'list_channels', 'list_conversations',
    'get_channel_history', 'get_thread_replies', 'get_users', 'get_user_profile',
  ],
  linear: [
    'search_issues', 'search', 'list_issues', 'list_projects', 'list_teams',
    'get_issue', 'get_project', 'get_team',
  ],
  github: [
    'search_repositories', 'search_issues', 'search_code', 'search', 'list_issues',
    'list_pull_requests', 'list_commits', 'get_file_contents', 'get_issue',
    'get_pull_request', 'get_commit',
  ],
  'google-calendar': [
    'search_events', 'search', 'list_events', 'list_calendars', 'get_event', 'get_calendar',
  ],
  asana: [
    'search_tasks', 'search', 'list_tasks', 'list_projects', 'list_workspaces',
    'get_task', 'get_project', 'get_workspace',
  ],
};

const QUERY_KEYS = ['query', 'q', 'search', 'search_query', 'term', 'text', 'keywords'] as const;
const RESULT_KEYS = [
  'results',
  'items',
  'data',
  'pages',
  'messages',
  'issues',
  'events',
  'tasks',
  'repositories',
  'nodes',
] as const;

export interface ConnectorMcpClient {
  getTools(): Array<Pick<MCPTool, 'name' | 'inputSchema'> & Partial<Pick<MCPTool, 'description' | 'serverName'>>>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface ConnectorContentOptions {
  query?: string;
  /** Injected client (tests). Default: the live MCP manager. */
  client?: ConnectorMcpClient;
  /** Injected MCP bootstrap (tests). Default: initializeMCPServers(). */
  ensureMcp?: () => Promise<void>;
}

interface SelectedTool {
  tool: ReturnType<ConnectorMcpClient['getTools']>[number];
  operation: string;
  args: Record<string, unknown>;
}

/**
 * Fetch connector content as publication-shaped discoveries. Only tools whose operation starts
 * with search/list/get are eligible; any operation containing a mutation verb is rejected.
 */
export async function fetchConnectorContent(
  connectorName: string,
  opts: ConnectorContentOptions = {},
): Promise<Publication[]> {
  try {
    const name = connectorName.trim().toLowerCase();
    const connector = getConnectorRegistry().getConnector(name);
    if (!connector) {
      logger.warn(`[connector-source] Unknown connector: ${connectorName}`);
      return [];
    }

    const missingEnvVars = connector.requiredEnvVars.filter((envName) => !process.env[envName]);
    if (missingEnvVars.length > 0) {
      logger.warn(
        `[connector-source] ${name} is not configured; missing environment variable(s): ${missingEnvVars.join(', ')}`,
      );
      return [];
    }

    let client = opts.client;
    if (!client) {
      const liveClient = await getLiveConnectorClient(connector, opts.ensureMcp);
      if (!liveClient) return [];
      client = liveClient;
    }

    const selected = selectReadOnlyTool(name, client.getTools(), opts.query);
    if (!selected) {
      logger.warn(`[connector-source] ${name} exposes no callable read-only search/list/get tool`);
      return [];
    }

    let result: unknown;
    try {
      result = await client.callTool(selected.tool.name, selected.args);
    } catch (err) {
      logger.warn(
        `[connector-source] ${name}.${selected.operation} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }

    return mapResultToPublications(name, selected.operation, result);
  } catch (err) {
    logger.warn(`[connector-source] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function getLiveConnectorClient(
  connector: ConnectorConfig,
  ensureMcp?: () => Promise<void>,
): Promise<ConnectorMcpClient | null> {
  try {
    if (ensureMcp) await ensureMcp();
    else {
      const { initializeMCPServers } = await import('../codebuddy/tools.js');
      await initializeMCPServers();
    }

    const { getMCPManager } = await import('../codebuddy/tools.js');
    const manager = getMCPManager();
    const prefix = `mcp__${connector.name}__`;
    if (!manager.getTools().some((tool) => tool.name.startsWith(prefix))) {
      const config = connectorServerConfig(connector);
      if (!config) {
        logger.warn(`[connector-source] Invalid MCP server configuration for ${connector.name}`);
        return null;
      }
      await manager.addServer(config);
    }
    return manager;
  } catch (err) {
    logger.warn(
      `[connector-source] ${connector.name} MCP init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function connectorServerConfig(connector: ConnectorConfig): MCPServerConfig | null {
  const command = connector.mcpServerConfig.command;
  if (typeof command !== 'string' || !command.trim()) return null;
  const args = Array.isArray(connector.mcpServerConfig.args)
    ? connector.mcpServerConfig.args.filter((arg): arg is string => typeof arg === 'string')
    : [];
  const env: Record<string, string> = {};
  for (const envName of connector.requiredEnvVars) {
    const value = process.env[envName];
    if (value) env[envName] = value;
  }
  return {
    name: connector.name,
    transport: { type: 'stdio', command, args, env },
  };
}

function selectReadOnlyTool(
  connectorName: string,
  tools: ReturnType<ConnectorMcpClient['getTools']>,
  rawQuery?: string,
): SelectedTool | null {
  const prefix = `mcp__${connectorName}__`;
  const query = rawQuery?.trim();
  const preferences = CONNECTOR_READ_ONLY_TOOLS[connectorName] ?? [];

  const candidates: Array<SelectedTool & { score: number }> = [];
  for (const tool of tools) {
    if (!tool.name.startsWith(prefix)) continue;
    const operation = tool.name.slice(prefix.length);
    const normalizedOperation = normalizeOperation(connectorName, operation);
    const readOnlyVerb = getReadOnlyVerb(normalizedOperation, preferences);
    if (!readOnlyVerb || (query && readOnlyVerb !== 'search')) continue;
    const args = makeToolArgs(tool.inputSchema, query);
    if (!args) continue;

    const preferenceIndex = preferences.indexOf(normalizedOperation);
    const preferenceScore = preferenceIndex === -1 ? preferences.length + 20 : preferenceIndex;
    const verbScore = query ? 0 : readOnlyVerb === 'list' ? 0 : readOnlyVerb === 'search' ? 20 : 40;
    candidates.push({ tool, operation, args, score: verbScore + preferenceScore });
  }

  candidates.sort((a, b) => a.score - b.score || a.operation.localeCompare(b.operation));
  return candidates[0] ?? null;
}

function normalizeOperation(connectorName: string, operation: string): string {
  const normalized = operation.toLowerCase().replace(/-/g, '_');
  const connectorPrefix = `${connectorName.toLowerCase().replace(/-/g, '_')}_`;
  return normalized.startsWith(connectorPrefix) ? normalized.slice(connectorPrefix.length) : normalized;
}

function getReadOnlyVerb(operation: string, allowlist: string[]): string | null {
  if (!allowlist.includes(operation)) return null;
  return operation.split('_').find((verb) => READ_ONLY_VERBS.has(verb)) ?? null;
}

function makeToolArgs(inputSchema: Record<string, unknown>, query?: string): Record<string, unknown> | null {
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((key): key is string => typeof key === 'string')
    : [];

  if (!query) return required.length === 0 ? {} : null;

  const queryKey = QUERY_KEYS.find((key) => key in properties || required.includes(key))
    ?? required.find((key) => /(^|_)(q|query|search|term|text|keywords?)(_|$)/i.test(key))
    ?? (Object.keys(properties).length === 0 && required.length === 0 ? 'query' : undefined);
  if (!queryKey) return null;
  if (required.some((key) => key !== queryKey)) return null;
  return { [queryKey]: query };
}

function mapResultToPublications(connectorName: string, operation: string, result: unknown): Publication[] {
  if (isRecord(result) && result.isError === true) return [];

  const payloads = extractPayloads(result);
  const records = payloads.flatMap((payload) => extractRecords(payload));
  const publications: Publication[] = [];
  const seen = new Set<string>();

  for (const [index, record] of records.entries()) {
    const publication = toPublication(connectorName, operation, record, index);
    if (!publication || seen.has(publication.id)) continue;
    seen.add(publication.id);
    publications.push(publication);
  }
  return publications;
}

function extractPayloads(result: unknown): unknown[] {
  if (!isRecord(result)) return [result];
  if ('structuredContent' in result) return [result.structuredContent];
  const payloads: unknown[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isRecord(block) && typeof block.text === 'string') payloads.push(block.text);
    }
  }
  return payloads.length > 0 ? payloads : [result];
}

function extractRecords(value: unknown, depth = 0): unknown[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      return extractRecords(JSON.parse(text) as unknown, depth + 1);
    } catch {
      return [text];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => extractRecords(item, depth + 1));
  if (!isRecord(value)) return [value];
  for (const key of RESULT_KEYS) {
    const nested = value[key];
    if (Array.isArray(nested) || (key === 'data' && isRecord(nested))) {
      return extractRecords(nested, depth + 1);
    }
  }
  if (looksLikeContentItem(value)) return [value];
  return [value];
}

function looksLikeContentItem(value: Record<string, unknown>): boolean {
  return ['id', 'uuid', 'title', 'name', 'subject', 'abstract', 'body', 'text', 'description', 'url'].some(
    (key) => key in value,
  );
}

function toPublication(
  connectorName: string,
  operation: string,
  value: unknown,
  index: number,
): Publication | null {
  if (typeof value === 'string') {
    const abstract = normalizeText(value);
    if (!abstract) return null;
    return {
      id: `${connectorName}:${operation}:${index}`,
      title: `${connectorName} — ${operation}`,
      abstract: abstract.slice(0, 1500),
      source: connectorName,
    };
  }
  if (!isRecord(value)) return null;

  const abstract = firstText(value, ['abstract', 'content', 'text', 'description', 'body', 'message', 'notes', 'summary', 'snippet'])
    ?? normalizeText(safeJson(value));
  if (!abstract) return null;
  const title = firstText(value, ['title', 'name', 'subject', 'summary'])
    ?? abstract.slice(0, 100)
    ?? `${connectorName} — ${operation}`;
  const url = firstText(value, ['url', 'html_url', 'web_url', 'permalink']);
  const rawId = firstScalar(value, ['id', 'uuid', 'node_id', 'key']) ?? url ?? String(index);

  return {
    id: `${connectorName}:${operation}:${rawId}`,
    title: title.slice(0, 300),
    abstract: abstract.slice(0, 1500),
    source: connectorName,
    ...(url ? { url } : {}),
  };
}

function firstText(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      const text = normalizeText(candidate);
      if (text) return text;
    }
  }
  return undefined;
}

function firstScalar(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
