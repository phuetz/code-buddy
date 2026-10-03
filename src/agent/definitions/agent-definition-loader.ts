/**
 * Agent Definition Loader
 *
 * Loads custom agent definitions from `.codebuddy/agents/*.md` (project)
 * and `~/.codebuddy/agents/*.md` (user) directories.
 * Uses YAML frontmatter for configuration and markdown body for system prompt.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { parseAgentTools } from '../agent-tools.js';
import { logger } from '../../utils/logger.js';

export interface AgentDefinition {
  name: string;
  description: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  tools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  preloadedSkills?: string[];
  systemPrompt?: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Reuses the same pattern as SkillRegistry.parseFrontmatter.
 */
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    if (raw.trimStart().startsWith('---') && /^\s*(?:tools|disallowedTools):/m.test(raw)) throw new Error('Malformed agent tool allowlist');
    return { meta: {}, body: raw };
  }
  const meta: unknown = yaml.parse(match[1]!);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid agent frontmatter');
  return { meta: meta as Record<string, unknown>, body: match[2]!.trim() };
}

export function parseAgentFile(filePath: string): AgentDefinition {
  return parseAgentMarkdown(fs.readFileSync(filePath, 'utf-8'), filePath);
}

export function parseAgentMarkdown(content: string, filePath: string): AgentDefinition {
  const { meta, body } = parseFrontmatter(content);

  if (meta.disabled === true) throw new Error('Agent disabled pending review');

  const name = (meta.name as string) || path.basename(filePath, '.md');
  const description = (meta.description as string) || '';

  const definition: AgentDefinition = {
    name,
    description,
  };

  if (meta.model && typeof meta.model === 'string') {
    const validModels = ['sonnet', 'opus', 'haiku', 'inherit'];
    if (validModels.includes(meta.model)) {
      definition.model = meta.model as AgentDefinition['model'];
    }
  }

  definition.tools = parseAgentTools(meta.tools);

  definition.disallowedTools = parseAgentTools(meta.disallowedTools);

  if (typeof meta.maxTurns === 'number') {
    definition.maxTurns = meta.maxTurns;
  }

  if (Array.isArray(meta.preloadedSkills)) {
    definition.preloadedSkills = meta.preloadedSkills as string[];
  }

  if (body) {
    definition.systemPrompt = body;
  }

  return definition;
}

function scanDirectory(dirPath: string): AgentDefinition[] {
  const definitions: AgentDefinition[] = [];

  if (!fs.existsSync(dirPath)) {
    return definitions;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    logger.warn(`Failed to read agent definitions directory: ${dirPath}`);
    return definitions;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const filePath = path.join(dirPath, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const def = parseAgentFile(filePath);
      definitions.push(def);
    } catch (err) {
      logger.warn(`Failed to parse agent definition: ${filePath}: ${err}`);
    }
  }

  return definitions;
}

let cachedDefinitions: AgentDefinition[] | null = null;

export async function loadAgentDefinitions(baseDir?: string): Promise<AgentDefinition[]> {
  const projectDir = path.join(baseDir || process.cwd(), '.codebuddy', 'agents');
  const userDir = path.join(os.homedir(), '.codebuddy', 'agents');

  const userDefs = scanDirectory(userDir);
  const projectDefs = scanDirectory(projectDir);

  // Project definitions override user definitions with the same name
  const byName = new Map<string, AgentDefinition>();
  for (const def of userDefs) {
    byName.set(def.name, def);
  }
  for (const def of projectDefs) {
    byName.set(def.name, def);
  }

  cachedDefinitions = Array.from(byName.values());
  logger.info(`Loaded ${cachedDefinitions.length} agent definitions`);
  return cachedDefinitions;
}

export function getAgentDefinition(name: string): AgentDefinition | undefined {
  if (!cachedDefinitions) return undefined;
  return cachedDefinitions.find((d) => d.name === name);
}

export function resetDefinitionCache(): void {
  cachedDefinitions = null;
}
