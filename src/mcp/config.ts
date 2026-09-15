import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSettingsManager } from "../utils/settings-manager.js";
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, readJsonAtomicSyncReadOnly, writeJsonAtomicSync } from '../utils/atomic-write.js';
import type { MCPServerConfig, MCPConfig } from "./types.js";

// Re-export types for backwards compatibility
export type { MCPConfig } from "./types.js";

/**
 * Resolve ${ENV_VAR} references in env values from process.env
 */
function resolveEnvVars(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return env;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = value.match(/^\$\{(\w+)\}$/);
    const varName = match?.[1];
    resolved[key] = varName !== undefined ? (process.env[varName] || value) : value;
  }
  return resolved;
}

/**
 * Resolve env vars in a server config's transport
 */
function resolveServerEnv(server: MCPServerConfig): MCPServerConfig {
  if (server.transport?.env) {
    return { ...server, transport: { ...server.transport, env: resolveEnvVars(server.transport.env) } };
  }
  if (server.env) {
    return { ...server, env: resolveEnvVars(server.env) };
  }
  return server;
}

/**
 * Load MCP configuration from multiple sources (Advanced enterprise architecture for)
 * Priority: Project .codebuddy/mcp.json > .codebuddy/settings.json > ~/.codebuddy/mcp.json
 */
export interface LoadMCPConfigOptions {
  /** Include disabled entries for inventory and diagnostics. Runtime callers omit this. */
  includeDisabled?: boolean;
  /**
   * Project directory whose `.codebuddy/mcp.json` and `.codebuddy/settings.json` are read.
   * Defaults to `process.cwd()` (historical behaviour). Lets diagnostics inspect another
   * project without `process.chdir()`, which is global state shared across awaits.
   */
  cwd?: string;
}

/** `mcpServers` of a project `.codebuddy/settings.json` read directly (explicit `cwd`). */
function readProjectSettingsServers(projectDir: string): Record<string, unknown> | undefined {
  const settingsPath = path.join(projectDir, '.codebuddy', 'settings.json');
  if (!fs.existsSync(settingsPath)) return undefined;
  try {
    const settings = readJsonAtomicSync<Record<string, unknown> | null>(settingsPath, null, { mode: 0o600 });
    const servers = settings?.mcpServers;
    return servers && typeof servers === 'object' && !Array.isArray(servers) ? servers as Record<string, unknown> : undefined;
  } catch (error) {
    logger.warn('Failed to load project settings MCP servers', { error });
    return undefined;
  }
}

export function loadMCPConfig(options: LoadMCPConfigOptions = {}): MCPConfig {
  const servers: MCPServerConfig[] = [];
  const seenServers = new Set<string>();

  // 1. First, try project-level .codebuddy/mcp.json (highest priority, committable)
  const projectDir = options.cwd ?? process.cwd();
  const projectMCPPath = path.join(projectDir, '.codebuddy', 'mcp.json');
  if (fs.existsSync(projectMCPPath)) {
    try {
      const projectMCP = readJsonAtomicSync<Record<string, unknown>>(projectMCPPath, {});
      const mcpServers = projectMCP.mcpServers || projectMCP.servers || {};

      for (const [name, config] of Object.entries(mcpServers)) {
        if (!seenServers.has(name)) {
          const serverConfig = resolveServerEnv({ ...(config as MCPServerConfig), name });
          // Skip disabled servers at load time
          if (serverConfig.enabled === false && !options.includeDisabled) {
            seenServers.add(name);
            continue;
          }
          servers.push(serverConfig);
          seenServers.add(name);
        }
      }
    } catch (error) {
      logger.warn('Failed to load project MCP config', { error });
    }
  }

  // 2. Then, try project settings (.codebuddy/settings.json). Without an explicit `cwd`
  // the settings manager keeps its historical path; with one, that project's file is read.
  const projectSettingsServers = options.cwd === undefined
    ? getSettingsManager().loadProjectSettings().mcpServers
    : readProjectSettingsServers(projectDir);
  if (projectSettingsServers) {
    for (const [name, config] of Object.entries(projectSettingsServers)) {
      if (!seenServers.has(name)) {
        const serverConfig = resolveServerEnv({ ...(config as MCPServerConfig), name });
        if (serverConfig.enabled !== false || options.includeDisabled) {
          servers.push(serverConfig);
        }
        seenServers.add(name);
      }
    }
  }

  // 3. Finally, try user-level ~/.codebuddy/mcp.json (lowest priority)
  const userMCPPath = path.join(os.homedir(), '.codebuddy', 'mcp.json');
  if (fs.existsSync(userMCPPath)) {
    try {
      const userMCP = readJsonAtomicSync<Record<string, unknown>>(userMCPPath, {});
      const mcpServers = userMCP.mcpServers || userMCP.servers || {};

      for (const [name, config] of Object.entries(mcpServers)) {
        if (!seenServers.has(name)) {
          const serverConfig = resolveServerEnv({ ...(config as MCPServerConfig), name });
          if (serverConfig.enabled !== false || options.includeDisabled) {
            servers.push(serverConfig);
          }
          seenServers.add(name);
        }
      }
    } catch (_error) {
      // Silently ignore user config errors
    }
  }

  return { servers };
}

