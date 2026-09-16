import { SECRET_PATTERNS } from '../security/secret-patterns.js';
import type { MCPServerConfig } from './types.js';
import type { TransportConfig } from './transports.js';

export type MCPImportSource = 'hermes' | 'openclaw';
export interface MCPImportResult { servers: MCPServerConfig[]; warnings: string[]; rejected: string[] }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sensitiveKey = /KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE/i;
const reference = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const hasSecret = (value: string) => SECRET_PATTERNS.some(p => new RegExp(p.pattern.source, p.pattern.flags.replace('g', '')).test(value));

/** Supported subset: exact names and star globs. Unsupported exclusions must never broaden exposure. */
export function validateMCPToolFilter(filter: MCPServerConfig['toolFilter']): void {
  if (!filter) return;
  for (const patterns of [filter.include, filter.exclude]) {
    if (patterns !== undefined && (!Array.isArray(patterns) || patterns.some(p => typeof p !== 'string' || !/^[A-Za-z0-9_.:*-]+$/.test(p)))) {
      throw new Error('Unsupported MCP tool filter; only names and * are supported');
    }
  }
}
export function mcpToolAllowed(name: string, filter: MCPServerConfig['toolFilter']): boolean {
  validateMCPToolFilter(filter);
  const matches = (pattern: string) => new RegExp(`^${pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name);
  return (!filter?.include || filter.include.some(matches)) && !filter?.exclude?.some(matches);
}

/** Pure import: never resolve env, connect, run commands or transfer credentials. */
export function normalizeMCPImports(input: unknown, source: MCPImportSource): MCPImportResult {
  const result: MCPImportResult = { servers: [], warnings: [], rejected: [] };
  if (!record(input)) { result.rejected.push('MCP server map must be an object'); return result; }
  for (const [name, raw] of Object.entries(input)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name) || !record(raw)) { result.rejected.push('Invalid MCP server entry'); continue; }
    const warn = (message: string) => result.warnings.push(`${name}: ${message}`);
    try {
      const clean = (key: string, value: unknown): string => {
        if (typeof value !== 'string') throw new Error('Expected string configuration value');
        if (reference.test(value) || /^Bearer \$\{[A-Za-z_][A-Za-z0-9_]*\}$/i.test(value)) return value;
        if (sensitiveKey.test(key) || /^(?:--)?[^=]*(?:token|secret|password|authorization|api[_-]?key)[^=]*=/i.test(value) || hasSecret(value)) {
          const envName = `MCP_IMPORT_${name}_${key}`.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
          warn(`secret not copied; configure environment ${envName}`);
          return '${' + envName + '}';
        }
        return value;
      };
      const map = (key: 'env' | 'headers') => {
        if (raw[key] === undefined) return undefined;
        if (!record(raw[key])) throw new Error(`Invalid ${key}`);
        return Object.fromEntries(Object.entries(raw[key]).map(([k, v]) => [k, clean(`${key}_${k}`, v)]));
      };
      const type = raw.transport ?? raw.type;
      let transport: TransportConfig;
      if (type === 'stdio' || (type === undefined && typeof raw.command === 'string')) {
        if (typeof raw.command !== 'string' || !raw.command.trim()) throw new Error('stdio requires command');
        if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some(a => typeof a !== 'string'))) throw new Error('Invalid args');
        const args = (raw.args ?? []) as string[];
        transport = { type: 'stdio', inheritEnv: false, command: clean('command', raw.command), args: args.map((v, i) => clean(sensitiveKey.test(args[i - 1] ?? '') ? `arg_secret_${i}` : `arg_${i}`, v)), env: map('env') };
        if (raw.cwd !== undefined) transport.cwd = clean('cwd', raw.cwd);
      } else {
        const mapped = type === undefined ? (source === 'hermes' ? 'streamable_http' : 'sse')
          : type === 'http' || type === 'streamable-http' || type === 'streamable_http' ? 'streamable_http'
            : type === 'sse' || type === 'sse_sdk' ? 'sse' : undefined;
        if (!mapped) throw new Error('Unsupported transport');
        if (typeof raw.url !== 'string') throw new Error('Remote transport requires URL');
        if (!reference.test(raw.url)) {
          const url = new URL(raw.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Remote URL must not contain credentials, query or fragment; use environment reference');
        }
        transport = { type: mapped, url: raw.url, headers: map('headers') };
        if (type === undefined && source === 'hermes') warn('streamable HTTP selected; implicit SSE fallback is not imported');
      }
      const server: MCPServerConfig = { name, transport, enabled: raw.enabled !== false };
      const filter = raw.toolFilter ?? raw.tool_filter ?? raw.tools;
      if (filter !== undefined) {
        if (!record(filter)) throw new Error('Invalid tool filter');
        const allowedKeys = filter === raw.tools ? ['include', 'exclude', 'resources', 'prompts'] : ['include', 'exclude'];
        if (Object.keys(filter).some(key => !allowedKeys.includes(key))) throw new Error('Unsupported tool filter fields');
        if (filter.resources !== undefined || filter.prompts !== undefined) warn('resource/prompt utilities are not imported; Buddy imports native tools only');
        if (filter.include !== undefined || filter.exclude !== undefined) {
          server.toolFilter = { ...(filter.include !== undefined ? { include: typeof filter.include === 'string' ? [filter.include] : filter.include as string[] } : {}),
            ...(filter.exclude !== undefined ? { exclude: typeof filter.exclude === 'string' ? [filter.exclude] : filter.exclude as string[] } : {}) };
          validateMCPToolFilter(server.toolFilter);
          // OpenClaw treats an empty include as unrestricted, unlike Hermes.
          if (source === 'openclaw' && server.toolFilter.include?.length === 0) delete server.toolFilter.include;
        }
      }
      if (raw.auth !== undefined || raw.oauth !== undefined) {
        server.enabled = false;
        warn('authentication settings not imported; server disabled until operator configures authentication in Buddy');
      }
      result.servers.push(server);
    } catch {
      result.rejected.push(`${name}: unsupported or unsafe configuration; no values copied`);
    }
  }
  return result;
}
