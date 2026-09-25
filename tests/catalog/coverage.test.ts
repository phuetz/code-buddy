import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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
  it('keeps technical descriptions and real representative paths for the new domains', () => {
    for (const id of ['computer-use', 'messaging-channels', 'http-api', 'configuration', 'cowork-gui']) {
      const area = CURATED_FEATURES.find((feature) => feature.id === id);
      expect(area, `${id} needs a curated description`).toBeDefined();
      expect(area!.description.length).toBeGreaterThan(30);
      expect(area!.paths.length).toBeGreaterThan(0);
      for (const representative of area!.paths) {
        expect(existsSync(path.join(checkout, representative)), `${id}: missing ${representative}`).toBe(true);
      }
    }
  });

  it('attaches declared surfaces by name and path, including the CLI interface', () => {
    expect(CURATED_FEATURES).toHaveLength(37);
    const coverage = buildCatalogCoverage(fixture(), CURATED_FEATURES);
    expect(coverage.total).toBe(4);
    expect(coverage.assigned).toBe(4);
    expect(coverage.unassigned).toBe(0);
    expect(coverage.percent).toBe(100);
    expect(coverage.assignments.find((entry) => entry.id === 'provider:ollama')?.domainId).toBe('model-routing');
    expect(coverage.assignments.find((entry) => entry.id.includes('evolve'))?.domainId).toBe('self-improvement');
    expect(coverage.assignments.find((entry) => entry.id.startsWith('http:'))?.domainId).toBe('sessions-checkpoints');
    expect(coverage.assignments.find((entry) => entry.id === 'slash:help')?.domainId).toBe('cli-interface');
    expect(coverage.codeExplorer).toBe('not_requested');
    expect(renderCatalogCoverageMarkdown(coverage)).toContain('Non rattachés : 0');
  });

  it('feeds the curated DGM domains with stable catalogue IDs', () => {
    const enriched = attachCatalogToFeatureMap(fixture());
    expect(enriched).toHaveLength(37);
    expect(enriched.find((area) => area.id === 'model-routing')?.catalogIds).toContain('provider:ollama');
    expect(enriched.find((area) => area.id === 'self-improvement')?.catalogIds).toContain('cli:src/index.ts:evolve');
    expect(enriched.find((area) => area.id === 'sessions-checkpoints')?.catalogIds).toContain('http:src/server/routes/sessions.ts:GET /');
    expect(enriched.find((area) => area.id === 'cli-interface')?.catalogIds).toContain('slash:help');
  });

  it('passes catalogue IDs through the DGM feature-map API without Code Explorer', async () => {
    const areas = await getFeatureMap({ catalog: fixture(), enrich: async () => [] });
    expect(areas).toHaveLength(37);
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
    expect(coverage.unmatched, 'Every generated catalogue entry needs a curated domain').toEqual([]);
    const digest = createHash('sha256').update(catalog.entries.map((entry) => entry.id).sort().join('\n')).digest('hex');
    expect(digest, 'Review new catalogue IDs and their domains before updating this fingerprint')
      .toBe('4fce6c31eab8b0fe1eb140cf983393fd0cfc4c60f0f88c74ff56e819221b872a');
    expect(buildCatalogCoverage(catalog, CURATED_FEATURES)).toEqual(coverage);
  });

  it('uses reader paths for environment variables and configuration for unknown readers', () => {
    const base = fixture();
    base.entries.push(
      { id: 'environment:SCREEN_SETTING', family: 'environment', name: 'SCREEN_SETTING', sources: [{ file: 'src/desktop-automation/smart-snapshot.ts', line: 1, commit: 'fixture' }] },
      { id: 'environment:VOICE_SETTING', family: 'environment', name: 'VOICE_SETTING', sources: [{ file: 'src/config/config-schema.ts', line: 1, commit: 'fixture' }, { file: 'src/companion/reply-augment.ts', line: 1, commit: 'fixture' }] },
      { id: 'environment:UNCLASSIFIED', family: 'environment', name: 'UNCLASSIFIED', sources: [{ file: 'src/misc/unknown.ts', line: 1, commit: 'fixture' }] },
    );
    const assigned = buildCatalogCoverage(base, CURATED_FEATURES).assignments;
    expect(assigned.find((entry) => entry.id === 'environment:SCREEN_SETTING')).toMatchObject({ domainId: 'computer-use', rule: 'reader:src/desktop-automation/smart-snapshot.ts' });
    expect(assigned.find((entry) => entry.id === 'environment:VOICE_SETTING')).toMatchObject({ domainId: 'companion', rule: 'reader:src/companion/reply-augment.ts' });
    expect(assigned.find((entry) => entry.id === 'environment:UNCLASSIFIED')).toMatchObject({ domainId: 'configuration', rule: 'reader:fallback:configuration' });
  });

  it('maps the requested computer-use surfaces to one editorial domain', () => {
    const base = fixture();
    for (const name of ['computer_control', 'browser_operator', 'web_test']) {
      base.entries.push({ id: `tool:${name}`, family: 'tool', name, sources: [{ file: 'src/tools/metadata.ts', line: 1, commit: 'fixture' }] });
    }
    const coverage = buildCatalogCoverage(base, CURATED_FEATURES);
    for (const name of ['computer_control', 'browser_operator', 'web_test']) {
      expect(coverage.assignments.find((entry) => entry.id === `tool:${name}`)?.domainId).toBe('computer-use');
    }
  });

  it('assigns channel adapters, HTTP routes and Cowork panels', () => {
    const base = fixture();
    base.entries.push(
      { id: 'channel:telegram', family: 'channel', name: 'telegram', sources: [{ file: 'src/channels/index.ts', line: 1, commit: 'fixture' }] },
      { id: 'http:src/server/index.ts:GET /api/docs', family: 'http', name: 'GET /api/docs', sources: [{ file: 'src/server/index.ts', line: 1, commit: 'fixture' }] },
      { id: 'cowork:DockWorkspace', family: 'cowork', name: 'DockWorkspace', sources: [{ file: 'cowork/src/renderer/App.tsx', line: 1, commit: 'fixture' }] },
    );
    const assignments = buildCatalogCoverage(base, CURATED_FEATURES).assignments;
    expect(assignments.find((entry) => entry.id === 'channel:telegram')?.domainId).toBe('messaging-channels');
    expect(assignments.find((entry) => entry.id.includes('/api/docs'))?.domainId).toBe('http-api');
    expect(assignments.find((entry) => entry.id === 'cowork:DockWorkspace')?.domainId).toBe('cowork-gui');
  });

  it('rejects duplicate catalogue IDs and exposes a broken domain rule as unmatched', () => {
    const catalog = fixture();
    const withoutRouting = buildCatalogCoverage(catalog, CURATED_FEATURES.filter((area) => area.id !== 'model-routing'));
    expect(withoutRouting.unmatched.map((entry) => entry.id)).toContain('provider:ollama');
    expect(withoutRouting.assigned).toBe(3);
    catalog.entries.push(catalog.entries[0]!);
    expect(() => buildCatalogCoverage(catalog, CURATED_FEATURES)).toThrow('Duplicate catalogue ID');
  });
});