export interface MCPConfigReadOnlyResult {
  servers: MCPServerConfig[];
  /** Sanitized warnings (no config content, no secrets). Empty when all sources are missing/valid. */
  warnings: string[];
}

function isServerMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Which keys the RUNTIME reads in a source (see loadMCPConfig): `mcp.json` files accept
 * `mcpServers || servers`; project `settings.json` is read through `mcpServers` only.
 */
type RuntimeServerKeys = 'mcpServers-or-servers' | 'mcpServers-only';

function readOnlyServersFromFile(
  filePath: string,
  label: string,
  warnings: string[],
  keys: RuntimeServerKeys,
): Record<string, unknown> | undefined {
  const outcome = readJsonAtomicSyncReadOnly<Record<string, unknown>>(filePath, isServerMap);
  if (outcome.status === 'missing') return undefined;
  if (outcome.status === 'unreadable') {
    warnings.push(`${label} is unreadable`);
    return undefined;
  }
  if (outcome.status === 'corrupt') {
    warnings.push(`${label} is corrupt or not a JSON object`);
    return undefined;
  }
  const parsed = outcome.value;
  if (keys === 'mcpServers-only') {
    // The runtime never reads a `servers` key here: report it instead of counting it.
    if (parsed.servers !== undefined) {
      warnings.push(`${label} has a "servers" key, which is not read at runtime; use mcpServers`);
    }
    if (parsed.mcpServers === undefined) return undefined;
    if (!isServerMap(parsed.mcpServers)) {
      warnings.push(`${label} has an invalid mcpServers value (expected an object)`);
      return undefined;
    }
    return parsed.mcpServers;
  }
  // Same selection as the runtime (`mcpServers || servers`).
  const servers = parsed.mcpServers || parsed.servers;
  if (!servers) return undefined;
  if (!isServerMap(servers)) {
    warnings.push(`${label} has an invalid mcpServers/servers value (expected an object)`);
    return undefined;
  }
  return servers;
}

/**
 * Strictly read-only MCP configuration loader for diagnostics. Reads the same
 * three sources with the same precedence, disabled masking, and env resolution
 * as `loadMCPConfig`, but never restores/renames/chmods/creates config or
 * backups/temporaries. Corrupt or unreadable sources yield sanitized warnings
 * instead of being silently treated as "no server configured". Missing config
 * is normal and produces no warning.
 */
