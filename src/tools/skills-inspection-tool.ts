import { getErrorMessage, type ToolResult } from '../types/index.js';
import type { InstalledSkill, InstalledSkillStatus } from '../skills/hub.js';

export interface SkillsListToolInput extends Record<string, unknown> {
  include_disabled?: unknown;
  include_usage?: unknown;
}

export interface SkillViewToolInput extends Record<string, unknown> {
  name?: unknown;
  include_content?: unknown;
}

function serializePayload(payload: Record<string, unknown>): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
    data: payload,
  };
}

/** Activity telemetry is best-effort: a failure never changes the tool result. */
async function recordView(name: string): Promise<void> {
  try {
    const { recordSkillActivity } = await import('../skills/skill-usage-store.js');
    recordSkillActivity(name, 'view', { source: 'skill_view' });
  } catch {
    // Telemetry must never make skill inspection fail.
  }
}

function stripUsage<T extends InstalledSkill>(skill: T): Omit<T, 'usage'> {
  const { usage: _usage, ...rest } = skill;
  return rest;
}

export async function executeSkillsListTool(input: SkillsListToolInput): Promise<ToolResult> {
  try {
    const { getSkillsHub } = await import('../skills/hub.js');
    const hub = getSkillsHub();
    const all: InstalledSkillStatus[] = hub.listWithIntegrity();
    const includeDisabled = input.include_disabled === true;
    const includeUsage = input.include_usage !== false;
    const shown = includeDisabled ? all : all.filter((skill) => skill.enabled !== false);
    const skills = includeUsage ? shown : shown.map(stripUsage);

    const { readLocalSkillInventory } = await import('../skills/local-inventory.js');
    const inventory = await readLocalSkillInventory(all);
    const availableSkills = inventory.entries.filter((skill) => skill.available);
    return serializePayload({
      action: 'skills_list',
      availableSkills,
      availableCount: availableSkills.length,
      unavailableSkills: inventory.entries.filter((skill) => !skill.available),
      discoveryErrors: inventory.errors,
      guidance: 'Use availableSkills to answer which skills can be used. Requirements may need tools or external configuration. The skills/count/total fields below describe only hub records, not the complete local catalogue. Missing files are not configuration errors.',
      count: skills.length,
      total: all.length,
      includeDisabled,
      skills,
    });
  } catch (error) {
    return { success: false, error: `skills_list: ${getErrorMessage(error)}` };
  }
}

export async function executeSkillViewTool(input: SkillViewToolInput): Promise<ToolResult> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { success: false, error: 'skill_view: name is required' };
  }

  try {
    const { getSkillsHub } = await import('../skills/hub.js');
    const result = getSkillsHub().info(name);
    if (!result) {
      const { readLocalSkillInventory, readLocalSkillContent } = await import('../skills/local-inventory.js');
      const inventory = await readLocalSkillInventory(getSkillsHub().listWithIntegrity());
      const skill = inventory.entries.find((entry) => entry.name === name);
      if (!skill) return { success: false, error: `skill_view: skill not found: ${name}` };
      await recordView(name);
      return serializePayload({
        action: 'skill_view',
        skill,
        ...(input.include_content !== false ? { content: await readLocalSkillContent(skill) } : {}),
      });
    }

    const includeContent = input.include_content !== false;
    await recordView(name);
    return serializePayload({
      action: 'skill_view',
      installed: result.installed,
      integrityOk: result.integrityOk,
      ...(includeContent ? { content: result.content ?? '' } : {}),
    });
  } catch (error) {
    return { success: false, error: `skill_view: ${getErrorMessage(error)}` };
  }
}
