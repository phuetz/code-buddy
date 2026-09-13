import { logger } from '../utils/logger.js';
import { TOOL_METADATA } from './metadata.js';
import { TOOL_EFFECT_CLASSES, type ToolEffectClass, type ToolMetadata } from './types.js';

// Runtime warnings live here so the tool catalog can also serve browser previews.
const missingEffectWarned = new Set<string>();

function isToolEffectClass(value: unknown): value is ToolEffectClass {
  return (TOOL_EFFECT_CLASSES as readonly string[]).includes(value as string);
}

/** Resolve a tool's declared effect class. Missing catalog/MCP entries warn once and return `unknown`. */
export function resolveToolEffect(
  name: string,
  metadata?: Pick<ToolMetadata, 'effect'> | null,
): ToolEffectClass | 'unknown' {
  if (isToolEffectClass(metadata?.effect)) return metadata.effect;
  const catalog = TOOL_METADATA.find((entry) => entry.name === name)?.effect;
  if (isToolEffectClass(catalog)) return catalog;
  if (!missingEffectWarned.has(name)) {
    missingEffectWarned.add(name);
    logger.warn('tool metadata missing effect class; treating as unknown', { tool: name });
  }
  return 'unknown';
}

/** Test hook: unique-warning latch. */
export function resetToolEffectWarningLatch(): void {
  missingEffectWarned.clear();
}
