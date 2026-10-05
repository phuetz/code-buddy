/**
 * CustomAgentLoader - Load custom agents from ~/.codebuddy/agents/
 *
 * Allows users to define custom AI agents with specific:
 * - System prompts
 * - Tool configurations
 * - Model preferences
 * - Behavior settings
 *
 * Inspired by Mistral Vibe CLI's custom agents feature.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import TOML from '@iarna/toml';
import * as yaml from 'yaml';
import { parseAgentMarkdown } from '../definitions/agent-definition-loader.js';
import { parseAgentTools } from '../agent-tools.js';
import {
  normalizeDispatchProfile,
  type FleetDispatchProfile,
} from '../../fleet/dispatch-profile.js';
import { getAgentsDir } from '../../utils/codebuddy-home.js';
import { logger } from '../../utils/logger.js';
import { buildHermesAgentSystemPrompt } from '../hermes-agent-profile.js';

// ============================================================================
// Types
// ============================================================================

export interface CustomAgentConfig {
  /** Unique agent identifier (derived from filename) */
  id: string;
  /** Display name */
  name: string;
  /** Description of what this agent does */
  description: string;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Model to use (optional, defaults to current model) */
  model?: string;
  /** Allowed tool patterns: absent inherits defaults; an explicit empty array denies all. */
  tools?: string[];
  /** Tools this agent cannot use */
  disabledTools?: string[];
  /** Default Fleet dispatch profile to use when agent delegates work */
  fleetDispatchProfile?: FleetDispatchProfile;
  /** Whether this agent should make delegated Fleet profile selection explicit */
  requireExplicitDispatchProfile?: boolean;
  /** Temperature for responses (0-2) */
  temperature?: number;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Whether to stream responses */
  streaming?: boolean;
  /** Custom variables that can be used in prompts */
  variables?: Record<string, string>;
  /** Trigger words that auto-activate this agent */
  triggers?: string[];
  /** Tags for organization */
  tags?: string[];
  /** Author information */
  author?: string;
  /** Version */
  version?: string;
}

export interface CustomAgentFile {
  /** File path */
  path: string;
  /** File format */
  format: 'toml' | 'yaml' | 'json' | 'md';
  /** Parsed configuration */
  config: CustomAgentConfig;
  /** Last modified time */
  modifiedAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

// Use GROK_HOME/agents/ directory (supports GROK_HOME env var)

const EXAMPLE_AGENT_TOML = `# Example Custom Agent Configuration
# Place this file in ~/.codebuddy/agents/

# Basic Info
name = "Code Reviewer"
description = "Reviews code for best practices, bugs, and improvements"
version = "1.0.0"
author = "Your Name"

# Tags for organization
tags = ["code", "review", "quality"]

# Trigger words (optional) - agent activates when these appear
triggers = ["review this", "check this code", "code review"]

# Model settings (optional)
# model = "grok-4-latest"
temperature = 0.3
maxTokens = 4000
streaming = true

# Tool configuration (optional)
# tools = ["read_file", "list_files", "search_files"]  # Only these tools
# disabledTools = ["bash", "write_file"]  # All except these

# Custom variables (accessible in systemPrompt as {{variable_name}})
[variables]
style_guide = "Google TypeScript Style Guide"
focus_areas = "security, performance, readability"

# System Prompt
systemPrompt = """
You are an expert code reviewer. Your job is to analyze code and provide actionable feedback.

Focus areas: {{focus_areas}}
Style guide: {{style_guide}}

When reviewing code:
1. Look for bugs and logic errors
2. Check for security vulnerabilities
3. Evaluate performance implications
4. Assess code readability and maintainability
5. Suggest improvements with examples

Be constructive and explain the "why" behind each suggestion.
"""
`;

const BUILT_IN_AGENTS: CustomAgentFile[] = [
  {
    path: 'builtin:hermes',
    format: 'toml',
    modifiedAt: new Date(0),
    config: {
      id: 'hermes',
      name: 'Hermes Agent',
      description:
        'Hermes-inspired autonomous Code Buddy profile for toolset-aware Fleet work, skills, memory, session search, scheduling, and delegation.',
      systemPrompt: buildHermesAgentSystemPrompt('balanced'),
      disabledTools: ['git_push', 'delete_file'],
      fleetDispatchProfile: 'balanced',
      requireExplicitDispatchProfile: true,
      streaming: true,
      triggers: [
        'hermes agent',
        'hermes-style',
        'self improving agent',
        'toolset-aware agent',
      ],
      tags: [
        'builtin',
        'hermes',
        'fleet',
        'toolsets',
        'memory',
        'skills',
        'delegation',
      ],
      version: '1.0.0',
      author: 'Code Buddy',
    },
  },
];

// ============================================================================
// Agent Loader
// ============================================================================

export class CustomAgentLoader {
  private agentsDir: string;
  private cache: Map<string, CustomAgentFile> = new Map();
  private lastScan: number = 0;
  private scanInterval: number = 5000; // 5 seconds cache

