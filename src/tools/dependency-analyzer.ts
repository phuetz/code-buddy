/**
 * Dependency Analyzer Tool
 *
 * Analyzes project dependencies:
 * - Outdated packages
 * - Security vulnerabilities
 * - Unused dependencies
 * - Circular dependencies
 * - Dependency graph
 */

import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import * as path from 'path';
import { execSync } from 'child_process';

export interface PackageDependency {
  name: string;
  version: string;
  type: 'prod' | 'dev' | 'peer' | 'optional';
  latest?: string;
  wanted?: string;
  isOutdated: boolean;
  isDeprecated?: boolean;
}

export interface DependencyNode {
  name: string;
  version: string;
  dependencies: string[];
  dependents: string[];
  depth: number;
}

export interface DependencyAnalysis {
  totalDependencies: number;
  prodDependencies: number;
  devDependencies: number;
  outdatedCount: number;
  dependencies: PackageDependency[];
  outdated: PackageDependency[];
  unused: string[];
  circular: string[][];
  graph: Map<string, DependencyNode>;
  analysisTime: number;
}

export interface AnalysisOptions {
  /** Project root directory */
  rootDir?: string;
  /** Check for outdated packages */
  checkOutdated?: boolean;
  /** Check for unused dependencies */
  checkUnused?: boolean;
  /** Check for circular dependencies */
  checkCircular?: boolean;
  /** Build full dependency graph */
  buildGraph?: boolean;
}

const DEFAULT_OPTIONS: AnalysisOptions = {
  rootDir: process.cwd(),
  checkOutdated: true,
  checkUnused: true,
  checkCircular: true,
  buildGraph: true,
};

/**
 * Analyze project dependencies
 */
export async function analyzeDependencies(
  options: AnalysisOptions = {}
): Promise<DependencyAnalysis> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const rootDir = opts.rootDir || process.cwd();

  // Read package.json
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!await UnifiedVfsRouter.Instance.exists(packageJsonPath)) {
    throw new Error('package.json not found');
  }

  const packageJsonContent = await UnifiedVfsRouter.Instance.readFile(packageJsonPath);
  const packageJson = JSON.parse(packageJsonContent);
  const dependencies: PackageDependency[] = [];

  // Collect all dependencies
  const prodDeps = packageJson.dependencies || {};
  const devDeps = packageJson.devDependencies || {};
  const peerDeps = packageJson.peerDependencies || {};
  const optDeps = packageJson.optionalDependencies || {};

  for (const [name, version] of Object.entries(prodDeps)) {
    dependencies.push({
      name,
      version: version as string,
      type: 'prod',
      isOutdated: false,
    });
  }

  for (const [name, version] of Object.entries(devDeps)) {
    dependencies.push({
      name,
      version: version as string,
      type: 'dev',
      isOutdated: false,
    });
  }

  for (const [name, version] of Object.entries(peerDeps)) {
    dependencies.push({
      name,
      version: version as string,
      type: 'peer',
      isOutdated: false,
    });
  }

  for (const [name, version] of Object.entries(optDeps)) {
    dependencies.push({
      name,
      version: version as string,
      type: 'optional',
      isOutdated: false,
    });
  }

  // Check for outdated packages
  let outdated: PackageDependency[] = [];
  if (opts.checkOutdated) {
    outdated = await checkOutdatedPackages(rootDir, dependencies);
  }

  // Check for unused dependencies
  let unused: string[] = [];
  if (opts.checkUnused) {
    unused = await findUnusedDependencies(rootDir, dependencies);
  }

  // Check for circular dependencies
  let circular: string[][] = [];
  if (opts.checkCircular) {
    circular = findCircularDependencies(rootDir);
  }

  // Build dependency graph
  const graph = new Map<string, DependencyNode>();
  if (opts.buildGraph) {
    await buildDependencyGraph(rootDir, dependencies, graph);
  }

  return {
    totalDependencies: dependencies.length,
    prodDependencies: Object.keys(prodDeps).length,
    devDependencies: Object.keys(devDeps).length,
    outdatedCount: outdated.length,
    dependencies,
    outdated,
    unused,
    circular,
    graph,
    analysisTime: Date.now() - startTime,
  };
}

/**
 * Check for outdated packages using npm
 */
