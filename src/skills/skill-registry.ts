/**
 * Enhanced Skills Registry
 *
 * Manages bundled, managed, and workspace skills with frontmatter parsing,
 * install/uninstall, enable/disable, and env override support.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags: string[];
  source: 'bundled' | 'managed' | 'workspace';
  enabled: boolean;
  installedAt?: number;
  path: string;
}

export interface SkillFrontmatter {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  tags?: string[];
  env?: Record<string, string>;
}

export class SkillRegistry {
  private skills: Map<string, SkillMetadata> = new Map();
  private dirs: { bundled: string; managed: string; workspace: string };

  constructor(baseDir?: string) {
    const base = baseDir || process.cwd();
    this.dirs = {
      bundled: join(base, '.codebuddy', 'skills', 'bundled'),
      managed: join(base, '.codebuddy', 'skills', 'managed'),
      workspace: join(base, '.codebuddy', 'skills', 'workspace'),
    };
  }

  /**
   * Scan all skill directories and load metadata.
   */
  scan(): SkillMetadata[] {
    this.skills.clear();

    const sources: Array<{ dir: string; source: SkillMetadata['source'] }> = [
      { dir: this.dirs.bundled, source: 'bundled' },
      { dir: this.dirs.managed, source: 'managed' },
      { dir: this.dirs.workspace, source: 'workspace' },
    ];

    for (const { dir, source } of sources) {
      if (!existsSync(dir)) continue;

      // Check for SKILL.md directly in the dir
      const topLevel = join(dir, 'SKILL.md');
      if (existsSync(topLevel)) {
        this.loadSkillFile(topLevel, source);
      }

      // Check subdirectories for SKILL.md
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subFile = join(dir, entry.name, 'SKILL.md');
        if (existsSync(subFile)) {
          this.loadSkillFile(subFile, source);
        }
      }
    }

    return Array.from(this.skills.values());
  }

  /**
   * Load a single SKILL.md file into the registry.
   */
  private loadSkillFile(filePath: string, source: SkillMetadata['source']): void {
    const content = readFileSync(filePath, 'utf-8');
    const fm = SkillRegistry.parseFrontmatter(content);

    if (!fm.name) return;

    const meta: SkillMetadata = {
      name: fm.name,
      version: fm.version || '0.0.0',
      description: fm.description || '',
      author: fm.author,
      tags: fm.tags || [],
      source,
      enabled: true,
      path: filePath,
    };

    this.skills.set(fm.name, meta);
  }

  /**
   * Get a skill by name.
   */
  get(name: string): SkillMetadata | undefined {
    return this.skills.get(name);
  }

  /**
   * List all skills, optionally filtered by source.
   */
  list(source?: SkillMetadata['source']): SkillMetadata[] {
    const all = Array.from(this.skills.values());
    if (!source) return all;
    return all.filter(s => s.source === source);
  }

  /**
   * Install a skill from content string into the managed directory.
   */
  install(name: string, content: string): SkillMetadata {
    const dir = join(this.dirs.managed, name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const filePath = join(dir, 'SKILL.md');
    writeFileSync(filePath, content, 'utf-8');

    const fm = SkillRegistry.parseFrontmatter(content);

    const meta: SkillMetadata = {
      name: fm.name || name,
      version: fm.version || '0.0.0',
      description: fm.description || '',
      author: fm.author,
      tags: fm.tags || [],
      source: 'managed',
      enabled: true,
      installedAt: Date.now(),
      path: filePath,
    };

    this.skills.set(meta.name, meta);
    return meta;
  }

  /**
   * Remove a managed skill. Returns false if skill not found or not managed.
   */
  uninstall(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill || skill.source !== 'managed') return false;

    const dir = join(this.dirs.managed, name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }

    this.skills.delete(name);
    return true;
  }

  /**
   * Enable or disable a skill.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = enabled;
    return true;
  }

  /**
   * Get the full SKILL.md content for a skill.
   */
  getContent(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill || !existsSync(skill.path)) return null;
    return readFileSync(skill.path, 'utf-8');
  }

  /**
   * Parse YAML-like frontmatter from SKILL.md content.
   */
  static parseFrontmatter(content: string): SkillFrontmatter {
    const result: SkillFrontmatter = { name: '' };

    const trimmed = content.trimStart();
    if (!trimmed.startsWith('---')) return result;

    const endIdx = trimmed.indexOf('---', 3);
    if (endIdx === -1) return result;

    const block = trimmed.slice(3, endIdx).trim();
    const lines = block.split('\n');

    let inEnv = false;
    const env: Record<string, string> = {};

    for (const line of lines) {
      // Check if this is an indented env entry
      if (inEnv && /^\s+\S/.test(line)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim();
          const val = line.slice(colonIdx + 1).trim();
          env[key] = val;
        }
        continue;
      }

      inEnv = false;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();

      switch (key) {
        case 'name':
          result.name = val;
          break;
        case 'version':
          result.version = val;
          break;
        case 'description':
          result.description = val;
          break;
        case 'author':
          result.author = val;
          break;
        case 'tags':
          result.tags = val.split(',').map(t => t.trim()).filter(Boolean);
          break;
        case 'env':
          inEnv = true;
          break;
      }
    }

    if (Object.keys(env).length > 0) {
      result.env = env;
    }

    return result;
  }

  /**
   * Get env overrides for a skill.
   */
  getEnvOverrides(name: string): Record<string, string> {
    const content = this.getContent(name);
    if (!content) return {};
    const fm = SkillRegistry.parseFrontmatter(content);
    return fm.env || {};
  }

  /**
   * Re-scan all directories.
   */
  refresh(): SkillMetadata[] {
    return this.scan();
  }
}
