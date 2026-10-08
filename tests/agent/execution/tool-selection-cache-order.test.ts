/**
 * La liste d'outils est figée et ordonnée pour les tours d'une même requête.
 * Une autre requête, ou un clearCache (nouveau message utilisateur), resélectionne.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyTool } from '../../../src/codebuddy/client.js';

vi.mock('../../../src/codebuddy/tools.js', () => ({
  getAllCodeBuddyTools: vi.fn(),
  getRelevantTools: vi.fn(),
  classifyQuery: vi.fn(() => ({ complexity: 'simple', categories: [] })),
  getSkillAugmentedTools: (tools: unknown) => tools,
}));

import { getAllCodeBuddyTools } from '../../../src/codebuddy/tools.js';
import { ToolSelectionStrategy } from '../../../src/agent/execution/tool-selection-strategy.js';

function tool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
    },
  };
}

describe('ordre des outils figé pour une même requête', () => {
  const listed = getAllCodeBuddyTools as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listed.mockReset();
  });

  it('ressert le même ordre après cacheTools, et resélectionne après clearCache ou une autre requête', async () => {
    listed.mockResolvedValue([tool('view_file'), tool('search'), tool('bash')]);
    const strategy = new ToolSelectionStrategy({ useRAG: false, enableCaching: true });

    const first = await strategy.selectToolsForQuery('Corrige le bug du fichier calc.ts');
    strategy.cacheTools(first.tools);
    listed.mockResolvedValue([tool('bash'), tool('search'), tool('view_file')]);
    const second = await strategy.selectToolsForQuery('Corrige le bug du fichier calc.ts');

    expect(second.fromCache).toBe(true);
    expect(second.tools.map(item => item.function.name)).toEqual(['view_file', 'search', 'bash']);

    const other = await strategy.selectToolsForQuery('Autre demande sans rapport avec la première');
    expect(other.fromCache).toBe(false);
    expect(other.tools.map(item => item.function.name)).toEqual(['bash', 'search', 'view_file']);

    strategy.cacheTools(first.tools);
    strategy.clearCache();
    const resealed = await strategy.selectToolsForQuery('Corrige le bug du fichier calc.ts');
    expect(resealed.fromCache).toBe(false);
    expect(resealed.tools.map(item => item.function.name)).toEqual(['bash', 'search', 'view_file']);
  });
});
