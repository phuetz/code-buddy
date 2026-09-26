import { Command } from 'commander';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog, renderCatalogMarkdown } from '../../src/catalog/status.js';
import { registerCatalogCommands } from '../../src/commands/cli/catalog-command.js';

const REVISION = 'a'.repeat(40);
const OLD_REVISION = 'b'.repeat(40);
const roots: string[] = [];

function put(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'catalog-status-'));
  roots.push(root);
  put(root, 'package.json', JSON.stringify({ name: '@phuetz/code-buddy', version: '2.3.0' }));
  put(root, 'src/catalog/feature.ts', 'export const feature = true;');
  put(root, 'src/index.ts', "addLazyCommandGroup(program, 'feature', 'description', async () => { registerFeatureCommands(program); });");
  put(root, 'src/commands/feature.ts', "export function registerFeatureCommands(program) { program.command('feature').command('status'); }");
  put(root, 'docs/catalog/inventory.json', JSON.stringify({
    schemaVersion: 1,
    features: [{
      id: 'feature', title: 'Feature',
      codePaths: ['src/catalog/feature.ts'],
      entrypoint: { kind: 'cli', checks: [
        { file: 'src/index.ts', contains: "addLazyCommandGroup(program, 'feature'" },
        { file: 'src/index.ts', contains: 'registerFeatureCommands(program)' },
        { file: 'src/commands/feature.ts', contains: ".command('status')" },
      ] },
      introducedIn: '2.3.0',
    }],
  }));
  return root;
}

