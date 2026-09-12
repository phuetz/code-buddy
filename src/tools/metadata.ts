import { type ToolMetadata, type ToolEffectClass, TOOL_EFFECT_CLASSES } from './types.js';
import { logger } from '../utils/logger.js';
import { TOOL_METADATA } from './metadata-catalog.js';

// Preserve the CLI API and catalog identity; UI consumers import the pure catalog.
export { TOOL_METADATA, CATEGORY_KEYWORDS } from './metadata-catalog.js';

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

/** Metadata visible to RAG / BM25. Gated tools stay out of the index when disabled. */
export function getActiveToolMetadata(): ToolMetadata[] {
  if (process.env.CODEBUDDY_CONTEXT_ZOOM === 'true') return TOOL_METADATA;
  return TOOL_METADATA.filter((metadata) => metadata.name !== 'context_expand');
}
