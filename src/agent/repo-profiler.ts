/**
 * RepoProfiler
 *
 * Scans the current repository to detect language, framework, package manager,
 * and build/test commands. Produces a compact contextPack string injected into
 * the agent system prompt to give it awareness of project conventions.
 *
 * Result is cached in .codebuddy/repoProfile.json and invalidated when
 * package.json (or equivalent) changes.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { CartographyResult } from './repo-profiling/cartography.js';
import { KnowledgeGraph } from '../knowledge/knowledge-graph.js';
import { populateCodeGraph } from '../knowledge/code-graph-populator.js';
import { saveCodeGraph, loadCodeGraph, codeGraphExists } from '../knowledge/code-graph-persistence.js';

export interface RepoProfile {
  detectedAt: string;
  languages: string[];
  framework?: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'poetry' | 'pip' | 'cargo' | 'dotnet' | 'go';
  commands: {
    test?: string;
    lint?: string;
    format?: string;
    build?: string;
    typecheck?: string;
    validate?: string;
  };
  directories: {
    src?: string;
    tests?: string;
    docs?: string;
  };
  conventions: {
    naming?: string;
    lintRules?: string[];
  };
  /** Compact string injected into agent system prompt */
  contextPack: string;
  /** mtime of the primary config file used for cache invalidation */
  _configMtime?: number;
  /** package.json name */
  name?: string;
  /** package.json description */
  description?: string;
  /** ESM or CJS module system */
  moduleType?: 'esm' | 'cjs';
  /** Detected test framework (Vitest, Jest, etc.) */
  testFramework?: string;
  /** Entry points from main/bin */
  entryPoints?: string[];
  /** Node.js version constraint from engines */
  nodeVersion?: string;
  /** Dockerfile or docker-compose detected */
  hasDocker?: boolean;
  /** CI config detected (.github/workflows, etc.) */
  hasCi?: boolean;
  /** CLAUDE.md exists in project root */
  hasClaudeMd?: boolean;
  /** Detected databases from dependencies */
  databases?: string[];
  /** Top-level dependencies (up to 10 most significant) */
  topDependencies?: string[];
  /** License from package.json */
  license?: string;
  /** Deep cartography scan results (architecture, imports, patterns, API surface) */
  cartography?: CartographyResult;
  /** Whether the project directory appears empty/new (no config files or src dir) */
  isEmpty?: boolean;
}

const CACHE_FILENAME = '.codebuddy/repoProfile.json';

/**
 * Profiles a repository to produce structured metadata.
 */
