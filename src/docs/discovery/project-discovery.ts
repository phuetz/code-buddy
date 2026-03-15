/**
 * Phase 1 — Project Discovery
 *
 * Analyzes the code graph to build a ProjectProfile without any
 * project-specific assumptions. Works on any codebase.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';

// ============================================================================
// Types
// ============================================================================

export interface SourceFile {
  path: string;
  functions: string[];
  classes: string[];
  imports: string[];
  importedBy: string[];
  rank: number;
}

export interface RankedModule {
  path: string;
  rank: number;
  importers: number;
  functions: number;
  classes: number;
  description: string;
}

export interface ModuleCluster {
  id: number;
  label: string;
  members: string[];
  size: number;
  topModule: string;
}

export interface ArchitecturalLayer {
  name: string;
  directory: string;
  moduleCount: number;
  description: string;
}

export interface DetectedPattern {
  name: string;
  location: string;
  evidence: string;
}

export interface ProjectMetrics {
  totalModules: number;
  totalClasses: number;
  totalFunctions: number;
  totalRelationships: number;
  avgFunctionsPerModule: number;
  avgConnectionsPerModule: number;
}

export interface ProjectProfile {
  name: string;
  version: string;
  description: string;
  repoUrl: string;
  commit: string;
  language: string;
  framework?: string;

  metrics: ProjectMetrics;

  architecture: {
    type: 'monolith' | 'layered' | 'microservices' | 'plugin-based' | 'unknown';
    entryPoints: SourceFile[];
    coreModules: RankedModule[];
    clusters: ModuleCluster[];
    layers: ArchitecturalLayer[];
  };

  patterns: DetectedPattern[];

  /** Raw package.json scripts for getting-started */
  scripts: Record<string, string>;
  /** Dependency names */
  dependencies: string[];
  devDependencies: string[];
  /** Environment variables found */
  envVars: Array<{ name: string; desc: string }>;
}

// ============================================================================
// Discovery
// ============================================================================

