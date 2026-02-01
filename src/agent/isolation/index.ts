/**
 * Multi-Agent Isolation Module
 *
 * Provides isolation capabilities for multi-agent systems including
 * workspaces, memory scoping, and configuration management.
 */

// Agent Configuration
export type { AgentType, AgentCapabilities, AgentConfig, AgentSession } from './agent-config.js';

export {
  DEFAULT_CAPABILITIES,
  DEFAULT_AGENT_CONFIG,
  createAgentConfig,
  generateSessionKey,
  parseSessionKey,
  isCapabilityAllowed,
  isToolGroupAllowed,
} from './agent-config.js';

// Agent Workspace
export type { WorkspaceState, WorkspaceConfig } from './agent-workspace.js';

export {
  DEFAULT_WORKSPACE_CONFIG,
  AgentWorkspace,
  WorkspaceManager,
  getWorkspaceManager,
  resetWorkspaceManager,
} from './agent-workspace.js';

// Isolated Memory
export type { MemoryScope, ScopedMemoryEntry, IsolatedMemoryConfig } from './isolated-memory.js';

export {
  DEFAULT_ISOLATED_MEMORY_CONFIG,
  IsolatedMemory,
  getIsolatedMemory,
  resetIsolatedMemory,
  resetAllIsolatedMemory,
} from './isolated-memory.js';

// Announcements
export type {
  AnnouncementType,
  AnnouncementPriority,
  Announcement,
  AnnouncementFilter,
  AnnouncementEvents,
  AnnouncementQueueConfig,
} from './announcements.js';

export {
  DEFAULT_ANNOUNCEMENT_CONFIG,
  AnnouncementQueue,
  getAnnouncementQueue,
  resetAnnouncementQueue,
  announceResult,
  announceError,
  announceProgress,
  announceRequest,
  requestAndWait,
} from './announcements.js';

// ============================================================================
// Convenience Functions
// ============================================================================

import type { AgentConfig, AgentType } from './agent-config.js';
import { createAgentConfig } from './agent-config.js';
import { getWorkspaceManager, AgentWorkspace } from './agent-workspace.js';
import { getIsolatedMemory, IsolatedMemory, resetIsolatedMemory } from './isolated-memory.js';

/**
 * Create a fully isolated agent environment
 */
export async function createIsolatedAgent(
  id: string,
  type: AgentType,
  name: string,
  configOverrides?: Partial<AgentConfig>
): Promise<{
  config: AgentConfig;
  workspace: AgentWorkspace;
  memory: IsolatedMemory;
}> {
  // Create agent configuration
  const config = createAgentConfig(id, type, name, configOverrides);

  // Create workspace
  const workspaceManager = getWorkspaceManager();
  const workspace = await workspaceManager.createWorkspace(config);

  // Get isolated memory
  const memory = getIsolatedMemory(id);

  return { config, workspace, memory };
}

/**
 * Get or resume an isolated agent environment
 */
export async function getOrCreateIsolatedAgent(
  id: string,
  type: AgentType,
  name: string,
  sessionId?: string,
  configOverrides?: Partial<AgentConfig>
): Promise<{
  config: AgentConfig;
  workspace: AgentWorkspace;
  memory: IsolatedMemory;
  resumed: boolean;
}> {
  const config = createAgentConfig(id, type, name, configOverrides);
  const workspaceManager = getWorkspaceManager();

  // Try to find existing workspace
  let workspace = workspaceManager.getWorkspaceByAgent(id);
  let resumed = false;

  if (!workspace && sessionId) {
    // Try to load from disk
    const loaded = await workspaceManager.loadWorkspace(config, sessionId);
    if (loaded) {
      workspace = loaded;
      resumed = true;
    }
  }

  if (!workspace) {
    // Create new workspace
    workspace = await workspaceManager.createWorkspace(config, sessionId);
  }

  const memory = getIsolatedMemory(id);

  return { config, workspace, memory, resumed };
}

/**
 * Clean up an agent's resources
 */
export async function cleanupAgent(agentId: string, destroy: boolean = false): Promise<void> {
  const workspaceManager = getWorkspaceManager();
  const workspaces = workspaceManager.getWorkspacesForAgent(agentId);

  for (const workspace of workspaces) {
    await workspaceManager.removeWorkspace(workspace.getSession().key, destroy);
  }

  if (destroy) {
    resetIsolatedMemory(agentId);
  }
}

/**
 * List all active agents
 */
export function listActiveAgents(): Array<{
  agentId: string;
  agentName: string;
  agentType: AgentType;
  sessionKey: string;
  lastActivity: number;
}> {
  const workspaceManager = getWorkspaceManager();
  const workspaces = workspaceManager.getActiveWorkspaces();

  return workspaces.map(ws => ({
    agentId: ws.getAgentConfig().id,
    agentName: ws.getAgentConfig().name,
    agentType: ws.getAgentConfig().type,
    sessionKey: ws.getSession().key,
    lastActivity: ws.getSession().lastActivityAt,
  }));
}
