/**
 * Agent Registry
 *
 * Central registry for managing specialized agents.
 * Provides auto-detection of appropriate agents based on file types.
 */

import { EventEmitter } from 'events';
import { extname } from 'path';
import {
  SpecializedAgent,
  AgentTask,
  AgentResult,
  AgentCapability,
} from './types.js';
import { getPDFAgent } from './pdf-agent.js';
import { getExcelAgent } from './excel-agent.js';
import { getDataAnalysisAgent } from './data-analysis-agent.js';
import { getSQLAgent } from './sql-agent.js';
import { getArchiveAgent } from './archive-agent.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentRegistryConfig {
  /** Auto-initialize agents on first use */
  autoInitialize?: boolean;
  /** Enable caching of agent instances */
  cacheAgents?: boolean;
}

export interface AgentMatch {
  agent: SpecializedAgent;
  score: number;
  reason: string;
}

// ============================================================================
// Agent Registry Implementation
// ============================================================================

export class AgentRegistry extends EventEmitter {
  private agents: Map<string, SpecializedAgent> = new Map();
  private config: AgentRegistryConfig;

  constructor(config: AgentRegistryConfig = {}) {
    super();
    this.config = {
      autoInitialize: true,
      cacheAgents: true,
      ...config,
    };
  }

  /**
   * Register all built-in agents
   */
  async registerBuiltInAgents(): Promise<void> {
    const agents = [
      getPDFAgent(),
      getExcelAgent(),
      getDataAnalysisAgent(),
      getSQLAgent(),
      getArchiveAgent(),
    ];

    for (const agent of agents) {
      this.register(agent);
    }

    this.emit('agents:registered', { count: agents.length });
  }

  /**
   * Register a specialized agent
   */
  register(agent: SpecializedAgent): void {
    this.agents.set(agent.getId(), agent);
    this.emit('agent:registered', { id: agent.getId(), name: agent.getName() });
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): boolean {
    const result = this.agents.delete(agentId);
    if (result) {
      this.emit('agent:unregistered', { id: agentId });
    }
    return result;
  }

  /**
   * Get an agent by ID
   */
  get(agentId: string): SpecializedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all registered agents
   */
  getAll(): SpecializedAgent[] {
    return [...this.agents.values()];
  }

  /**
   * Find the best agent for a given file
   */
  findAgentForFile(filePath: string): AgentMatch | null {
    const ext = extname(filePath).toLowerCase().slice(1); // Remove leading dot
    const matches: AgentMatch[] = [];

    for (const agent of this.agents.values()) {
      if (agent.canHandleExtension(ext)) {
        matches.push({
          agent,
          score: 100, // Direct extension match
          reason: `Handles .${ext} files`,
        });
      }
    }

    if (matches.length === 0) {
      return null;
    }

    // Return best match
    return matches.sort((a, b) => b.score - a.score)[0];
  }

  /**
   * Find agents with a specific capability
   */
  findAgentsWithCapability(capability: AgentCapability): SpecializedAgent[] {
    return [...this.agents.values()].filter(agent =>
      agent.hasCapability(capability)
    );
  }

  /**
   * Find the best agent for a task
   */
  findAgentForTask(task: AgentTask): AgentMatch | null {
    // If specific files provided, use file-based matching
    if (task.inputFiles && task.inputFiles.length > 0) {
      return this.findAgentForFile(task.inputFiles[0]);
    }

    // Otherwise, try to match by action name
    const matches: AgentMatch[] = [];

    for (const agent of this.agents.values()) {
      const actions = agent.getSupportedActions();
      if (actions.includes(task.action)) {
        matches.push({
          agent,
          score: 50,
          reason: `Supports action: ${task.action}`,
        });
      }
    }

    if (matches.length === 0) {
      return null;
    }

    return matches.sort((a, b) => b.score - a.score)[0];
  }