export async function discoverProject(
  graph: KnowledgeGraph,
  cwd: string,
  repoUrl: string = '',
  commit: string = '',
): Promise<ProjectProfile> {
  const pkg = readPkg(cwd);
  const allTriples = graph.toJSON();
  const stats = graph.getStats();

  // Collect entities by type
  const modules = new Set<string>();
  const classeSet = new Set<string>();
  const functionSet = new Set<string>();
  for (const t of allTriples) {
    if (t.subject.startsWith('mod:')) modules.add(t.subject);
    if (t.object.startsWith('mod:')) modules.add(t.object);
    if (t.subject.startsWith('cls:')) classeSet.add(t.subject);
    if (t.subject.startsWith('fn:')) functionSet.add(t.subject);
    if (t.object.startsWith('fn:')) functionSet.add(t.object);
  }

  // Filter to src/ modules only
  const srcModules = [...modules].filter(m => m.startsWith('mod:src/'));

  // Metrics
  const totalFunctions = [...new Set(allTriples.filter(t => t.predicate === 'containsFunction').map(t => t.object))].length;
  const totalClasses = [...new Set(allTriples.filter(t => t.predicate === 'containsClass').map(t => t.object))].length;
  const metrics: ProjectMetrics = {
    totalModules: srcModules.length,
    totalClasses: totalClasses,
    totalFunctions: totalFunctions,
    totalRelationships: stats.tripleCount,
    avgFunctionsPerModule: srcModules.length > 0 ? Math.round(totalFunctions / srcModules.length) : 0,
    avgConnectionsPerModule: srcModules.length > 0 ? Math.round(stats.tripleCount / srcModules.length) : 0,
  };

  // Core modules — top 20 by blended PageRank + function density
  const coreModules = srcModules
    .map(mod => {
      const modPath = mod.replace(/^mod:/, '');
      const fns = graph.query({ subject: mod, predicate: 'containsFunction' }).length;
      const cls = graph.query({ subject: mod, predicate: 'containsClass' }).length;
      const rank = graph.getEntityRank(mod);
      const importers = graph.query({ predicate: 'imports', object: mod }).length;
      return { path: modPath, rank, importers, functions: fns, classes: cls, description: '' };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 20);

  // Entry points — modules with 0 importers (no one imports them)
  const entryPoints: SourceFile[] = srcModules
    .filter(mod => graph.query({ predicate: 'imports', object: mod }).length === 0)
    .slice(0, 10)
    .map(mod => moduleToSourceFile(graph, mod));

  // Detect layers from top-level directories
  const layers = detectLayers(srcModules);

  // Detect clusters via community detection
  let clusters: ModuleCluster[] = [];
  try {
    const { detectCommunities } = await import('../../knowledge/community-detection.js');
    const communities = detectCommunities(graph);
    clusters = [...communities.communityMembers.entries()]
      .filter(([, members]) => members.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 25)
      .map(([id, members]) => {
        const topMember = members.sort((a, b) => graph.getEntityRank(b) - graph.getEntityRank(a))[0];
        return {
          id,
          label: deriveClusterLabel(members),
          members: members.map(m => m.replace(/^mod:/, '')),
          size: members.length,
          topModule: topMember?.replace(/^mod:/, '') ?? '',
        };
      });
  } catch { /* community detection optional */ }

  // Detect architecture type
  const archType = detectArchitectureType(layers, coreModules, metrics);

  // Detect patterns
  const patterns = detectPatterns(graph, allTriples);

  // Detect framework
  const deps = Object.keys((pkg.dependencies ?? {}) as Record<string, string>);
  const devDeps = Object.keys((pkg.devDependencies ?? {}) as Record<string, string>);
  const framework = detectFramework(deps);

  // Detect language
  const language = detectLanguage(cwd);

  // Environment variables from CLAUDE.md or .env.example
  const envVars = extractEnvVars(cwd);

  return {
    name: (pkg.name as string) ?? path.basename(cwd),
    version: (pkg.version as string) ?? '0.0.0',
    description: (pkg.description as string) ?? '',
    repoUrl,
    commit,
    language,
    framework,
    metrics,
    architecture: {
      type: archType,
      entryPoints,
      coreModules,
      clusters,
      layers,
    },
    patterns,
    scripts: (pkg.scripts ?? {}) as Record<string, string>,
    dependencies: deps,
    devDependencies: devDeps,
    envVars,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function readPkg(cwd: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')); }
  catch { return {}; }
}

function moduleToSourceFile(graph: KnowledgeGraph, mod: string): SourceFile {
  return {
    path: mod.replace(/^mod:/, ''),
    functions: graph.query({ subject: mod, predicate: 'containsFunction' }).map(t => t.object.replace(/^fn:/, '')),
    classes: graph.query({ subject: mod, predicate: 'containsClass' }).map(t => t.object.replace(/^cls:/, '')),
    imports: graph.query({ subject: mod, predicate: 'imports' }).map(t => t.object.replace(/^mod:/, '')),
    importedBy: graph.query({ predicate: 'imports', object: mod }).map(t => t.subject.replace(/^mod:/, '')),
    rank: graph.getEntityRank(mod),
  };
}

function detectLayers(modules: string[]): ArchitecturalLayer[] {
  const dirCounts = new Map<string, number>();
  for (const mod of modules) {
    const parts = mod.replace(/^mod:src\//, '').split('/');
    const dir = parts[0];
    if (dir) dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  return [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, count]) => ({
      name,
      directory: `src/${name}`,
      moduleCount: count,
      description: '',
    }));
}

function deriveClusterLabel(members: string[]): string {
  const dirCounts = new Map<string, number>();
  for (const m of members) {
    const dir = m.replace(/^mod:src\//, '').split('/')[0] ?? 'misc';
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'misc';
  if (sorted[0][1] / members.length > 0.6) return sorted[0][0];
  return sorted.slice(0, 2).map(([d]) => d).join(' + ');
}

function detectArchitectureType(
  layers: ArchitecturalLayer[],
  coreModules: RankedModule[],
  metrics: ProjectMetrics,
): 'monolith' | 'layered' | 'microservices' | 'plugin-based' | 'unknown' {
  // Plugin-based: has a plugins directory
  if (layers.some(l => l.name === 'plugins' || l.name === 'extensions')) return 'plugin-based';
  // Microservices: multiple independent entry points + low coupling
  if (layers.filter(l => l.name.includes('service')).length >= 3) return 'microservices';
  // Layered: distinct layers with clear hierarchy
  if (layers.length >= 5 && metrics.totalModules > 50) return 'layered';
  // Small project
  if (metrics.totalModules < 20) return 'monolith';
  return 'unknown';
}

function detectPatterns(graph: KnowledgeGraph, triples: Array<{ subject: string; predicate: string; object: string }>): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Facade: class with high importers + many outgoing calls
  const classImporters = new Map<string, number>();
  for (const t of triples) {
    if (t.predicate === 'imports' && t.object.startsWith('cls:')) {
      classImporters.set(t.object, (classImporters.get(t.object) ?? 0) + 1);
    }
  }
  for (const [cls, count] of classImporters) {
    if (count >= 5) {
      patterns.push({ name: 'Facade', location: cls.replace(/^cls:/, ''), evidence: `${count} importers` });
    }
  }

  // Singleton: classes with getInstance
  for (const t of triples) {
    if (t.predicate === 'containsFunction' && t.object.includes('.getInstance')) {
      patterns.push({ name: 'Singleton', location: t.subject.replace(/^mod:/, ''), evidence: 'getInstance() method' });
    }
  }

  // Registry: classes with register/unregister
  for (const t of triples) {
    if (t.predicate === 'containsFunction' && (t.object.includes('.register') || t.object.includes('Registry'))) {
      patterns.push({ name: 'Registry', location: t.subject.replace(/^mod:/, ''), evidence: 'register() or Registry class' });
    }
  }

  return patterns.slice(0, 20);
}

function detectFramework(deps: string[]): string | undefined {
  if (deps.includes('next')) return 'nextjs';
  if (deps.includes('express')) return 'express';
  if (deps.includes('@nestjs/core')) return 'nestjs';
  if (deps.includes('fastify')) return 'fastify';
  if (deps.includes('react') && !deps.includes('ink')) return 'react';
  if (deps.includes('vue')) return 'vue';
  if (deps.includes('angular')) return 'angular';
  if (deps.includes('django')) return 'django';
  if (deps.includes('flask')) return 'flask';
  if (deps.includes('ink')) return 'ink';
  return undefined;
}

function detectLanguage(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) return 'typescript';
  if (fs.existsSync(path.join(cwd, 'package.json'))) return 'javascript';
  if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py'))) return 'python';
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) return 'java';
  return 'unknown';
}

function extractEnvVars(cwd: string): Array<{ name: string; desc: string }> {
  const vars: Array<{ name: string; desc: string }> = [];

  // Try CLAUDE.md
  try {
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8').substring(0, 35000);
    for (const m of claudeMd.matchAll(/\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([^|]+)\s*\|/g)) {
      if (m[1] && m[2] && !m[1].startsWith('Variable') && !m[1].startsWith('Metric')) {
        vars.push({ name: m[1], desc: m[2].trim() });
      }
    }
  } catch { /* no CLAUDE.md */ }

  // Try .env.example
  if (vars.length === 0) {
    try {
      const envExample = fs.readFileSync(path.join(cwd, '.env.example'), 'utf-8');
      for (const line of envExample.split('\n')) {
        const match = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
        if (match) vars.push({ name: match[1], desc: '' });
      }
    } catch { /* no .env.example */ }
  }

  return vars;
}
