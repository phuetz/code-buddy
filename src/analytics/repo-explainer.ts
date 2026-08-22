/**
 * Repository explainer
 *
 * Pure synthesis layer for `buddy explain`. Heavy and fallible collection is
 * deliberately kept outside this module: callers inject a file tree, profile,
 * analytics reports, documentation inventory, and an optional Code Explorer
 * graph. Given the same input this module always returns the same explanation.
 */

import path from 'node:path';

export type RepoExplainDepth = 'quick' | 'deep';

export interface RepoFileInput {
  path: string;
  sizeBytes?: number;
  lines?: number;
}

export interface RepoProfileInput {
  name?: string;
  description?: string;
  readmeExcerpt?: string;
  languages?: string[];
  framework?: string;
  frameworks?: string[];
  packageManager?: string;
  testFramework?: string;
  entryPoints?: string[];
  commands?: Record<string, string | undefined>;
  topDependencies?: string[];
}

export interface RepoArchitectureLayerInput {
  name: string;
  directory: string;
  fileCount: number;
}

export interface RepoCartographyInput {
  architecture?: {
    style?: string;
    layers?: RepoArchitectureLayerInput[];
    maxDepth?: number;
  };
  fileStats?: {
    largestFiles?: Array<{ path: string; lines: number }>;
    totalSourceFiles?: number;
    totalTestFiles?: number;
  };
  importGraph?: {
    hotModules?: Array<{ module: string; importedBy: number }>;
    circularRisks?: Array<{ a: string; b: string }>;
  };
  importEdges?: Array<[string, string]>;
}

export interface RepoComplexityFileInput {
  filePath: string;
  maxComplexity: number;
  averageComplexity?: number;
  totalLinesOfCode: number;
  maintainabilityIndex?: number;
}

export interface RepoComplexityHotspotInput {
  filePath: string;
  name?: string;
  cyclomaticComplexity: number;
  cognitiveComplexity?: number;
  linesOfCode?: number;
}

export interface RepoComplexityInput {
  files: RepoComplexityFileInput[];
  hotspots?: RepoComplexityHotspotInput[];
  summary?: {
    totalFiles?: number;
    totalFunctions?: number;
    averageComplexity?: number;
    maxComplexity?: number;
    overallRating?: string;
  };
}

export interface RepoHeatFileInput {
  filePath: string;
  commits: number;
  additions: number;
  deletions: number;
  churnScore: number;
  heatLevel?: string;
}

export interface RepoHeatmapInput {
  files: RepoHeatFileInput[];
}

export interface RepoEvolutionInput {
  dataPoints?: unknown[];
  summary?: {
    locChange?: number;
    locChangePercent?: number;
    fileChange?: number;
  };
  trends?: {
    locTrend?: 'growing' | 'shrinking' | 'stable';
    fileTrend?: 'growing' | 'shrinking' | 'stable';
    velocity?: number;
  };
}

export interface RepoDocumentationInput {
  modules: Array<{
    path: string;
    description?: string;
    entries: Array<{ name: string; kind: string; description?: string }>;
  }>;
  totalEntries?: number;
}

export interface RepoCodeExplorerInput {
  indexed: boolean;
  stale?: boolean;
  commitsBehind?: number;
  symbols?: number;
  relations?: number;
  processes?: number;
  clusters?: number;
  mermaid?: string;
  target?: string;
}

export interface RepoExplanationInput {
  rootPath?: string;
  rootName: string;
  depth: RepoExplainDepth;
  generatedAt: string;
  files: RepoFileInput[];
  profile?: RepoProfileInput;
  cartography?: RepoCartographyInput;
  complexity?: RepoComplexityInput;
  heatmap?: RepoHeatmapInput;
  evolution?: RepoEvolutionInput;
  documentation?: RepoDocumentationInput;
  codeExplorer?: RepoCodeExplorerInput;
  git?: { available: boolean };
  notices?: string[];
}

export interface RepoLanguageSummary {
  name: string;
  files: number;
  percent: number;
}

