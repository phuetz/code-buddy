import type { ToolResult } from '../types/index.js';
import {
  buildDesignGuidance,
  getDesignSystem,
  listDesignSystems,
  loadCatalog,
  type DesignSystemSummary,
} from '../design/design-system-registry.js';

export interface DesignSystemToolArgs {
  action?: 'list' | 'get';
  id?: string;
  category?: string;
  query?: string;
}

export class DesignSystemTool {
  async execute(args: DesignSystemToolArgs): Promise<ToolResult> {
    try {
      if (args.action === 'list') {
        const systems = listDesignSystems({ category: args.category, query: args.query });
        return { success: true, output: formatListOutput(systems, args) };
      }

      if (args.action === 'get') {
        const id = args.id?.trim();
        if (!id) return { success: false, error: 'Missing required design system id for action=get.' };

        const detail = getDesignSystem(id);
        if (!detail) {
          return {
            success: false,
            error: `Unknown design system id: ${id}. Suggestions: ${suggestIds(id).join(', ') || 'none'}`,
          };
        }

        const guidance = buildDesignGuidance(id);
        if (!guidance) {
          return { success: false, error: `Unable to build guidance for design system id: ${id}` };
        }

        return { success: true, output: `${guidance}\n\n${formatTokenReminder(detail.designTokens)}` };
      }

      return { success: false, error: "Missing or invalid action. Use action='list' or action='get'." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Design system tool failed: ${message}` };
    }
  }
}

function formatListOutput(systems: DesignSystemSummary[], args: DesignSystemToolArgs): string {
  const filters = [args.category ? `category=${args.category}` : null, args.query ? `query=${args.query}` : null]
    .filter((value): value is string => value !== null)
    .join(', ');

  if (systems.length === 0) {
    return `No design systems found${filters ? ` for ${filters}` : ''}. Total: 0.`;
  }

  const shouldGroup = !args.category && !args.query;
  const lines = [`Found ${systems.length} design system(s)${filters ? ` for ${filters}` : ''}.`];

  if (shouldGroup) {
    const byCategory = new Map<string, DesignSystemSummary[]>();
    for (const system of systems) {
      const group = byCategory.get(system.category) ?? [];
      group.push(system);
      byCategory.set(system.category, group);
    }

    for (const [category, entries] of byCategory) {
      lines.push('', `## ${category}`);
      lines.push(...entries.map(formatSummaryLine));
    }
  } else {
    lines.push('', ...systems.map(formatSummaryLine));
  }

  return lines.join('\n');
}

function formatSummaryLine(system: DesignSystemSummary): string {
  return `- \`${system.id}\` — ${system.name} — ${system.category} — ${system.tagline}`;
}

function formatTokenReminder(designTokens: unknown): string {
  if (typeof designTokens !== 'object' || designTokens === null) {
    return 'Tokens clés: aucun design-tokens.json disponible.';
  }

  const record = designTokens as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, 12);
  if (keys.length === 0) return 'Tokens clés: design-tokens.json vide.';

  return `Tokens clés disponibles: ${keys.map((key) => `\`${key}\``).join(', ')}.`;
}

function suggestIds(id: string): string[] {
  const query = id.toLowerCase();
  return loadCatalog()
    .map((system) => ({ id: system.id, score: scoreSuggestion(query, system) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map((entry) => entry.id);
}

function scoreSuggestion(query: string, system: DesignSystemSummary): number {
  const haystacks = [system.id, system.name, system.category, system.tagline].map((value) => value.toLowerCase());
  let score = 0;
  for (const value of haystacks) {
    if (value === query) score += 100;
    if (value.startsWith(query) || query.startsWith(value)) score += 50;
    if (value.includes(query) || query.includes(value)) score += 20;
  }
  return score;
}
