/** Read-only, best-effort collection for `buddy explain`. */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { RepoProfiler, type RepoProfile } from '../agent/repo-profiler.js';
import { CodeExplorerManager } from '../plugins/code-explorer/CodeExplorerManager.js';
import { generateDocs, type GeneratedDocs } from '../tools/doc-generator.js';
import { logger } from '../utils/logger.js';
import { generateEvolutionReport, type EvolutionReport } from './code-evolution.js';
import { generateHeatmap, type HeatmapData } from './codebase-heatmap.js';
import { analyzeComplexity, type ComplexityReport } from './complexity-analyzer.js';
import type {
  RepoCodeExplorerInput,
  RepoExplainDepth,
  RepoExplanationInput,
  RepoFileInput,
} from './repo-explainer.js';

const TREE_IGNORES = [
  '**/.git/**',
  '**/.codebuddy/**',
  '**/.codeexplorer/**',
  '**/.gitnexus/**',
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/target/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
];

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const EVOLUTION_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cpp',
  '.c',
  '.h',
]);
const TEST_RE = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^/]+$|_test\.[^/]+$/i;

export interface RepoExplanationCollectorOptions {
  rootPath: string;
  depth: RepoExplainDepth;
  generatedAt: Date;
}

async function bestEffort<T>(
  stage: string,
  fallback: T,
  notices: string[],
  operation: () => Promise<T> | T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger.debug(`[repo-explainer] ${stage} unavailable`, {
      error: error instanceof Error ? error.message : String(error),
    });
    notices.push(`${stage} indisponible; le reste de l’analyse a continué.`);
    return fallback;
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function collectFileTree(
  rootPath: string,
  depth: RepoExplainDepth,
  notices: string[]
): Promise<RepoFileInput[]> {
  const entries = await fg('**/*', {
    cwd: rootPath,
    absolute: false,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    objectMode: true,
    stats: true,
    suppressErrors: true,
    deep: depth === 'quick' ? 8 : 20,
    ignore: TREE_IGNORES,
  });
  const limit = depth === 'quick' ? 8_000 : 30_000;
  const sorted = entries
    .map((entry) => ({
      path: normalizePath(entry.path),
      sizeBytes: entry.stats?.size ?? 0,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (sorted.length > limit) {
    notices.push(
      `Arbre borné à ${limit.toLocaleString('fr-FR')} fichiers sur ${sorted.length.toLocaleString('fr-FR')}.`
    );
  }
  return sorted.slice(0, limit);
}

async function readPrefix(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readReadmeExcerpt(
  rootPath: string,
  files: RepoFileInput[]
): Promise<string | undefined> {
  const readme = files.find((file) => /^readme(?:\.[^/]*)?$/i.test(file.path));
  if (!readme) return undefined;
  const content = await readPrefix(path.join(rootPath, readme.path), 48 * 1024);
  return content.trim() || undefined;
}

function isGitRepository(rootPath: string): boolean {
  try {
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: rootPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
    return realpathSync(topLevel) === realpathSync(rootPath);
  } catch {
    return false;
  }
}

function analysisPriority(file: RepoFileInput): number {
  const normalized = file.path.toLowerCase();
  let priority = Math.min(file.sizeBytes ?? 0, 2_000_000);
  if (/(?:^|\/)(?:index|main|app|server|cli)\.(?:ts|tsx|js|jsx)$/.test(normalized)) {
    priority += 5_000_000;
  }
  if (normalized.includes('/agent/') || normalized.includes('/core/')) priority += 1_000_000;
  return priority;
}

function selectJsTsFiles(files: RepoFileInput[], maxFiles: number): RepoFileInput[] {
  return files
    .filter(
      (file) =>
        JS_TS_EXTENSIONS.has(path.extname(file.path).toLowerCase()) &&
        !TEST_RE.test(file.path) &&
        (file.sizeBytes ?? 0) <= 2 * 1024 * 1024
    )
    .sort(
      (left, right) =>
        analysisPriority(right) - analysisPriority(left) || left.path.localeCompare(right.path)
    )
    .slice(0, maxFiles);
}

function exactGlobPatterns(files: RepoFileInput[]): string[] {
  return files.map((file) => fg.escapePath(file.path));
}

function mergeKnownLineCounts(files: RepoFileInput[], profile?: RepoProfile): RepoFileInput[] {
  const counts = new Map(
    (profile?.cartography?.fileStats.largestFiles ?? []).map((file) => [
      normalizePath(file.path),
      file.lines,
    ])
  );
  return files.map((file) => {
    const lines = counts.get(file.path);
    return lines === undefined ? file : { ...file, lines };
  });
}

function codeExplorerCandidates(profile?: RepoProfile, docs?: GeneratedDocs): string[] {
  const components = profile?.cartography?.components;
  const candidates = [
    ...(components?.facades.map((entry) => entry.name) ?? []),
    ...(components?.agents.map((entry) => entry.name) ?? []),
    ...(components?.keyExports.flatMap((entry) => entry.exports) ?? []),
    ...(docs?.modules.flatMap((module) => module.entries.map((entry) => entry.name)) ?? []),
  ];
  return [...new Set(candidates.filter((candidate) => /^[A-Za-z_$][\w$]*$/.test(candidate)))]
    .filter((candidate) => !/^(?:index|main|default|config|options|result)$/i.test(candidate))
    .slice(0, 3);
}

function safeFreshnessGit(args: string, cwd: string): string {
  const match = /^rev-list --count ([0-9a-fA-F]+)\.\.HEAD$/.exec(args);
  const commit = match?.[1];
  if (!commit) throw new Error('Unsafe Code Explorer commit range');
  return execFileSync('git', ['rev-list', '--count', `${commit}..HEAD`], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
  }).trim();
}

function collectCodeExplorer(
  rootPath: string,
  profile?: RepoProfile,
  docs?: GeneratedDocs
): RepoCodeExplorerInput {
  const manager = new CodeExplorerManager(rootPath);
  try {
    const stats = manager.getStats();
    if (!stats.indexed) return { indexed: false };
    const freshness = manager.getFreshness(safeFreshnessGit, { autoIndex: false });
    let mermaid = '';
    let target: string | undefined;
    for (const candidate of codeExplorerCandidates(profile, docs)) {
      mermaid = manager.generateDiagram(candidate);
      if (mermaid) {
        target = candidate;
        break;
      }
    }
    return {
      indexed: true,
      stale: freshness.stale || stats.stale,
      ...(freshness.commitsBehind !== undefined ? { commitsBehind: freshness.commitsBehind } : {}),
      symbols: stats.symbols,
      relations: stats.relations,
      processes: stats.processes,
      clusters: stats.clusters,
      ...(mermaid ? { mermaid } : {}),
      ...(target ? { target } : {}),
    };
  } finally {
    manager.dispose();
  }
}

function emptyComplexity(): ComplexityReport {
  return {
    files: [],
    summary: {
      totalFiles: 0,
      totalFunctions: 0,
      averageComplexity: 0,
      maxComplexity: 0,
      totalLinesOfCode: 0,
      complexFunctions: 0,
      veryComplexFunctions: 0,
      overallRating: 'A',
    },
    hotspots: [],
    recommendations: [],
    generatedAt: new Date(0),
  };
}

function emptyHeatmap(): HeatmapData {
  return {
    files: [],
    summary: {
      totalFiles: 0,
      totalCommits: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      hotspots: [],
      coldspots: [],
      topAuthors: [],
    },
    generatedAt: new Date(0),
  };
}

function emptyEvolution(): EvolutionReport {
  const date = new Date(0);
  return {
    dataPoints: [],
    summary: {
      startDate: date,
      endDate: date,
      startLoc: 0,
      endLoc: 0,
      locChange: 0,
      locChangePercent: 0,
      startFiles: 0,
      endFiles: 0,
      fileChange: 0,
      avgCommitsPerDay: 0,
    },
    trends: { locTrend: 'stable', fileTrend: 'stable', velocity: 0 },
    generatedAt: date,
  };
}

function emptyDocs(): GeneratedDocs {
  return { modules: [], totalEntries: 0, generatedAt: new Date(0) };
}

/**
 * Collect every source independently. Failures are converted to notices, so a
 * readable artifact can still be produced for an empty directory, a non-Git
 * project, malformed manifests, or an unavailable Code Explorer binary.
 */
export async function collectRepoExplanationInput(
  options: RepoExplanationCollectorOptions
): Promise<RepoExplanationInput> {
  const rootPath = path.resolve(options.rootPath);
  const notices: string[] = [];
  let files = await bestEffort('Arbre de fichiers', [], notices, () =>
    collectFileTree(rootPath, options.depth, notices)
  );
  const profile = await bestEffort<RepoProfile | undefined>(
    'Profil du dépôt',
    undefined,
    notices,
    () => new RepoProfiler(rootPath).inspect()
  );
  files = mergeKnownLineCounts(files, profile);
  const readmeExcerpt = await bestEffort<string | undefined>(
    'Lecture du README',
    undefined,
    notices,
    () => readReadmeExcerpt(rootPath, files)
  );

  const jsTsFiles = selectJsTsFiles(files, options.depth === 'quick' ? 260 : 1_500);
  const complexity =
    jsTsFiles.length === 0
      ? emptyComplexity()
      : await bestEffort('Analyse de complexité', emptyComplexity(), notices, () =>
          analyzeComplexity({
            rootPath,
            include: exactGlobPatterns(jsTsFiles),
            exclude: [],
            complexityThreshold: 10,
            maxHotspots: options.depth === 'quick' ? 20 : 50,
          })
        );

  const documentedFiles = jsTsFiles.slice(0, options.depth === 'quick' ? 100 : 700);
  const documentation =
    documentedFiles.length === 0
      ? emptyDocs()
      : await bestEffort('Inventaire documentaire du code', emptyDocs(), notices, () =>
          generateDocs({
            rootDir: rootPath,
            include: exactGlobPatterns(documentedFiles),
            exclude: [],
            exportedOnly: true,
            includePrivate: false,
          })
        );

  const gitAvailable = isGitRepository(rootPath);
  const heatmap = gitAvailable
    ? await bestEffort('Heatmap Git', emptyHeatmap(), notices, () =>
        generateHeatmap({
          repoPath: rootPath,
          days: options.depth === 'quick' ? 90 : 365,
          maxFiles: options.depth === 'quick' ? 100 : 300,
        })
      )
    : emptyHeatmap();

  const sourceExtensions = [
    ...new Set(
      files
        .map((file) => path.extname(file.path).toLowerCase())
        .filter((extension) => EVOLUTION_EXTENSIONS.has(extension))
    ),
  ];
  const sourceFileCount = Math.max(
    files.filter((file) => EVOLUTION_EXTENSIONS.has(path.extname(file.path).toLowerCase())).length,
    profile?.cartography?.fileStats.totalSourceFiles ?? 0
  );
  const evolutionLimit = options.depth === 'quick' ? 120 : 350;
  let evolution = emptyEvolution();
  if (gitAvailable && sourceExtensions.length > 0 && sourceFileCount <= evolutionLimit) {
    evolution = await bestEffort('Évolution du code', emptyEvolution(), notices, () =>
      generateEvolutionReport({
        repoPath: rootPath,
        dataPoints: options.depth === 'quick' ? 3 : 6,
        days: options.depth === 'quick' ? 90 : 365,
        extensions: sourceExtensions,
      })
    );
  } else if (gitAvailable && sourceFileCount > evolutionLimit) {
    notices.push(
      `Évolution historique détaillée ignorée au-delà de ${evolutionLimit} fichiers source; la heatmap Git reste active.`
    );
  }

  const codeExplorer = await bestEffort<RepoCodeExplorerInput>(
    'Code Explorer',
    { indexed: false },
    notices,
    () => collectCodeExplorer(rootPath, profile, documentation)
  );

  return {
    rootPath,
    rootName: path.basename(rootPath) || 'repo',
    depth: options.depth,
    generatedAt: options.generatedAt.toISOString(),
    files,
    profile: {
      name: profile?.name,
      description: profile?.description,
      readmeExcerpt,
      languages: profile?.languages,
      framework: profile?.framework,
      packageManager: profile?.packageManager,
      testFramework: profile?.testFramework,
      entryPoints: profile?.entryPoints,
      commands: profile?.commands,
      topDependencies: profile?.topDependencies,
    },
    cartography: profile?.cartography,
    complexity,
    heatmap,
    evolution,
    documentation,
    codeExplorer,
    git: { available: gitAvailable },
    notices,
  };
}
