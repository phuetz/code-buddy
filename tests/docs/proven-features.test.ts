import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGenerated, generateProvenFeatures, updateReadme } from '../../scripts/generate-proven-features.js';
import { currentCatalogSourceDigest } from '../../src/catalog/status.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporaryRoots: string[] = [];
const revision = 'a'.repeat(40);

function put(directory: string, file: string, content: string): void {
  const target = path.join(directory, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'proven-features-'));
  temporaryRoots.push(directory);
  mkdirSync(path.join(directory, 'docs/preuves'), { recursive: true });
  put(directory, 'src/feature.ts', 'export const feature = true;');
  put(directory, 'docs/catalog/inventory.json', JSON.stringify({ schemaVersion: 1, features: [{
    id: 'fixture', title: 'Fixture', domain: 'cli',
    benefit: { fr: 'Bénéfice de la fixture.', en: 'Fixture benefit.' },
    verificationLimit: 'Required service is unavailable in this environment.',
    codePaths: ['src/feature.ts'],
    entrypoint: { kind: 'cli', checks: [{ file: 'src/feature.ts', contains: 'export const feature = true;' }] },
  }] }));
  put(directory, 'README.md', '# Fixture\n\n<!-- proven-features:start -->\n<!-- proven-features:end -->\n\nUnrelated paragraph.\n');
  return directory;
}

function proof(directory: string, result: 'passed' | 'failed', date: string, summary: string): void {
  put(directory, `docs/preuves/${result}.log`, `Commande : buddy fixture --json\nPortée : fixture only.\n`);
  put(directory, `docs/preuves/${result}.json`, JSON.stringify({
    schemaVersion: 1, featureId: 'fixture', kind: 'integration', result, date, revision,
    sourceDigest: currentCatalogSourceDigest(directory, 'fixture'),
    artifact: `docs/preuves/${result}.log`, summary,
  }));
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('generated proven features showcase', () => {
  it('matches both committed pages and the README exactly from the current catalogue', () => {
    const files = generateProvenFeatures(root);
    expect(checkGenerated(root, files), 'Run npx tsx scripts/generate-proven-features.ts').toEqual([]);
    for (const [file, generated] of Object.entries(files)) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).toBe(generated);
    }
  });

  it('documents every tracked feature once in each language, with existing trace links', () => {
    const files = generateProvenFeatures(root);
    const inventory = JSON.parse(readFileSync(path.join(root, 'docs/catalog/inventory.json'), 'utf8')) as {
      features: Array<{ id: string; benefit: { fr: string; en: string } }>;
    };
    for (const file of ['docs/FONCTIONNALITES-PROUVEES.md', 'docs/PROVEN-FEATURES.md']) {
      const content = files[file]!;
      const headings = content.split('\n').filter((line) => line.startsWith('### '));
      expect(headings).toHaveLength(inventory.features.length);
      for (const feature of inventory.features) {
        expect(headings.filter((line) => line.endsWith(`\` ${feature.id} \``)), feature.id).toHaveLength(1);
      }
      for (const match of content.matchAll(/\]\(([^)#]+)\)/g)) {
        readFileSync(path.resolve(root, 'docs', decodeURIComponent(match[1]!)), 'utf8');
      }
    }
  });

  it('rejects a catalogue edit without regeneration, even if it only changes editorial metadata', () => {
    const directory = fixture();
    for (const [file, content] of Object.entries(generateProvenFeatures(directory, revision))) put(directory, file, content);
    expect(checkGenerated(directory, generateProvenFeatures(directory, revision))).toEqual([]);
    const inventoryPath = path.join(directory, 'docs/catalog/inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    inventory.editorialNote = 'Changed catalogue metadata';
    writeFileSync(inventoryPath, JSON.stringify(inventory));
    expect(checkGenerated(directory, generateProvenFeatures(directory, revision))).toEqual([
      'docs/FONCTIONNALITES-PROUVEES.md', 'docs/PROVEN-FEATURES.md',
    ]);
  });

  it('shows the latest failed run even when a previous run passed', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-28T12:00:00Z', 'OLD_SUCCESS');
    proof(directory, 'failed', '2026-09-29T12:00:00Z', 'NEW_FAILURE');
    const files = generateProvenFeatures(directory, revision);
    const fr = files['docs/FONCTIONNALITES-PROUVEES.md']!;
    expect(fr).toContain('0/1 prouvées en situation · 1 échecs');
    expect(fr).toContain('**Échec**');
    expect(fr).toContain('NEW\\_FAILURE');
    expect(fr).toContain('(preuves/failed.log)');
    expect(fr).not.toContain('OLD_SUCCESS');
    expect(fr).toContain('buddy fixture --json');
    expect(fr).toContain('2026-09-29T12:00:00Z');
  });

  it('downgrades an outdated source digest and explains the unavailable evidence', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUCCESS');
    expect(generateProvenFeatures(directory, revision)['README.md']).toContain('PROUVÉES 1/1');
    put(directory, 'src/feature.ts', 'export const feature = true;\nexport const changed = true;');
    const files = generateProvenFeatures(directory, revision);
    expect(files['README.md']).toContain('PROUVÉES 0/1');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('Preuve ancienne ou révision courante inconnue.');
  });

  it('records a reason and no fabricated command or date for an unexecuted scenario', () => {
    const directory = fixture();
    const content = generateProvenFeatures(directory, revision)['docs/PROVEN-FEATURES.md']!;
    expect(content).toContain('**Not verifiable here** · Execution date (UTC) : —.');
    expect(content).toContain('Evidence command: no recorded execution.');
    expect(content).toContain('Reason : Required service is unavailable in this environment.');
    expect(content).not.toContain('buddy fixture');
  });

  it('fails closed on an ignored proof, a missing recorded command or an unexplained unknown', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUCCESS');
    put(directory, 'docs/preuves/passed.log', 'Output with no recorded command.');
    expect(() => generateProvenFeatures(directory, revision)).toThrow('Missing recorded command');
    put(directory, 'docs/preuves/passed.json', '{}');
    expect(() => generateProvenFeatures(directory, revision)).toThrow('Preuve ignorée');
    rmSync(path.join(directory, 'docs/preuves/passed.json'));
    const inventoryPath = path.join(directory, 'docs/catalog/inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    delete inventory.features[0].verificationLimit;
    writeFileSync(inventoryPath, JSON.stringify(inventory));
    expect(() => generateProvenFeatures(directory, revision)).toThrow('Missing verification reason');
  });

  it('refuses a machine path or email from proof text before generating public pages', () => {
    const directory = fixture();
    for (const summary of ['/home/test-person/fixture', 'fixture-person@example.org']) {
      proof(directory, 'passed', '2026-09-29T12:00:00Z', summary);
      expect(() => generateProvenFeatures(directory, revision)).toThrow('machine path or email');
    }
  });

  it('preserves the rest of the README and refuses ambiguous markers', () => {
    const directory = fixture();
    expect(generateProvenFeatures(directory, revision)['README.md']).toMatch(/^# Fixture\n[\s\S]+Unrelated paragraph\.\n$/);
    expect(() => updateReadme('# No markers', 'block')).toThrow('marker pair');
    expect(() => updateReadme('<!-- proven-features:start --><!-- proven-features:start --><!-- proven-features:end -->', 'block')).toThrow('marker pair');
  });
});
