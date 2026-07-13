/**
 * ConfigExportService — Claude Cowork parity Phase 2 step 19
 *
 * Serializes the user's settings (API config, projects, rules, custom
 * skills, MCP servers) into a versioned JSON bundle and imports them
 * back with conflict resolution.
 *
 * @module main/config/config-export-service
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { logWarn } from '../utils/logger';
import { configStore } from '../config/config-store';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import type {
  ProjectContextConfig,
  ProjectManager,
  ProjectMemoryConfig,
} from '../project/project-manager';

export interface ConfigExportBundle {
  version: number;
  exportedAt: string;
  source: string;
  app: {
    api: Record<string, unknown>;
    theme?: string;
  };
  projects: Array<Record<string, unknown>>;
  mcpServers: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
}

export interface ImportConflict {
  type: 'project' | 'mcpServer' | 'apiKey';
  identifier: string;
  current?: unknown;
  incoming: unknown;
}

export interface ImportPreview {
  bundle: ConfigExportBundle;
  conflicts: ImportConflict[];
  newProjects: number;
  newMcpServers: number;
}

export interface ImportResult {
  success: boolean;
  imported: {
    projects: number;
    mcpServers: number;
    apiUpdated: boolean;
  };
  errors: string[];
}

const BUNDLE_VERSION = 1;
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const MAX_BUNDLE_ITEMS = 1_000;
const REDACTED_VALUE = '[REDACTED]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return normalized.includes('apikey')
    || normalized.endsWith('password')
    || normalized.endsWith('passwd')
    || normalized.endsWith('secret')
    || normalized.endsWith('token')
    || normalized.endsWith('privatekey')
    || normalized.endsWith('encryptionkey')
    || normalized.endsWith('accesskey')
    || normalized === 'authorization'
    || normalized.endsWith('authorization')
    || normalized === 'cookie'
    || normalized.endsWith('cookie');
}

function redactStringFragments(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED_VALUE}`)
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)=)[^&#\s]+/gi,
      `$1${REDACTED_VALUE}`
    )
    .replace(/(https?:\/\/)[^:/@\s]+:[^/@\s]+@/gi, `$1${REDACTED_VALUE}@`);
}

function redactArgumentList(values: unknown[]): unknown[] {
  let redactNext = false;
  return values.map((value) => {
    if (redactNext) {
      redactNext = false;
      return REDACTED_VALUE;
    }
    if (typeof value !== 'string') return redactSensitiveConfig(value);
    const separator = value.indexOf('=');
    const flag = (separator >= 0 ? value.slice(0, separator) : value).replace(/^-+/, '');
    if (isSensitiveKey(flag)) {
      if (separator < 0) {
        redactNext = true;
        return value;
      }
      return `${value.slice(0, separator + 1)}${REDACTED_VALUE}`;
    }
    return redactStringFragments(value);
  });
}

/** Recursively redact credentials from API profiles and MCP env/header/argument trees. */
export function redactSensitiveConfig(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    return normalizedKey(parentKey).endsWith('args')
      ? redactArgumentList(value)
      : value.map((item) => redactSensitiveConfig(item));
  }
  if (!isRecord(value)) {
    return typeof value === 'string' ? redactStringFragments(value) : value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSensitiveKey(key)
      ? REDACTED_VALUE
      : redactSensitiveConfig(child, key);
  }
  return result;
}

function restoreRedactedValues(incoming: unknown, current: unknown): unknown {
  if (incoming === REDACTED_VALUE) return current;
  if (Array.isArray(incoming)) {
    const currentItems = Array.isArray(current) ? current : [];
    const currentById = new Map(
      currentItems
        .filter(isRecord)
        .filter((item) => typeof item.id === 'string')
        .map((item) => [item.id as string, item])
    );
    return incoming.map((item, index) => {
      const matchingCurrent = isRecord(item) && typeof item.id === 'string'
        ? currentById.get(item.id) ?? currentItems[index]
        : currentItems[index];
      return restoreRedactedValues(item, matchingCurrent);
    });
  }
  if (!isRecord(incoming)) return incoming;
  const currentRecord = isRecord(current) ? current : {};
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(incoming)) {
    const restored = restoreRedactedValues(child, currentRecord[key]);
    if (restored !== undefined) result[key] = restored;
  }
  return result;
}

