export type AgentBasePermission = 'read' | 'write' | 'external';
export type AgentBaseConnectorStatus =
  | 'connected'
  | 'connecting'
  | 'failed'
  | 'disabled'
  | 'available';

export interface AgentBaseTool {
  name: string;
  description?: string;
  permission: AgentBasePermission;
}

export interface AgentBaseConnector {
  id: string;
  catalogId?: string;
  name: string;
  description?: string;
  category: string;
  source: 'configured' | 'marketplace';
  installed: boolean;
  enabled: boolean;
  status: AgentBaseConnectorStatus;
  auth: {
    mode: 'oauth' | 'secret' | 'local' | 'none';
    configured: boolean;
    /** Presence only. Tokens and secret values never cross IPC. */
    detail: string;
  };
  permissions: Record<AgentBasePermission, boolean>;
  tools: AgentBaseTool[];
}

export interface AgentBaseAuditEvent {
  id: string;
  timestamp: number;
  connectorId: string;
  action:
    | 'connector_imported'
    | 'permissions_updated'
    | 'confirmation_requested'
    | 'invocation_allowed'
    | 'invocation_completed'
    | 'invocation_denied'
    | 'invocation_failed';
  toolName?: string;
  permission?: AgentBasePermission;
  success: boolean;
  detail: string;
}

export interface AgentBaseInvokeInput {
  connectorId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentBaseInvokeResult {
  success: boolean;
  durationMs: number;
  result?: unknown;
  error?: string;
  confirmationRequired?: boolean;
}

export type AgentBaseCodeBuddyImportSource = 'project' | 'user';

/** Secret-free preview of a Code Buddy MCP entry that Cowork can import. */
export interface AgentBaseCodeBuddyImportCandidate {
  id: string;
  name: string;
  description?: string;
  source: AgentBaseCodeBuddyImportSource;
  transport: 'stdio' | 'sse' | 'streamable-http' | 'unsupported';
  command?: string;
  /** Secret-free preview only. Literal credential-shaped arguments are redacted and make the candidate non-importable. */
  args: string[];
  url?: string;
  envKeys: string[];
  secretEnvKeys: string[];
  enabledInSource: boolean;
  alreadyConfigured: boolean;
  importable: boolean;
  issue?: string;
}

export interface AgentBaseCodeBuddyDiscoveryResult {
  ok: boolean;
  candidates: AgentBaseCodeBuddyImportCandidate[];
  warnings: string[];
  error?: string;
}

export interface AgentBaseCodeBuddyImportResult {
  ok: boolean;
  imported?: { id: string; name: string; enabled: false };
  error?: string;
}
