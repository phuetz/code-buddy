import type { Command } from 'commander';
import { readFile, stat } from 'node:fs/promises';
import { MCPManager } from '../mcp/client.js';
import { loadMCPConfig } from '../mcp/config.js';
import { getErrorMessage } from '../types/index.js';

const MAX_ARGUMENT_BYTES = 1024 * 1024;

export function registerMCPInvocationCommands(command: Command): void {
  command.command('tools <server>')
    .description('Print one configured MCP server tool catalog as JSON, without an LLM')
    .option('--query <text>', 'Filter tool names and descriptions before printing schemas')
    .action(async (server: string, options: { query?: string }) => run(server, undefined, options));

  command.command('call <server> <tool>')
    .description('Invoke one MCP tool directly and print its result as JSON')
    .option('--args <json>', 'JSON object of tool arguments')
    .option('--args-file <path>', 'Read JSON arguments from a file (maximum 1 MiB)')
    .action(async (server: string, tool: string, options: { args?: string; argsFile?: string }) => {
      await run(server, tool, options);
    });
}

async function run(server: string, tool?: string, options: { args?: string; argsFile?: string; query?: string } = {}): Promise<void> {
  const manager = new MCPManager();
  try {
    if (options.args !== undefined && options.argsFile !== undefined) {
      throw new Error('Use either --args or --args-file');
    }
    let raw = options.args ?? '{}';
    if (options.argsFile !== undefined) {
      const info = await stat(options.argsFile);
      if (!info.isFile() || info.size > MAX_ARGUMENT_BYTES) throw new Error('Arguments must be a regular file no larger than 1 MiB');
      raw = await readFile(options.argsFile, 'utf8');
    }
    if (Buffer.byteLength(raw) > MAX_ARGUMENT_BYTES) throw new Error('Arguments exceed 1 MiB');
    let args: unknown;
    try { args = JSON.parse(raw); } catch { throw new Error('Tool arguments must be valid JSON'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object');
    const config = loadMCPConfig().servers.find(candidate => candidate.name === server);
    if (!config) throw new Error(`Enabled MCP server not found: ${server}`);
    await manager.addServer(config);
    if (!tool) {
      const catalog = manager.getTools().filter(item => item.serverName === server);
      const query = options.query?.toLowerCase();
      const tools = query ? catalog.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query)) : catalog;
      console.log(JSON.stringify({ server, totalTools: catalog.length, tools }));
      return;
    }
    const qualified = `mcp__${server}__${tool}`;
    const result = await manager.callTool(qualified, args as Record<string, unknown>);
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ isError: true, error: getErrorMessage(error) }));
    process.exitCode = 1;
  } finally {
    await manager.dispose();
  }
}
