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
import path from 'path';
import TOML from '@iarna/toml';
import { getAgentsDir } from '../utils/codebuddy-home.js';
import { logger } from '../utils/logger.js';

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
  /** Tools this agent can use (empty = all tools) */
  tools?: string[];
  /** Tools this agent cannot use */
  disabledTools?: string[];
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
  format: 'toml' | 'yaml' | 'json';
  /** Parsed configuration */
  config: CustomAgentConfig;
  /** Last modified time */
  modifiedAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

// Use GROK_HOME/agents/ directory (supports GROK_HOME env var)
const AGENTS_DIR = getAgentsDir();

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

// ============================================================================
// Agent Loader
// ============================================================================

export class CustomAgentLoader {
  private agentsDir: string;
  private cache: Map<string, CustomAgentFile> = new Map();
  private lastScan: number = 0;
  private scanInterval: number = 5000; // 5 seconds cache

  constructor(agentsDir: string = AGENTS_DIR) {
    this.agentsDir = agentsDir;
    this.ensureAgentsDirectory();
  }

  /**
   * Ensure the agents directory exists and has example
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
   * Load all agents from the agents directory
   */
  loadAgents(): CustomAgentFile[] {
    const now = Date.now();

    // Use cache if recent
    if (now - this.lastScan < this.scanInterval && this.cache.size > 0) {
      return Array.from(this.cache.values());
    }

    this.cache.clear();
    this.lastScan = now;

    if (!fs.existsSync(this.agentsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.agentsDir);
    const agents: CustomAgentFile[] = [];

    for (const file of files) {
      // Skip example files
      if (file.startsWith('_')) continue;

      const filePath = path.join(this.agentsDir, file);
      const stats = fs.statSync(filePath);

      if (!stats.isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      let format: 'toml' | 'yaml' | 'json' | null = null;

      if (ext === '.toml') format = 'toml';
      else if (ext === '.yaml' || ext === '.yml') format = 'yaml';
      else if (ext === '.json') format = 'json';
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
          agents.push(agentFile);
          this.cache.set(config.id, agentFile);
        }
      } catch (error) {
        logger.error(`Failed to load agent from ${file}`, { error });
      }
    }

    return agents;
  }

  /**
   * Parse an agent configuration file
   */
  private parseAgentFile(filePath: string, format: 'toml' | 'yaml' | 'json'): CustomAgentConfig | null {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, path.extname(filePath));

    let parsed: Record<string, unknown>;

    switch (format) {
      case 'toml':
        parsed = TOML.parse(content) as Record<string, unknown>;
        break;
      case 'json':
        parsed = JSON.parse(content);
        break;
      case 'yaml':
        // Simple YAML parsing for basic cases
        parsed = this.parseSimpleYaml(content);
        break;
      default:
        return null;
    }

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
      tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : undefined,
      disabledTools: Array.isArray(parsed.disabledTools) ? parsed.disabledTools.map(String) : undefined,
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
    const result: Record<string, unknown> = {};
    const lines = content.split('\n');
    let currentKey: string | null = null;
    let multilineValue: string[] = [];
    let inMultiline = false;

    for (const line of lines) {
      // Skip comments and empty lines (unless in multiline)
      if (!inMultiline && (line.trim().startsWith('#') || line.trim() === '')) {
        continue;
      }

      // Check for multiline end
      if (inMultiline) {
        if (line.match(/^[a-zA-Z_]/)) {
          // New key, end multiline
          if (currentKey) {
            result[currentKey] = multilineValue.join('\n').trim();
          }
          inMultiline = false;
          multilineValue = [];
          currentKey = null;
        } else {
          multilineValue.push(line);
          continue;
        }
      }

      // Parse key: value
      const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;

        if (value === '|' || value === '>') {
          // Start multiline
          currentKey = key;
          inMultiline = true;
          multilineValue = [];
        } else if (value.startsWith('[') && value.endsWith(']')) {
          // Array
          result[key] = value
            .slice(1, -1)
            .split(',')
            .map(s => s.trim().replace(/^["']|["']$/g, ''));
        } else if (value === 'true' || value === 'false') {
          result[key] = value === 'true';
        } else if (!isNaN(Number(value))) {
          result[key] = Number(value);
        } else {
          result[key] = value.replace(/^["']|["']$/g, '');
        }
      }
    }

    // Handle trailing multiline
    if (inMultiline && currentKey) {
      result[currentKey] = multilineValue.join('\n').trim();
    }

    return result;
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

    const lines = ['Custom Agents:', '─'.repeat(50)];

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
