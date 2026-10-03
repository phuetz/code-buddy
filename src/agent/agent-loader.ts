/**
 * Agent Loader — Markdown-defined custom agents
 *
 * Loads agent definitions from .codebuddy/agents/ and ~/.codebuddy/agents/
 * Markdown files with YAML frontmatter define agent configuration:
 *
 *   ---
 *   name: reviewer
 *   description: Code review agent
 *   model: grok-3
 *   tools: ["read_file", "grep", "glob", "plan"]
 *   disallowedTools: ["bash", "write"]
 *   maxTurns: 20
 *   permissionMode: auto-edit
 *   ---
 *   You are a code reviewer. Focus on...
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import * as yaml from 'yaml';
import { parseAgentTools, resolveAgentTool } from './agent-tools.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface MarkdownAgentDefinition {
  /** Agent name (used as ID) */
  name: string;
  /** Human-readable description */
  description: string;
  /** LLM model to use (optional, uses default if omitted) */
  model?: string;
  /** Allowed tool names */
  tools?: string[];
  /** Disallowed tool names */
  disallowedTools?: string[];
  /** Maximum conversation turns */
  maxTurns?: number;
  /** Permission mode: suggest | auto-edit | full-auto */
  permissionMode?: 'suggest' | 'auto-edit' | 'full-auto';
  /** System prompt (markdown body) */
  systemPrompt: string;
  /** Source file path */
  source: string;
  /** Whether this is a user-defined (not built-in) agent */
  isCustom: true;
}

// ============================================================================
// Frontmatter Parser (same as rules-loader)
// ============================================================================

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    if (raw.trimStart().startsWith('---') && /^\s*(?:tools|disallowedTools):/m.test(raw)) throw new Error('Malformed agent tool allowlist');
    return { meta: {}, body: raw };
  }
  const meta: unknown = yaml.parse(match[1]!);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid agent frontmatter');
  return { meta: meta as Record<string, unknown>, body: match[2]! };
}

// ============================================================================
// Loader
// ============================================================================

/**
 * Load agent definitions from a directory.
 */
function loadAgentsFromDir(dir: string): MarkdownAgentDefinition[] {
  if (!fs.existsSync(dir)) return [];

  const agents: MarkdownAgentDefinition[] = [];

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);

        if (meta.disabled === true) continue;

        if (!body.trim()) {
          logger.debug(`Agent file ${file} has no body, skipping`);
          continue;
        }

        const name = (typeof meta.name === 'string' ? meta.name : path.basename(file, '.md')).toLowerCase();

        agents.push({
          name,
          description: typeof meta.description === 'string' ? meta.description : `Custom agent: ${name}`,
          model: typeof meta.model === 'string' ? meta.model : undefined,
          tools: parseAgentTools(meta.tools),
          disallowedTools: parseAgentTools(meta.disallowedTools),
          maxTurns: typeof meta.maxTurns === 'number' ? meta.maxTurns : undefined,
          permissionMode: ['suggest', 'auto-edit', 'full-auto'].includes(meta.permissionMode as string)
            ? meta.permissionMode as 'suggest' | 'auto-edit' | 'full-auto'
            : undefined,
          systemPrompt: body.trim(),
          source: filePath,
          isCustom: true,
        });

        logger.debug(`Loaded custom agent: ${name} from ${filePath}`);
      } catch (err) {
        logger.debug(`Failed to load agent file ${file}: ${err}`);
      }
    }
  } catch (err) {
    logger.debug(`Failed to read agents directory ${dir}: ${err}`);
  }

  return agents;
}

/** Cache */
let _agentsCache: MarkdownAgentDefinition[] | null = null;

/**
 * Clear the agents cache (for testing).
 */
export function clearAgentLoaderCache(): void {
  _agentsCache = null;
}

/**
 * Load all custom agent definitions from project and user directories.
 * Project agents override user agents with the same name.
 */
export function loadCustomAgents(projectRoot: string = process.cwd()): MarkdownAgentDefinition[] {
  if (_agentsCache) return _agentsCache;

  const userDir = path.join(homedir(), '.codebuddy', 'agents');
  const projectDir = path.join(projectRoot, '.codebuddy', 'agents');

  const userAgents = loadAgentsFromDir(userDir);
  const projectAgents = loadAgentsFromDir(projectDir);

  // Project agents override user agents with the same name
  const agentMap = new Map<string, MarkdownAgentDefinition>();
  for (const agent of userAgents) {
    agentMap.set(agent.name, agent);
  }
  for (const agent of projectAgents) {
    agentMap.set(agent.name, agent);
  }

  _agentsCache = Array.from(agentMap.values());
  return _agentsCache;
}

/**
 * Get a custom agent by name.
 */
export function getCustomAgent(name: string, projectRoot?: string): MarkdownAgentDefinition | null {
  const agents = loadCustomAgents(projectRoot);
  return agents.find(a => a.name === name.toLowerCase()) || null;
}

/**
 * List all custom agent names and descriptions.
 */
export function listCustomAgents(projectRoot?: string): Array<{ name: string; description: string; source: string }> {
  return loadCustomAgents(projectRoot).map(a => ({
    name: a.name,
    description: a.description,
    source: a.source,
  }));
}

/**
 * Check if a tool is allowed for a custom agent.
 */
export function isToolAllowedForAgent(agent: MarkdownAgentDefinition, toolName: string): boolean {
  const normalized = resolveAgentTool(toolName).toLowerCase();

  // If disallowedTools is set, check it first
  if (agent.disallowedTools?.some(t => resolveAgentTool(t).toLowerCase() === normalized)) {
    return false;
  }

  // If tools is set, only those tools are allowed
  if (agent.tools) {
    return agent.tools.some(t => resolveAgentTool(t).toLowerCase() === normalized);
  }

  // No restrictions
  return true;
}