export interface RepoEntryPoint {
  path: string;
  reason: string;
  exportedSymbols: string[];
}

export interface RepoModuleSummary {
  name: string;
  directory: string;
  fileCount: number;
  purpose: string;
}

export interface RepoDependencyDiagram {
  mermaid: string;
  source: 'code-explorer' | 'file-analysis';
  note: string;
}

export type RepoRiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface RepoHotspot {
  path: string;
  score: number;
  level: RepoRiskLevel;
  maxComplexity?: number;
  lines?: number;
  sizeBytes?: number;
  churn?: number;
  commits?: number;
  reasons: string[];
}

export interface RepoExplanation {
  repo: {
    name: string;
    purpose: string;
    depth: RepoExplainDepth;
    generatedAt: string;
    totalFiles: number;
    sourceFiles: number;
    testFiles: number;
  };
  overview: {
    languages: RepoLanguageSummary[];
    frameworks: string[];
    packageManager?: string;
    testFramework?: string;
    dependencies: string[];
    entryPoints: RepoEntryPoint[];
  };
  architecture: {
    style: string;
    modules: RepoModuleSummary[];
    diagram: RepoDependencyDiagram;
    centralModules: Array<{ path: string; importedBy: number }>;
  };
  risks: {
    hotspots: RepoHotspot[];
    complexity?: RepoComplexityInput['summary'];
    evolution?: RepoEvolutionInput;
    gitAvailable: boolean;
  };
  gettingStarted: {
    path: string[];
    docs: string[];
    tests: string[];
    commands: Record<string, string>;
  };
  limitations: string[];
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.c': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.css': 'CSS',
  '.dart': 'Dart',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.go': 'Go',
  '.h': 'C/C++',
  '.hpp': 'C++',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.php': 'PHP',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.rs': 'Rust',
  '.scala': 'Scala',
  '.sh': 'Shell',
  '.sol': 'Solidity',
  '.svelte': 'Svelte',
  '.swift': 'Swift',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.vue': 'Vue',
};

const SOURCE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION));
const TEST_PATH_RE =
  /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^/]+$|_test\.[^/]+$/i;
const DOC_PATH_RE =
  /(?:^|\/)(?:readme|contributing|architecture|getting-started|quickstart|claude|agents|codebuddy)(?:\.[^/]*)?$|^(?:docs?|documentation)\//i;
const ORIENTATION_NOISE_RE =
  /(?:^|\/)(?:__fixtures__|__mocks__|__snapshots__|demos?|examples?|fixtures?|mocks?|scratch|test-data)(?:\/|$)/i;
const READABLE_DOC_EXTENSIONS = new Set(['.adoc', '.md', '.mdx', '.rst', '.text', '.txt']);