function validateProject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.name !== 'string') return false;
  if (!value.name.trim() || value.name.length > 200) return false;
  if (value.id !== undefined && (typeof value.id !== 'string' || value.id.length > 200)) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.workspacePath !== undefined && typeof value.workspacePath !== 'string') return false;
  if (value.memoryConfig !== undefined && !isRecord(value.memoryConfig)) return false;
  if (value.contextConfig !== undefined && !isRecord(value.contextConfig)) return false;
  return true;
}

function validateMcpServer(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id || value.id.length > 200) return false;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return false;
  if (!['stdio', 'sse', 'streamable-http'].includes(String(value.type))) return false;
  if (value.command !== undefined && typeof value.command !== 'string') return false;
  if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string'))) return false;
  if (value.env !== undefined && (!isRecord(value.env) || !Object.values(value.env).every((item) => typeof item === 'string'))) return false;
  if (value.headers !== undefined && (!isRecord(value.headers) || !Object.values(value.headers).every((item) => typeof item === 'string'))) return false;
  return true;
}

function assertBundle(value: unknown): ConfigExportBundle {
  if (!isRecord(value)) throw new Error('Invalid bundle: expected an object');
  if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) {
    throw new Error('Invalid bundle: unsupported version');
  }
  if (Number(value.version) > BUNDLE_VERSION) {
    throw new Error(`Bundle version ${String(value.version)} is newer than supported ${BUNDLE_VERSION}`);
  }
  if (!isRecord(value.app) || !isRecord(value.app.api)) {
    throw new Error('Invalid bundle: app.api must be an object');
  }
  if (!Array.isArray(value.projects) || value.projects.length > MAX_BUNDLE_ITEMS || !value.projects.every(validateProject)) {
    throw new Error('Invalid bundle: malformed projects');
  }
  if (!Array.isArray(value.mcpServers) || value.mcpServers.length > MAX_BUNDLE_ITEMS || !value.mcpServers.every(validateMcpServer)) {
    throw new Error('Invalid bundle: malformed MCP servers');
  }
  return value as unknown as ConfigExportBundle;
}

export class ConfigExportService {
  constructor(private projectManager: ProjectManager) {}