  /**
   * Execute a task using the appropriate agent
   */
  async execute(task: AgentTask): Promise<AgentResult> {
    // Find matching agent
    const match = this.findAgentForTask(task);

    if (!match) {
      return {
        success: false,
        error: `No agent found for task: ${task.action}`,
      };
    }

    const agent = match.agent;

    // Initialize if needed
    if (this.config.autoInitialize && !agent.isReady()) {
      await agent.initialize();
    }

    if (!agent.isReady()) {
      return {
        success: false,
        error: `Agent ${agent.getName()} is not ready`,
      };
    }

    this.emit('task:start', {
      agentId: agent.getId(),
      task: task.action,
    });

    try {
      const result = await agent.execute(task);

      this.emit('task:complete', {
        agentId: agent.getId(),
        task: task.action,
        success: result.success,
      });

      return result;
    } catch (error: any) {
      this.emit('task:error', {
        agentId: agent.getId(),
        task: task.action,
        error: error.message,
      });

      return {
        success: false,
        error: `Agent error: ${error.message}`,
      };
    }
  }

  /**
   * Execute a task on a specific agent
   */
  async executeOn(agentId: string, task: AgentTask): Promise<AgentResult> {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${agentId}`,
      };
    }

    if (this.config.autoInitialize && !agent.isReady()) {
      await agent.initialize();
    }

    return agent.execute(task);
  }

  /**
   * Initialize all registered agents
   */
  async initializeAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [id, agent] of this.agents) {
      try {
        await agent.initialize();
        results.set(id, true);
      } catch (_error) {
        results.set(id, false);
      }
    }

    return results;
  }

  /**
   * Get a summary of all agents
   */
  getSummary(): string {
    const lines: string[] = [
      '┌─────────────────────────────────────────────────────────────┐',
      '│              SPECIALIZED AGENTS                             │',
      '├─────────────────────────────────────────────────────────────┤',
    ];

    for (const agent of this.agents.values()) {
      const config = agent.getConfig();
      const status = agent.isReady() ? '✓' : '○';
      const exts = config.fileExtensions.slice(0, 5).join(', ');

      lines.push(`│ ${status} ${config.name.padEnd(20)} │ .${exts.padEnd(30)} │`);
      lines.push(`│   ${config.description.slice(0, 55).padEnd(55)} │`);
    }

    lines.push('└─────────────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  /**
   * Get help for a specific agent
   */
  getAgentHelp(agentId: string): string | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const config = agent.getConfig();
    const actions = agent.getSupportedActions();

    const lines: string[] = [
      `${config.name}`,
      '═'.repeat(config.name.length),
      '',
      config.description,
      '',
      'Supported file types:',
      `  ${config.fileExtensions.map(e => '.' + e).join(', ')}`,
      '',
      'Available actions:',
    ];

    for (const action of actions) {
      lines.push(`  ${action}: ${agent.getActionHelp(action)}`);
    }

    return lines.join('\n');
  }

  /**
   * Cleanup all agents
   */
  async cleanup(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.cleanup();
    }
    this.agents.clear();
    this.emit('cleanup');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let registryInstance: AgentRegistry | null = null;

/**
 * Get the global agent registry
 */
export function getAgentRegistry(): AgentRegistry {
  if (!registryInstance) {
    registryInstance = new AgentRegistry();
  }
  return registryInstance;
}

/**
 * Initialize the agent registry with all built-in agents
 */
export async function initializeAgentRegistry(): Promise<AgentRegistry> {
  const registry = getAgentRegistry();
  await registry.registerBuiltInAgents();
  return registry;
}

/**
 * Reset the agent registry (for testing)
 */
export async function resetAgentRegistry(): Promise<void> {
  if (registryInstance) {
    await registryInstance.cleanup();
    registryInstance = null;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute a task using the appropriate specialized agent
 */
export async function executeSpecializedTask(task: AgentTask): Promise<AgentResult> {
  const registry = getAgentRegistry();

  // Ensure agents are registered
  if (registry.getAll().length === 0) {
    await registry.registerBuiltInAgents();
  }

  return registry.execute(task);
}

/**
 * Find the best agent for a file
 */
export function findAgentForFile(filePath: string): SpecializedAgent | null {
  const registry = getAgentRegistry();
  const match = registry.findAgentForFile(filePath);
  return match?.agent || null;
}

/**
 * Get all available specialized agents
 */
export function getAvailableAgents(): Array<{
  id: string;
  name: string;
  description: string;
  extensions: string[];
  capabilities: AgentCapability[];
}> {
  const registry = getAgentRegistry();
  return registry.getAll().map(agent => {
    const config = agent.getConfig();
    return {
      id: config.id,
      name: config.name,
      description: config.description,
      extensions: config.fileExtensions,
      capabilities: config.capabilities,
    };
  });
}
