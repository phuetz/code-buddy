/**
 * Documentation Generator — DeepWiki-style
 *
 * Generates a full markdown documentation site from the codebase,
 * using the code graph, mermaid diagrams, community detection,
 * impact analysis, and static analysis.
 *
 * Output: .codebuddy/docs/ with structured markdown files.
 *
 * Sections:
 *   1-overview.md       — Project overview, tech stack, entry points
 *   2-architecture.md   — Architecture diagram, layers, core components
 *   3-tools.md          — Tool registry, categories, metadata
 *   4-security.md       — Security layers, policies, validation
 *   5-context.md        — Context management, compression, memory
 *   6-subsystems.md     — Per-subsystem pages with call graphs
 *   7-api.md            — API endpoints, WebSocket, CLI commands
 *   8-metrics.md        — Code quality metrics, coupling, dead code
 *   index.md            — Table of contents with links
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { KnowledgeGraph } from '../knowledge/knowledge-graph.js';

// ============================================================================
// Types
// ============================================================================

export interface DocsGeneratorOptions {
  /** Project root directory */
  cwd?: string;
  /** Output directory (default: .codebuddy/docs/) */
  outputDir?: string;
  /** Include mermaid diagrams */
  includeDiagrams?: boolean;
  /** Include code metrics (dead code, coupling) */
  includeMetrics?: boolean;
  /** Maximum files to scan */
  maxFiles?: number;
}

export interface DocsGeneratorResult {
  /** Files generated */
  files: string[];
  /** Total generation time (ms) */
  durationMs: number;
  /** Number of entities documented */
  entityCount: number;
  /** Errors encountered */
  errors: string[];
}

// ============================================================================
// Documentation Generator
// ============================================================================

export async function generateDocs(
  graph: KnowledgeGraph,
  options: DocsGeneratorOptions = {},
): Promise<DocsGeneratorResult> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const outputDir = options.outputDir ?? path.join(cwd, '.codebuddy', 'docs');
  const includeDiagrams = options.includeDiagrams ?? true;
  const includeMetrics = options.includeMetrics ?? true;

  const files: string[] = [];
  const errors: string[] = [];

  // Ensure output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stats = graph.getStats();
  logger.info(`Docs generator: ${stats.tripleCount} triples, ${stats.subjectCount} entities`);

  // Collect graph data
  const allTriples = graph.toJSON();
  const modules = new Set<string>();
  const classes = new Set<string>();
  const functions = new Set<string>();

  for (const t of allTriples) {
    if (t.subject.startsWith('mod:')) modules.add(t.subject);
    if (t.object.startsWith('mod:')) modules.add(t.object);
    if (t.subject.startsWith('cls:')) classes.add(t.subject);
    if (t.subject.startsWith('fn:')) functions.add(t.subject);
    if (t.object.startsWith('fn:')) functions.add(t.object);
  }

  // ========================================================================
  // 1. Overview
  // ========================================================================
  try {
    const overview = generateOverview(graph, cwd, modules, classes, functions);
    const overviewPath = path.join(outputDir, '1-overview.md');
    fs.writeFileSync(overviewPath, overview);
    files.push('1-overview.md');
  } catch (e) { errors.push(`overview: ${e}`); }

  // ========================================================================
  // 2. Architecture
  // ========================================================================
  try {
    const arch = await generateArchitecture(graph, modules, includeDiagrams);
    const archPath = path.join(outputDir, '2-architecture.md');
    fs.writeFileSync(archPath, arch);
    files.push('2-architecture.md');
  } catch (e) { errors.push(`architecture: ${e}`); }

  // ========================================================================
  // 3. Subsystems (per-community)
  // ========================================================================
  try {
    const subsystems = await generateSubsystems(graph, modules, includeDiagrams);
    const subPath = path.join(outputDir, '3-subsystems.md');
    fs.writeFileSync(subPath, subsystems);
    files.push('3-subsystems.md');
  } catch (e) { errors.push(`subsystems: ${e}`); }

  // ========================================================================
  // 4. Metrics
  // ========================================================================
  if (includeMetrics) {
    try {
      const metrics = await generateMetrics(graph);
      const metricsPath = path.join(outputDir, '4-metrics.md');
      fs.writeFileSync(metricsPath, metrics);
      files.push('4-metrics.md');
    } catch (e) { errors.push(`metrics: ${e}`); }
  }

  // ========================================================================
  // 5. Index (table of contents)
  // ========================================================================
  try {
    const index = generateIndex(files, stats, modules.size, classes.size, functions.size);
    const indexPath = path.join(outputDir, 'index.md');
    fs.writeFileSync(indexPath, index);
    files.push('index.md');
  } catch (e) { errors.push(`index: ${e}`); }

  const result: DocsGeneratorResult = {
    files,
    durationMs: Date.now() - startTime,
    entityCount: modules.size + classes.size + functions.size,
    errors,
  };

  logger.info(`Docs generated: ${files.length} files in ${result.durationMs}ms, ${result.entityCount} entities`);
  return result;
}

// ============================================================================
// Section Generators
// ============================================================================