export class RepoProfiler {
  private cwd: string;
  private cachePath: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.cachePath = path.join(this.cwd, CACHE_FILENAME);
  }

  /**
   * Get or compute the repo profile.
   * Uses cached result if the primary config file hasn't changed.
   */
  async getProfile(): Promise<RepoProfile> {
    const cached = this.loadCache();
    if (cached && !this.isCacheStale(cached)) {
      // Lazy-load code graph from disk if not already populated
      const graph = KnowledgeGraph.getInstance();
      if (graph.getStats().tripleCount === 0 && codeGraphExists(this.cwd)) {
        loadCodeGraph(graph, this.cwd);
      }
      return cached;
    }

    const profile = await this.computeProfile();
    this.saveCache(profile);
    return profile;
  }

  /**
   * Check if the current directory looks like an empty/new project
   * (no recognized config files and no src directory).
   */
  isEmptyProject(): boolean {
    const configFiles = [
      'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
      'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json',
      'Gemfile', 'mix.exs', 'Package.swift', 'build.zig',
      'tsconfig.json', 'CMakeLists.txt', 'Makefile',
    ];
    const hasSrc = fs.existsSync(path.join(this.cwd, 'src'));
    const hasConfig = configFiles.some(f => fs.existsSync(path.join(this.cwd, f)));
    return !hasSrc && !hasConfig;
  }

  /**
   * Force recompute (ignores cache).
   */
  async refresh(): Promise<RepoProfile> {
    const profile = await this.computeProfile();
    this.saveCache(profile);
    return profile;
  }

  // ──────────────────────────────────────────────────────────────
  // Private implementation
  // ──────────────────────────────────────────────────────────────

  private async computeProfile(): Promise<RepoProfile> {
    const languages: string[] = [];
    let framework: string | undefined;
    let packageManager: RepoProfile['packageManager'];
    const commands: RepoProfile['commands'] = {};
    const directories: RepoProfile['directories'] = {};
    const conventions: RepoProfile['conventions'] = {};
    let configMtime: number | undefined;

    // Extended profile fields
    let name: string | undefined;
    let description: string | undefined;
    let moduleType: 'esm' | 'cjs' | undefined;
    let testFramework: string | undefined;
    let entryPoints: string[] | undefined;
    let nodeVersion: string | undefined;
    let license: string | undefined;
    let topDependencies: string[] | undefined;
    const databases: string[] = [];

    // ── Node / TypeScript ──────────────────────────────────────
    const pkgJsonPath = path.join(this.cwd, 'package.json');
    if (this.exists(pkgJsonPath)) {
      configMtime = this.mtime(pkgJsonPath);
      languages.push('TypeScript', 'JavaScript');

      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

        // Package metadata
        name = pkg.name || undefined;
        description = pkg.description || undefined;
        moduleType = pkg.type === 'module' ? 'esm' : 'cjs';
        license = pkg.license || undefined;
        nodeVersion = pkg.engines?.node || undefined;

        // Entry points (deduplicated)
        const eps = new Set<string>();
        if (pkg.main) eps.add(pkg.main);
        if (pkg.bin) {
          if (typeof pkg.bin === 'string') eps.add(pkg.bin);
          else Object.values(pkg.bin).forEach((v) => eps.add(v as string));
        }
        if (eps.size > 0) entryPoints = [...eps];

        // Package manager
        if (this.exists(path.join(this.cwd, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else if (this.exists(path.join(this.cwd, 'yarn.lock'))) {
          packageManager = 'yarn';
        } else {
          packageManager = 'npm';
        }

        const pm = packageManager;
        const run = pm === 'npm' ? 'npm run' : pm;

        // Scripts
        const scripts: Record<string, string> = pkg.scripts || {};
        if (scripts.test) commands.test = `${run} test`;
        if (scripts.lint) commands.lint = `${run} lint`;
        if (scripts.format) commands.format = `${run} format`;
        if (scripts.build) commands.build = `${run} build`;
        if (scripts.typecheck) commands.typecheck = `${run} typecheck`;
        if (scripts.validate) commands.validate = `${run} validate`;

        // Framework detection from dependencies (order matters: specific before generic)
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        // Ink uses React internally — check it first
        if (allDeps['ink']) framework = 'Ink (terminal UI)';
        else if (allDeps['next']) framework = 'Next.js';
        else if (allDeps['nuxt']) framework = 'Nuxt';
        else if (allDeps['@angular/core']) framework = 'Angular';
        else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) framework = 'Svelte';
        else if (allDeps['vue']) framework = 'Vue';
        else if (allDeps['react'] || allDeps['react-dom']) framework = 'React';
        else if (allDeps['fastify']) framework = 'Fastify';
        else if (allDeps['express']) framework = 'Express';

        // Test framework detection
        if (allDeps['vitest']) testFramework = 'Vitest';
        else if (allDeps['jest']) testFramework = 'Jest';
        else if (allDeps['mocha']) testFramework = 'Mocha';
        else if (allDeps['ava']) testFramework = 'AVA';

        // Database detection
        if (allDeps['better-sqlite3'] || allDeps['sqlite3']) databases.push('SQLite');
        if (allDeps['pg'] || allDeps['postgres']) databases.push('PostgreSQL');
        if (allDeps['mysql'] || allDeps['mysql2']) databases.push('MySQL');
        if (allDeps['mongodb'] || allDeps['mongoose']) databases.push('MongoDB');
        if (allDeps['redis'] || allDeps['ioredis']) databases.push('Redis');
        if (allDeps['prisma'] || allDeps['@prisma/client']) databases.push('Prisma');

        // Top dependencies — sorted by significance, not alphabetically
        // Skip internal tooling / types / telemetry / boilerplate
        const LOW_SIGNAL = new Set([
          '@types/', '@opentelemetry/', '@sentry/', '@resvg/',
        ]);
        const depEntries = Object.keys(pkg.dependencies || {})
          .filter((d) => !LOW_SIGNAL.has(d) && ![...LOW_SIGNAL].some((p) => d.startsWith(p)));
        // Score: short names are typically core libs, scoped org packages less so
        const scored = depEntries.map((d) => {
          let score = 0;
          // Well-known significant packages get a boost
          const CORE = ['react', 'vue', 'angular', 'express', 'fastify', 'ink',
            'next', 'nuxt', 'svelte', 'commander', 'yargs', 'chalk', 'zod',
            'prisma', 'drizzle-orm', 'typeorm', 'sequelize', 'mongoose',
            'openai', 'langchain', 'axios', 'socket.io', 'graphql',
            'tailwindcss', 'typescript', 'webpack', 'vite', 'esbuild',
            'electron', 'tauri', 'react-native', 'expo'];
          if (CORE.includes(d)) score += 100;
          // Non-scoped packages are usually more recognizable
          if (!d.startsWith('@')) score += 10;
          // User's own packages are highly relevant
          if (pkg.name && d.startsWith(pkg.name.split('/')[0])) score += 50;
          return { name: d, score };
        });
        scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        const significantDeps = scored.slice(0, 10).map((s) => s.name);
        if (significantDeps.length > 0) topDependencies = significantDeps;

        // Naming convention hint
        if (allDeps['eslint'] || pkg.eslintConfig) {
          conventions.naming = 'camelCase (JS/TS)';
          conventions.lintRules = ['eslint'];
        }
      } catch {
        // Malformed package.json — ignore
      }
    }

    // ── Python ────────────────────────────────────────────────
    const pyprojectPath = path.join(this.cwd, 'pyproject.toml');
    const requirementsPath = path.join(this.cwd, 'requirements.txt');
    if (this.exists(pyprojectPath) || this.exists(requirementsPath)) {
      languages.push('Python');
      if (this.exists(pyprojectPath)) {
        packageManager = 'poetry';
        configMtime = configMtime || this.mtime(pyprojectPath);
        commands.test = commands.test || 'poetry run pytest';
        commands.lint = commands.lint || 'poetry run ruff check .';
        commands.format = commands.format || 'poetry run black .';
      } else {
        packageManager = 'pip';
        configMtime = configMtime || this.mtime(requirementsPath);
        commands.test = commands.test || 'python -m pytest';
      }
    }

    // ── Rust ─────────────────────────────────────────────────
    const cargoPath = path.join(this.cwd, 'Cargo.toml');
    if (this.exists(cargoPath)) {
      languages.push('Rust');
      packageManager = 'cargo';
      configMtime = configMtime || this.mtime(cargoPath);
      commands.test = commands.test || 'cargo test';
      commands.build = commands.build || 'cargo build --release';
      commands.lint = commands.lint || 'cargo clippy';
      commands.format = commands.format || 'cargo fmt';
    }

    // ── Go ────────────────────────────────────────────────────
    const goModPath = path.join(this.cwd, 'go.mod');
    if (this.exists(goModPath)) {
      languages.push('Go');
      packageManager = 'go';
      configMtime = configMtime || this.mtime(goModPath);
      commands.test = commands.test || 'go test ./...';
      commands.build = commands.build || 'go build ./...';
      commands.lint = commands.lint || 'golangci-lint run';
      commands.format = commands.format || 'gofmt -w .';
    }

    // ── .NET ─────────────────────────────────────────────────
    const hasCsproj = this.glob('*.csproj').length > 0 || this.glob('*.sln').length > 0;
    if (hasCsproj) {
      languages.push('C#');
      packageManager = 'dotnet';
      commands.test = commands.test || 'dotnet test';
      commands.build = commands.build || 'dotnet build';
      commands.format = commands.format || 'dotnet format';
    }

    // ── Common directory detection ────────────────────────────
    for (const candidate of ['src', 'lib', 'app']) {
      if (this.exists(path.join(this.cwd, candidate))) {
        directories.src = candidate;
        break;
      }
    }
    for (const candidate of ['tests', 'test', '__tests__', 'spec']) {
      if (this.exists(path.join(this.cwd, candidate))) {
        directories.tests = candidate;
        break;
      }
    }
    for (const candidate of ['docs', 'documentation', 'doc']) {
      if (this.exists(path.join(this.cwd, candidate))) {
        directories.docs = candidate;
        break;
      }
    }

    // ── Infrastructure detection ────────────────────────────────
    const hasDocker = this.exists(path.join(this.cwd, 'Dockerfile'))
      || this.exists(path.join(this.cwd, 'docker-compose.yml'))
      || this.exists(path.join(this.cwd, 'docker-compose.yaml'));
    const hasCi = this.exists(path.join(this.cwd, '.github', 'workflows'))
      || this.exists(path.join(this.cwd, '.gitlab-ci.yml'))
      || this.exists(path.join(this.cwd, '.circleci'));
    const hasClaudeMd = this.exists(path.join(this.cwd, 'CLAUDE.md'));

    // ── Deep cartography scan ──────────────────────────────────
    let cartography: CartographyResult | undefined;
    try {
      const { runCartography } = await import('./repo-profiling/cartography.js');
      // Auto-detects source dirs; falls back to directories.src if set
      cartography = runCartography(this.cwd, directories.src || undefined);
    } catch (err) {
      logger.debug('RepoProfiler: cartography scan failed (non-critical)', { err });
    }

    // ── Populate code graph from cartography ───────────────────
    if (cartography) {
      try {
        const graph = KnowledgeGraph.getInstance();
        graph.clear(); // Fresh rebuild
        const tripleCount = populateCodeGraph(graph, cartography);
        saveCodeGraph(graph, this.cwd);

        // Strip importEdges from profile to keep repoProfile.json lean
        delete cartography.importEdges;

        logger.debug(`RepoProfiler: code graph populated with ${tripleCount} triples`);
      } catch (err) {
        logger.debug('RepoProfiler: code graph population failed (non-critical)', { err });
      }
    }

    // ── Build contextPack ─────────────────────────────────────
    const profile: RepoProfile = {
      detectedAt: new Date().toISOString(),
      languages,
      framework,
      packageManager,
      commands,
      directories,
      conventions,
      contextPack: '',
      _configMtime: configMtime,
      name,
      description,
      moduleType,
      testFramework,
      entryPoints,
      nodeVersion,
      hasDocker,
      hasCi,
      hasClaudeMd,
      databases: databases.length > 0 ? databases : undefined,
      topDependencies,
      license,
      cartography,
      isEmpty: this.isEmptyProject(),
    };

    profile.contextPack = this.buildContextPack(profile);
    
    // Save to cache before starting background task
    this.saveCache(profile);

    // Trigger background semantic indexing of the workspace
    try {
      const { getWorkspaceIndexer } = await import('../knowledge/workspace-indexer.js');
      const indexer = getWorkspaceIndexer({
        workspaceRoot: this.cwd,
        indexPath: path.join(this.cwd, '.codebuddy', 'index', 'workspace.bin'),
      });
      indexer.initialize()
        .then(() => indexer.startIndexing())
        .catch(e => logger.error('Background indexing failed', { error: String(e) }));
    } catch (e) {
      logger.debug('Failed to load workspace indexer', { error: String(e) });
    }

    return profile;
  }

  private buildContextPack(p: RepoProfile): string {
    const parts: string[] = [];

    if (p.languages.length > 0) {
      parts.push(`Language: ${p.languages.join(', ')}`);
    }
    if (p.framework) {
      parts.push(`Framework: ${p.framework}`);
    }
    if (p.packageManager) {
      parts.push(`Package manager: ${p.packageManager}`);
    }
    const cmds = Object.entries(p.commands)
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ');
    if (cmds) {
      parts.push(`Commands: ${cmds}`);
    }
    const dirs = Object.entries(p.directories)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (dirs) {
      parts.push(`Dirs: ${dirs}`);
    }
    if (p.conventions.naming) {
      parts.push(`Naming: ${p.conventions.naming}`);
    }

    return parts.join(' | ');
  }

  private loadCache(): RepoProfile | null {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const raw = fs.readFileSync(this.cachePath, 'utf-8');
      return JSON.parse(raw) as RepoProfile;
    } catch {
      return null;
    }
  }

  private isCacheStale(cached: RepoProfile): boolean {
    if (!cached._configMtime) return true;
    // Check if primary config file has changed
    const pkgJsonPath = path.join(this.cwd, 'package.json');
    for (const candidate of [pkgJsonPath, 'pyproject.toml', 'Cargo.toml', 'go.mod'].map(
      (f) => (path.isAbsolute(f) ? f : path.join(this.cwd, f))
    )) {
      if (fs.existsSync(candidate)) {
        const currentMtime = this.mtime(candidate);
        if (currentMtime !== cached._configMtime) return true;
        break;
      }
    }
    return false;
  }

  private saveCache(profile: RepoProfile): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(profile, null, 2));
    } catch (err) {
      logger.debug('RepoProfiler: failed to save cache', { err });
    }
  }

  private exists(p: string): boolean {
    return fs.existsSync(p);
  }

  private mtime(p: string): number {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  }

  private glob(pattern: string): string[] {
    try {
      // Simple glob: look for files matching *.ext in cwd
      const ext = pattern.replace('*', '');
      return fs.readdirSync(this.cwd).filter((f) => f.endsWith(ext));
    } catch {
      return [];
    }
  }
}

/** Singleton instance */
let _instance: RepoProfiler | null = null;

export function getRepoProfiler(cwd?: string): RepoProfiler {
  if (!_instance || cwd) {
    _instance = new RepoProfiler(cwd);
  }
  return _instance;
}
