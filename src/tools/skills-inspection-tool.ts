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

/**
 * Names to try, in order. Imported skills are installed as `imported-<name>`
 * (provenance namespace, see skill-importer) while their SKILL.md, the user
 * and the model keep calling them `<name>`. Measured by Grok Bot (03/10):
 * `skill_view security-review` → "skill not found" although
 * `imported-security-review` was installed. The exact name always wins, so a
 * native skill is never shadowed by an imported one.
 */
const IMPORTED_SKILL_PREFIX = 'imported-';
function skillNameCandidates(name: string): string[] {
  return name.startsWith(IMPORTED_SKILL_PREFIX) ? [name] : [name, `${IMPORTED_SKILL_PREFIX}${name}`];
}

export async function executeSkillViewTool(input: SkillViewToolInput): Promise<ToolResult> {
  const requested = typeof input.name === 'string' ? input.name.trim() : '';
  if (!requested) {
    return { success: false, error: 'skill_view: name is required' };
  }

  try {
    const { getSkillsHub } = await import('../skills/hub.js');
    const hub = getSkillsHub();
    const candidates = skillNameCandidates(requested);
    let name = requested;
    let result = hub.info(requested);
    if (!result) {
      const { readLocalSkillInventory, readLocalSkillContent } = await import('../skills/local-inventory.js');
      const installed = hub.listWithIntegrity();
      const inventory = await readLocalSkillInventory(installed);
      let skill: (typeof inventory.entries)[number] | undefined;
      for (const candidate of candidates) {
        result = hub.info(candidate);
        if (result) { name = candidate; break; }
        skill = inventory.entries.find((entry) => entry.name === candidate);
        // An imported SKILL.md can declare the bare name. Keep its hub
        // identity/integrity evidence rather than treating the same file as
        // an independent exact-name skill. A distinct workspace skill wins.
        if (skill && !installed.some((entry) => entry.name !== candidate && entry.path === skill?.path)) {
          name = candidate;
          break;
        }
        skill = undefined;
      }
      if (skill) {
        await recordView(name);
        return serializePayload({
          action: 'skill_view',
          ...(name !== requested ? { requestedName: requested, resolvedName: name } : {}),
          skill,
          ...(input.include_content !== false ? { content: await readLocalSkillContent(skill) } : {}),
        });
      }
      if (!result) return { success: false, error: `skill_view: skill not found: ${requested}` };
    }

    const includeContent = input.include_content !== false;
    await recordView(name);
    return serializePayload({
      action: 'skill_view',
      ...(name !== requested ? { requestedName: requested, resolvedName: name } : {}),
      installed: result.installed,
      integrityOk: result.integrityOk,
      ...(includeContent ? { content: result.content ?? '' } : {}),
    });
  } catch (error) {
    return { success: false, error: `skill_view: ${getErrorMessage(error)}` };
  }
}
