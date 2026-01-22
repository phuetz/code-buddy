/**
 * Semantic Map Formatter
 *
 * Output formatting functions for the Semantic Map.
 */

import type { SemanticMap } from "./types.js";

/**
 * Format map for display
 */
export function formatMap(map: SemanticMap | null): string {
  if (!map) return "No map built";

  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("🗺️  CODEBASE SEMANTIC MAP");
  lines.push("═".repeat(60));
  lines.push("");

  lines.push(`Root: ${map.rootPath}`);
  lines.push(`Created: ${map.createdAt.toISOString()}`);
  lines.push("");

  lines.push("─".repeat(40));
  lines.push("Statistics:");
  lines.push(`  Files: ${map.stats.totalFiles}`);
  lines.push(`  Elements: ${map.stats.totalElements}`);
  lines.push(`  Relationships: ${map.stats.totalRelationships}`);
  lines.push(`  Clusters: ${map.stats.totalClusters}`);
  lines.push(`  Concepts: ${map.concepts.size}`);
  lines.push(`  Layers: ${map.layers.length}`);

  lines.push("");
  lines.push("─".repeat(40));
  lines.push("Elements by Type:");
  for (const [type, count] of map.stats.elementsByType) {
    lines.push(`  ${type}: ${count}`);
  }

  if (map.layers.length > 0) {
    lines.push("");
    lines.push("─".repeat(40));
    lines.push("Architectural Layers:");
    for (const layer of map.layers.sort((a, b) => a.level - b.level)) {
      lines.push(`  ${layer.level}. ${layer.name} (${layer.elements.length} elements)`);
    }
  }

  if (map.clusters.size > 0) {
    lines.push("");
    lines.push("─".repeat(40));
    lines.push("Top Clusters:");
    const topClusters = Array.from(map.clusters.values())
      .sort((a, b) => b.elements.length - a.elements.length)
      .slice(0, 10);
    for (const cluster of topClusters) {
      lines.push(`  • ${cluster.name} [${cluster.category}] (${cluster.elements.length} elements)`);
    }
  }

  lines.push("");
  lines.push("═".repeat(60));

  return lines.join("\n");
}
