import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { Command } from 'commander';
import { normalizeMCPImports } from '../mcp/import-normalize.js';
import { writeJsonAtomicSync } from '../utils/atomic-write.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function importMCPFile(filename: string, source: 'hermes' | 'openclaw', options: { dryRun?: boolean; output?: string } = {}) {
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('MCP import file must be at most 1 MiB');
  let input: unknown;
  try { input = parse(fs.readFileSync(filename, 'utf8'), { uniqueKeys: true }); } catch { throw new Error('Invalid MCP import JSON/YAML'); }
  if (!object(input)) throw new Error('MCP import requires an object');
  const map = input.mcpServers ?? input.mcp_servers ?? (object(input.mcp) ? input.mcp.servers : undefined) ?? input;
  const normalized = normalizeMCPImports(map, source);
  if (options.dryRun || normalized.servers.length === 0) return { ...normalized, written: false };
  const output = options.output ?? path.join(process.cwd(), '.codebuddy', 'mcp.json');
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(output)) {
    const target = fs.lstatSync(output);
    if (!target.isFile() || target.isSymbolicLink() || target.size > 1024 * 1024) throw new Error('Invalid existing MCP target');
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (!object(parsed) || (parsed.mcpServers !== undefined && !object(parsed.mcpServers))) throw new Error();
      existing = parsed;
    } catch { throw new Error('Existing MCP configuration is invalid; not replaced'); }
  }
  const servers = object(existing.mcpServers) ? existing.mcpServers : {};
  for (const server of normalized.servers) {
    if (Object.hasOwn(servers, server.name)) normalized.warnings.push(`${server.name}: existing configuration preserved`);
    else servers[server.name] = server;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeJsonAtomicSync(output, { ...existing, mcpServers: servers }, { mode: 0o600 });
  return { ...normalized, written: true };
}

export function registerMCPImportCommand(command: Command): void {
  command.command('import <file>').requiredOption('--from <source>', 'hermes or openclaw')
    .option('--dry-run', 'Show sanitized mapping without writing or connecting')
    .option('--output <file>', 'Target MCP JSON file (default project .codebuddy/mcp.json)')
    .description('Import MCP declarations; credentials become environment references and existing entries are preserved')
    .action((file: string, options: { from: string; dryRun?: boolean; output?: string }) => {
      if (options.from !== 'hermes' && options.from !== 'openclaw') command.error('Source must be hermes or openclaw');
      try { process.stdout.write(JSON.stringify(importMCPFile(file, options.from as 'hermes' | 'openclaw', options), null, 2) + '\n'); }
      catch { command.error('MCP import failed; check input/target configuration. No credentials are printed.'); }
    });
}
