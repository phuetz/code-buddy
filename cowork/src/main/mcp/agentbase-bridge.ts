import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentBaseAuditEvent,
  AgentBaseConnector,
  AgentBaseInvokeInput,
  AgentBaseInvokeResult,
  AgentBasePermission,
  AgentBaseTool,
} from '../../shared/agentbase-types';
import type { MCPServerConfig } from './mcp-manager';

interface LiveStatus {
  id: string;
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
}

interface LiveTool {
  name: string;
  description?: string;
  serverId: string;
}

interface MarketplaceItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  installed?: boolean;
  installedServerId?: string;
  enabled?: boolean;
}

export interface AgentBaseBridgeDeps {
  listServers: () => MCPServerConfig[];
  listStatuses: () => LiveStatus[];
  listTools: () => LiveTool[];
  listMarketplace: () => MarketplaceItem[];
  hasOAuthState: (serverId: string) => boolean;
  invokeTool: (toolName: string, args: Record<string, unknown>) => Promise<{
    success: boolean;
    durationMs: number;
    result?: unknown;
    error?: string;
  }>;
  confirmExternalAction: (input: {
    connector: AgentBaseConnector;
    tool: AgentBaseTool;
    argumentKeys: string[];
    argumentPreview: string;
  }) => Promise<{ confirmed: boolean; feedback?: string }>;
}

const EXTERNAL_ACTION = /(^|__|[._-])(send|publish|post|delete|remove|invite|message|email|deploy|merge|purchase|book|submit|execute|run)(_|\.|-|$)/i;
// Remote state changes are writes even when their product wording sounds
// passive (for example `mark_as_read`, `ack_alert`, or `archive_thread`).
// Keep this list ahead of READ_ACTION so such compound names fail closed.
const WRITE_ACTION = /(^|__|[._-])(write|save|edit|patch|update|create|move|copy|rename|append|set|download|mark|ack|acknowledge|archive|restore|star|unstar|like|unlike|react|follow|unfollow|mute|unmute|enable|disable|assign|unassign|label|tag)(_|\.|-|$)/i;
const READ_ACTION = /(^|__|[._-])(get|list|read|search|find|fetch|query|view|inspect|status|describe|lookup)(_|\.|-|$)/i;
const SECRET_KEY = /(token|secret|password|api.?key|authorization|cookie|credential)/i;
const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIT_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_AUDIT_ARCHIVES = 5;

function sanitizeAuditDetail(detail: string): string {
  return detail
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/gu, '[REDACTED PEM]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|password|api.?key|authorization|cookie|credential)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .slice(0, 500);
}

function redactArgumentValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeAuditDetail(value);
  if (Array.isArray(value)) return value.map((entry) => redactArgumentValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [
        entryKey,
        redactArgumentValue(entry, entryKey),
      ])
    );
  }
  return value;
}

function argumentPreview(args: Record<string, unknown>): string {
  const serialized = JSON.stringify(redactArgumentValue(args), null, 2);
  return serialized.length > 4000 ? `${serialized.slice(0, 4000)}\n… [truncated]` : serialized;
}

export function classifyAgentBaseTool(name: string): AgentBasePermission {
  // Order matters: compound names such as `list_then_update` must never be
  // downgraded to read-only just because they contain a read verb first.
  if (EXTERNAL_ACTION.test(name)) return 'external';
  if (WRITE_ACTION.test(name)) return 'write';
  if (READ_ACTION.test(name)) return 'read';
  // Unknown capabilities are externally visible until proven otherwise.
  return 'external';
}

function defaultPermissions(): Record<AgentBasePermission, boolean> {
  return { read: true, write: false, external: false };
}

