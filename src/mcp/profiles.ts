import fs from 'fs';
import path from 'path';

export interface MCPProfile {
  name: string;
  servers: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MCPProfilesConfig {
  version: 1;
  activeProfile: string | null;
  profiles: Record<string, MCPProfile>;
}

const EMPTY_CONFIG: MCPProfilesConfig = {
  version: 1,
  activeProfile: null,
  profiles: {},
};

export function getMCPProfilesPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'mcp-profiles.json');
}

export function loadMCPProfiles(cwd?: string): MCPProfilesConfig {
  const filePath = getMCPProfilesPath(cwd);
  if (!fs.existsSync(filePath)) return { ...EMPTY_CONFIG, profiles: {} };

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MCPProfilesConfig>;
  const profiles = parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
  return {
    version: 1,
    activeProfile: typeof parsed.activeProfile === 'string' ? parsed.activeProfile : null,
    profiles,
  };
}

export function saveMCPProfiles(config: MCPProfilesConfig, cwd?: string): string {
  const filePath = getMCPProfilesPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return filePath;
}

export function upsertMCPProfile(
  name: string,
  servers: string[],
  description?: string,
  cwd?: string,
): MCPProfile {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) {
    throw new Error('Profile names must contain only letters, numbers, dashes, or underscores.');
  }
  const uniqueServers = [...new Set(servers.map(server => server.trim()).filter(Boolean))];
  if (uniqueServers.length === 0) throw new Error('An MCP profile must contain at least one server.');

  const config = loadMCPProfiles(cwd);
  const existing = config.profiles[name];
  const now = new Date().toISOString();
  const profile: MCPProfile = {
    name,
    servers: uniqueServers,
    description: description?.trim() || existing?.description,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  config.profiles[name] = profile;
  saveMCPProfiles(config, cwd);
  return profile;
}

export function removeMCPProfile(name: string, cwd?: string): boolean {
  const config = loadMCPProfiles(cwd);
  if (!config.profiles[name]) return false;
  delete config.profiles[name];
  if (config.activeProfile === name) config.activeProfile = null;
  saveMCPProfiles(config, cwd);
  return true;
}

export function setActiveMCPProfile(name: string | null, cwd?: string): MCPProfilesConfig {
  const config = loadMCPProfiles(cwd);
  if (name !== null && !config.profiles[name]) throw new Error(`Unknown MCP profile: ${name}`);
  config.activeProfile = name;
  saveMCPProfiles(config, cwd);
  return config;
}
