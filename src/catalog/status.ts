import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export type CatalogState = 'vrai' | 'faux' | 'inconnu';
export type EntryKind = 'cli' | 'tool' | 'route' | 'channel';

export interface CatalogProof {
  date: string;
  revision: string;
  artifact: string;
  kind: 'integration' | 'field';
  result: 'passed' | 'failed';
  summary: string;
  sourceDigest?: string;
}

interface FeatureDefinition {
  id: string;
  title: string;
  discoveryKey?: string;
  codePaths?: string[];
  entrypoint?: { kind: EntryKind; checks: Array<{ file: string; contains: string }> };
  introducedIn?: string;
  proofs?: CatalogProof[];
}

interface Inventory { schemaVersion: number; features: FeatureDefinition[] }

export interface CatalogFeature {
  id: string;
  title: string;
  entryKind: EntryKind | null;
  states: { coded: CatalogState; wired: CatalogState; testedInSituation: CatalogState; deployed: CatalogState };
  lastProof: CatalogProof | null;
  latestEvidence: CatalogProof | null;
  reasons: string[];
}

export interface CatalogStatus {
  schemaVersion: 1;
  generatedAt: string;
  sourceRevision: string | null;
  installedVersion: string | null;
  features: CatalogFeature[];
  warnings: string[];
}

export interface CatalogOptions {
  root: string;
  revision?: string | null;
  installed?: { confirmed: boolean; version: string };
  now?: () => Date;
}

function within(root: string, relative: string): string | null {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return null;
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return null;
  try {
    const real = realpathSync(file);
    return real.startsWith(`${realpathSync(root)}${path.sep}`) ? real : null;
  } catch { return null; }
}

function locatedFile(root: string, relative: string): string | null {
  const direct = within(root, relative);
  if (direct) return direct;
  // npm packages ship dist/ rather than src/. Match the emitted module.
  if (relative.startsWith('src/') && relative.endsWith('.ts')) {
    return within(root, `dist/${relative.slice(4, -3)}.js`);
  }
  return null;
}

function codeTokens(source: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    const next = source[i + 1];
    if (/\s/.test(char)) continue;
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
    } else if (char === "'" || char === '"' || char === '`') {
      let value = '';
      for (i++; i < source.length && source[i] !== char; i++) {
        if (source[i] === '\\' && i + 1 < source.length) i++;
        value += source[i];
      }
      tokens.push(`string:${value}`);
    } else if (/[\w$]/.test(char)) {
      let word = char;
      while (i + 1 < source.length && /[\w$]/.test(source[i + 1]!)) word += source[++i];
      tokens.push(word);
    } else tokens.push(char);
  }
  return tokens;
}

function discoveredNames(root: string, fileName: string, kind: 'cli' | 'tool'): string[] {
  const file = locatedFile(root, fileName);
  if (!file) return [];
  const tokens = codeTokens(readFileSync(file, 'utf8'));
  const names = new Set<string>();
  if (kind === 'cli') {
    for (let i = 0; i < tokens.length; i++) {
      const lazy = tokens[i] === 'addLazyCommandGroup' && tokens[i + 1] === '('
        && tokens[i + 2] === 'program' && tokens[i + 3] === ',';
      const direct = tokens[i] === 'program' && tokens[i + 1] === '.'
        && tokens[i + 2] === 'command' && tokens[i + 3] === '(';
      const name = tokens[i + 4];
      if ((lazy || direct) && name?.startsWith('string:')) names.add(name.slice(7).split(' ')[0]!);
    }
  } else {
    const start = tokens.indexOf('TOOL_METADATA');
    if (start < 0) return [];
    let arrayStart = start;
    while (arrayStart < tokens.length && tokens[arrayStart] !== '=') arrayStart++;
    while (arrayStart < tokens.length && tokens[arrayStart] !== '[') arrayStart++;
    let bracketDepth = 0;
    let objectDepth = 0;
    for (let i = arrayStart; i < tokens.length; i++) {
      if (tokens[i] === '[') bracketDepth++;
      else if (tokens[i] === ']') {
        bracketDepth--;
        if (bracketDepth === 0) break;
      } else if (tokens[i] === '{') objectDepth++;
      else if (tokens[i] === '}') objectDepth--;
      else if (objectDepth === 1 && tokens[i] === 'name' && tokens[i + 1] === ':'
        && tokens[i + 2]?.startsWith('string:')) {
        names.add(tokens[i + 2]!.slice(7));
      }
    }
  }
  return [...names].filter(Boolean).sort();
}

