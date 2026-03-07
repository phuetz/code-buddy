/**
 * Skill Discovery Tool
 *
 * Enables the agent to auto-discover and install skills from the Skills Hub
 * during reasoning. When tool confidence is low, the agent can search for
 * relevant skills that provide the needed capability.
 *
 * OpenClaw-inspired "self-improving" capability — the agent expands its
 * own toolset at runtime by finding and installing community skills.
 */

import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SkillDiscoveryInput {
  /** Search query to find relevant skills */
  query: string;
  /** Tags to filter by */
  tags?: string[];
  /** Automatically install the top matching skill */
  auto_install?: boolean;
  /** Maximum number of results to return */
  limit?: number;
}

export interface DiscoveredSkill {
  name: string;
  version: string;
  description: string;
  tags: string[];
  downloads: number;
  stars: number;
}

// ============================================================================
// Skill Discovery Tool
// ============================================================================

export class SkillDiscoveryTool {
  /**
   * Search the Skills Hub for relevant skills, optionally auto-installing
   * the top result.
   */
  async execute(input: SkillDiscoveryInput): Promise<ToolResult> {
    const { query, tags, auto_install = false, limit = 5 } = input;

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'query is required' };
    }

    try {
      // Lazy-load hub to avoid circular dependencies
      const { getSkillsHub } = await import('../skills/hub.js');
      const hub = getSkillsHub();

      // Search for matching skills
      const result = await hub.search(query, {
        tags,
        pageSize: limit,
      });

      if (result.skills.length === 0) {
        return {
          success: true,
          output: `No skills found matching "${query}".`,
        };
      }

      const discovered: DiscoveredSkill[] = result.skills.map(s => ({
        name: s.name,
        version: s.version,
        description: s.description,
        tags: s.tags,
        downloads: s.downloads,
        stars: s.stars,
      }));

      let output = `Found ${result.total} skill(s) matching "${query}":\n\n`;
      for (const skill of discovered) {
        output += `  - ${skill.name} v${skill.version}: ${skill.description}`;
        if (skill.tags.length > 0) {
          output += ` [${skill.tags.join(', ')}]`;
        }
        output += `\n`;
      }

      // Auto-install top result if requested
      if (auto_install && discovered.length > 0) {
        const topSkill = discovered[0];
        try {
          const installed = await hub.install(topSkill.name, topSkill.version);
          output += `\nAuto-installed: ${installed.name} v${installed.version}`;

          // Refresh tools from skills
          await this.refreshToolsFromSkills();
          output += '\nTool registry refreshed with new skill capabilities.';

          logger.info('Skill auto-installed via discovery', {
            name: installed.name,
            version: installed.version,
          });
        } catch (installErr) {
          output += `\nFailed to auto-install ${topSkill.name}: ${installErr instanceof Error ? installErr.message : String(installErr)}`;
        }
      }

      return {
        success: true,
        output,
      };
    } catch (error) {
      return {
        success: false,
        error: `Skill discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Refresh the tool registry to pick up newly installed skills.
   * Delegates to the unified SKILL.md registry so new managed skills become
   * searchable without restarting the process.
   */
  private async refreshToolsFromSkills(): Promise<void> {
    try {
      const { getSkillRegistry } = await import('../skills/registry.js');
      const registry = getSkillRegistry();

      if (typeof registry.reloadAll === 'function') {
        await registry.reloadAll();
      } else if (typeof registry.load === 'function') {
        await registry.load();
      }

      logger.debug('Skills refreshed after discovery install');
    } catch (err) {
      logger.warn('Failed to refresh skills after install', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