async function checkOutdatedPackages(
  rootDir: string,
  dependencies: PackageDependency[]
): Promise<PackageDependency[]> {
  const outdated: PackageDependency[] = [];

  try {
    const output = execSync('npm outdated --json', {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const outdatedData = JSON.parse(output || '{}');

    for (const [name, info] of Object.entries(outdatedData) as [string, { current: string; wanted: string; latest: string }][]) {
      const dep = dependencies.find(d => d.name === name);
      if (dep) {
        dep.isOutdated = true;
        dep.latest = info.latest;
        dep.wanted = info.wanted;
        outdated.push(dep);
      }
    }
  } catch (error) {
    // npm outdated returns non-zero exit code when packages are outdated
    if (error instanceof Error && 'stdout' in error) {
      try {
        const stdout = (error as { stdout: string }).stdout;
        if (stdout) {
          const outdatedData = JSON.parse(stdout);
          for (const [name, info] of Object.entries(outdatedData) as [string, { current: string; wanted: string; latest: string }][]) {
            const dep = dependencies.find(d => d.name === name);
            if (dep) {
              dep.isOutdated = true;
              dep.latest = info.latest;
              dep.wanted = info.wanted;
              outdated.push(dep);
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return outdated;
}

/**
 * Find unused dependencies by scanning source files
 */
async function findUnusedDependencies(
  rootDir: string,
  dependencies: PackageDependency[]
): Promise<string[]> {
  const unused: string[] = [];
  const usedPackages = new Set<string>();

  // Get all source files
  const sourceFiles = await getSourceFiles(rootDir);

  // Scan each file for imports
  for (const file of sourceFiles) {
    try {
      const content = await UnifiedVfsRouter.Instance.readFile(file, 'utf-8');

      // Match import statements
      const importMatches = content.matchAll(
        /(?:import|require)\s*\(?['"]([^'"./][^'"]*)['"]\)?/g
      );

      for (const match of importMatches) {
        // Get the package name (handle scoped packages)
        let packageName = match[1];
        if (packageName.startsWith('@')) {
          // Scoped package: @scope/package/path -> @scope/package
          const parts = packageName.split('/');
          packageName = parts.slice(0, 2).join('/');
        } else {
          // Regular package: package/path -> package
          packageName = packageName.split('/')[0];
        }
        usedPackages.add(packageName);
      }
    } catch {
      // Ignore file read errors
    }
  }

  // Find dependencies that aren't used
  for (const dep of dependencies) {
    if (!usedPackages.has(dep.name)) {
      // Skip certain types of dependencies that might not be directly imported
      if (dep.type === 'dev') {
        // Dev dependencies might be used by tools, not directly imported
        const isToolDep = [
          'typescript', 'eslint', 'prettier', 'jest', 'vitest',
          'ts-node', 'tsx', 'nodemon', '@types/',
        ].some(t => dep.name.includes(t));
        if (isToolDep) continue;
      }
      unused.push(dep.name);
    }
  }

  return unused;
}

/**
 * Get source files to scan
 */
async function getSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const srcDir = path.join(rootDir, 'src');

  async function scanDir(dir: string): Promise<void> {
    if (!await UnifiedVfsRouter.Instance.exists(dir)) return;

    const entries = await UnifiedVfsRouter.Instance.readDirectory(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory) {
        if (!['node_modules', 'dist', '.git'].includes(entry.name)) {
          await scanDir(fullPath);
        }
      } else if (entry.isFile) {
        if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }
  }

  await scanDir(srcDir);
  // Also scan root level files
  if (await UnifiedVfsRouter.Instance.exists(rootDir)) {
    const rootEntries = await UnifiedVfsRouter.Instance.readDirectory(rootDir);
    for (const entry of rootEntries) {
      if (entry.isFile && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        files.push(path.join(rootDir, entry.name));
      }
    }
  }

  return files;
}

/**
 * Find circular dependencies in the project
 */
function findCircularDependencies(rootDir: string): string[][] {
  const circular: string[][] = [];

  try {
    // Try to use madge if available
    const output = execSync('npx madge --circular --json src/', {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const circles = JSON.parse(output || '[]');
    circular.push(...circles);
  } catch {
    // madge not available, skip circular check
  }

  return circular;
}

/**
 * Build a dependency graph
 */
async function buildDependencyGraph(
  rootDir: string,
  dependencies: PackageDependency[],
  graph: Map<string, DependencyNode>
): Promise<void> {
  // Initialize nodes for direct dependencies
  for (const dep of dependencies) {
    graph.set(dep.name, {
      name: dep.name,
      version: dep.version,
      dependencies: [],
      dependents: [],
      depth: 0,
    });
  }

  // Read package-lock.json for dependency tree
  const lockPath = path.join(rootDir, 'package-lock.json');
  if (await UnifiedVfsRouter.Instance.exists(lockPath)) {
    try {
      const lockContent = await UnifiedVfsRouter.Instance.readFile(lockPath);
      const lock = JSON.parse(lockContent);
      const packages = lock.packages || {};

      // Build relationships
      for (const [pkgPath, pkgInfo] of Object.entries(packages) as [string, { dependencies?: Record<string, string> }][]) {
        const pkgName = pkgPath.replace('node_modules/', '').split('/node_modules/').pop() || '';
        if (!pkgName) continue;

        const node = graph.get(pkgName);
        if (node && pkgInfo.dependencies) {
          node.dependencies = Object.keys(pkgInfo.dependencies);

          // Update dependents
          for (const depName of node.dependencies) {
            const depNode = graph.get(depName);
            if (depNode) {
              depNode.dependents.push(pkgName);
            }
          }
        }
      }
    } catch {
      // Ignore lock file parse errors
    }
  }
}

/**
 * Format dependency analysis report
 */
export function formatDependencyReport(analysis: DependencyAnalysis): string {
  const lines: string[] = [
    '',
    '== Dependency Analysis Report ==',
    '',
    `Analysis completed in ${analysis.analysisTime}ms`,
    '',
    'Summary:',
    `  Total dependencies: ${analysis.totalDependencies}`,
    `  Production: ${analysis.prodDependencies}`,
    `  Development: ${analysis.devDependencies}`,
    `  Outdated: ${analysis.outdatedCount}`,
    '',
  ];

  if (analysis.outdated.length > 0) {
    lines.push('Outdated Packages:');
    for (const dep of analysis.outdated) {
      lines.push(`  ${dep.name}: ${dep.version} -> ${dep.latest} (wanted: ${dep.wanted})`);
    }
    lines.push('');
  }

  if (analysis.unused.length > 0) {
    lines.push('Potentially Unused Dependencies:');
    for (const name of analysis.unused) {
      lines.push(`  - ${name}`);
    }
    lines.push('');
    lines.push('Note: Some may be used by build tools or config files.');
    lines.push('');
  }

  if (analysis.circular.length > 0) {
    lines.push('Circular Dependencies:');
    for (const cycle of analysis.circular) {
      lines.push(`  ${cycle.join(' -> ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default analyzeDependencies;