const MODULE_PURPOSES: Record<string, string> = {
  agent: 'Boucle agent et orchestration',
  agents: 'Agents spécialisés',
  analytics: 'Mesures et analyse du code',
  api: 'API et contrats réseau',
  app: 'Application principale',
  cli: 'Interface en ligne de commande',
  commands: 'Commandes et parcours utilisateur',
  components: 'Composants d’interface',
  config: 'Configuration et capacités',
  context: 'Contexte et compression',
  controllers: 'Contrôleurs applicatifs',
  database: 'Persistance et accès aux données',
  db: 'Persistance et accès aux données',
  docs: 'Documentation',
  export: 'Production d’artefacts',
  fleet: 'Coordination multi-agent',
  integrations: 'Intégrations externes',
  knowledge: 'Graphe et connaissance du code',
  memory: 'Mémoire persistante',
  middleware: 'Pipeline de middlewares',
  models: 'Modèles de données',
  plugins: 'Extensions et plugins',
  providers: 'Adaptateurs de fournisseurs',
  routes: 'Routes et endpoints',
  security: 'Sécurité et permissions',
  server: 'Serveur et transports',
  services: 'Services métier',
  tests: 'Tests automatisés',
  tools: 'Outils exécutables',
  ui: 'Interface utilisateur',
  utils: 'Utilitaires partagés',
  workflows: 'Workflows et orchestration',
};

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeRepoPath(filePath: string, rootPath?: string): string {
  if (!filePath) return filePath;
  if (rootPath && path.isAbsolute(filePath)) {
    const relative = path.relative(rootPath, filePath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return normalizeSlashes(relative);
    }
  }
  return normalizeSlashes(filePath);
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isTestFile(filePath: string): boolean {
  return TEST_PATH_RE.test(normalizeSlashes(filePath));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function cleanPurposeText(value: string): string {
  const paragraphs = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((paragraph) => paragraph.length >= 24 && !/^build|^status|^license$/i.test(paragraph));
  const purpose = paragraphs[0] ?? value.replace(/\s+/g, ' ').trim();
  return purpose.length > 420 ? `${purpose.slice(0, 417).trimEnd()}…` : purpose;
}

function inferPurpose(input: RepoExplanationInput, languages: RepoLanguageSummary[]): string {
  const explicit = input.profile?.description?.trim() || input.profile?.readmeExcerpt?.trim();
  if (explicit) return cleanPurposeText(explicit);

  const languageText = languages
    .slice(0, 3)
    .map((language) => language.name)
    .join(', ');
  if (input.files.length === 0) {
    return 'Dépôt minimal ou vide : aucun fichier exploitable n’a été détecté, mais les points de départ disponibles sont listés ci-dessous.';
  }
  if (languageText) {
    return `Projet principalement écrit en ${languageText}. Aucun résumé produit explicite n’a été trouvé dans les métadonnées ou la documentation racine.`;
  }
  return 'Dépôt de projet sans langage principal détecté. Consultez les fichiers de documentation et de configuration listés ci-dessous pour préciser son rôle.';
}

function summarizeLanguages(input: RepoExplanationInput): RepoLanguageSummary[] {
  const counts = new Map<string, number>();
  for (const file of input.files) {
    const language = LANGUAGE_BY_EXTENSION[path.extname(file.path).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  for (const language of input.profile?.languages ?? []) {
    const normalized = language.replace(/ \(React\)$/i, '').trim();
    if (normalized && !counts.has(normalized)) counts.set(normalized, 0);
  }

  const measuredTotal = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()]
    .map(([name, files]) => ({
      name,
      files,
      percent: measuredTotal > 0 ? Math.round((files / measuredTotal) * 100) : 0,
    }))
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name));
}

function inferFrameworks(profile?: RepoProfileInput): string[] {
  const frameworks = [profile?.framework, ...(profile?.frameworks ?? [])].filter(
    (value): value is string => Boolean(value?.trim())
  );
  const dependencies = new Set(profile?.topDependencies ?? []);
  const inferred: Array<[string, string[]]> = [
    ['Next.js', ['next']],
    ['Nuxt', ['nuxt']],
    ['Angular', ['@angular/core']],
    ['Svelte', ['svelte', '@sveltejs/kit']],
    ['Vue', ['vue']],
    ['Ink', ['ink']],
    ['React', ['react', 'react-dom']],
    ['Fastify', ['fastify']],
    ['Express', ['express']],
    ['Electron', ['electron']],
    ['Tauri', ['@tauri-apps/api']],
  ];
  for (const [name, packages] of inferred) {
    if (packages.some((packageName) => dependencies.has(packageName))) frameworks.push(name);
  }
  const seen = new Set<string>();
  return frameworks
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.replace(/\s*\([^)]*\)\s*$/, '').toLocaleLowerCase('en-US');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function entryPointScore(filePath: string): number {
  const normalized = normalizeSlashes(filePath).toLowerCase();
  if (isTestFile(normalized) || ORIENTATION_NOISE_RE.test(normalized)) return -1;
  const depthPenalty = Math.max(0, normalized.split('/').length - 2) * 3;
  if (/^(?:src|lib|app)\/(?:index|main)\.[^/]+$/.test(normalized)) return 120;
  if (/^(?:index|main|app|server|cli)\.[^/]+$/.test(normalized)) return 110;
  if (/^cmd\/[^/]+\/main\.go$/.test(normalized)) return 108;
  if (/^(?:src\/)?main\.rs$/.test(normalized)) return 108;
  if (/(?:^|\/)program\.cs$/.test(normalized)) return 106;
  if (/(?:^|\/)(?:manage|wsgi|asgi|__main__)\.py$/.test(normalized)) return 104;
  if (/(?:^|\/)(?:index|main|app|server|cli)\.(?:ts|tsx|js|jsx|py|go|rs|java|cs)$/.test(normalized))
    return Math.max(1, 90 - depthPenalty);
  if (/(?:^|\/)bin\/[^/]+$/.test(normalized)) return Math.max(1, 80 - depthPenalty);
  return 0;
}

function sourceEquivalent(entryPoint: string, files: Set<string>): string | undefined {
  const normalized = normalizeSlashes(entryPoint);
  if (files.has(normalized)) return normalized;
  const withoutDist = normalized.replace(/^(?:dist|build|out)\//, 'src/');
  const stem = withoutDist.replace(/\.(?:mjs|cjs|js)$/, '');
  for (const extension of ['.ts', '.tsx', '.js', '.jsx']) {
    if (files.has(`${stem}${extension}`)) return `${stem}${extension}`;
  }
  return undefined;
}

function findEntryPoints(input: RepoExplanationInput): RepoEntryPoint[] {
  const normalizedFiles = new Set(input.files.map((file) => normalizeSlashes(file.path)));
  const candidates = new Map<string, { score: number; reason: string }>();

  for (const declared of input.profile?.entryPoints ?? []) {
    const resolved = sourceEquivalent(declared, normalizedFiles) ?? normalizeSlashes(declared);
    candidates.set(resolved, { score: 150, reason: 'déclaré par le manifeste du projet' });
  }

  for (const file of normalizedFiles) {
    const score = entryPointScore(file);
    if (score <= 0) continue;
    const current = candidates.get(file);
    if (!current || score > current.score) {
      candidates.set(file, { score, reason: 'nom et emplacement conventionnels d’entrée' });
    }
  }

  const docsByPath = new Map(
    (input.documentation?.modules ?? []).map((module) => [normalizeSlashes(module.path), module])
  );
  return [...candidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, input.depth === 'deep' ? 8 : 6)
    .map(([entryPath, value]) => ({
      path: entryPath,
      reason: value.reason,
      exportedSymbols: (docsByPath.get(entryPath)?.entries ?? [])
        .slice(0, 6)
        .map((entry) => entry.name),
    }));
}

function moduleDirectory(filePath: string): string {
  const segments = normalizeSlashes(filePath).split('/').filter(Boolean);
  if (segments.length <= 1) return '.';
  if (segments[0] === 'packages' || segments[0] === 'apps' || segments[0] === 'crates') {
    return segments.slice(0, 2).join('/');
  }
  if (
    ['src', 'lib', 'app', 'server', 'client'].includes(segments[0] ?? '') &&
    segments.length >= 3
  ) {
    return segments.slice(0, 2).join('/');
  }
  return segments[0] ?? '.';
}

function modulePurpose(directory: string, explicitName?: string): string {
  const key = directory.split('/').pop()?.toLowerCase() ?? directory;
  return (
    MODULE_PURPOSES[key] ??
    (explicitName && explicitName !== key ? explicitName : 'Module fonctionnel du projet')
  );
}

function summarizeModules(input: RepoExplanationInput): RepoModuleSummary[] {
  const layers = input.cartography?.architecture?.layers ?? [];
  if (layers.length > 0) {
    return layers
      .map((layer) => ({
        name: layer.name,
        directory: normalizeSlashes(layer.directory),
        fileCount: layer.fileCount,
        purpose: modulePurpose(layer.directory, layer.name),
      }))
      .sort(
        (left, right) =>
          right.fileCount - left.fileCount || left.directory.localeCompare(right.directory)
      )
      .slice(0, input.depth === 'deep' ? 14 : 9);
  }

  const counts = new Map<string, number>();
  for (const file of input.files) {
    if (!isSourceFile(file.path) || isTestFile(file.path)) continue;
    const directory = moduleDirectory(file.path);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([directory, fileCount]) => ({
      name: directory === '.' ? input.rootName : (directory.split('/').pop() ?? directory),
      directory,
      fileCount,
      purpose: modulePurpose(directory),
    }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount || left.directory.localeCompare(right.directory)
    )
    .slice(0, input.depth === 'deep' ? 14 : 9);
}

function unwrapMermaid(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const fenced = /```(?:mermaid)?\s*([\s\S]*?)```/i.exec(value);
  const candidate = (fenced?.[1] ?? value).trim();
  // Code Explorer data comes from the inspected repository. Refuse Mermaid
  // directives that could make the local renderer load a URL or loosen its
  // security level; the structural diagram remains available as a fallback.
  if (
    /(?:https?|file|data|javascript):|%%\{|\burl\s*\(|<\s*[!/A-Za-z]|^\s*click\b/im.test(candidate)
  ) {
    return undefined;
  }
  return /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\b/m.test(
    candidate
  )
    ? candidate
    : undefined;
}

function buildDependencyDiagram(
  input: RepoExplanationInput,
  modules: RepoModuleSummary[]
): RepoDependencyDiagram {
  const codeExplorerMermaid = unwrapMermaid(input.codeExplorer?.mermaid);
  if (codeExplorerMermaid) {
    const target = input.codeExplorer?.target ? ` autour de ${input.codeExplorer.target}` : '';
    return {
      mermaid: codeExplorerMermaid,
      source: 'code-explorer',
      note: `Graphe Code Explorer${target}${input.codeExplorer?.stale ? ' (index potentiellement en retard)' : ''}.`,
    };
  }

  const edgeCounts = new Map<string, number>();
  const moduleSet = new Set(modules.map((module) => module.directory));
  for (const [rawFrom, rawTo] of input.cartography?.importEdges ?? []) {
    const from = moduleDirectory(rawFrom);
    const to = moduleDirectory(rawTo);
    if (from === to) continue;
    moduleSet.add(from);
    moduleSet.add(to);
    const key = `${from}\u0000${to}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const selectedModules = [...moduleSet]
    .map((directory) => ({
      directory,
      weight:
        (modules.find((module) => module.directory === directory)?.fileCount ?? 0) +
        [...edgeCounts.entries()].reduce(
          (sum, [edge, count]) => sum + (edge.split('\u0000').includes(directory) ? count : 0),
          0
        ),
    }))
    .sort(
      (left, right) => right.weight - left.weight || left.directory.localeCompare(right.directory)
    )
    .slice(0, input.depth === 'deep' ? 14 : 10);
  const selected = new Set(selectedModules.map((module) => module.directory));
  const ids = new Map(selectedModules.map((module, index) => [module.directory, `M${index}`]));
  const label = (value: string): string =>
    value
      .replace(/[\r\n<>`]/g, ' ')
      .replaceAll('"', "'")
      .replaceAll('[', "'")
      .replaceAll(']', "'")
      .trim();
  const lines = ['flowchart LR'];
  for (const module of selectedModules) {
    lines.push(`  ${ids.get(module.directory)}["${label(module.directory)}"]`);
  }

  const selectedEdges = [...edgeCounts.entries()]
    .map(([key, count]) => {
      const [from = '', to = ''] = key.split('\u0000');
      return { from, to, count };
    })
    .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
    .sort((left, right) => right.count - left.count || left.from.localeCompare(right.from))
    .slice(0, input.depth === 'deep' ? 24 : 14);
  for (const edge of selectedEdges) {
    lines.push(`  ${ids.get(edge.from)} -->|${edge.count}| ${ids.get(edge.to)}`);
  }

  if (selectedModules.length === 0) {
    lines.push(`  ROOT["${label(input.rootName)}"]`);
  } else if (selectedEdges.length === 0) {
    lines.push(`  ROOT["${label(input.rootName)}"]`);
    for (const module of selectedModules) lines.push(`  ROOT --> ${ids.get(module.directory)}`);
  }

  return {
    mermaid: lines.join('\n'),
    source: 'file-analysis',
    note:
      selectedEdges.length > 0
        ? 'Dépendances agrégées à partir des imports détectés dans les fichiers.'
        : 'Repli structurel : aucun graphe d’import exploitable, les modules clés sont reliés au dépôt.',
  };
}

interface MutableHotspot {
  path: string;
  maxComplexity?: number;
  lines?: number;
  sizeBytes?: number;
  churn?: number;
  commits?: number;
  circular?: boolean;
}

function buildHotspots(input: RepoExplanationInput): RepoHotspot[] {
  const candidates = new Map<string, MutableHotspot>();
  const get = (filePath: string): MutableHotspot => {
    const normalized = normalizeRepoPath(filePath, input.rootPath);
    let candidate = candidates.get(normalized);
    if (!candidate) {
      candidate = { path: normalized };
      candidates.set(normalized, candidate);
    }
    return candidate;
  };

  for (const file of input.files) {
    if (!isSourceFile(file.path) || isTestFile(file.path)) continue;
    const candidate = get(file.path);
    candidate.sizeBytes = file.sizeBytes;
    candidate.lines = file.lines;
  }
  for (const file of input.cartography?.fileStats?.largestFiles ?? []) {
    get(file.path).lines = file.lines;
  }
  for (const file of input.complexity?.files ?? []) {
    const candidate = get(file.filePath);
    candidate.maxComplexity = Math.max(candidate.maxComplexity ?? 0, file.maxComplexity);
    candidate.lines = Math.max(candidate.lines ?? 0, file.totalLinesOfCode);
  }
  for (const hotspot of input.complexity?.hotspots ?? []) {
    const candidate = get(hotspot.filePath);
    candidate.maxComplexity = Math.max(candidate.maxComplexity ?? 0, hotspot.cyclomaticComplexity);
  }
  for (const file of input.heatmap?.files ?? []) {
    if (!isSourceFile(file.filePath) || isTestFile(file.filePath)) continue;
    const candidate = get(file.filePath);
    candidate.churn = file.churnScore;
    candidate.commits = file.commits;
  }

  for (const risk of input.cartography?.importGraph?.circularRisks ?? []) {
    const normalizedA = normalizeSlashes(risk.a);
    const normalizedB = normalizeSlashes(risk.b);
    for (const candidate of candidates.values()) {
      const stem = candidate.path.replace(/\.[^.]+$/, '');
      if (
        stem === normalizedA ||
        stem === normalizedB ||
        normalizedA.endsWith(stem) ||
        normalizedB.endsWith(stem)
      ) {
        candidate.circular = true;
      }
    }
  }

  const values = [...candidates.values()];
  const maxChurn = Math.max(...values.map((item) => item.churn ?? 0), 1);
  const maxCommits = Math.max(...values.map((item) => item.commits ?? 0), 1);

  return values
    .map((item): RepoHotspot => {
      const complexityRisk = clamp((item.maxComplexity ?? 0) / 25);
      const locRisk = Math.max(
        clamp((item.lines ?? 0) / 1_500),
        clamp((item.sizeBytes ?? 0) / 250_000)
      );
      const churnRisk = clamp((item.churn ?? 0) / maxChurn) * clamp((item.churn ?? 0) / 500);
      const commitRisk = clamp((item.commits ?? 0) / maxCommits) * clamp((item.commits ?? 0) / 20);
      const circularRisk = item.circular ? 0.15 : 0;
      const score = Math.round(
        clamp(
          complexityRisk * 0.4 + locRisk * 0.22 + churnRisk * 0.28 + commitRisk * 0.1 + circularRisk
        ) * 100
      );
      const reasons: string[] = [];
      if ((item.maxComplexity ?? 0) > 10)
        reasons.push(`complexité cyclomatique max ${item.maxComplexity}`);
      if ((item.lines ?? 0) >= 300) reasons.push(`${item.lines?.toLocaleString('fr-FR')} lignes`);
      else if ((item.sizeBytes ?? 0) >= 50_000)
        reasons.push(`${Math.round((item.sizeBytes ?? 0) / 1_024)} Kio`);
      if ((item.churn ?? 0) > 0) {
        reasons.push(
          `churn ${item.churn?.toLocaleString('fr-FR')} lignes sur ${item.commits ?? 0} commit(s)`
        );
      }
      if (item.circular) reasons.push('cycle d’import potentiel');
      const level: RepoRiskLevel =
        score >= 70 ? 'critical' : score >= 48 ? 'high' : score >= 25 ? 'medium' : 'low';
      return {
        path: item.path,
        score,
        level,
        ...(item.maxComplexity !== undefined ? { maxComplexity: item.maxComplexity } : {}),
        ...(item.lines !== undefined ? { lines: item.lines } : {}),
        ...(item.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
        ...(item.churn !== undefined ? { churn: item.churn } : {}),
        ...(item.commits !== undefined ? { commits: item.commits } : {}),
        reasons,
      };
    })
    .filter((hotspot) => hotspot.score >= 15 || hotspot.reasons.length > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, input.depth === 'deep' ? 15 : 8);
}

function docsScore(filePath: string): number {
  const normalized = normalizeSlashes(filePath).toLowerCase();
  if (/^readme(?:\.|$)/.test(normalized)) return 100;
  if (/^(?:getting-started|quickstart|architecture|contributing)(?:\.|$)/.test(normalized))
    return 95;
  if (/^docs?\/(?:getting-started|quickstart|architecture|index|readme)/.test(normalized))
    return 90;
  if (/^(?:claude|agents|codebuddy)\.md$/.test(normalized)) return 80;
  return normalized.startsWith('docs/') ? 60 : 40;
}

function isReadableDoc(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return (
    READABLE_DOC_EXTENSIONS.has(extension) ||
    (extension === '' &&
      /^(?:agents|architecture|claude|codebuddy|contributing|readme)$/i.test(
        path.basename(filePath)
      ))
  );
}

function testScore(filePath: string): number {
  const normalized = normalizeSlashes(filePath).toLowerCase();
  if (ORIENTATION_NOISE_RE.test(normalized)) return 0;
  const depthPenalty = Math.max(0, normalized.split('/').length - 2);
  if (/^tests?\//.test(normalized)) return 100 - depthPenalty;
  if (/(?:^|\/)unit(?:\/|$)/.test(normalized)) return 85 - depthPenalty;
  if (/(?:^|\/)e2e(?:\/|$)/.test(normalized)) return 45 - depthPenalty;
  return 65 - depthPenalty;
}

function buildGettingStarted(
  input: RepoExplanationInput,
  entryPoints: RepoEntryPoint[],
  modules: RepoModuleSummary[]
): RepoExplanation['gettingStarted'] {
  const docs = input.files
    .map((file) => normalizeSlashes(file.path))
    .filter((filePath) => DOC_PATH_RE.test(filePath) && isReadableDoc(filePath))
    .sort((left, right) => docsScore(right) - docsScore(left) || left.localeCompare(right))
    .slice(0, input.depth === 'deep' ? 12 : 7);
  const tests = input.files
    .map((file) => normalizeSlashes(file.path))
    .filter((filePath) => isTestFile(filePath) && testScore(filePath) > 0)
    .sort((left, right) => testScore(right) - testScore(left) || left.localeCompare(right))
    .slice(0, input.depth === 'deep' ? 12 : 7);
  const commands = Object.fromEntries(
    Object.entries(input.profile?.commands ?? {}).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0
    )
  );
  const onboardingPath = unique(
    [
      docs[0],
      ...entryPoints.slice(0, input.depth === 'deep' ? 3 : 1).map((entry) => entry.path),
      ...modules.slice(0, 3).map((module) => module.directory),
      tests[0],
    ].filter((value): value is string => Boolean(value))
  );
  return { path: onboardingPath, docs, tests, commands };
}

function buildLimitations(input: RepoExplanationInput): string[] {
  const limitations = [...(input.notices ?? [])];
  if (input.git?.available === false) {
    limitations.push('Historique Git indisponible : le churn et l’évolution ne sont pas classés.');
  } else if ((input.heatmap?.files.length ?? 0) === 0) {
    limitations.push('Aucun churn récent exploitable dans la fenêtre analysée.');
  }
  if (!input.complexity || input.complexity.files.length === 0) {
    limitations.push(
      'Aucune métrique de complexité exploitable; les risques reposent sur la taille et la structure.'
    );
  }
  if (!input.codeExplorer?.indexed) {
    limitations.push(
      'Code Explorer non indexé : diagramme construit depuis les imports/fichiers disponibles.'
    );
  } else if (!unwrapMermaid(input.codeExplorer.mermaid)) {
    limitations.push(
      input.codeExplorer.mermaid
        ? 'Diagramme Code Explorer non exploitable ou non sûr pour un rendu local; repli sur les imports.'
        : 'Index Code Explorer détecté, mais aucun diagramme ciblé n’a pu être extrait; repli sur les imports.'
    );
  }
  if (input.codeExplorer?.stale) {
    const lag = input.codeExplorer.commitsBehind;
    limitations.push(
      `Index Code Explorer en retard${lag !== undefined ? ` de ${lag} commit(s)` : ''}.`
    );
  }
  if (input.files.length === 0) {
    limitations.push(
      'Arbre de fichiers vide ou illisible : le résultat est une orientation minimale.'
    );
  }
  return unique(limitations.map((item) => item.trim()).filter(Boolean));
}

/** Build a complete, render-agnostic repository explanation. */
export function explainRepository(input: RepoExplanationInput): RepoExplanation {
  const files = input.files.map((file) => ({
    ...file,
    path: normalizeRepoPath(file.path, input.rootPath),
  }));
  const normalizedInput = { ...input, files };
  const languages = summarizeLanguages(normalizedInput);
  const entryPoints = findEntryPoints(normalizedInput);
  const modules = summarizeModules(normalizedInput);
  const testFiles = files.filter((file) => isTestFile(file.path)).length;
  const sourceFiles = files.filter(
    (file) => isSourceFile(file.path) && !isTestFile(file.path)
  ).length;
  const name = input.profile?.name?.trim() || input.rootName || 'repo';

  return {
    repo: {
      name,
      purpose: inferPurpose(normalizedInput, languages),
      depth: input.depth,
      generatedAt: input.generatedAt,
      totalFiles: files.length,
      sourceFiles,
      testFiles,
    },
    overview: {
      languages,
      frameworks: inferFrameworks(input.profile),
      ...(input.profile?.packageManager ? { packageManager: input.profile.packageManager } : {}),
      ...(input.profile?.testFramework ? { testFramework: input.profile.testFramework } : {}),
      dependencies: unique(input.profile?.topDependencies ?? []).slice(0, 12),
      entryPoints,
    },
    architecture: {
      style:
        input.cartography?.architecture?.style || (modules.length > 3 ? 'modulaire' : 'simple'),
      modules,
      diagram: buildDependencyDiagram(normalizedInput, modules),
      centralModules: (input.cartography?.importGraph?.hotModules ?? [])
        .map((module) => ({ path: normalizeSlashes(module.module), importedBy: module.importedBy }))
        .slice(0, input.depth === 'deep' ? 12 : 7),
    },
    risks: {
      hotspots: buildHotspots(normalizedInput),
      ...(input.complexity?.summary ? { complexity: input.complexity.summary } : {}),
      ...(input.evolution && (input.evolution.dataPoints?.length ?? 0) > 0
        ? { evolution: input.evolution }
        : {}),
      gitAvailable: input.git?.available === true,
    },
    gettingStarted: buildGettingStarted(normalizedInput, entryPoints, modules),
    limitations: buildLimitations(normalizedInput),
  };
}
