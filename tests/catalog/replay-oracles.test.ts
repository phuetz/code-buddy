import { describe, expect, it } from 'vitest';
// @ts-expect-error Standalone QA helper has no generated declaration file.
import { codeExplorerDefinitionsMatch, measureCatalogStdout } from '../../scripts/qa/replay-oracles.mjs';

const definitions = ['sample.js', 'sample.ts'].map(filePath => ({
  filePath, name: 'uniqueSymbol', label: 'Function', startLine: 1, endLine: 1,
}));

describe('rejeu CodeExplorer sans index préexistant', () => {
  it('exige les deux définitions, les fichiers et la ligne du symbole demandé', () => {
    expect(codeExplorerDefinitionsMatch({ notes: JSON.stringify({ definitions }) }, 'uniqueSymbol')).toBe(true);
    expect(codeExplorerDefinitionsMatch({ notes: JSON.stringify({ definitions }) }, 'anotherSymbol')).toBe(false);
  });

  it.each([
    { notes: 'Code Explorer is connected but returned no graph hits.' },
    { notes: 'uniqueSymbol sample.js sample.ts' },
    { notes: JSON.stringify({ definitions: [] }) },
    { notes: JSON.stringify({ definitions: [definitions[0], definitions[0]] }) },
    { notes: JSON.stringify({ definitions: definitions.map(d => ({ ...d, startLine: 2 })) }) },
    { notes: JSON.stringify({ definitions: definitions.map(d => ({ ...d, filePath: 'other.js' })) }) },
  ])('refuse réponse vide, écho, doublon ou mauvaise localisation : %j', context => {
    expect(codeExplorerDefinitionsMatch(context, 'uniqueSymbol')).toBe(false);
  });
});

describe('sortie brute du catalogue et mesures dérivées', () => {
  const catalog = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), warnings: [], features: [
    { id: 'one', states: { testedInSituation: 'vrai' } },
    { id: 'two', states: { testedInSituation: 'faux' } },
    { id: 'three', states: { testedInSituation: 'inconnu' } },
  ] };

  it('mesure le vrai tableau features sans modifier stdout ni son format', () => {
    const stdout = JSON.stringify(catalog, null, 2) + '\n';
    expect(measureCatalogStdout(stdout)).toEqual({ sourceRevision: 'a'.repeat(40), featureCount: 3,
      counts: { vrai: 1, faux: 1, inconnu: 1 }, warnings: [] });
    expect(stdout).toBe(JSON.stringify(catalog, null, 2) + '\n');
  });

  it('refuse le résumé reformaté à la place de la sortie réelle', () => {
    expect(() => measureCatalogStdout(JSON.stringify({ schemaVersion: 1, sourceRevision: 'a'.repeat(40),
      warnings: [], featureCount: 338, states: { vrai: 185, faux: 8, inconnu: 145 } }))).toThrow();
  });

  it('refuse les avertissements et les IDs comptés deux fois', () => {
    expect(() => measureCatalogStdout(JSON.stringify({ ...catalog, warnings: ['missing artifact'] }))).toThrow();
    expect(() => measureCatalogStdout(JSON.stringify({ ...catalog, features: [catalog.features[0], catalog.features[0]] }))).toThrow();
  });
});
