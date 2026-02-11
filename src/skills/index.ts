/**
 * Skills Module
 *
 * Unified skill system that bridges two underlying implementations:
 * 1. Legacy JSON-based skills (skill-manager, skill-loader)
 * 2. OpenClaw-inspired SKILL.md natural language skills (registry, executor)
 *
 * The UnifiedSkill type and adapters provide a single interface over both.
 * The SKILL.md system uses YAML frontmatter + Markdown for natural language
 * skill definitions with three-tier loading (workspace > managed > bundled).
 */

// Legacy skill system (deprecated - use SKILL.md system instead)
/** @deprecated Use SKILL.md system (SkillRegistry) instead */
export * from "./skill-manager.js";
/** @deprecated Use SKILL.md system (SkillRegistry) instead */
export * from "./skill-loader.js";
export * from "./eligibility.js";

// SKILL.md natural language system (OpenClaw-inspired)
// Re-export with "Md" suffix to avoid conflicts with legacy types
export type {
  SkillMetadata as SkillMdMetadata,
  SkillContent as SkillMdContent,
  Skill as SkillMd,
  SkillTier as SkillMdTier,
  SkillMatch as SkillMdMatch,
  SkillSearchOptions as SkillMdSearchOptions,
  SkillExecutionContext as SkillMdExecutionContext,
  SkillExecutionResult as SkillMdExecutionResult,
  SkillRequirements as SkillMdRequirements,
} from './types.js';
export { parseSkillFile, validateSkill, serializeSkill } from './parser.js';
export { SkillRegistry, getSkillRegistry, resetSkillRegistry } from './registry.js';
export { SkillExecutor, getSkillExecutor, resetSkillExecutor } from './executor.js';
export type { SkillExecutorConfig, ToolExecutorFn, CodeExecutorFn } from './executor.js';

// Unified skill types and adapters
export type {
  UnifiedSkill,
  UnifiedSkillSource,
  LegacySkillRef,
} from './types.js';
export {
  legacyToUnified,
  legacyLoadedToUnified,
  unifiedToLegacy,
  skillMdToUnified,
  unifiedToSkillMd,
} from './adapters/index.js';
export type {
  LegacySkill as LegacySkillShape,
  LegacySkillScript as LegacySkillScriptShape,
  LegacyLoadedSkill as LegacyLoadedSkillShape,
} from './adapters/index.js';

// ============================================================================
// Bundled Skills Path
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';

/**
 * Get the path to bundled SKILL.md skills.
 *
 * Strategy: walk up from the entry script (process.argv[1]) or cwd
 * to find .codebuddy/skills/bundled. This avoids __dirname (unavailable
 * in ESM) and import.meta.url (breaks ts-jest).
 */
export function getBundledSkillsPath(): string {
  const startDir = process.argv[1]
    ? path.dirname(path.resolve(process.argv[1]))
    : process.cwd();

  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.codebuddy', 'skills', 'bundled');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback to cwd
  return path.join(process.cwd(), '.codebuddy', 'skills', 'bundled');
}

// ============================================================================
// Convenience Functions for SKILL.md System
// ============================================================================

import { getSkillRegistry } from './registry.js';
import { getSkillExecutor } from './executor.js';
import { getSkillManager } from './skill-manager.js';
import type {
  Skill as SkillMdType,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillMatch as SkillMdMatchType,
  UnifiedSkill,
} from './types.js';

/**
 * Initialize both skill systems (legacy and SKILL.md) and unify them.
 *
 * This loads the SKILL.md registry from bundled/workspace/managed paths,
 * initializes the legacy SkillManager, and registers legacy skills into
 * the SKILL.md registry so they can be queried through a single interface.
 *
 * @param projectRoot - The project root for the legacy SkillManager (defaults to cwd)
 */
export async function initializeAllSkills(projectRoot?: string): Promise<{
  registry: import('./registry.js').SkillRegistry;
  manager: import('./skill-manager.js').SkillManager;
  unified: UnifiedSkill[];
}> {
  // Initialize the SKILL.md registry
  const registry = getSkillRegistry({
    bundledPath: getBundledSkillsPath(),
  });
  await registry.load();

  // Initialize the legacy skill manager
  const manager = getSkillManager(projectRoot);
  await manager.initialize();

  // Register legacy skills into the SKILL.md registry so they are searchable
  // via the unified interface. Only register those not already present.
  for (const skillName of manager.getAvailableSkills()) {
    if (!registry.get(skillName)) {
      const legacySkill = manager.getSkill(skillName);
      if (legacySkill) {
        registry.registerLegacySkill(legacySkill, 'workspace');
      }
    }
  }

  // Return unified view
  const unified = registry.getAllUnified();

  return { registry, manager, unified };
}

/**
 * Initialize the SKILL.md skills system only (backward-compatible).
 */
export async function initializeSkills(): Promise<void> {
  const registry = getSkillRegistry({
    bundledPath: getBundledSkillsPath(),
  });
  await registry.load();
}

/**
 * Find the best SKILL.md skill for a request
 */
export function findSkill(request: string): SkillMdMatchType | null {
  const registry = getSkillRegistry();
  return registry.findBestMatch(request);
}

/**
 * Execute a SKILL.md skill by name
 */
export async function executeSkill(
  skillName: string,
  context: SkillExecutionContext
): Promise<SkillExecutionResult> {
  const registry = getSkillRegistry();
  const skill = registry.get(skillName);

  if (!skill) {
    return {
      success: false,
      error: `Skill not found: ${skillName}`,
      duration: 0,
    };
  }

  const executor = getSkillExecutor();
  return executor.execute(skill, context);
}

/**
 * List all available SKILL.md skills
 */
export function listSkillMdSkills(): SkillMdType[] {
  const registry = getSkillRegistry();
  return registry.list();
}

/**
 * Search for SKILL.md skills
 */
export function searchSkillMd(query: string, limit?: number): SkillMdMatchType[] {
  const registry = getSkillRegistry();
  return registry.search({ query, limit });
}

/**
 * Get all skills from both systems as UnifiedSkill objects.
 * This is a convenience function that combines skills from
 * both the SKILL.md registry and the legacy SkillManager.
 *
 * @returns An array of UnifiedSkill objects
 */
export function getAllUnifiedSkills(): UnifiedSkill[] {
  const registry = getSkillRegistry();
  return registry.getAllUnified();
}
