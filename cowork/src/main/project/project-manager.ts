/**
 * ProjectManager — Claude Cowork parity
 *
 * Manages projects: persistent workspaces with scoped memory, description,
 * and configuration. Each project owns a `.codebuddy/memory/` folder in its
 * workspace path for cross-session memory consolidation.
 *
 * @module main/project/project-manager
 */

import { v4 as uuidv4 } from 'uuid';
import { existsSync, writeFileSync } from 'fs';
import { isAbsolute, normalize } from 'path';
import { log, logError, logWarn } from '../utils/logger';
import type { DatabaseInstance, ProjectRow } from '../db/database';
import {
  ensureProjectMemoryDirectory,
  resolveProjectMemoryDirectory,
  resolveProjectMemoryFile,
} from './project-paths';

export interface Project {
  id: string;
  name: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
  contextConfig?: ProjectContextConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemoryConfig {
  autoConsolidate?: boolean;
  maxMemoryEntries?: number;
  includeICM?: boolean;
  memoryStrategy?: 'auto' | 'manual' | 'rolling';
}

export interface ProjectContextConfig {
  masterInstruction?: string;
  knowledgeFiles?: string[];
  maxKnowledgeChars?: number;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
  contextConfig?: ProjectContextConfig;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
  contextConfig?: ProjectContextConfig;
}

const DEFAULT_MEMORY_CONFIG: ProjectMemoryConfig = {
  autoConsolidate: true,
  maxMemoryEntries: 100,
  includeICM: false,
  memoryStrategy: 'auto',
};

const DEFAULT_CONTEXT_CONFIG: ProjectContextConfig = {
  knowledgeFiles: [],
  maxKnowledgeChars: 16_000,
};

const MEMORY_STRATEGIES = new Set<ProjectMemoryConfig['memoryStrategy']>([
  'auto', 'manual', 'rolling',
]);

function normalizeRequiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`${field} must not be empty`);
  return normalized.slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeWorkspacePath(value: unknown): string | undefined {
  const workspacePath = normalizeOptionalText(value, 'workspacePath', 4_096);
  if (!workspacePath) return undefined;
  if (workspacePath.includes('\0') || !isAbsolute(workspacePath)) {
    throw new RangeError('workspacePath must be an absolute path without null bytes');
  }
  return normalize(workspacePath);
}

function normalizeMemoryConfig(input?: ProjectMemoryConfig): ProjectMemoryConfig {
  const requestedEntries = Number(input?.maxMemoryEntries ?? DEFAULT_MEMORY_CONFIG.maxMemoryEntries);
  const strategy = input?.memoryStrategy;
  return {
    autoConsolidate: typeof input?.autoConsolidate === 'boolean'
      ? input.autoConsolidate
      : DEFAULT_MEMORY_CONFIG.autoConsolidate,
    maxMemoryEntries: Number.isFinite(requestedEntries)
      ? Math.max(1, Math.min(10_000, Math.trunc(requestedEntries)))
      : DEFAULT_MEMORY_CONFIG.maxMemoryEntries,
    includeICM: typeof input?.includeICM === 'boolean'
      ? input.includeICM
      : DEFAULT_MEMORY_CONFIG.includeICM,
    memoryStrategy: strategy && MEMORY_STRATEGIES.has(strategy)
      ? strategy
      : DEFAULT_MEMORY_CONFIG.memoryStrategy,
  };
}

function normalizeContextConfig(input?: ProjectContextConfig): ProjectContextConfig {
  const masterInstruction = normalizeOptionalText(
    input?.masterInstruction,
    'masterInstruction',
    12_000
  );
  const knowledgeFiles = Array.from(
    new Set(
      (input?.knowledgeFiles ?? [])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.slice(0, 4_096).trim())
        .filter(Boolean)
        .slice(0, 32)
    )
  );
  const requestedBudget = Number(input?.maxKnowledgeChars ?? DEFAULT_CONTEXT_CONFIG.maxKnowledgeChars);
  const maxKnowledgeChars = Number.isFinite(requestedBudget)
    ? Math.max(4_000, Math.min(64_000, Math.trunc(requestedBudget)))
    : DEFAULT_CONTEXT_CONFIG.maxKnowledgeChars;
  return {
    ...(masterInstruction ? { masterInstruction } : {}),
    knowledgeFiles,
    maxKnowledgeChars,
  };
}