export function loadMCPConfigReadOnly(options: LoadMCPConfigOptions = {}): MCPConfigReadOnlyResult {
  const servers: MCPServerConfig[] = [];
  const seenServers = new Set<string>();
  const warnings: string[] = [];
  const projectDir = options.cwd ?? process.cwd();

  const projectMCPPath = path.join(projectDir, '.codebuddy', 'mcp.json');
  const projectMCP = readOnlyServersFromFile(projectMCPPath, 'project .codebuddy/mcp.json', warnings, 'mcpServers-or-servers');
  if (projectMCP) {
    for (const [name, config] of Object.entries(projectMCP)) {
      if (seenServers.has(name)) continue;
      const serverConfig = resolveServerEnv({ ...(config as MCPServerConfig), name });
      if (serverConfig.enabled === false && !options.includeDisabled) {
        seenServers.add(name);
        continue;
      }
      servers.push(serverConfig);
      seenServers.add(name);
    }
  }

  const projectSettingsPath = path.join(projectDir, '.codebuddy', 'settings.json');
  const projectSettings = readOnlyServersFromFile(projectSettingsPath, 'project .codebuddy/settings.json', warnings, 'mcpServers-only');
  if (projectSettings) {
    for (const [name, config] of Object.entries(projectSettings)) {
      if (seenServers.has(name)) continue;
      const serverConfig = resolveServerEnv({ ...(config as MCPServerConfig), name });
      if (serverConfig.enabled !== false || options.includeDisabled) {
        servers.push(serverConfig);
      }
      seenServers.add(name);
    }
  }

  const userMCPPath = path.join(os.homedir(), '.codebuddy', 'mcp.json');
  const userMCP = readOnlyServersFromFile(userMCPPath, 'user ~/.codebuddy/mcp.json', warnings, 'mcpServers-or-servers');
  if (userMCP) {
    for (const [name, config] of Object.entries(userMCP)) {
      if (seenServers.has(name)) continue;
      const serverConfig = resolveServerEnv({ ...(config as MCPServerConfig), name });
      if (serverConfig.enabled !== false || options.includeDisabled) {
        servers.push(serverConfig);
      }
      seenServers.add(name);
    }
  }

  return { servers, warnings };
}

export function saveMCPConfig(config: MCPConfig): void {
  const manager = getSettingsManager();
  const mcpServers: Record<string, MCPServerConfig> = {};

  // Convert servers array to object keyed by name
  for (const server of config.servers) {
    mcpServers[server.name] = server;
  }

  manager.updateProjectSetting('mcpServers', mcpServers);
}

export function addMCPServer(config: MCPServerConfig): void {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const mcpServers = projectSettings.mcpServers || {};

  mcpServers[config.name] = config;
  manager.updateProjectSetting('mcpServers', mcpServers);
}

export function removeMCPServer(serverName: string): void {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  const mcpServers = projectSettings.mcpServers;

  if (mcpServers) {
    delete mcpServers[serverName];
    manager.updateProjectSetting('mcpServers', mcpServers);
  }
}

export function getMCPServer(serverName: string): MCPServerConfig | undefined {
  const manager = getSettingsManager();
  const projectSettings = manager.loadProjectSettings();
  return projectSettings.mcpServers?.[serverName] as MCPServerConfig | undefined;
}

export interface MCPServerEnabledUpdate {
  updated: boolean;
  source?: 'project-mcp' | 'project-settings' | 'user-mcp';
  path?: string;
}

function updateEnabledInJsonFile(
  filePath: string,
  serverName: string,
  enabled: boolean,
): boolean {
  if (!fs.existsSync(filePath)) return false;
  const parsed = readJsonAtomicSync<Record<string, unknown> | null>(filePath, null);
  if (!parsed) return false;
  const key = parsed.mcpServers && typeof parsed.mcpServers === 'object' ? 'mcpServers' : 'servers';
  const servers = parsed[key];
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return false;
  const record = servers as Record<string, unknown>;
  const existing = record[serverName];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return false;
  record[serverName] = { ...existing, enabled };
  writeJsonAtomicSync(filePath, parsed);
  return true;
}

