/**
 * Subagent Persistent Memory
 *
 * Scoped memory system for subagents with user/project/local scopes,
 * topic files, and context injection support.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export type MemoryScope = 'user' | 'project' | 'local';

export interface SubagentMemoryConfig {
  agentName: string;
  scope: MemoryScope;
  maxLines: number;
  memoryDir?: string;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_MAX_LINES = 200;

// ============================================================================
// Subagent Memory
// ============================================================================

export class SubagentMemory {
  private config: SubagentMemoryConfig;
  private memoryPath: string;

  constructor(config: SubagentMemoryConfig) {
    this.config = {
      ...config,
      maxLines: config.maxLines || DEFAULT_MAX_LINES,
    };

    if (config.memoryDir) {
      this.memoryPath = config.memoryDir;
    } else {
      this.memoryPath = SubagentMemory.getMemoryDir(config.agentName, config.scope);
    }
  }

  /**
   * Get memory directory path based on scope
   */
  static getMemoryDir(agentName: string, scope: MemoryScope): string {
    const safeName = agentName.replace(/[^a-zA-Z0-9_-]/g, '_');

    switch (scope) {
      case 'user':
        return path.join(os.homedir(), '.codebuddy', 'agents', safeName, 'memory');
      case 'project':
        return path.join(process.cwd(), '.codebuddy', 'agents', safeName, 'memory');
      case 'local':
        return path.join(os.tmpdir(), 'codebuddy-agents', safeName, 'memory');
    }
  }

  /**
   * Ensure the memory directory exists
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.memoryPath)) {
      fs.mkdirSync(this.memoryPath, { recursive: true });
    }
  }

  /**
   * Get the MEMORY.md file path
   */
  private getMemoryFilePath(): string {
    return path.join(this.memoryPath, 'MEMORY.md');
  }

  /**
   * Read MEMORY.md (first maxLines lines)
   */
  readMemory(): string {
    const filePath = this.getMemoryFilePath();
    const content = readTextAtomicSync(filePath, '');
    if (!content) return '';
    const lines = content.split('\n');
    const limited = lines.slice(0, this.config.maxLines);
    return limited.join('\n');
  }

  /**
   * Write to MEMORY.md (replace all content)
   */
  writeMemory(content: string): void {
    this.ensureDir();
    const filePath = this.getMemoryFilePath();
    writeFileAtomicSync(filePath, content, { mode: 0o600 });
    logger.debug(`Memory written for agent: ${this.config.agentName}`);
  }

  /**
   * Append to MEMORY.md
   */
  appendMemory(entry: string): void {
    this.ensureDir();
    const filePath = this.getMemoryFilePath();
    const existing = readTextAtomicSync(filePath, '');
    const separator = existing.endsWith('\n') || existing === '' ? '' : '\n';
    writeFileAtomicSync(filePath, existing + separator + entry + '\n', { mode: 0o600 });
    logger.debug(`Memory appended for agent: ${this.config.agentName}`);
  }

  /**
   * Read a specific topic file
   */
  readTopic(topicName: string): string | null {
    const safeTopic = topicName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.memoryPath, `${safeTopic}.md`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return readTextAtomicSync(filePath, '');
  }

  /**
   * Write a topic file
   */
  writeTopic(topicName: string, content: string): void {
    this.ensureDir();
    const safeTopic = topicName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.memoryPath, `${safeTopic}.md`);
    writeFileAtomicSync(filePath, content, { mode: 0o600 });
    logger.debug(`Topic written: ${topicName} for agent: ${this.config.agentName}`);
  }

  /**
   * List all memory files
   */
  listMemoryFiles(): string[] {
    if (!fs.existsSync(this.memoryPath)) {
      return [];
    }

    return fs.readdirSync(this.memoryPath).filter(f => f.endsWith('.md'));
  }

  /**
   * Check if memory exists (MEMORY.md file)
   */
  hasMemory(): boolean {
    return fs.existsSync(this.getMemoryFilePath());
  }

  /**
   * Get memory size in bytes
   */
  getMemorySize(): number {
    const filePath = this.getMemoryFilePath();
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    return fs.statSync(filePath).size;
  }

  /**
   * Clear all memory
   */
  clearMemory(): void {
    if (!fs.existsSync(this.memoryPath)) return;

    const files = fs.readdirSync(this.memoryPath);
    for (const file of files) {
      fs.unlinkSync(path.join(this.memoryPath, file));
    }
    logger.info(`Memory cleared for agent: ${this.config.agentName}`);
  }

  /**
   * Generate context injection (first maxLines lines of MEMORY.md)
   */
  getContextInjection(): string {
    const content = this.readMemory();
    if (!content) {
      return '';
    }
    return `\n--- SUBAGENT MEMORY (${this.config.agentName}) ---\n${content}\n--- END SUBAGENT MEMORY ---\n`;
  }

  getAgentName(): string {
    return this.config.agentName;
  }

  getScope(): MemoryScope {
    return this.config.scope;
  }

  getMemoryPath(): string {
    return this.memoryPath;
  }
}
