import { readFile } from 'fs/promises';
import { getBundledSkillsPath } from './index.js';
import { SkillRegistry } from './registry.js';
import { SkillManager } from './skill-manager.js';
import type { InstalledSkillStatus } from './hub.js';
import type { SkillRequirements } from './types.js';

export interface LocalSkillEntry {
  name: string;
  description: string;
  source: string;
  path?: string;
  version?: string;
  requires?: SkillRequirements;
  available: boolean;
  reason?: 'disabled' | 'missing-file' | 'integrity-mismatch' | 'invalid-skill';
}

/** Read the same local skill tiers without activating skills or starting watchers. */
export async function readLocalSkillInventory(installed: InstalledSkillStatus[]): Promise<{
  entries: LocalSkillEntry[];
  errors: Array<{ path: string; message: string }>;
}> {
  const registry = new SkillRegistry({ bundledPath: getBundledSkillsPath(), watchEnabled: false });
  const errors: Array<{ path: string; message: string }> = [];
  registry.on('skill:error', (path: string, error: Error) => errors.push({ path, message: error.message }));
  await registry.load();
  const entries = new Map<string, LocalSkillEntry>();
  // Built-in legacy specializations still exposed by /skill. Do not load custom
  // files through the legacy parser: SKILL.md files must pass registry validation.
  const manager = new SkillManager();
  for (const name of manager.getAvailableSkills()) {
    const skill = manager.getSkill(name)!;
    entries.set(name, { name, description: skill.description, source: 'builtin', available: true });
  }
  for (const skill of registry.list()) {
    entries.set(skill.metadata.name, {
      name: skill.metadata.name,
      description: skill.metadata.description,
      source: skill.tier,
      path: skill.sourcePath,
      version: skill.metadata.version,
      requires: skill.metadata.requires,
      available: skill.enabled !== false,
      ...(skill.enabled === false ? { reason: 'disabled' as const } : {}),
    });
  }
  for (const skill of installed) {
    let previous = entries.get(skill.name);
    let reason: LocalSkillEntry['reason'] = skill.enabled === false ? 'disabled'
      : !skill.exists ? 'missing-file'
      : !skill.integrityOk ? 'integrity-mismatch' : undefined;
    if (!reason) {
      try {
        const parsed = await registry.registerSkillFile(skill.path, 'managed');
        if (registry.get(parsed.metadata.name)?.sourcePath !== skill.path) {
          reason = 'invalid-skill';
        } else {
          previous = { name: skill.name, description: parsed.metadata.description,
            source: 'hub', available: true, requires: parsed.metadata.requires };
        }
      } catch (error) {
        reason = 'invalid-skill';
        errors.push({ path: skill.path, message: error instanceof Error ? error.message : String(error) });
      }
    }
    // Hub lifecycle state takes precedence; never present a disabled or altered
    // installed skill as usable via a same-name bundled fallback.
    entries.set(skill.name, {
      name: skill.name,
      description: previous?.description ?? '',
      requires: previous?.requires,
      source: 'hub',
      path: skill.path,
      version: skill.version,
      available: !reason,
      ...(reason ? { reason } : {}),
    });
  }
  return { entries: [...entries.values()], errors };
}

export async function readLocalSkillContent(skill: LocalSkillEntry): Promise<string> {
  if (skill.path) return readFile(skill.path, 'utf-8');
  return new SkillManager().getSkill(skill.name)?.systemPrompt ?? '';
}
