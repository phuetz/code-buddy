/**
 * App Studio design-system catalog (renderer-side).
 *
 * The 150 brand design systems are vendored in the repo; their lightweight
 * index (id/name/category/tagline) is bundled here as JSON so the style
 * selector needs no IPC round-trip. The actual DESIGN.md + tokens are read
 * core-side during scaffolding (see src/templates/design-system-apply.ts).
 */

import catalogData from './design-systems-catalog.json';

export interface DesignSystemSummary {
  id: string;
  name: string;
  category: string;
  tagline: string;
}

interface CatalogFile {
  schema?: string;
  count?: number;
  systems?: DesignSystemSummary[];
}

const catalog = catalogData as CatalogFile;

export const DESIGN_SYSTEMS: DesignSystemSummary[] = Array.isArray(catalog.systems) ? catalog.systems : [];

export function findDesignSystem(id: string): DesignSystemSummary | undefined {
  return DESIGN_SYSTEMS.find((system) => system.id === id);
}

/** Systems grouped by category, both categories and systems sorted alphabetically. */
export function designSystemsByCategory(): Array<{ category: string; systems: DesignSystemSummary[] }> {
  const groups = new Map<string, DesignSystemSummary[]>();
  for (const system of DESIGN_SYSTEMS) {
    const list = groups.get(system.category) ?? [];
    list.push(system);
    groups.set(system.category, list);
  }
  return Array.from(groups.entries())
    .map(([category, systems]) => ({
      category,
      systems: systems.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