  /** Build a bundle from the current state. */
  exportBundle(): ConfigExportBundle {
    const config = configStore.getAll() as unknown as Record<string, unknown>;
    const projects = this.projectManager.list();
    const mcpServers = mcpConfigStore.getServers();

    return {
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      source: `Code Buddy Cowork ${app.getVersion()}`,
      app: {
        api: this.sanitizeApiConfig(config),
        theme: (config as Record<string, unknown>).theme as string | undefined,
      },
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        workspacePath: p.workspacePath,
        memoryConfig: p.memoryConfig,
        contextConfig: p.contextConfig,
        createdAt: p.createdAt,
      })),
      mcpServers: mcpServers.map((server) =>
        redactSensitiveConfig(server) as Record<string, unknown>
      ),
    };
  }

  /** Sanitize the API config: drop or mask known secret fields. */
  private sanitizeApiConfig(config: Record<string, unknown>): Record<string, unknown> {
    return redactSensitiveConfig(config) as Record<string, unknown>;
  }

  /** Write the bundle to a file path on disk. */
  saveToFile(targetPath: string): { success: boolean; error?: string; bundle?: ConfigExportBundle } {
    try {
      const bundle = this.exportBundle();
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(bundle, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.chmodSync(targetPath, 0o600);
      return { success: true, bundle };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Read a bundle from disk. */
  loadFromFile(sourcePath: string): { success: boolean; bundle?: ConfigExportBundle; error?: string } {
    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `File not found: ${sourcePath}` };
      }
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) {
        return { success: false, error: 'Invalid bundle: file is not regular or is too large' };
      }
      const raw = fs.readFileSync(sourcePath, 'utf-8');
      return { success: true, bundle: assertBundle(JSON.parse(raw) as unknown) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Compute conflicts between an incoming bundle and current state. */
  diffBundle(bundle: ConfigExportBundle): ImportPreview {
    bundle = assertBundle(bundle);
    const conflicts: ImportConflict[] = [];
    const currentProjects = this.projectManager.list();
    const currentProjectIds = new Set(currentProjects.map((p) => p.id));
    const currentProjectNames = new Map(currentProjects.map((p) => [p.name, p]));
    const currentServers = mcpConfigStore.getServers();
    const currentServerNames = new Set(currentServers.map((s) => s.name));

    let newProjects = 0;
    for (const proj of bundle.projects) {
      const id = proj.id as string;
      const name = proj.name as string;
      if (currentProjectIds.has(id) || currentProjectNames.has(name)) {
        conflicts.push({
          type: 'project',
          identifier: name,
          current: currentProjectNames.get(name),
          incoming: proj,
        });
      } else {
        newProjects++;
      }
    }

    let newMcpServers = 0;
    for (const server of bundle.mcpServers) {
      const name = server.name as string;
      if (currentServerNames.has(name)) {
        conflicts.push({
          type: 'mcpServer',
          identifier: name,
          current: currentServers.find((s) => s.name === name),
          incoming: server,
        });
      } else {
        newMcpServers++;
      }
    }

    return { bundle, conflicts, newProjects, newMcpServers };
  }

  /**
   * Apply an import bundle. `strategy` controls how conflicts are
   * resolved: `skip` keeps existing items, `overwrite` replaces them.
   */
  importBundle(
    bundle: ConfigExportBundle,
    strategy: 'skip' | 'overwrite' = 'skip'
  ): ImportResult {
    const result: ImportResult = {
      success: true,
      imported: { projects: 0, mcpServers: 0, apiUpdated: false },
      errors: [],
    };

    if (strategy !== 'skip' && strategy !== 'overwrite') {
      result.success = false;
      result.errors.push('Invalid import conflict strategy');
      return result;
    }

    try {
      bundle = assertBundle(bundle);
    } catch (error) {
      result.success = false;
      result.errors.push((error as Error).message);
      return result;
    }

    const currentProjects = this.projectManager.list();
    const currentProjectIds = new Set(currentProjects.map((p) => p.id));
    const currentProjectNames = new Map(currentProjects.map((p) => [p.name, p.id]));
    const currentServers = mcpConfigStore.getServers();
    const currentServerNames = new Set(currentServers.map((s) => s.name));

    // Projects
    for (const proj of bundle.projects) {
      const id = proj.id as string;
      const name = proj.name as string;
      const isConflict = currentProjectIds.has(id) || currentProjectNames.has(name);
      if (isConflict && strategy === 'skip') continue;
      try {
        if (isConflict && strategy === 'overwrite') {
          const existingId = currentProjectIds.has(id) ? id : currentProjectNames.get(name);
          if (existingId) {
            this.projectManager.update(existingId, {
              name: name,
              description: proj.description as string | undefined,
              workspacePath: proj.workspacePath as string | undefined,
              memoryConfig: proj.memoryConfig as ProjectMemoryConfig | undefined,
              contextConfig: proj.contextConfig as ProjectContextConfig | undefined,
            });
          }
        } else {
          this.projectManager.create({
            name,
            description: proj.description as string | undefined,
            workspacePath: proj.workspacePath as string | undefined,
            memoryConfig: proj.memoryConfig as ProjectMemoryConfig | undefined,
            contextConfig: proj.contextConfig as ProjectContextConfig | undefined,
          });
        }
        result.imported.projects++;
      } catch (err) {
        result.errors.push(`project ${name}: ${(err as Error).message}`);
      }
    }

    // MCP servers
    for (const server of bundle.mcpServers) {
      const name = server.name as string;
      const isConflict = currentServerNames.has(name);
      if (isConflict && strategy === 'skip') continue;
      try {
        const existing = currentServers.find((candidate) =>
          candidate.id === server.id || candidate.name === name
        );
        const restored = restoreRedactedValues(server, existing) as Record<string, unknown>;
        mcpConfigStore.saveServer({
          ...restored,
          id: existing?.id ?? String(server.id),
          enabled: false,
        } as never);
        result.imported.mcpServers++;
      } catch (err) {
        result.errors.push(`MCP server ${name}: ${(err as Error).message}`);
      }
    }

    // API config (only update non-secret fields)
    if (bundle.app.api && Object.keys(bundle.app.api).length > 0) {
      try {
        const incoming = restoreRedactedValues(
          bundle.app.api,
          configStore.getAll()
        ) as Record<string, unknown>;
        if (Object.keys(incoming).length > 0) {
          configStore.update(incoming as never);
          result.imported.apiUpdated = true;
        }
      } catch (err) {
        result.errors.push(`API config: ${(err as Error).message}`);
      }
    }

    if (result.errors.length > 0) {
      result.success = false;
      logWarn('[ConfigExportService] import completed with errors:', result.errors);
    }

    return result;
  }
}