function containsCode(source: string, fragment: string): boolean {
  const actual = codeTokens(source);
  const expected = codeTokens(fragment);
  if (expected.length === 0) return false;
  return actual.some((_, offset) => expected.every((token, index) => actual[offset + index] === token));
}

function codeState(root: string, paths?: string[]): CatalogState {
  if (!paths?.length) return 'inconnu';
  return paths.every((file) => locatedFile(root, file)) ? 'vrai' : 'faux';
}

function wiringState(root: string, checks?: Array<{ file: string; contains: string }>): CatalogState {
  if (!checks?.length) return 'inconnu';
  for (const check of checks) {
    if (!check.file || !check.contains) return 'inconnu';
    const file = locatedFile(root, check.file);
    if (!file || !containsCode(readFileSync(file, 'utf8'), check.contains)) return 'faux';
  }
  return 'vrai';
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value);
}

function hasTrace(root: string, artifact: unknown): boolean {
  if (typeof artifact !== 'string'
    || !(artifact.startsWith('docs/preuves/') || artifact.startsWith('tests/integration/'))) return false;
  const file = locatedFile(root, artifact);
  if (!file) return false;
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch { return false; }
}

function isProof(root: string, value: unknown): value is CatalogProof {
  if (!value || typeof value !== 'object') return false;
  const proof = value as Partial<CatalogProof>;
  return (proof.kind === 'integration' || proof.kind === 'field')
    && (proof.result === 'passed' || proof.result === 'failed')
    && isRevision(proof.revision)
    && typeof proof.date === 'string' && /^\d{4}-\d\d-\d\dT/.test(proof.date)
    && !Number.isNaN(Date.parse(proof.date))
    && hasTrace(root, proof.artifact)
    && (proof.sourceDigest === undefined || (typeof proof.sourceDigest === 'string' && /^[0-9a-f]{64}$/i.test(proof.sourceDigest)))
    && typeof proof.summary === 'string' && proof.summary.length > 0;
}

function sourceDigest(root: string, feature: FeatureDefinition): string | null {
  const paths = [...new Set([
    'docs/catalog/inventory.json',
    ...(feature.codePaths ?? []),
    ...(feature.entrypoint?.checks.map((check) => check.file) ?? []),
  ])].sort();
  if (!feature.codePaths?.length || !feature.entrypoint?.checks.length) return null;
  const digest = createHash('sha256');
  for (const relative of paths) {
    const file = locatedFile(root, relative);
    if (!file) return null;
    digest.update(relative).update('\0').update(readFileSync(file)).update('\0');
  }
  return digest.digest('hex');
}

function proofsByFeature(root: string, inventory: Inventory, warnings: string[]): Map<string, CatalogProof[]> {
  const result = new Map<string, CatalogProof[]>();
  const add = (id: string, candidate: unknown, origin: string): void => {
    if (!isProof(root, candidate)) {
      warnings.push(`Preuve ignorée (${origin}) : schéma, date, révision ou trace invalide.`);
      return;
    }
    const list = result.get(id) ?? [];
    list.push(candidate);
    result.set(id, list);
  };
  for (const feature of inventory.features) {
    for (const candidate of feature.proofs ?? []) add(feature.id, candidate, `inventaire:${feature.id}`);
  }
  const directory = path.join(root, 'docs/preuves');
  if (existsSync(directory)) {
    for (const name of readdirSync(directory).filter((item) => item.endsWith('.json')).sort()) {
      try {
        const record = JSON.parse(readFileSync(path.join(directory, name), 'utf8')) as { schemaVersion?: number; featureId?: string };
        if (record.schemaVersion !== 1 || typeof record.featureId !== 'string') throw new Error('schema');
        add(record.featureId, record, `docs/preuves/${name}`);
      } catch {
        warnings.push(`Preuve ignorée (docs/preuves/${name}) : JSON ou schéma invalide.`);
      }
    }
  }
  for (const proofs of result.values()) proofs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return result;
}

function versionOrder(left: string, right: string): number | null {
  const parse = (value: string): number[] | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    return match ? match.slice(1).map(Number) : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  return 0;
}