export class ProjectManager {
  private db: DatabaseInstance;
  private activeProjectId: string | null = null;
  private onProjectChange?: (project: Project | null) => void;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /** Subscribe to active project changes */
  setProjectChangeListener(listener: (project: Project | null) => void): void {
    this.onProjectChange = listener;
  }

  /** Create a new project */
  create(input: ProjectCreateInput): Project {
    if (!input || typeof input !== 'object') throw new TypeError('Project input is required');
    const now = Date.now();
    const id = uuidv4();
    const memoryConfig = normalizeMemoryConfig(input.memoryConfig);
    const contextConfig = normalizeContextConfig(input.contextConfig);
    const name = normalizeRequiredText(input.name, 'name', 200);
    const description = normalizeOptionalText(input.description, 'description', 4_000);
    const workspacePath = normalizeWorkspacePath(input.workspacePath);

    const project: Project = {
      id,
      name,
      ...(description ? { description } : {}),
      ...(workspacePath ? { workspacePath } : {}),
      memoryConfig,
      contextConfig,
      createdAt: now,
      updatedAt: now,
    };

    this.db.projects.create({
      id,
      name: project.name,
      description: project.description ?? null,
      workspace_path: project.workspacePath ?? null,
      memory_config: JSON.stringify(memoryConfig),
      context_config: JSON.stringify(contextConfig),
      created_at: now,
      updated_at: now,
    });

    // Initialize memory folder in workspace
    if (project.workspacePath) {
      this.initMemoryFolder(project.workspacePath);
    }

    log('[ProjectManager] Created project:', project.name, id);
    return project;
  }

  /** Update an existing project */
  update(id: string, updates: ProjectUpdateInput): Project | null {
    if (!updates || typeof updates !== 'object') throw new TypeError('Project updates are required');
    const existing = this.get(id);
    if (!existing) {
      logWarn('[ProjectManager] Cannot update unknown project:', id);
      return null;
    }

    const dbUpdates: Partial<ProjectRow> = {};
    if (updates.name !== undefined) dbUpdates.name = normalizeRequiredText(updates.name, 'name', 200);
    if (updates.description !== undefined) {
      dbUpdates.description = normalizeOptionalText(updates.description, 'description', 4_000) ?? null;
    }
    if (updates.workspacePath !== undefined) {
      dbUpdates.workspace_path = normalizeWorkspacePath(updates.workspacePath) ?? null;
    }
    if (updates.memoryConfig !== undefined) {
      dbUpdates.memory_config = JSON.stringify(normalizeMemoryConfig({
        ...existing.memoryConfig,
        ...updates.memoryConfig,
      }));
    }
    if (updates.contextConfig !== undefined) {
      dbUpdates.context_config = JSON.stringify(
        normalizeContextConfig({ ...existing.contextConfig, ...updates.contextConfig })
      );
    }

    this.db.projects.update(id, dbUpdates);

    // Re-initialize memory folder if workspace path changed
    const nextWorkspacePath = dbUpdates.workspace_path;
    if (typeof nextWorkspacePath === 'string' && nextWorkspacePath !== existing.workspacePath) {
      this.initMemoryFolder(nextWorkspacePath);
    }

    const updated = this.get(id)!;

    if (this.activeProjectId === id) {
      this.onProjectChange?.(updated);
    }

    return updated;
  }

  /** Get a project by id */
  get(id: string): Project | null {
    const row = this.db.projects.get(id);
    if (!row) return null;
    return this.rowToProject(row);
  }

  /** List all projects ordered by updated_at desc */
  list(): Project[] {
    return this.db.projects.getAll().map((row) => this.rowToProject(row));
  }

