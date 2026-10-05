/**
 * Stabilité d'ordre des outils pour le cache de préfixe provider.
 *
 * Sans tri déterministe, `Map` renvoie l'ordre d'insertion : deux processus
 * (ou un enregistrement MCP/plugin dans un autre ordre) sérialisent un JSON
 * d'outils différent à contenu égal → cache miss.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getToolRegistry } from '../../src/tools/registry.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';

function fakeTool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `tool ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

describe('stabilité ordre des outils (cache préfixe)', () => {
  const registry = getToolRegistry();

  beforeEach(() => {
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  it('getEnabledTools trie les noms même si l’enregistrement est désordonné', () => {
    // Ordre d'insertion volontairement non alphabétique.
    for (const name of ['zeta_tool', 'alpha_tool', 'middle_tool']) {
      registry.registerTool(fakeTool(name), {
        name,
        category: 'system',
        keywords: [],
        priority: 1,
        description: name,
      });
    }

    const names = registry.getEnabledTools().map((t) => t.function.name);
    // ÉCHOUE sur l'ancienne logique (ordre Map = insertion).
    // PASSE avec le tri localeCompare sur function.name.
    expect(names).toEqual(['alpha_tool', 'middle_tool', 'zeta_tool']);
  });

  it('getEnabledToolMetadata suit le même ordre déterministe', () => {
    for (const name of ['z', 'a', 'm']) {
      registry.registerTool(fakeTool(name), {
        name,
        category: 'system',
        keywords: [],
        priority: 1,
        description: name,
      });
    }
    expect(registry.getEnabledToolMetadata().map((m) => m.name)).toEqual(['a', 'm', 'z']);
  });
});
