import { getMCPManager } from '../codebuddy/tools.js';
import { loadMCPConfig } from '../mcp/config.js';

export type PubCommanderModule =
  | 'core'
  | 'editorial'
  | 'media'
  | 'autoblog'
  | 'analytics'
  | 'automation';

function moduleList(value: string | undefined): string[] {
  return (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
}

export function resolvePubCommanderServer(module: PubCommanderModule): string | null {
  const servers = loadMCPConfig({ includeDisabled: true }).servers;
  const expectedName = module === 'core' ? 'pubcommander' : `pubcommander-${module}`;
  const exact = servers.find(server => server.name === expectedName);
  if (exact) return exact.name;

  const configured = servers.find(server => {
    const env = server.transport?.env ?? server.env;
    return moduleList(env?.PUBCOMMANDER_MCP_MODULES).includes(module);
  });
  return configured?.name ?? null;
}

function parseToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('content' in result)) return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;
  const text = content
    .filter((item): item is { type: string; text: string } =>
      Boolean(item && typeof item === 'object' && 'type' in item && 'text' in item &&
        (item as { type: unknown }).type === 'text' && typeof (item as { text: unknown }).text === 'string'))
    .map(item => item.text)
    .join('\n');
  if (!text) return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class PubCommanderBridge {
  async call(
    module: PubCommanderModule,
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const serverName = resolvePubCommanderServer(module);
    if (!serverName) {
      throw new Error(`PubCommander MCP module is not configured: ${module}`);
    }
    const manager = getMCPManager();
    const wasConnected = manager.getServers().includes(serverName);
    if (!wasConnected) {
      const config = loadMCPConfig({ includeDisabled: true }).servers.find(server => server.name === serverName);
      if (!config) throw new Error(`PubCommander MCP server not found: ${serverName}`);
      await manager.addServer(config);
    }
    try {
      return parseToolResult(await manager.callTool(`mcp__${serverName}__${tool}`, args));
    } finally {
      if (!wasConnected) await manager.removeServer(serverName);
    }
  }
}