  /** Delete a project (sessions remain but lose their project link) */
  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    this.db.projects.delete(id);

    // Detach any sessions pointing to this project
    try {
      this.db.raw.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
    } catch (err) {
      logError('[ProjectManager] Failed to detach sessions from project:', err);
    }

    if (this.activeProjectId === id) {
      this.setActive(null);
    }

    log('[ProjectManager] Deleted project:', id);
    return true;
  }

  /** Set the active project */
  setActive(id: string | null): Project | null {
    if (id === null) {
      this.activeProjectId = null;
      this.onProjectChange?.(null);
      return null;
    }

    const project = this.get(id);
    if (!project) {
      logWarn('[ProjectManager] Cannot set active unknown project:', id);
      return null;
    }

    this.activeProjectId = id;
    this.onProjectChange?.(project);
    return project;
  }

  /** Get the active project */
  getActive(): Project | null {
    if (!this.activeProjectId) return null;
    return this.get(this.activeProjectId);
  }

  /** Get the active project id (without a DB round-trip) */
  getActiveId(): string | null {
    return this.activeProjectId;
  }

  /** Initialize .codebuddy/memory/ folder in the workspace */
  private initMemoryFolder(workspacePath: string): void {
    try {
      if (!existsSync(workspacePath)) {
        logWarn('[ProjectManager] Workspace path does not exist:', workspacePath);
        return;
      }

      const memoryDir = ensureProjectMemoryDirectory(workspacePath);
      if (!memoryDir) {
        logWarn('[ProjectManager] Refusing unsafe project memory path:', workspacePath);
        return;
      }

      // Seed an empty MEMORY.md if missing
      const memoryFile = resolveProjectMemoryFile(workspacePath, 'MEMORY.md');
      if (!memoryFile) {
        logWarn('[ProjectManager] Refusing unsafe project memory file:', workspacePath);
        return;
      }
      if (!existsSync(memoryFile)) {
        writeFileSync(
          memoryFile,
          '# Project Memory\n\n' +
            '<!-- This file is managed by Code Buddy Cowork. ' +
            'Entries are consolidated across sessions. -->\n\n',
          { encoding: 'utf-8', flag: 'wx', mode: 0o600 }
        );
      }

      log('[ProjectManager] Initialized memory folder:', memoryDir);
    } catch (err) {
      logError('[ProjectManager] Failed to initialize memory folder:', err);
    }
  }

  /** Get the memory folder path for a project */
  getMemoryPath(projectId: string): string | null {
    const project = this.get(projectId);
    if (!project?.workspacePath) return null;
    return resolveProjectMemoryDirectory(project.workspacePath);
  }

  private rowToProject(row: ProjectRow): Project {
    let memoryConfig: ProjectMemoryConfig = { ...DEFAULT_MEMORY_CONFIG };
    if (row.memory_config) {
      try {
        memoryConfig = normalizeMemoryConfig(JSON.parse(row.memory_config) as ProjectMemoryConfig);
      } catch (err) {
        logWarn('[ProjectManager] Failed to parse memory_config for', row.id, err);
      }
    }

    let contextConfig: ProjectContextConfig = { ...DEFAULT_CONTEXT_CONFIG };
    if (row.context_config) {
      try {
        contextConfig = normalizeContextConfig(JSON.parse(row.context_config) as ProjectContextConfig);
      } catch (err) {
        logWarn('[ProjectManager] Failed to parse context_config for', row.id, err);
      }
    }

    let workspacePath: string | undefined;
    if (row.workspace_path) {
      try {
        workspacePath = normalizeWorkspacePath(row.workspace_path);
      } catch (err) {
        // Legacy databases and imported bundles predate strict IPC validation.
        // Never resolve a relative stored path against Electron's process cwd.
        logWarn('[ProjectManager] Ignoring unsafe workspace_path for', row.id, err);
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      workspacePath,
      memoryConfig,
      contextConfig,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