function generateOverview(
  graph: KnowledgeGraph,
  cwd: string,
  modules: Set<string>,
  classes: Set<string>,
  functions: Set<string>,
): string {
  const projectName = path.basename(cwd);
  const stats = graph.getStats();

  // Find top-ranked entities
  const topEntities: Array<{ entity: string; rank: number }> = [];
  for (const mod of modules) {
    topEntities.push({ entity: mod, rank: graph.getEntityRank(mod) });
  }
  topEntities.sort((a, b) => b.rank - a.rank);

  const lines = [
    `# ${projectName} — Documentation`,
    '',
    `> Auto-generated from code graph (${stats.tripleCount} relationships across ${modules.size} modules)`,
    '',
    '## Project Statistics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Modules | ${modules.size} |`,
    `| Classes | ${classes.size} |`,
    `| Functions | ${functions.size} |`,
    `| Relationships | ${stats.tripleCount} |`,
    `| Predicates | ${stats.predicateCount} |`,
    '',
    '## Key Modules (by PageRank)',
    '',
  ];

  for (const { entity, rank } of topEntities.slice(0, 15)) {
    const name = entity.replace(/^mod:/, '');
    const callers = graph.query({ predicate: 'calls', object: entity }).length;
    const importers = graph.query({ predicate: 'imports', object: entity }).length;
    lines.push(`- **${name}** (rank: ${rank.toFixed(3)}, ${importers} importers, ${callers} callers)`);
  }

  // Entry points (index files)
  lines.push('', '## Entry Points', '');
  for (const mod of modules) {
    const name = mod.replace(/^mod:/, '');
    if (name.endsWith('index') || name.endsWith('main') || name === 'mod:src/index') {
      const exports = graph.query({ subject: mod, predicate: 'exports' });
      lines.push(`- \`${name}\` (${exports.length} exports)`);
    }
  }

  return lines.join('\n');
}

async function generateArchitecture(
  graph: KnowledgeGraph,
  modules: Set<string>,
  includeDiagrams: boolean,
): Promise<string> {
  const lines = [
    '# Architecture',
    '',
    '## Module Dependency Graph',
    '',
  ];

  if (includeDiagrams) {
    // Generate module dependency diagram
    try {
      const { generateModuleDependencies } = await import('../knowledge/mermaid-generator.js');
      // Find the most connected module as center
      let bestMod = '';
      let bestConns = 0;
      for (const mod of modules) {
        const conns = graph.query({ subject: mod }).length + graph.query({ object: mod }).length;
        if (conns > bestConns) { bestConns = conns; bestMod = mod; }
      }
      if (bestMod) {
        const diagram = generateModuleDependencies(graph, bestMod, 2, 40);
        lines.push('```mermaid', diagram, '```', '');
      }
    } catch { /* mermaid optional */ }
  }

  // Layer analysis: group modules by directory prefix
  const layers = new Map<string, string[]>();
  for (const mod of modules) {
    const name = mod.replace(/^mod:/, '');
    const parts = name.split('/');
    const layer = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    const list = layers.get(layer) ?? [];
    list.push(name);
    layers.set(layer, list);
  }

  lines.push('## Layers', '');
  const sortedLayers = [...layers.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [layer, mods] of sortedLayers.slice(0, 20)) {
    lines.push(`### ${layer} (${mods.length} modules)`, '');
    for (const m of mods.slice(0, 10)) {
      const rank = graph.getEntityRank(`mod:${m}`);
      lines.push(`- \`${m}\` ${rank > 0.01 ? `(rank: ${rank.toFixed(3)})` : ''}`);
    }
    if (mods.length > 10) lines.push(`- ... and ${mods.length - 10} more`);
    lines.push('');
  }

  return lines.join('\n');
}

async function generateSubsystems(
  graph: KnowledgeGraph,
  modules: Set<string>,
  includeDiagrams: boolean,
): Promise<string> {
  const lines = [
    '# Subsystems',
    '',
  ];

  // Detect communities
  try {
    const { detectCommunities } = await import('../knowledge/community-detection.js');
    const communities = detectCommunities(graph);

    lines.push(`Detected **${communities.communitySizes.size}** architectural subsystems (modularity: ${communities.modularity.toFixed(3)})`, '');

    // Document each community
    for (const [communityId, members] of communities.communityMembers) {
      if (members.length < 2) continue;

      const shortNames = members.map(m => m.replace(/^mod:/, ''));
      const commonPrefix = findCommonPrefix(shortNames);
      const label = commonPrefix || `Cluster ${communityId}`;

      lines.push(`## ${label} (${members.length} modules)`, '');

      // List members with PageRank
      const ranked = members
        .map(m => ({ name: m.replace(/^mod:/, ''), rank: graph.getEntityRank(m) }))
        .sort((a, b) => b.rank - a.rank);

      for (const { name, rank } of ranked.slice(0, 10)) {
        const fns = graph.query({ subject: `mod:${name}`, predicate: 'containsFunction' });
        lines.push(`- **${name}** (rank: ${rank.toFixed(3)}, ${fns.length} functions)`);
      }
      if (ranked.length > 10) lines.push(`- ... and ${ranked.length - 10} more`);

      // Class hierarchy for this community
      if (includeDiagrams && ranked.length > 0) {
        try {
          const { generateCallFlowchart } = await import('../knowledge/mermaid-generator.js');
          const topEntity = `mod:${ranked[0].name}`;
          const fns = graph.query({ subject: topEntity, predicate: 'containsFunction' });
          if (fns.length > 0) {
            const chart = generateCallFlowchart(graph, fns[0].object, 1, 15);
            if (chart.includes('-->')) {
              lines.push('', '```mermaid', chart, '```');
            }
          }
        } catch { /* diagram optional */ }
      }

      lines.push('');
    }

    // Community interaction diagram
    if (includeDiagrams) {
      try {
        const { generateCommunityDiagram } = await import('../knowledge/mermaid-generator.js');
        const communityChart = generateCommunityDiagram(graph, communities, 8);
        if (communityChart.includes('-->')) {
          lines.push('## Community Interactions', '', '```mermaid', communityChart, '```', '');
        }
      } catch { /* optional */ }
    }
  } catch {
    lines.push('*Community detection not available.*', '');
  }

  return lines.join('\n');
}

