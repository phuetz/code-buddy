import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCatalog, type Catalog } from '../../src/catalog/generate.js';
import { buildCatalogCoverage, renderCatalogCoverageMarkdown } from '../../src/catalog/coverage.js';
import { attachCatalogToFeatureMap, CURATED_FEATURES, getFeatureMap } from '../../src/agent/self-improvement/evolution/feature-map.js';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = { file: 'src/providers/provider-catalog.ts', line: 1, commit: 'fixture' };

function fixture(): Catalog {
  return {
    schemaVersion: 1,
    commit: 'fixture',
    entries: [
      { id: 'provider:ollama', family: 'provider', name: 'ollama', sources: [source] },
      { id: 'cli:src/index.ts:evolve', family: 'cli', name: 'evolve', sources: [{ file: 'src/index.ts', line: 2, commit: 'fixture' }] },
      { id: 'http:src/server/routes/sessions.ts:GET /', family: 'http', name: 'GET /', sources: [{ file: 'src/server/routes/sessions.ts', line: 3, commit: 'fixture' }] },
      { id: 'slash:help', family: 'slash', name: 'help', sources: [{ file: 'src/commands/slash/builtin-commands.ts', line: 4, commit: 'fixture' }] },
    ],
  };
}

describe('DGM catalogue coverage', () => {
  it('attaches declared surfaces by name and path while leaving ambiguous entries visible', () => {
    expect(CURATED_FEATURES).toHaveLength(21);
    const coverage = buildCatalogCoverage(fixture(), CURATED_FEATURES);
    expect(coverage.total).toBe(4);
    expect(coverage.assigned).toBe(3);
    expect(coverage.unassigned).toBe(1);
    expect(coverage.percent).toBe(75);
    expect(coverage.assignments.find((entry) => entry.id === 'provider:ollama')?.domainId).toBe('model-routing');
    expect(coverage.assignments.find((entry) => entry.id.includes('evolve'))?.domainId).toBe('self-improvement');
    expect(coverage.assignments.find((entry) => entry.id.startsWith('http:'))?.domainId).toBe('sessions-checkpoints');
    expect(coverage.unmatched.map((entry) => entry.id)).toEqual(['slash:help']);
    expect(coverage.codeExplorer).toBe('not_requested');
    expect(renderCatalogCoverageMarkdown(coverage)).toContain('Non rattachés : 1');
  });

  it('feeds the unchanged 21 curated DGM domains with stable catalogue IDs', () => {
    const enriched = attachCatalogToFeatureMap(fixture());
    expect(enriched).toHaveLength(21);
    expect(enriched.find((area) => area.id === 'model-routing')?.catalogIds).toContain('provider:ollama');
    expect(enriched.find((area) => area.id === 'self-improvement')?.catalogIds).toContain('cli:src/index.ts:evolve');
    expect(enriched.find((area) => area.id === 'sessions-checkpoints')?.catalogIds).toContain('http:src/server/routes/sessions.ts:GET /');
    expect(enriched.flatMap((area) => area.catalogIds ?? [])).not.toContain('slash:help');
  });

  it('passes catalogue IDs through the DGM feature-map API without Code Explorer', async () => {
    const areas = await getFeatureMap({ catalog: fixture(), enrich: async () => [] });
    expect(areas).toHaveLength(21);
    expect(areas.find((area) => area.id === 'model-routing')?.catalogIds).toContain('provider:ollama');
  });

  it('calculates coverage from the real generated catalogue without losing or duplicating an ID', () => {
    const catalog = generateCatalog(checkout);
    const coverage = buildCatalogCoverage(catalog, CURATED_FEATURES);
    expect(coverage.total).toBe(catalog.entries.length);
    expect(coverage.assigned + coverage.unassigned).toBe(coverage.total);
    expect(new Set(coverage.assignments.map((item) => item.id)).size).toBe(catalog.entries.length);
    expect(coverage.unmatched).toEqual(coverage.assignments.filter((item) => item.domainId === null));
    expect(coverage.assignments.find((item) => item.id === 'provider:ollama')?.domainId).toBe('model-routing');
    expect(coverage.byDomain['model-routing']).toBeGreaterThan(0);
    expect(buildCatalogCoverage(catalog, CURATED_FEATURES)).toEqual(coverage);
  });

  it('rejects duplicate catalogue IDs and exposes a broken domain rule as unmatched', () => {
    const catalog = fixture();
    const withoutRouting = buildCatalogCoverage(catalog, CURATED_FEATURES.filter((area) => area.id !== 'model-routing'));
    expect(withoutRouting.unmatched.map((entry) => entry.id)).toContain('provider:ollama');
    expect(withoutRouting.assigned).toBe(2);
    catalog.entries.push(catalog.entries[0]!);
    expect(() => buildCatalogCoverage(catalog, CURATED_FEATURES)).toThrow('Duplicate catalogue ID');
  });
});