function proof(root: string, revision = REVISION, result = 'passed', date = '2026-09-26T12:00:00Z'): void {
  put(root, 'docs/preuves/trace.log', 'PASS: feature status reaches the command\n');
  put(root, 'docs/preuves/feature.json', JSON.stringify({
    schemaVersion: 1, featureId: 'feature', kind: 'integration',
    result, date, revision, artifact: 'docs/preuves/trace.log',
    summary: 'Real command output checked',
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('catalog states and evidence', () => {
  it('finds each declared entrypoint in the real source inventory', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const catalog = buildCatalog({ root, revision: REVISION });
    expect(catalog.features.slice(0, 5).map((feature) => feature.id)).toEqual([
      'catalog-status', 'resource-catalog-tool', 'http-health', 'telegram-channel', 'fleet-cli',
    ]);
    for (const feature of catalog.features.slice(0, 5)) {
      expect(feature.states.coded, feature.id).toBe('vrai');
      expect(feature.states.wired, feature.id).toBe('vrai');
      expect(feature.states.deployed, feature.id).toBe('inconnu');
    }
  });

  it('discovers other CLI and tool names without claiming their unverified code or wiring', () => {
    const root = fixture();
    put(root, 'src/index.ts', readFileSync(path.join(root, 'src/index.ts'), 'utf8')
      + "\naddLazyCommandGroup(program, 'other', 'description', async () => {});\n");
    put(root, 'src/tools/metadata.ts', "export const TOOL_METADATA = [{ name: 'sample_tool', description: 'Example' }];");
    const catalog = buildCatalog({ root, revision: REVISION });
    const cli = catalog.features.find((item) => item.id === 'cli:other')!;
    const tool = catalog.features.find((item) => item.id === 'tool:sample_tool')!;
    expect(cli).toBeDefined();
    expect(tool).toBeDefined();
    expect(cli.states).toEqual({ coded: 'inconnu', wired: 'vrai', testedInSituation: 'inconnu', deployed: 'inconnu' });
    expect(tool.states).toEqual({ coded: 'inconnu', wired: 'inconnu', testedInSituation: 'inconnu', deployed: 'inconnu' });
  });

  it('requires source, each wiring hop, a current passing trace and an installed version', () => {
    const root = fixture();
    proof(root);
    const feature = buildCatalog({ root, revision: REVISION, installed: { confirmed: true, version: '2.3.0' } }).features[0]!;
    expect(feature.states).toEqual({ coded: 'vrai', wired: 'vrai', testedInSituation: 'vrai', deployed: 'vrai' });
    expect(feature.lastProof).toMatchObject({ date: '2026-09-26T12:00:00Z', revision: REVISION, artifact: 'docs/preuves/trace.log' });
  });

  it('does not mistake a commented or missing wiring hop for a reachable feature', () => {
    const root = fixture();
    put(root, 'src/index.ts', "// addLazyCommandGroup(program, 'feature'\nregisterFeatureCommands(program);");
    const feature = buildCatalog({ root, revision: REVISION }).features[0]!;
    expect(feature.states.coded).toBe('vrai');
    expect(feature.states.wired).toBe('faux');
    expect(feature.states.testedInSituation).toBe('inconnu');
    expect(feature.states.deployed).toBe('inconnu');
  });

  it('does not mistake a quoted example for an executable wiring hop', () => {
    const root = fixture();
    put(root, 'src/index.ts', "const example = \"addLazyCommandGroup(program, 'feature'\"; registerFeatureCommands(program);");
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.wired).toBe('faux');
  });

  it('marks declared code absent from the artifact as false', () => {
    const root = fixture();
    rmSync(path.join(root, 'src/catalog/feature.ts'));
    const feature = buildCatalog({ root, revision: REVISION, installed: { confirmed: true, version: '2.3.0' } }).features[0]!;
    expect(feature.states.coded).toBe('faux');
    expect(feature.states.deployed).toBe('faux');
  });

  it('keeps stale evidence visible without claiming the current revision was tested', () => {
    const root = fixture();
    proof(root, OLD_REVISION);
    const feature = buildCatalog({ root, revision: REVISION }).features[0]!;
    expect(feature.states.testedInSituation).toBe('inconnu');
    expect(feature.lastProof?.revision).toBe(OLD_REVISION);
  });

  it('treats a current failing run as false and rejects an artifact escaping the root', () => {
    const root = fixture();
    proof(root, REVISION, 'failed');
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.testedInSituation).toBe('faux');
    put(root, 'docs/preuves/feature.json', JSON.stringify({
      schemaVersion: 1, featureId: 'feature', kind: 'integration', result: 'passed',
      date: '2026-09-26T12:00:00Z', revision: REVISION, artifact: '../outside.log',
      summary: 'Forged passing trace',
    }));
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.testedInSituation).toBe('inconnu');
  });

  it('retains the last passing proof when a newer current run failed', () => {
    const root = fixture();
    proof(root, REVISION);
    put(root, 'docs/preuves/failure.log', 'FAIL: feature status\n');
    put(root, 'docs/preuves/failure.json', JSON.stringify({
      schemaVersion: 1, featureId: 'feature', kind: 'integration', result: 'failed',
      date: '2026-09-26T13:00:00Z', revision: REVISION,
      artifact: 'docs/preuves/failure.log', summary: 'Later failing run',
    }));
    const feature = buildCatalog({ root, revision: REVISION }).features[0]!;
    expect(feature.states.testedInSituation).toBe('faux');
    expect(feature.lastProof?.artifact).toBe('docs/preuves/trace.log');
    expect(feature.latestEvidence?.artifact).toBe('docs/preuves/failure.log');
  });

  it('accepts a dated execution proof declared in the inventory', () => {
    const root = fixture();
    put(root, 'tests/integration/feature.log', 'PASS: feature\n');
    const inventoryPath = path.join(root, 'docs/catalog/inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    inventory.features[0].proofs = [{
      kind: 'integration', result: 'passed', date: '2026-09-26T12:00:00Z',
      revision: REVISION, artifact: 'tests/integration/feature.log', summary: 'Integration run',
    }];
    writeFileSync(inventoryPath, JSON.stringify(inventory));
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.testedInSituation).toBe('vrai');
  });

  it('rejects an empty trace or an unrelated file presented as a passing proof', () => {
    const root = fixture();
    proof(root);
    put(root, 'docs/preuves/trace.log', '');
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.testedInSituation).toBe('inconnu');
    put(root, 'docs/preuves/feature.json', JSON.stringify({
      schemaVersion: 1, featureId: 'feature', kind: 'integration', result: 'passed',
      date: '2026-09-26T12:00:00Z', revision: REVISION,
      artifact: 'package.json', summary: 'Unrelated file',
    }));
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.testedInSituation).toBe('inconnu');
  });

  it('does not claim deployment without installation evidence, and rejects an older installed version', () => {
    const root = fixture();
    expect(buildCatalog({ root, revision: REVISION }).features[0]!.states.deployed).toBe('inconnu');
    expect(buildCatalog({ root, revision: REVISION, installed: { confirmed: true, version: '2.2.0' } }).features[0]!.states.deployed).toBe('faux');
  });

  it('confirms deployment from code in the installed artifact when introduction version is unspecified', () => {
    const root = fixture();
    const inventoryPath = path.join(root, 'docs/catalog/inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    delete inventory.features[0].introducedIn;
    writeFileSync(inventoryPath, JSON.stringify(inventory));
    expect(buildCatalog({ root, revision: REVISION, installed: { confirmed: true, version: '2.3.0' } }).features[0]!.states.deployed).toBe('vrai');
  });

  it('renders Markdown and makes buddy catalog status --json use the same data', async () => {
    const root = fixture();
    proof(root);
    const catalog = buildCatalog({ root, revision: REVISION });
    const markdown = renderCatalogMarkdown(catalog);
    expect(markdown).toContain('CODÉE');
    expect(markdown).toContain('TESTÉE EN SITUATION');
    expect(markdown).toContain('docs/preuves/trace.log');

    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerCatalogCommands(program, { root, revision: REVISION });
    await program.parseAsync(['node', 'buddy', 'catalog', 'status', '--json']);
    const parsed = JSON.parse(output.mock.calls.map((call) => call.join(' ')).join('\n'));
    expect(parsed.features[0].states).toEqual(catalog.features[0]!.states);

    output.mockClear();
    const defaultProgram = new Command();
    defaultProgram.exitOverride();
    registerCatalogCommands(defaultProgram, { root, revision: REVISION });
    await defaultProgram.parseAsync(['node', 'buddy', 'catalog']);
    expect(output.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('CODÉE');
  });
});
