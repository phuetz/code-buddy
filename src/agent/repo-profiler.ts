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
      return cached;
    }

    const profile = await this.computeProfile();
    this.saveCache(profile);
    return profile;
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

    // ── Node / TypeScript ──────────────────────────────────────
    const pkgJsonPath = path.join(this.cwd, 'package.json');
    if (this.exists(pkgJsonPath)) {
      configMtime = this.mtime(pkgJsonPath);
      languages.push('TypeScript', 'JavaScript');

      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

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

        // Framework detection from dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };
        if (allDeps['react'] || allDeps['react-dom']) framework = 'React';
        else if (allDeps['next']) framework = 'Next.js';
        else if (allDeps['vue']) framework = 'Vue';
        else if (allDeps['@angular/core']) framework = 'Angular';
        else if (allDeps['express']) framework = 'Express';
        else if (allDeps['fastify']) framework = 'Fastify';
        else if (allDeps['ink']) framework = 'Ink (terminal UI)';

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
    };

    profile.contextPack = this.buildContextPack(profile);
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
