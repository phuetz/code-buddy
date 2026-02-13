/**
 * Skill Loader
 *
 * Enhanced skill loading from multiple directories with
 * support for global, project, and agent-specific skills.
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import type { Skill } from './skill-manager.js';
import { logger } from '../utils/logger.js';
import {
  type SkillRequirements,
  type EligibilityResult,
  checkEligibility,
  parseRequirements,
  logEligibilityResult,
} from './eligibility.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill source type
 */
export type SkillSource = 'builtin' | 'global' | 'project' | 'agent';

/**
 * Loaded skill with metadata
 */
export interface LoadedSkill extends Skill {
  /** Source of the skill */
  source: SkillSource;
  /** Path to skill directory (if loaded from file) */
  path?: string;
  /** Agent ID (for agent-specific skills) */
  agentId?: string;
  /** Load timestamp */
  loadedAt: number;
  /** Skill requirements */
  requires?: SkillRequirements;
  /** Whether skill is eligible to run */
  eligible: boolean;
  /** Eligibility check result */
  eligibilityResult?: EligibilityResult;
}

/**
 * Skill loader configuration
 */
export interface SkillLoaderConfig {
  /** Global skills directory */
  globalDir: string;
  /** Project skills directory */
  projectDir: string;
  /** Whether to load global skills */
  loadGlobal: boolean;
  /** Whether to load project skills */
  loadProject: boolean;
  /** Whether to merge duplicates (project overrides global) */
  mergeDuplicates: boolean;
  /** Whether to check eligibility when loading */
  checkEligibility: boolean;
  /** Whether to skip ineligible skills */
  skipIneligible: boolean;
}

/**
 * Default skill loader configuration
 */
export const DEFAULT_SKILL_LOADER_CONFIG: SkillLoaderConfig = {
  globalDir: path.join(os.homedir(), '.codebuddy', 'skills'),
  projectDir: path.join(process.cwd(), '.codebuddy', 'skills'),
  loadGlobal: true,
  loadProject: true,
  mergeDuplicates: true,
  checkEligibility: true,
  skipIneligible: false,
};

// ============================================================================
// Skill Loader
// ============================================================================

let _skillLoaderDeprecationWarned = false;

/**
 * Loads skills from multiple directories
 *
 * @deprecated Use the SKILL.md system instead (SkillRegistry from './registry.js').
 * See src/skills/MIGRATION.md for migration guide.
 */
export class SkillLoader {
  private config: SkillLoaderConfig;
  private skills: Map<string, LoadedSkill> = new Map();
  private agentSkillsDir: Map<string, string> = new Map();

  constructor(config: Partial<SkillLoaderConfig> = {}) {
    if (!_skillLoaderDeprecationWarned) {
      _skillLoaderDeprecationWarned = true;
      logger.warn('[DEPRECATED] SkillLoader is deprecated. Use SKILL.md system (SkillRegistry) instead. See src/skills/MIGRATION.md');
    }
    this.config = { ...DEFAULT_SKILL_LOADER_CONFIG, ...config };
  }

  /**
   * Load skills from all configured directories
   */
  async loadAll(): Promise<LoadedSkill[]> {
    this.skills.clear();

    // Load global skills first
    if (this.config.loadGlobal) {
      await this.loadFromDirectory(this.config.globalDir, 'global');
    }

    // Load project skills (can override global)
    if (this.config.loadProject) {
      await this.loadFromDirectory(this.config.projectDir, 'project');
    }

    // Load agent-specific skills
    for (const [agentId, dir] of this.agentSkillsDir) {
      await this.loadFromDirectory(dir, 'agent', agentId);
    }

    return Array.from(this.skills.values());
  }

  /**
   * Load skills from a directory
   */
  async loadFromDirectory(
    dir: string,
    source: SkillSource,
    agentId?: string
  ): Promise<LoadedSkill[]> {
    const loaded: LoadedSkill[] = [];

    if (!await fs.pathExists(dir)) {
      return loaded;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(dir, entry.name, 'SKILL.md');
          if (await fs.pathExists(skillPath)) {
            const skill = await this.parseSkillFile(skillPath, entry.name, source, agentId);
            if (skill) {
              loaded.push(skill);

              // Handle duplicates based on config
              const existing = this.skills.get(skill.name);
              if (existing && !this.config.mergeDuplicates) {
                continue;
              }

              // Project overrides global, agent overrides both
              if (!existing ||
                  source === 'agent' ||
                  (source === 'project' && existing.source === 'global')) {
                this.skills.set(skill.name, skill);
              }
            }
          }
        }
      }

