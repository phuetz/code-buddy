import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGenerated, generateProvenFeatures, updateReadme } from '../../scripts/generate-proven-features.js';
import { currentCatalogSourceDigest } from '../../src/catalog/status.js';
import { auditShowcase, inspectDocument } from '../../scripts/check-showcase-claims.js';

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
  put(directory, 'README.fr.md', '# Fixture FR\n\n<!-- proven-features:start --><!-- proven-features:end -->\n');
  review(directory, 'insufficient');
  return directory;
}

function review(directory: string, decision: 'accept' | 'insufficient', artifact: string | null = null): void {
  put(directory, 'docs/catalog/showcase-review.json', JSON.stringify({ schemaVersion: 1, features: [{
    id: 'fixture', decision, artifact,
    artifactSha256: artifact ? createHash('sha256').update(readFileSync(path.join(directory, artifact))).digest('hex') : null,
    reason: 'Documentary qualification of this fixture only.',
  }] }));
}

function proof(directory: string, result: 'passed' | 'failed', date: string, summary: string): void {
  put(directory, `docs/preuves/${result}.log`, `Commande : buddy fixture --json\nPortée : fixture only.\n`);
  put(directory, `docs/preuves/${result}.json`, JSON.stringify({
    schemaVersion: 1, featureId: 'fixture', kind: 'integration', result, date, revision,
    sourceDigest: currentCatalogSourceDigest(directory, 'fixture'),
    artifact: `docs/preuves/${result}.log`, summary,
  }));
  review(directory, 'accept', `docs/preuves/${result}.log`);
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
      'docs/FONCTIONNALITES.md', 'docs/feature-catalog.md', 'docs/INVENTAIRE-FONCTIONNALITES.md',
    ]);
  });

  it('shows the latest failed run even when a previous run passed', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-28T12:00:00Z', 'OLD_SUCCESS');
    proof(directory, 'failed', '2026-09-29T12:00:00Z', 'NEW_FAILURE');
    const files = generateProvenFeatures(directory, revision);
    const fr = files['docs/FONCTIONNALITES-PROUVEES.md']!;
    expect(fr).toContain('0/1 prouvées · 1 non prouvées ici (dont 1 derniers essais en échec)');
    expect(fr).toContain('**Non prouvée ici**');
    expect(fr).toContain('NEW\\_FAILURE');
    expect(fr).toContain('(preuves/failed.log)');
    expect(fr).not.toContain('OLD_SUCCESS');
    expect(fr).toContain('buddy fixture --json');
    expect(fr).toContain('2026-09-29T12:00:00Z');
  });

  it('downgrades an outdated source digest and explains the unavailable evidence', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUCCESS');
    expect(generateProvenFeatures(directory, revision)['README.md']).toContain('PROVEN 1/1');
    put(directory, 'src/feature.ts', 'export const feature = true;\nexport const changed = true;');
    const files = generateProvenFeatures(directory, revision);
    expect(files['README.md']).toContain('PROVEN 0/1');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('Preuve ancienne ou révision courante inconnue.');
  });

  it('records a reason and no fabricated command or date for an unexecuted scenario', () => {
    const directory = fixture();
    const content = generateProvenFeatures(directory, revision)['docs/PROVEN-FEATURES.md']!;
    expect(content).toContain('**Not proven here** · Execution date (UTC) : —.');
    expect(content).toContain('Evidence command: no recorded execution.');
    expect(content).toContain('Review : Documentary qualification of this fixture only.');
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
    put(directory, 'docs/catalog/showcase-review.json', JSON.stringify({ schemaVersion: 1, features: [] }));
    expect(() => generateProvenFeatures(directory, revision)).toThrow('Incomplete or invalid documentary review');
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

  it('qualifies the scenario limit promise when a proven trace records no scope', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUCCESS');
    put(directory, 'docs/preuves/passed.log', 'Commande : buddy fixture --json\n');
    review(directory, 'accept', 'docs/preuves/passed.log');
    const files = generateProvenFeatures(directory, revision);
    expect(files['README.md']).toContain('scenario limit when recorded');
    expect(files['README.fr.md']).toContain('limite du scénario lorsqu’elle est consignée');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('Les observations et raisons, ainsi que les limites consignées,');
    expect(files['docs/PROVEN-FEATURES.md']).toContain('Observations and reasons, along with recorded limits,');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('**Prouvée**');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).not.toContain('Portée de l’essai :');
    expect(files['docs/PROVEN-FEATURES.md']).not.toContain('Run scope :');
  });

  it('does not promote a mechanically valid manifest whose trace review is insufficient', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUMMARY_ONLY');
    review(directory, 'insufficient', 'docs/preuves/passed.log');
    expect(generateProvenFeatures(directory, revision)['README.md']).toContain('PROVEN 0/1');
  });

  it('keeps a latest failed attempt visible after the source digest becomes stale', () => {
    const directory = fixture();
    proof(directory, 'failed', '2026-09-29T12:00:00Z', 'MISSING_BACKEND');
    put(directory, 'src/feature.ts', 'export const feature = false;');
    const files = generateProvenFeatures(directory, revision);
    expect(files['README.md']).toContain('INCLUDING LATEST FAILED RUNS 1');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('MISSING\\_BACKEND');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('Preuve ancienne');
  });

  it('requires a new documentary review when an accepted trace is edited', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUCCESS');
    put(directory, 'docs/preuves/passed.log', 'Commande : buddy fixture --json\nObservé : changed summary.');
    const files = generateProvenFeatures(directory, revision);
    expect(files['README.md']).toContain('PROVEN 0/1');
    expect(files['docs/FONCTIONNALITES-PROUVEES.md']).toContain('Trace nouvelle ou modifiée');
  });

  it('uses the same feature statuses and counts in every generated summary', () => {
    const files = generateProvenFeatures(root);
    const result = JSON.parse(files['docs/catalog/showcase-status.json']!);
    expect(result.counts.passed + result.counts.unavailable).toBe(result.counts.total);
    expect(result.counts.failed).toBe(result.features.filter((feature: { latestRunFailed: boolean }) => feature.latestRunFailed).length);
    for (const file of ['docs/FONCTIONNALITES.md', 'docs/INVENTAIRE-FONCTIONNALITES.md', 'docs/feature-catalog.md']) {
      const rows = files[file]!.split('\n').filter((line) => line.startsWith('| ` '));
      expect(rows).toHaveLength(result.counts.total);
      for (const feature of result.features) {
        const row = rows.find((line) => line.startsWith(`| \` ${feature.id} \``))!;
        expect(row).toContain(file === 'docs/feature-catalog.md'
          ? (feature.status === 'proven' ? '**Proven**' : '**Not proven here**')
          : (feature.status === 'proven' ? '**Prouvée**' : '**Non prouvée ici**'));
      }
    }
  });

  it('renders the README status in each language without changing the evidence counts', () => {
    const directory = fixture();
    proof(directory, 'passed', '2026-09-29T12:00:00Z', 'SUCCESS');
    const files = generateProvenFeatures(directory, revision);
    expect(files['README.md']).toContain('## Feature status');
    expect(files['README.md']).toContain('PROVEN 1/1 | NOT PROVEN HERE 0 | INCLUDING LATEST FAILED RUNS 0');
    expect(files['README.md']).not.toContain('## État des fonctionnalités');
    expect(files['README.md']).toContain('](docs/PROVEN-FEATURES.md)');
    expect(files['README.fr.md']).toContain('## État des fonctionnalités');
    expect(files['README.fr.md']).toContain('PROUVÉES 1/1 | NON PROUVÉES ICI 0 | DONT DERNIERS ESSAIS EN ÉCHEC 0');
    expect(files['README.fr.md']).toContain('](docs/FONCTIONNALITES-PROUVEES.md)');
    expect(JSON.parse(files['docs/catalog/showcase-status.json']!).counts)
      .toEqual({ total: 1, passed: 1, failed: 0, unavailable: 0 });
  });
});