  constructor(agentsDir: string = getAgentsDir()) {
    this.agentsDir = agentsDir;
    this.ensureAgentsDirectory();
  }

  /**
   * Ensure the agents directory exists and has example
   */
  private async ensureAgentsDirectoryAsync(): Promise<void> {
    try {
      await fsPromises.access(this.agentsDir);
    } catch {
      await fsPromises.mkdir(this.agentsDir, { recursive: true });

      // Create example agent file
      const examplePath = path.join(this.agentsDir, '_example.toml');
      await fsPromises.writeFile(examplePath, EXAMPLE_AGENT_TOML);
    }
  }

  /**
   * Ensure the agents directory exists and has example (sync for constructor)
   */
  private ensureAgentsDirectory(): void {
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });

      // Create example agent file
      const examplePath = path.join(this.agentsDir, '_example.toml');
      fs.writeFileSync(examplePath, EXAMPLE_AGENT_TOML);
    }
  }

  /**
   * Load all agents from the agents directory (async version)
   */
  async loadAgentsAsync(): Promise<CustomAgentFile[]> {
    const now = Date.now();

    // Use cache if recent
    if (now - this.lastScan < this.scanInterval && this.cache.size > 0) {
      return Array.from(this.cache.values());
    }

    this.resetCacheToBuiltIns();
    this.lastScan = now;

    try {
      await fsPromises.access(this.agentsDir);
    } catch {
      return Array.from(this.cache.values());
    }

    const files = await fsPromises.readdir(this.agentsDir);

    for (const file of files) {
      // Skip example files
      if (file.startsWith('_')) continue;

      const filePath = path.join(this.agentsDir, file);
      const stats = await fsPromises.stat(filePath);

      if (!stats.isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      let format: 'toml' | 'yaml' | 'json' | 'md' | null = null;

      if (ext === '.toml') format = 'toml';
      else if (ext === '.yaml' || ext === '.yml') format = 'yaml';
      else if (ext === '.json') format = 'json';
      else if (ext === '.md') format = 'md';
      else continue;

      try {
        const config = await this.parseAgentFileAsync(filePath, format);
        if (config) {
          const agentFile: CustomAgentFile = {
            path: filePath,
            format,
            config,
            modifiedAt: stats.mtime,
          };
          this.cache.set(config.id, agentFile);
        }
      } catch (error) {
        logger.error(`Failed to load agent from ${file}`, { error });
      }
    }

    return Array.from(this.cache.values());
  }

  /**
   * Load all agents from the agents directory (sync version for backwards compatibility)
   */
  loadAgents(): CustomAgentFile[] {
    const now = Date.now();

    // Use cache if recent
    if (now - this.lastScan < this.scanInterval && this.cache.size > 0) {
      return Array.from(this.cache.values());
    }

    this.resetCacheToBuiltIns();
    this.lastScan = now;

    if (!fs.existsSync(this.agentsDir)) {
      return Array.from(this.cache.values());
    }

    const files = fs.readdirSync(this.agentsDir);

    for (const file of files) {
      // Skip example files
      if (file.startsWith('_')) continue;

      const filePath = path.join(this.agentsDir, file);
      const stats = fs.statSync(filePath);

      if (!stats.isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      let format: 'toml' | 'yaml' | 'json' | 'md' | null = null;

      if (ext === '.toml') format = 'toml';
      else if (ext === '.yaml' || ext === '.yml') format = 'yaml';
      else if (ext === '.json') format = 'json';
      else if (ext === '.md') format = 'md';
      else continue;

      try {
        const config = this.parseAgentFile(filePath, format);
        if (config) {
          const agentFile: CustomAgentFile = {
            path: filePath,
            format,
            config,
            modifiedAt: stats.mtime,
          };
          this.cache.set(config.id, agentFile);
        }
      } catch (error) {
        logger.error(`Failed to load agent from ${file}`, { error });
      }
    }

    return Array.from(this.cache.values());
  }

  private resetCacheToBuiltIns(): void {
    this.cache.clear();
    for (const agent of BUILT_IN_AGENTS) {
      this.cache.set(agent.config.id, {
        ...agent,
        config: {
          ...agent.config,
          triggers: agent.config.triggers ? [...agent.config.triggers] : undefined,
          tags: agent.config.tags ? [...agent.config.tags] : undefined,
          tools: agent.config.tools ? [...agent.config.tools] : undefined,
          disabledTools: agent.config.disabledTools ? [...agent.config.disabledTools] : undefined,
          variables: agent.config.variables ? { ...agent.config.variables } : undefined,
        },
      });
    }
  }

  /**
   * Parse an agent configuration file (async version)
   */
  private async parseAgentFileAsync(filePath: string, format: 'toml' | 'yaml' | 'json' | 'md'): Promise<CustomAgentConfig | null> {
    const content = await fsPromises.readFile(filePath, 'utf-8');
    return this.parseAgentContent(content, filePath, format);
  }

  /**
   * Parse an agent configuration file (sync version)
   */
  private parseAgentFile(filePath: string, format: 'toml' | 'yaml' | 'json' | 'md'): CustomAgentConfig | null {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseAgentContent(content, filePath, format);
  }

  /**
   * Parse agent content (shared logic)
   */
  private parseAgentContent(content: string, filePath: string, format: 'toml' | 'yaml' | 'json' | 'md'): CustomAgentConfig | null {
    const fileName = path.basename(filePath, path.extname(filePath));

    let parsed: Record<string, unknown>;

    switch (format) {
      case 'md': {
        const definition = parseAgentMarkdown(content, filePath);
        parsed = { name: definition.name, description: definition.description,
          systemPrompt: definition.systemPrompt, tools: definition.tools,
          disabledTools: definition.disallowedTools };
        break;
      }
      case 'toml':
        parsed = TOML.parse(content) as Record<string, unknown>;
        break;
      case 'json':
        parsed = JSON.parse(content);
        break;
      case 'yaml':
        // Parse YAML strictly so unreadable tool policies cannot disappear.
        parsed = this.parseSimpleYaml(content);
        break;
      default:
        return null;
    }

    if (parsed.disabled === true) return null;

    // Validate required fields
    if (!parsed.name || !parsed.systemPrompt) {
      logger.error(`Agent ${fileName} missing required fields (name, systemPrompt)`);
      return null;
    }

    // Process system prompt with variables
    let systemPrompt = String(parsed.systemPrompt);
    const variables = (parsed.variables as Record<string, string>) || {};

    for (const [key, value] of Object.entries(variables)) {
      systemPrompt = systemPrompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return {
      id: fileName,
      name: String(parsed.name),
      description: String(parsed.description || ''),
      systemPrompt,
      model: parsed.model ? String(parsed.model) : undefined,
      tools: parseAgentTools(parsed.tools),
      disabledTools: parseAgentTools(parsed.disabledTools, 'deny'),
      fleetDispatchProfile: typeof parsed.fleetDispatchProfile === 'string'
        ? normalizeDispatchProfile(parsed.fleetDispatchProfile)
        : undefined,
      requireExplicitDispatchProfile:
        typeof parsed.requireExplicitDispatchProfile === 'boolean'
          ? parsed.requireExplicitDispatchProfile
          : undefined,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : undefined,
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
      streaming: typeof parsed.streaming === 'boolean' ? parsed.streaming : true,
      variables,
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : undefined,
      author: parsed.author ? String(parsed.author) : undefined,
      version: parsed.version ? String(parsed.version) : undefined,
    };
  }

  /**
   * Simple YAML parser for basic key-value pairs and multiline strings
   */
  private parseSimpleYaml(content: string): Record<string, unknown> {
    // Legacy descriptive scalars may contain an unquoted colon. Repair only
    // description, never an unreadable security policy.
    const compatible = content.replace(/^(description:\s+)([^'"|>\n][^\n]*: [^\n]*)$/gm,
      (_line, prefix: string, value: string) => prefix + JSON.stringify(value));
    const parsed: unknown = yaml.parse(compatible);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid agent YAML');
    return parsed as Record<string, unknown>;
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): CustomAgentConfig | null {
    // Refresh cache if needed
    this.loadAgents();
    return this.cache.get(id)?.config || null;
  }

  /**
   * Find agents by trigger word
   */
  findByTrigger(input: string): CustomAgentConfig[] {
    const agents = this.loadAgents();
    const lowerInput = input.toLowerCase();

    return agents
      .filter(agent => {
        if (!agent.config.triggers) return false;
        return agent.config.triggers.some(trigger =>
          lowerInput.includes(trigger.toLowerCase())
        );
      })
      .map(a => a.config);
  }

  /**
   * List all available agents
   */
  listAgents(): CustomAgentConfig[] {
    return this.loadAgents().map(a => a.config);
  }

  /**
   * Create a new agent from template
   */
  createAgent(name: string, description: string, systemPrompt: string): string {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filePath = path.join(this.agentsDir, `${id}.toml`);

    const config = `# Custom Agent: ${name}
name = "${name}"
description = "${description}"
version = "1.0.0"

# Optional settings
# model = "grok-4-latest"
# temperature = 0.7
# maxTokens = 4000

# triggers = ["keyword1", "keyword2"]
# tags = ["tag1", "tag2"]

systemPrompt = """
${systemPrompt}
"""
`;

    fs.writeFileSync(filePath, config);
    this.cache.clear(); // Clear cache to reload

    return filePath;
  }

  /**
   * Format agent list for display
   */
  formatAgentList(): string {
    const agents = this.listAgents();

    if (agents.length === 0) {
      return `No custom agents found.

Create agents in: ${this.agentsDir}
Example file: ${path.join(this.agentsDir, '_example.toml')}

Use /agent create <name> to create a new agent interactively.`;
    }

    const lines = ['Available Agents:', '─'.repeat(50)];

    for (const agent of agents) {
      const tags = agent.tags?.length ? ` [${agent.tags.join(', ')}]` : '';
      lines.push(`  ${agent.id}: ${agent.name}${tags}`);
      if (agent.description) {
        lines.push(`    ${agent.description}`);
      }
      if (agent.triggers?.length) {
        lines.push(`    Triggers: ${agent.triggers.join(', ')}`);
      }
    }

    lines.push('');
    lines.push('Use /agent <id> to activate an agent');
    lines.push(`Agents directory: ${this.agentsDir}`);

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let loaderInstance: CustomAgentLoader | null = null;

export function getCustomAgentLoader(): CustomAgentLoader {
  if (!loaderInstance) {
    loaderInstance = new CustomAgentLoader();
  }
  return loaderInstance;
}

export function resetCustomAgentLoader(): void {
  loaderInstance = null;
}