async function generateMetrics(graph: KnowledgeGraph): Promise<string> {
  const lines = [
    '# Code Quality Metrics',
    '',
  ];

  // Dead code detection
  try {
    const { detectDeadCode } = await import('../knowledge/graph-analytics.js');
    const deadCode = detectDeadCode(graph);

    lines.push('## Dead Code Analysis', '');
    lines.push(`| Confidence | Count |`, `|---|---|`);
    lines.push(`| High | ${deadCode.byConfidence.high.length} |`);
    lines.push(`| Medium | ${deadCode.byConfidence.medium.length} |`);
    lines.push(`| Low | ${deadCode.byConfidence.low.length} |`);
    lines.push(`| **Total** | **${deadCode.totalDead}** |`);
    lines.push('');

    if (deadCode.uncalledFunctions.length > 0) {
      lines.push('### Top Dead Code Candidates', '');
      for (const fn of deadCode.byConfidence.high.slice(0, 15)) {
        lines.push(`- \`${fn}\` (high confidence)`);
      }
      for (const fn of deadCode.byConfidence.medium.slice(0, 5)) {
        lines.push(`- \`${fn}\` (medium confidence)`);
      }
      lines.push('');
    }
  } catch { lines.push('*Dead code analysis not available.*', ''); }

  // Coupling analysis
  try {
    const { computeCoupling } = await import('../knowledge/graph-analytics.js');
    const coupling = computeCoupling(graph, 15);

    lines.push('## Module Coupling', '');
    lines.push(`| Module A | Module B | Calls | Imports | Total |`, `|---|---|---|---|---|`);
    for (const pair of coupling.hotspots.slice(0, 15)) {
      const a = pair.moduleA.replace(/^mod:/, '');
      const b = pair.moduleB.replace(/^mod:/, '');
      lines.push(`| ${a} | ${b} | ${pair.calls} | ${pair.imports} | ${pair.total} |`);
    }
    if (coupling.mostDependentModule) {
      lines.push('', `Most dependent module: \`${coupling.mostDependentModule.replace(/^mod:/, '')}\``);
    }
    if (coupling.mostDependendUponModule) {
      lines.push(`Most depended-upon: \`${coupling.mostDependendUponModule.replace(/^mod:/, '')}\``);
    }
    lines.push('');
  } catch { lines.push('*Coupling analysis not available.*', ''); }

  // Refactoring suggestions
  try {
    const { suggestRefactoring } = await import('../knowledge/graph-analytics.js');
    const suggestions = suggestRefactoring(graph);

    if (suggestions.length > 0) {
      lines.push('## Refactoring Suggestions', '');
      for (const s of suggestions.slice(0, 10)) {
        lines.push(`- **${s.entity.replace(/^(mod|fn|cls):/, '')}**: ${s.reason} (rank: ${s.pageRank.toFixed(3)}, ${s.totalCallers} callers, ${s.crossCommunityCallers} cross-community)`);
      }
      lines.push('');
    }
  } catch { /* optional */ }

  return lines.join('\n');
}

function generateIndex(
  files: string[],
  stats: { tripleCount: number; subjectCount: number },
  moduleCount: number,
  classCount: number,
  functionCount: number,
): string {
  const lines = [
    '# Documentation Index',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Modules | ${moduleCount} |`,
    `| Classes | ${classCount} |`,
    `| Functions | ${functionCount} |`,
    `| Relationships | ${stats.tripleCount} |`,
    '',
    '## Sections',
    '',
  ];

  for (const file of files.filter(f => f !== 'index.md')) {
    const name = file.replace(/^\d+-/, '').replace(/\.md$/, '');
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    lines.push(`- [${title}](./${file})`);
  }

  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  const parts = strings[0].split('/');
  let prefix = '';
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(0, i + 1).join('/');
    if (strings.every(s => s.startsWith(candidate))) {
      prefix = candidate;
    } else {
      break;
    }
  }
  return prefix;
}
