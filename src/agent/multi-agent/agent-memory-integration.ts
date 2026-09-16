/**
 * Subagent Persistent Memory Integration (CC14)
 *
 * Provides filesystem-based persistent memory for sub-agents.
 * Memory persists across sessions in ~/.codebuddy/agent-memory/<name>/
 * or .codebuddy/agent-memory/<name>/ (project-local).
 *
 * Advanced enterprise architecture for agent memory: user|project|local scopes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

/** Memory scope determines storage location */
export type AgentMemoryScope = 'user' | 'project' | 'local';

export interface AgentMemoryOptions {
  /** Agent name/nickname */
  agentName: string;
  /** Memory scope */
  scope: AgentMemoryScope;
  /** Project root (for 'project' and 'local' scopes) */
  projectRoot?: string;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the memory directory for a given agent and scope.
 */
function getMemoryDir(options: AgentMemoryOptions): string {
  const safeName = options.agentName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

  switch (options.scope) {
    case 'user': {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, '.codebuddy', 'agent-memory', safeName);
    }
    case 'project': {
      const root = options.projectRoot || process.cwd();
      return path.join(root, '.codebuddy', 'agent-memory', safeName);
    }
    case 'local': {
      // Local scope: project-scoped but in a temp-like location
      const root = options.projectRoot || process.cwd();
      return path.join(root, '.codebuddy', 'agent-memory', safeName);
    }
    default:
      return path.join(process.cwd(), '.codebuddy', 'agent-memory', safeName);
  }
}

/**
 * Ensure the memory directory exists.
 */
function ensureMemoryDir(memDir: string): void {
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
}

// ============================================================================
// Read / Write
// ============================================================================

/**
 * Read the agent's persistent MEMORY.md file.
 * Returns empty string if no memory exists yet.
 */
export function readAgentMemory(options: AgentMemoryOptions): string {
  const memDir = getMemoryDir(options);
  const memFile = path.join(memDir, 'MEMORY.md');

  if (!fs.existsSync(memFile)) {
    return '';
  }

  try {
    return readTextAtomicSync(memFile, '');
  } catch (err) {
    logger.debug(`Failed to read agent memory for ${options.agentName}: ${err}`);
    return '';
  }
}

/**
 * Write content to the agent's persistent MEMORY.md file.
 * Creates the directory if it doesn't exist.
 */
export function writeAgentMemory(options: AgentMemoryOptions, content: string): void {
  const memDir = getMemoryDir(options);
  const memFile = path.join(memDir, 'MEMORY.md');

  try {
    ensureMemoryDir(memDir);
    writeFileAtomicSync(memFile, content, { mode: 0o600 });
    logger.debug(`Agent memory written for ${options.agentName} (${content.length} chars)`);
  } catch (err) {
    logger.debug(`Failed to write agent memory for ${options.agentName}: ${err}`);
  }
}

/**
 * Append a summary to the agent's memory file.
 * Used at the end of a sub-agent's execution to persist learnings.
 */
export function appendAgentMemory(options: AgentMemoryOptions, summary: string): void {
  const existing = readAgentMemory(options);
  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `\n## ${timestamp}\n\n${summary}\n`;
  writeAgentMemory(options, existing + entry);
}

/**
 * Build a context injection string from an agent's persistent memory.
 * Returns empty string if no memory exists.
 */
export function buildAgentMemoryContext(options: AgentMemoryOptions): string {
  const memory = readAgentMemory(options);
  if (!memory.trim()) return '';

  return `<agent_memory scope="${options.scope}" agent="${options.agentName}">\n${memory.trim()}\n</agent_memory>`;
}

/**
 * List all agents that have persistent memory in a given scope.
 */
export function listAgentMemories(
  scope: AgentMemoryScope,
  projectRoot?: string,
): string[] {
  // Use a placeholder agent name and go up one directory to get the base
  const opts: AgentMemoryOptions = { agentName: '_placeholder_', scope, projectRoot };
  const baseDir = path.dirname(getMemoryDir(opts));

  if (!fs.existsSync(baseDir)) return [];

  try {
    return fs.readdirSync(baseDir).filter(name => {
      const memFile = path.join(baseDir, name, 'MEMORY.md');
      return fs.existsSync(memFile);
    });
  } catch {
    return [];
  }
}