      logger.debug('Loaded skills from directory', {
        dir,
        source,
        count: loaded.length,
      });
    } catch (error) {
      logger.warn('Failed to load skills from directory', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return loaded;
  }

  /**
   * Parse a SKILL.md file
   */
  private async parseSkillFile(
    filePath: string,
    dirName: string,
    source: SkillSource,
    agentId?: string
  ): Promise<LoadedSkill | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return null;
      }

      const frontmatter = frontmatterMatch[1];
      const body = content.slice(frontmatterMatch[0].length).trim();

      const skill: Partial<LoadedSkill> = {
        name: dirName,
        systemPrompt: body,
        source,
        path: path.dirname(filePath),
        agentId,
        loadedAt: Date.now(),
        eligible: true,
      };

      for (const line of frontmatter.split('\n')) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();

        switch (key) {
          case 'name':
            skill.name = value;
            break;
          case 'description':
            skill.description = value;
            break;
          case 'triggers':
            skill.triggers = this.parseYamlArray(value);
            break;
          case 'tools':
            skill.tools = this.parseYamlArray(value);
            break;
          case 'model':
            skill.model = value;
            break;
          case 'priority':
            skill.priority = parseInt(value);
            break;
          case 'autoActivate':
            skill.autoActivate = value === 'true';
            break;
          case 'agents':
            // Filter skills by agent
            const allowedAgents = this.parseYamlArray(value);
            if (agentId && !allowedAgents.includes(agentId)) {
              return null;
            }
            break;
          case 'requires':
            skill.requires = parseRequirements(value) ?? undefined;
            break;
        }
      }

      if (!skill.name || !skill.triggers || !skill.systemPrompt) {
        return null;
      }

      // Check eligibility if configured and requirements are present
      if (this.config.checkEligibility && skill.requires) {
        const eligibilityResult = checkEligibility(skill.requires);
        skill.eligible = eligibilityResult.eligible;
        skill.eligibilityResult = eligibilityResult;

        logEligibilityResult(skill.name, eligibilityResult);

        // Skip ineligible skills if configured
        if (!eligibilityResult.eligible && this.config.skipIneligible) {
          return null;
        }
      }

      return skill as LoadedSkill;
    } catch (error) {
      logger.warn('Failed to parse skill file', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Parse YAML array from string
   */
  private parseYamlArray(value: string): string[] {
    // Handle both [item1, item2] and item1, item2 formats
    return value
      .replace(/[[\]"']/g, '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  /**
   * Register agent-specific skills directory
   */
  registerAgentSkillsDir(agentId: string, dir: string): void {
    this.agentSkillsDir.set(agentId, dir);
  }

  /**
   * Unregister agent-specific skills directory
   */
  unregisterAgentSkillsDir(agentId: string): void {
    this.agentSkillsDir.delete(agentId);

    // Remove agent-specific skills
    for (const [name, skill] of this.skills) {
      if (skill.agentId === agentId) {
        this.skills.delete(name);
      }
    }
  }

  /**
   * Get all loaded skills
   */
  getSkills(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill by name
   */
  getSkill(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get skills for an agent (includes global, project, and agent-specific)
   */
  getSkillsForAgent(agentId: string): LoadedSkill[] {
    return Array.from(this.skills.values()).filter(skill =>
      skill.source !== 'agent' || skill.agentId === agentId
    );
  }

  /**
   * Get skills by source
   */
  getSkillsBySource(source: SkillSource): LoadedSkill[] {
    return Array.from(this.skills.values()).filter(skill => skill.source === source);
  }

  /**
   * Filter skills by agent type capabilities
   */
  filterSkillsByCapabilities(
    skills: LoadedSkill[],
    allowedTools: string[]
  ): LoadedSkill[] {
    if (allowedTools.length === 0) {
      return skills;
    }

    return skills.filter(skill => {
      if (!skill.tools || skill.tools.length === 0) {
        return true; // No tool restrictions
      }

      // Check if all skill tools are in allowed list
      return skill.tools.every(tool => allowedTools.includes(tool));
    });
  }

  /**
   * Create skill directory structure
   */
  async ensureSkillDirs(): Promise<void> {
    await fs.ensureDir(this.config.globalDir);
    await fs.ensureDir(this.config.projectDir);

    for (const dir of this.agentSkillsDir.values()) {
      await fs.ensureDir(dir);
    }
  }

  /**
   * Get only eligible skills
   */
  getEligibleSkills(): LoadedSkill[] {
    return Array.from(this.skills.values()).filter(skill => skill.eligible);
  }

  /**
   * Get ineligible skills with their reasons
   */
  getIneligibleSkills(): Array<{ skill: LoadedSkill; reasons: string[] }> {
    return Array.from(this.skills.values())
      .filter(skill => !skill.eligible)
      .map(skill => ({
        skill,
        reasons: skill.eligibilityResult?.reasons || ['Unknown'],
      }));
  }

  /**
   * Re-check eligibility for all loaded skills
   */
  recheckEligibility(): void {
    for (const skill of this.skills.values()) {
      if (skill.requires) {
        const result = checkEligibility(skill.requires);
        skill.eligible = result.eligible;
        skill.eligibilityResult = result;
        logEligibilityResult(skill.name, result);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    eligible: number;
    ineligible: number;
    bySource: Record<SkillSource, number>;
    byAgent: Record<string, number>;
  } {
    const bySource: Record<SkillSource, number> = {
      builtin: 0,
      global: 0,
      project: 0,
      agent: 0,
    };
    const byAgent: Record<string, number> = {};
    let eligible = 0;
    let ineligible = 0;

    for (const skill of this.skills.values()) {
      bySource[skill.source]++;
      if (skill.agentId) {
        byAgent[skill.agentId] = (byAgent[skill.agentId] || 0) + 1;
      }
      if (skill.eligible) {
        eligible++;
      } else {
        ineligible++;
      }
    }

    return {
      total: this.skills.size,
      eligible,
      ineligible,
      bySource,
      byAgent,
    };
  }

  /**
   * Clear all loaded skills
   */
  clear(): void {
    this.skills.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let skillLoaderInstance: SkillLoader | null = null;

/**
 * Get or create SkillLoader singleton
 */
export function getSkillLoader(config?: Partial<SkillLoaderConfig>): SkillLoader {
  if (!skillLoaderInstance) {
    skillLoaderInstance = new SkillLoader(config);
  }
  return skillLoaderInstance;
}

/**
 * Reset SkillLoader singleton
 */
export function resetSkillLoader(): void {
  if (skillLoaderInstance) {
    skillLoaderInstance.clear();
  }
  skillLoaderInstance = null;
}