export function buildCatalog(options: CatalogOptions): CatalogStatus {
  const root = path.resolve(options.root);
  const inventory = JSON.parse(readFileSync(path.join(root, 'docs/catalog/inventory.json'), 'utf8')) as Inventory;
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.features)) throw new Error('Inventaire du catalogue invalide.');
  const warnings: string[] = [];
  const proofs = proofsByFeature(root, inventory, warnings);
  const revision = isRevision(options.revision) ? options.revision : null;
  const installed = options.installed?.confirmed === true ? options.installed.version : null;
  const features = inventory.features.map((feature): CatalogFeature => {
    const reasons: string[] = [];
    const coded = codeState(root, feature.codePaths);
    const wired = wiringState(root, feature.entrypoint?.checks);
    const evidence = proofs.get(feature.id) ?? [];
    const latestEvidence = evidence[0] ?? null;
    const lastProof = evidence.find((item) => item.result === 'passed') ?? null;
    let testedInSituation: CatalogState = 'inconnu';
    const matchesSource = latestEvidence?.sourceDigest
      ? latestEvidence.sourceDigest === sourceDigest(root, feature)
      : !!(latestEvidence && revision && latestEvidence.revision === revision);
    if (latestEvidence && matchesSource) {
      testedInSituation = latestEvidence.result === 'passed' ? 'vrai' : 'faux';
    } else if (latestEvidence) reasons.push('Preuve ancienne ou révision courante inconnue.');
    let deployed: CatalogState = installed ? coded : 'inconnu';
    if (installed && feature.introducedIn) {
      const order = versionOrder(installed, feature.introducedIn);
      if (order !== null) deployed = order < 0 || coded === 'faux' ? 'faux' : coded;
      else deployed = 'inconnu';
    }
    if (!feature.codePaths?.length) reasons.push('Aucun chemin de code déclaré.');
    if (!feature.entrypoint?.checks.length) reasons.push('Aucun point d’entrée déclaré.');
    if (!latestEvidence) reasons.push('Aucune preuve d’exécution valide.');
    if (!installed) reasons.push('Version installée non confirmée.');
    return { id: feature.id, title: feature.title, entryKind: feature.entrypoint?.kind ?? null,
      states: { coded, wired, testedInSituation, deployed }, lastProof, latestEvidence, reasons };
  });
  const declared = new Set(inventory.features.flatMap((feature) => [feature.id, feature.discoveryKey ?? '']));
  for (const [kind, file] of [
    ['cli', 'src/index.ts'],
    ['tool', 'src/tools/metadata.ts'],
  ] as const) {
    for (const name of discoveredNames(root, file, kind)) {
      const id = `${kind}:${name}`;
      if (declared.has(id) || declared.has(name)) continue;
      const evidence = proofs.get(id) ?? [];
      const latestEvidence = evidence[0] ?? null;
      const lastProof = evidence.find((item) => item.result === 'passed') ?? null;
      const testedInSituation: CatalogState = latestEvidence && revision && latestEvidence.revision === revision
        ? latestEvidence.result === 'passed' ? 'vrai' : 'faux' : 'inconnu';
      features.push({
        id, title: `${kind === 'cli' ? 'Commande' : 'Outil'} ${name}`, entryKind: kind,
        states: { coded: 'inconnu', wired: kind === 'cli' ? 'vrai' : 'inconnu', testedInSituation,
          deployed: installed && kind === 'cli' ? 'vrai' : 'inconnu' },
        lastProof, latestEvidence,
        reasons: kind === 'cli'
          ? ['Entrée CLI détectée ; implémentation non suivie dans l’inventaire.']
          : ['Métadonnée d’outil détectée ; définition et exécuteur non vérifiés.'],
      });
    }
  }
  return { schemaVersion: 1, generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceRevision: revision, installedVersion: installed, features, warnings };
}

function escaped(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderCatalogMarkdown(catalog: CatalogStatus): string {
  const lines = [
    '# État des fonctionnalités', '',
    `Révision source : ${catalog.sourceRevision ?? 'inconnue'}  `,
    `Version installée confirmée : ${catalog.installedVersion ?? 'inconnue'}`, '',
    '| Fonctionnalité | CODÉE | RACCORDÉE | TESTÉE EN SITUATION | DÉPLOYÉE | Dernière preuve de fonctionnement |',
    '|---|---|---|---|---|---|',
  ];
  for (const feature of catalog.features) {
    const proof = feature.lastProof;
    const proofText = proof ? `${proof.date} · ${proof.revision} · ${proof.artifact}` : 'inconnue';
    lines.push(`| ${escaped(feature.title)} | ${feature.states.coded} | ${feature.states.wired} | ${feature.states.testedInSituation} | ${feature.states.deployed} | ${escaped(proofText)} |`);
  }
  if (catalog.warnings.length) lines.push('', '## Preuves ignorées', '', ...catalog.warnings.map((warning) => `- ${warning}`));
  return `${lines.join('\n')}\n`;
}