export class AgentBaseBridge {
  private permissions: Record<string, Record<AgentBasePermission, boolean>> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly deps: AgentBaseBridgeDeps
  ) {}

  recordConnectorImport(connectorId: string, name: string): void {
    this.audit({
      connectorId,
      action: 'connector_imported',
      success: true,
      detail: `Imported ${sanitizeAuditDetail(name)} disabled from Code Buddy MCP configuration`,
    });
  }

  list(): AgentBaseConnector[] {
    const servers = this.deps.listServers();
    const statuses = new Map(this.deps.listStatuses().map((status) => [status.id, status.status]));
    const tools = this.deps.listTools();
    const marketplace = this.deduplicateMarketplace(this.deps.listMarketplace());
    const marketplaceByServer = new Map(
      marketplace
        .filter((item) => item.installedServerId)
        .map((item) => [item.installedServerId as string, item])
    );
    const configured = servers.map((server): AgentBaseConnector => {
      const catalog = marketplaceByServer.get(server.id);
      const serverTools = tools
        .filter((tool) => tool.serverId === server.id)
        .map((tool): AgentBaseTool => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          permission: classifyAgentBaseTool(tool.name),
        }));
      return {
        id: server.id,
        ...(catalog ? { catalogId: catalog.id } : {}),
        name: server.name,
        ...(catalog?.description ? { description: catalog.description } : {}),
        category: catalog?.category ?? 'custom',
        source: 'configured',
        installed: true,
        enabled: server.enabled,
        status: server.enabled ? statuses.get(server.id) ?? 'connecting' : 'disabled',
        auth: this.authStatus(server),
        permissions: this.getPermissions(server.id),
        tools: serverTools,
      };
    });
    const configuredCatalogIds = new Set(configured.map((item) => item.catalogId).filter(Boolean));
    const available = marketplace
      .filter((item) => !item.installed && !configuredCatalogIds.has(item.id))
      .map((item): AgentBaseConnector => ({
        id: `catalog:${item.id}`,
        catalogId: item.id,
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        category: item.category ?? 'custom',
        source: 'marketplace',
        installed: false,
        enabled: false,
        status: 'available',
        auth: { mode: 'none', configured: false, detail: 'Not installed' },
        permissions: defaultPermissions(),
        tools: [],
      }));
    return [...configured, ...available];
  }

  setPermissions(
    connectorId: string,
    patch: Partial<Record<AgentBasePermission, boolean>>
  ): Record<AgentBasePermission, boolean> | null {
    if (!this.deps.listServers().some((server) => server.id === connectorId)) return null;
    const current = this.getPermissions(connectorId);
    const next = {
      read: typeof patch.read === 'boolean' ? patch.read : current.read,
      write: typeof patch.write === 'boolean' ? patch.write : current.write,
      external: typeof patch.external === 'boolean' ? patch.external : current.external,
    };
    const all = this.loadPermissions();
    this.permissions = { ...all, [connectorId]: next };
    this.persistPermissions();
    this.audit({
      connectorId,
      action: 'permissions_updated',
      success: true,
      detail: `read=${next.read}, write=${next.write}, external=${next.external}`,
    });
    return next;
  }

  async invoke(input: AgentBaseInvokeInput): Promise<AgentBaseInvokeResult> {
    const connector = this.list().find(
      (candidate) => candidate.id === input.connectorId && candidate.installed
    );
    if (!connector || !connector.enabled || connector.status !== 'connected') {
      const error = 'Connector is not installed, enabled and connected';
      this.audit({ connectorId: input.connectorId, action: 'invocation_denied', success: false, detail: error });
      return { success: false, durationMs: 0, error };
    }
    const tool = connector.tools.find((candidate) => candidate.name === input.toolName);
    if (!tool) {
      const error = 'Tool does not belong to this connector';
      this.audit({ connectorId: connector.id, action: 'invocation_denied', success: false, detail: error });
      return { success: false, durationMs: 0, error };
    }
    if (!connector.permissions[tool.permission]) {
      const error = `${tool.permission} permission is disabled for this connector`;
      this.audit({
        connectorId: connector.id,
        action: 'invocation_denied',
        toolName: tool.name,
        permission: tool.permission,
        success: false,
        detail: error,
      });
      return { success: false, durationMs: 0, error };
    }

    if (tool.permission !== 'read') {
      if (!this.audit({
        connectorId: connector.id,
        action: 'confirmation_requested',
        toolName: tool.name,
        permission: tool.permission,
        success: true,
        detail: 'Fresh confirmation requested',
      })) {
        return {
          success: false,
          durationMs: 0,
          error: 'Audit trail unavailable; external action blocked before confirmation',
        };
      }
      let confirmation: { confirmed: boolean; feedback?: string };
      try {
        confirmation = await this.deps.confirmExternalAction({
          connector,
          tool,
          argumentKeys: Object.keys(input.args).filter((key) => !SECRET_KEY.test(key)),
          argumentPreview: argumentPreview(input.args),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.audit({
          connectorId: connector.id,
          action: 'invocation_denied',
          toolName: tool.name,
          permission: tool.permission,
          success: false,
          detail: `Confirmation failed: ${message}`,
        });
        return { success: false, durationMs: 0, error: 'External action confirmation failed' };
      }
      if (!confirmation.confirmed) {
        const error = confirmation.feedback ?? 'External action was not approved';
        this.audit({
          connectorId: connector.id,
          action: 'invocation_denied',
          toolName: tool.name,
          permission: tool.permission,
          success: false,
          detail: error,
        });
        return { success: false, durationMs: 0, error, confirmationRequired: true };
      }
      if (!this.audit({
        connectorId: connector.id,
        action: 'invocation_allowed',
        toolName: tool.name,
        permission: tool.permission,
        success: true,
        detail: 'Fresh confirmation granted; invocation starting',
      })) {
        return {
          success: false,
          durationMs: 0,
          error: 'Audit trail unavailable; confirmed external action was not executed',
        };
      }
    }

    let result: AgentBaseInvokeResult;
    try {
      result = await this.deps.invokeTool(tool.name, input.args);
    } catch (error) {
      result = {
        success: false,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.audit({
      connectorId: connector.id,
      action: result.success ? 'invocation_completed' : 'invocation_failed',
      toolName: tool.name,
      permission: tool.permission,
      success: result.success,
      detail: result.success ? `Completed in ${result.durationMs} ms` : result.error ?? 'Invocation failed',
    });
    return result;
  }

  auditLog(limit = 100): AgentBaseAuditEvent[] {
    let descriptor: number | null = null;
    try {
      const file = this.auditPath();
      const size = fs.statSync(file).size;
      const bytesToRead = Math.min(size, MAX_AUDIT_TAIL_BYTES);
      const buffer = Buffer.alloc(bytesToRead);
      descriptor = fs.openSync(file, fs.constants.O_RDONLY);
      fs.readSync(descriptor, buffer, 0, bytesToRead, size - bytesToRead);
      fs.closeSync(descriptor);
      descriptor = null;
      let text = buffer.toString('utf8');
      if (size > bytesToRead) {
        const firstNewline = text.indexOf('\n');
        text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
      }
      const lines = text.split(/\r?\n/).filter(Boolean);
      return lines
        .slice(-Math.max(1, Math.min(limit, 500)))
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as AgentBaseAuditEvent];
          } catch {
            return [];
          }
        })
        .reverse();
    } catch {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch { /* best effort */ }
      }
      return [];
    }
  }

  private getPermissions(connectorId: string): Record<AgentBasePermission, boolean> {
    const stored = this.loadPermissions()[connectorId];
    const defaults = defaultPermissions();
    if (!stored) return defaults;
    return {
      read: typeof stored.read === 'boolean' ? stored.read : defaults.read,
      write: typeof stored.write === 'boolean' ? stored.write : defaults.write,
      external: typeof stored.external === 'boolean' ? stored.external : defaults.external,
    };
  }

  private loadPermissions(): Record<string, Record<AgentBasePermission, boolean>> {
    // Read on every policy decision. AgentBase has multiple production
    // consumers (Settings IPC and cached agent sessions); an in-memory cache
    // in one bridge would otherwise keep stale permissions after the user
    // changes them through another bridge.
    try {
      const parsed = JSON.parse(fs.readFileSync(this.permissionsPath(), 'utf8'));
      this.permissions = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.permissions = {};
    }
    return this.permissions ?? {};
  }

  private persistPermissions(): void {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const temporary = `${this.permissionsPath()}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.permissions, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.permissionsPath());
  }

  private audit(event: Omit<AgentBaseAuditEvent, 'id' | 'timestamp'>): boolean {
    let descriptor: number | null = null;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      if (!this.rotateAuditIfNeeded()) return false;
      try {
        const existing = fs.lstatSync(this.auditPath());
        if (!existing.isFile() || existing.isSymbolicLink()) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      }
      const complete: AgentBaseAuditEvent = {
        id: randomUUID(),
        timestamp: Date.now(),
        ...event,
        detail: sanitizeAuditDetail(event.detail),
      };
      let flags = fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY;
      const noFollow = (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW;
      if (typeof noFollow === 'number') flags |= noFollow;
      descriptor = fs.openSync(this.auditPath(), flags, 0o600);
      fs.chmodSync(this.auditPath(), 0o600);
      fs.writeSync(descriptor, `${JSON.stringify(complete)}\n`);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      return true;
    } catch {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the original audit failure.
        }
      }
      return false;
    }
  }

  private rotateAuditIfNeeded(): boolean {
    try {
      const file = this.auditPath();
      let existing: fs.Stats;
      try {
        existing = fs.lstatSync(file);
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT';
      }
      if (!existing.isFile() || existing.isSymbolicLink()) return false;
      if (existing.size < MAX_AUDIT_FILE_BYTES) return true;
      const archive = path.join(
        this.dataDir,
        `audit.${Date.now()}.${randomUUID().slice(0, 8)}.jsonl`,
      );
      fs.renameSync(file, archive);
      fs.chmodSync(archive, 0o600);
      const archives = fs.readdirSync(this.dataDir)
        .filter((name) => /^audit\.\d+\.[a-f0-9-]+\.jsonl$/iu.test(name))
        .sort();
      for (const name of archives.slice(0, Math.max(0, archives.length - MAX_AUDIT_ARCHIVES))) {
        fs.unlinkSync(path.join(this.dataDir, name));
      }
      return true;
    } catch {
      return false;
    }
  }

  private authStatus(server: MCPServerConfig): AgentBaseConnector['auth'] {
    if (server.oauth) {
      const configured = this.deps.hasOAuthState(server.id);
      return {
        mode: 'oauth',
        configured,
        detail: configured ? 'OAuth session stored' : 'OAuth sign-in required',
      };
    }
    const values = [
      ...Object.entries(server.env ?? {}),
      ...Object.entries(server.headers ?? {}),
    ];
    const secretFields = values.filter(([key]) => SECRET_KEY.test(key));
    if (secretFields.length > 0) {
      const configured = secretFields.every(([, value]) => Boolean(value));
      return {
        mode: 'secret',
        configured,
        detail: configured ? `${secretFields.length} secret field(s) configured` : 'Secret configuration incomplete',
      };
    }
    if (server.type === 'stdio') {
      return { mode: 'local', configured: true, detail: 'Local process transport' };
    }
    return { mode: 'none', configured: true, detail: 'No authentication declared' };
  }

  private deduplicateMarketplace(items: MarketplaceItem[]): MarketplaceItem[] {
    const byId = new Map<string, MarketplaceItem>();
    for (const item of items) {
      const existing = byId.get(item.id);
      if (!existing || item.installed) byId.set(item.id, item);
    }
    return [...byId.values()];
  }

  private permissionsPath(): string {
    return path.join(this.dataDir, 'permissions.json');
  }

  private auditPath(): string {
    return path.join(this.dataDir, 'audit.jsonl');
  }
}
