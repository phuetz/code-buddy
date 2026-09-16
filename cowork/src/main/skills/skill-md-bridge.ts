/**
 * SkillMdBridge — Claude Cowork parity Phase 2
 *
 * Wraps Code Buddy's SKILL.md skill registry (`src/skills/`) so the Cowork
 * renderer can browse, search, match, and execute natural-language skills.
 *
 * This is complementary to the existing `SkillsManager` which handles
 * installed Electron-native plugins. The SKILL.md registry covers the
 * bundled/managed/workspace three-tier SKILL.md system used by the CLI.
 *
 * @module main/skills/skill-md-bridge
 */

import { log, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { SkillExecutionContext } from '../../../../src/skills/types';

export interface SkillMdSummary {
  name: string;
  description: string;
  tier: string;
  filePath?: string;
  tags?: string[];
  requires?: string[];
}

export interface SkillMdMatch {
  skill: SkillMdSummary;
  confidence: number;
  matchedTriggers?: string[];
}

export interface SkillMdSearchResult {
  skill: SkillMdSummary;
  score: number;
}

export interface SkillMdExecuteResult {
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
}

type CoreSkillMdModule = {
  initializeAllSkills: (projectRoot?: string) => Promise<{
    registry: unknown;
    unified: unknown[];
  }>;
  initializeSkills: () => Promise<void>;
  listSkillMdSkills: () => Array<{
    metadata: { name: string; description: string; tags?: string[]; requires?: string[] };
    tier: string;
    filePath?: string;
  }>;
  searchSkillMd: (
    query: string,
    limit?: number
  ) => Array<{
    skill: {
      metadata: { name: string; description: string; tags?: string[] };
      tier: string;
      filePath?: string;
    };
    score: number;
  }>;
  findSkill: (request: string) => {
    skill: {
      metadata: { name: string; description: string; tags?: string[] };
      tier: string;
      filePath?: string;
    };
    confidence: number;
    matchedTriggers?: string[];
  } | null;
  executeSkill: (
    skillName: string,
    context: SkillExecutionContext
  ) => Promise<{
    success: boolean;
    output?: string;
    error?: string;
    duration: number;
  }>;
};

let cachedModule: CoreSkillMdModule | null = null;
let initialized = false;

async function loadModule(): Promise<CoreSkillMdModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<CoreSkillMdModule>('skills/index.js');
  if (mod) {
    cachedModule = mod;
    log('[SkillMdBridge] Core skills module loaded');
  } else {
    logWarn('[SkillMdBridge] Core skills module unavailable');
  }
  return mod;
}

function toSummary(skill: {
  metadata: { name: string; description: string; tags?: string[]; requires?: string[] };
  tier: string;
  filePath?: string;
}): SkillMdSummary {
  return {
    name: skill.metadata.name,
    description: skill.metadata.description,
    tier: skill.tier,
    filePath: skill.filePath,
    tags: skill.metadata.tags,
    requires: skill.metadata.requires,
  };
}

export class SkillMdBridge {
  /** Ensure the registry has been initialized exactly once. */
  private async ensureInitialized(): Promise<CoreSkillMdModule | null> {
    const mod = await loadModule();
    if (!mod) return null;
    if (!initialized) {
      try {
        await mod.initializeSkills();
        initialized = true;
        log('[SkillMdBridge] SKILL.md registry initialized');
      } catch (err) {
        logWarn('[SkillMdBridge] initializeSkills failed:', err);
      }
    }
    return mod;
  }

  async list(): Promise<SkillMdSummary[]> {
    const mod = await this.ensureInitialized();
    if (!mod) return [];
    try {
      return mod.listSkillMdSkills().map(toSummary);
    } catch (err) {
      logWarn('[SkillMdBridge] list failed:', err);
      return [];
    }
  }

  async search(query: string, limit = 20): Promise<SkillMdSearchResult[]> {
    const mod = await this.ensureInitialized();
    if (!mod) return [];
    try {
      return mod.searchSkillMd(query, limit).map((m) => ({
        skill: toSummary(m.skill),
        score: m.score,
      }));
    } catch (err) {
      logWarn('[SkillMdBridge] search failed:', err);
      return [];
    }
  }

  async findBest(request: string): Promise<SkillMdMatch | null> {
    const mod = await this.ensureInitialized();
    if (!mod) return null;
    try {
      const match = mod.findSkill(request);
      if (!match) return null;
      return {
        skill: toSummary(match.skill),
        confidence: match.confidence,
        matchedTriggers: match.matchedTriggers,
      };
    } catch (err) {
      logWarn('[SkillMdBridge] findBest failed:', err);
      return null;
    }
  }

  async execute(
    skillName: string,
    context: {
      userInput?: string;
      workspaceRoot?: string;
      sessionId?: string;
    }
  ): Promise<SkillMdExecuteResult> {
    const mod = await this.ensureInitialized();
    if (!mod) {
      return { success: false, error: 'Skill registry unavailable' };
    }
    try {
      const result = await mod.executeSkill(skillName, {
        request: context?.userInput?.trim() || `Use the ${skillName} skill to guide work in the current project.`,
        cwd: context?.workspaceRoot,
      });
      return {
        success: result.success,
        output: result.output,
        error: result.error,
        duration: result.duration,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