/** Update the highest-priority source that actually defines the server. */
export function setMCPServerEnabled(serverName: string, enabled: boolean): MCPServerEnabledUpdate {
  const projectPath = path.join(process.cwd(), '.codebuddy', 'mcp.json');
  if (updateEnabledInJsonFile(projectPath, serverName, enabled)) {
    return { updated: true, source: 'project-mcp', path: projectPath };
  }

  const manager = getSettingsManager();
  const settings = manager.loadProjectSettings();
  const settingsServers = settings.mcpServers;
  if (settingsServers?.[serverName]) {
    manager.updateProjectSetting('mcpServers', {
      ...settingsServers,
      [serverName]: { ...(settingsServers[serverName] as MCPServerConfig), enabled },
    });
    return { updated: true, source: 'project-settings' };
  }

  const userPath = path.join(os.homedir(), '.codebuddy', 'mcp.json');
  if (updateEnabledInJsonFile(userPath, serverName, enabled)) {
    return { updated: true, source: 'user-mcp', path: userPath };
  }

  return { updated: false };
}

// Predefined server configurations (disabled by default — user activates with API key)
export const PREDEFINED_SERVERS: Record<string, MCPServerConfig> = {
  'brave-search': {
    name: 'brave-search',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY || '' },
    },
    enabled: false,
  },
  'playwright': {
    name: 'playwright',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    },
    enabled: false,
  },
  'exa-search': {
    name: 'exa-search',
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'exa-mcp-server'],
      env: { EXA_API_KEY: process.env.EXA_API_KEY || '' },
    },
    enabled: false,
  },
  'icm': {
    name: 'icm',
    transport: {
      type: 'stdio',
      command: 'icm',
      args: ['mcp'],
      env: {},
    },
    enabled: false,
  },
};

/**
 * Save MCP configuration to project-level .codebuddy/mcp.json (committable)
 */
export function saveProjectMCPConfig(servers: Record<string, MCPServerConfig>): string {
  const projectMCPPath = path.join(process.cwd(), '.codebuddy', 'mcp.json');
  const projectDir = path.dirname(projectMCPPath);

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const config = {
    mcpServers: servers
  };

  writeJsonAtomicSync(projectMCPPath, config);
  return projectMCPPath;
}

/**
 * Create default MCP configuration template
 */
export function createMCPConfigTemplate(): string {
  const projectMCPPath = path.join(process.cwd(), '.codebuddy', 'mcp.json');
  const projectDir = path.dirname(projectMCPPath);

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const template = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "description": "MCP server configuration for this project. This file can be committed to share MCP servers with your team.",
    "mcpServers": {
      "example-stdio": {
        "name": "example-stdio",
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@example/mcp-server"],
        "env": {},
        "enabled": false
      },
      "example-http": {
        "name": "example-http",
        "type": "http",
        "url": "http://localhost:3000/mcp",
        "enabled": false
      },
      "brave-search": {
        "name": "brave-search",
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": { "BRAVE_API_KEY": "" },
        "enabled": false
      },
      "playwright": {
        "name": "playwright",
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@playwright/mcp@latest"],
        "enabled": false
      },
      "exa-search": {
        "name": "exa-search",
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "exa-mcp-server"],
        "env": { "EXA_API_KEY": "" },
        "enabled": false
      }
    }
  };

  writeJsonAtomicSync(projectMCPPath, template);
  return projectMCPPath;
}

/**
 * Check if project has MCP configuration
 */
export function hasProjectMCPConfig(): boolean {
  const projectMCPPath = path.join(process.cwd(), '.codebuddy', 'mcp.json');
  return fs.existsSync(projectMCPPath);
}

/**
 * Get MCP configuration file paths
 */
export function getMCPConfigPaths(): { project: string; user: string } {
  return {
    project: path.join(process.cwd(), '.codebuddy', 'mcp.json'),
    user: path.join(os.homedir(), '.codebuddy', 'mcp.json')
  };
}