describe('documentary claims guard', () => {
  it('scans every current documentation file, including unlinked pages and textual assets', () => {
    const audit = auditShowcase(root);
    expect(audit.files).toContain('docs/infrastructure.md');
    expect(audit.files).toContain('docs/marketing/VIDEO-LISA-2026-09-code-buddy.md');
    expect(audit.files).toContain('docs/architecture/tool-system.svg');
    expect(audit.files).toContain('cowork/ARCHITECTURE.md');
    expect(audit.violations).toEqual([]);
  });

  it.each([
    '~110 tools', '~ 110 outils', '110+ tools', '110+tools',
    '~110 built-in tools', '100+ outils', '15 providers', '15 LLM providers',
    '64 fournisseurs', '220+ outils', '230 tools', '45+ Tool Categories',
    '**110+** built-in tools', '<b>110</b> tools', '12 native tools',
    'Tools (110)', 'Providers: 64', 'Tools | 230 |', 'tool_count: 230',
    'Tool definitions: 110', 'fournisseurs — 64', '5-Provider Fallback',
    'three tools', 'one hundred tools', 'thirty providers', 'quinze fournisseurs',
    '<meta name="description" content="30 tools over MCP">',
    'compteur 220+ ; liste d’outils', '5 LLM-callable tools', '5 read-only semantic navigation tools', 'Five read-only semantic navigation tools', '## 110 tools', '64 pastilles (cloud / passerelle / local)',
  ])('rejects a numeric inventory argument in a newly added presentation page: %s', (claim) => {
    expect(inspectDocument('docs/marketing/new-presentation.md', claim)
      .some((row) => row.kind === 'count' && row.violation)).toBe(true);
  });

  it('also rejects unmeasured reference counts and historical labels in marketing', () => {
    expect(inspectDocument('docs/reports/README.md', '64 providers')
      .some((row) => row.violation)).toBe(true);
    expect(inspectDocument('docs/new-reference.md', '64 providers')
      .some((row) => row.violation)).toBe(true);
    expect(inspectDocument('docs/marketing/new.md', '<!-- showcase:historical -->\n2026-09-01\n110+ tools')
      .some((row) => row.violation)).toBe(true);
    expect(inspectDocument('docs/new-presentation.md', '<!-- showcase:historical -->\n2026-09-01\n110+ tools')
      .some((row) => row.violation)).toBe(true);
    expect(inspectDocument('README.md', '<!-- proven-features:start -->\n110+ tools\n<!-- proven-features:end -->')
      .some((row) => row.violation)).toBe(true);
  });

  it('records historical counts and execution limits without presenting them as current totals', () => {
    const old = inspectDocument('docs/archive/old.md', '110+ tools; 15 providers');
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({ classification: 'historical-record', violation: false });
    const limits = inspectDocument('docs/new-reference.md', '400 tool rounds\n12 tool calls\n## 8.1 Outils');
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((row) => !row.violation)).toBe(true);
  });

  it.each(['Proven voice', 'validated end-to-end', 'validated E2E', 'voice is proved', 'prove the configured provider works', 'Voix prouvée', 'Compagnon prouvé'])('rejects an unsupported evidence claim: %s', (claim) => {
    expect(inspectDocument('docs/new-presentation.md', claim)
      .some((row) => row.kind === 'evidence' && row.violation)).toBe(true);
  });

  it('preserves negative evidence statements and bounded historical sections', () => {
    expect(inspectDocument('README.fr.md', 'Ce critère n’est pas\nprouvé par les traces de cette branche.')
      .every((row) => !row.violation)).toBe(true);
    const text = '2026-06-04\n<!-- showcase:historical:start -->\nvalidated end-to-end\n<!-- showcase:historical:end -->\nProven voice';
    const rows = inspectDocument('docs/hermes-memory-providers-selfhost.md', text);
    expect(rows.map((row) => row.violation)).toEqual([false, true]);
  });
});
