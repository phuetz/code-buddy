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

/** Read a file safely, returning empty string on failure. Exported for llm-docs-generator. */
export function readFileSafe(filePath: string, maxChars: number = 5000): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8').substring(0, maxChars);
  } catch { return ''; }
}

function readPkg(cwd: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
  } catch { return {}; }
}

function generateOverview(
  graph: KnowledgeGraph,
  cwd: string,
  modules: Set<string>,
  classes: Set<string>,
  functions: Set<string>,
): string {
  const pkg = readPkg(cwd);
  const projectName = (pkg.name as string) ?? path.basename(cwd);
  const version = (pkg.version as string) ?? '0.0.0';
  const description = (pkg.description as string) ?? '';
  const stats = graph.getStats();
  const deps = Object.keys((pkg.dependencies ?? {}) as Record<string, string>);
  const devDeps = Object.keys((pkg.devDependencies ?? {}) as Record<string, string>);

  // Find top-ranked entities
  const topEntities: Array<{ entity: string; rank: number; importers: number; callers: number }> = [];
  for (const mod of modules) {
    topEntities.push({
      entity: mod,
      rank: graph.getEntityRank(mod),
      importers: graph.query({ predicate: 'imports', object: mod }).length,
      callers: graph.query({ predicate: 'calls', object: mod }).length,
    });
  }
  topEntities.sort((a, b) => b.rank - a.rank);

  // Classify entry points (real ones, not all index files)
  const mainEntries = ['src/index', 'src/server/index', 'src/daemon/index'];
  const entryPoints = topEntities.filter(e => {
    const name = e.entity.replace(/^mod:/, '');
    return mainEntries.some(m => name === m) || (name.endsWith('index') && e.importers >= 3);
  }).slice(0, 10);

  // Detect key capabilities from module names
  const capabilities: string[] = [];
  const modNames = [...modules].map(m => m.replace(/^mod:/, ''));
  if (modNames.some(m => m.includes('channel'))) capabilities.push('Multi-channel messaging (Telegram, Discord, Slack, WhatsApp, etc.)');
  if (modNames.some(m => m.includes('daemon'))) capabilities.push('Background daemon with health monitoring');
  if (modNames.some(m => m.includes('voice') || m.includes('tts'))) capabilities.push('Voice interaction with wake-word activation');
  if (modNames.some(m => m.includes('sandbox') || m.includes('docker'))) capabilities.push('Sandboxed execution (Docker, OS-level)');
  if (modNames.some(m => m.includes('reasoning') || m.includes('mcts'))) capabilities.push('Advanced reasoning (Tree-of-Thought, MCTS)');
  if (modNames.some(m => m.includes('knowledge-graph'))) capabilities.push(`Code graph analysis (${stats.tripleCount} relationships)`);
  if (modNames.some(m => m.includes('repair'))) capabilities.push('Automated program repair (fault localization + LLM)');
  if (modNames.some(m => m.includes('a2a'))) capabilities.push('Agent-to-Agent protocol (Google A2A spec)');
  if (modNames.some(m => m.includes('workflow'))) capabilities.push('Workflow engine with DAG execution');
  if (modNames.some(m => m.includes('deploy'))) capabilities.push('Cloud deployment (Fly.io, Railway, Render, GCP)');

  const lines = [
    `# ${projectName} v${version}`,
    '',
    description ? `> ${description}` : `> Auto-generated documentation from ${stats.tripleCount} code relationships`,
    '',
    `${projectName} is a terminal-based AI coding agent built in TypeScript/Node.js. It supports multiple LLM providers with automatic failover and provides ${functions.size.toLocaleString()} functions across ${modules.size} modules.`,
    '',
    '## Key Capabilities',
    '',
    ...capabilities.map(c => `- ${c}`),
    '',
    '## Project Statistics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Version | ${version} |`,
    `| Modules | ${modules.size} |`,
    `| Classes | ${classes.size} |`,
    `| Functions | ${functions.size.toLocaleString()} |`,
    `| Code Relationships | ${stats.tripleCount.toLocaleString()} |`,
    `| Dependencies | ${deps.length} |`,
    `| Dev Dependencies | ${devDeps.length} |`,
    '',
    '## Core Modules (by architectural importance)',
    '',
    'Ranked by PageRank — higher rank means more modules depend on this one:',
    '',
    `| Module | PageRank | Importers | Description |`,
    `|--------|----------|-----------|-------------|`,
  ];

  for (const { entity, rank, importers } of topEntities.slice(0, 20)) {
    const name = entity.replace(/^mod:/, '');
    const desc = inferModuleDescription(name);
    lines.push(`| \`${name}\` | ${rank.toFixed(3)} | ${importers} | ${desc} |`);
  }

  lines.push('', '## Entry Points', '');
  for (const entry of entryPoints) {
    const name = entry.entity.replace(/^mod:/, '');
    lines.push(`- **\`${name}\`** — ${inferModuleDescription(name)} (${entry.importers} dependents)`);
  }

  // Technology stack
  const coreDeps = deps.filter(d => ['commander', 'openai', 'express', 'ink', 'react', 'better-sqlite3', 'zod'].includes(d));
  if (coreDeps.length > 0) {
    lines.push('', '## Technology Stack', '');
    lines.push('| Category | Technologies |', '|----------|-------------|');
    lines.push(`| CLI Framework | commander |`);
    if (deps.includes('ink')) lines.push(`| Terminal UI | ink, react |`);
    const llmSdks = deps.filter(d => ['openai', '@anthropic-ai/sdk', '@google/generative-ai'].includes(d));
    if (llmSdks.length > 0) lines.push(`| LLM SDKs | ${llmSdks.join(', ')} |`);
    if (deps.includes('express')) lines.push(`| HTTP Server | express, ws, cors |`);
    if (deps.includes('better-sqlite3')) lines.push(`| Database | better-sqlite3 |`);
    if (deps.includes('zod')) lines.push(`| Validation | zod |`);
    if (deps.includes('playwright')) lines.push(`| Browser Automation | playwright |`);
  }

  return lines.join('\n');
}

/** Infer a human-readable description from a module path */
function inferModuleDescription(modulePath: string): string {
  const parts = modulePath.split('/');
  const descMap: Record<string, string> = {
    'agent': 'Core agent system',
    'codebuddy': 'LLM client and tool definitions',
    'tools': 'Tool implementations',
    'security': 'Security and validation',
    'context': 'Context window management',
    'channels': 'Messaging channel integrations',
    'knowledge': 'Code analysis and knowledge graph',
    'server': 'HTTP/WebSocket server',
    'daemon': 'Background daemon service',
    'config': 'Configuration management',
    'memory': 'Memory and persistence',
    'middleware': 'Middleware pipeline',
    'deploy': 'Cloud deployment',
    'skills': 'Skill registry and marketplace',
    'workflows': 'Workflow DAG engine',
    'observability': 'Logging, metrics, tracing',
    'sandbox': 'Execution sandboxing',
    'voice': 'Voice and TTS',
    'reasoning': 'Advanced reasoning (ToT, MCTS)',
    'repair': 'Automated program repair',
    'protocols': 'Agent protocols (A2A)',
    'search': 'Search and indexing',
    'ui': 'Terminal UI components',
    'commands': 'CLI and slash commands',
    'checkpoints': 'Undo and snapshots',
  };
  for (const part of parts) {
    if (descMap[part]) return descMap[part];
  }
  // Derive from last segment
  const last = parts[parts.length - 1];
  return last.replace(/-/g, ' ').replace(/([A-Z])/g, ' $1').trim();
}

async function generateArchitecture(
  graph: KnowledgeGraph,
  modules: Set<string>,
  includeDiagrams: boolean,
): Promise<string> {
  const lines = [
    '# Architecture',
    '',
    'The project follows a layered architecture with a central agent orchestrator coordinating all interactions between user interfaces, LLM providers, tools, and infrastructure services.',
    '',
  ];

  // Generate high-level layer diagram
  lines.push('## System Layers', '', '```mermaid', 'graph TD');
  lines.push('  UI["User Interfaces<br/>CLI, Chat UI, WebSocket, Voice, Channels"]');
  lines.push('  AGENT["Core Agent<br/>CodeBuddyAgent → AgentExecutor"]');
  lines.push('  TOOLS["Tool Ecosystem<br/>110+ tools, RAG selection"]');
  lines.push('  CTX["Context & Memory<br/>Compression, Lessons, Knowledge Graph"]');
  lines.push('  INFRA["Infrastructure<br/>Daemon, Sandbox, Config, MCP"]');
  lines.push('  SEC["Security<br/>Path validation, SSRF guard, Confirmation"]');
  lines.push('  UI --> AGENT');
  lines.push('  AGENT --> TOOLS');
  lines.push('  AGENT --> CTX');
  lines.push('  TOOLS --> INFRA');
  lines.push('  TOOLS --> SEC');
  lines.push('  CTX --> INFRA');
  lines.push('```', '');

  if (includeDiagrams) {
    try {
      const { generateModuleDependencies } = await import('../knowledge/mermaid-generator.js');
      let bestMod = '';
      let bestConns = 0;
      for (const mod of modules) {
        const conns = graph.query({ subject: mod }).length + graph.query({ object: mod }).length;
        if (conns > bestConns) { bestConns = conns; bestMod = mod; }
      }
      if (bestMod) {
        lines.push('## Core Module Dependencies', '');
        const diagram = generateModuleDependencies(graph, bestMod, 2, 30);
        lines.push('```mermaid', diagram, '```', '');
      }
    } catch { /* mermaid optional */ }
  }

  // Layer analysis with descriptions
  const layerDescriptions: Record<string, string> = {
    'src/agent': 'Core agent system — orchestrator, executor, middleware, reasoning, multi-agent coordination',
    'src/tools': 'Tool implementations — file editing, bash, search, web, planning, media',
    'src/codebuddy': 'LLM client abstraction — multi-provider support, tool definitions, streaming',
    'src/context': 'Context management — compression, sliding window, JIT discovery, tool masking',
    'src/security': 'Security layer — path validation, SSRF guard, shell policy, guardian agent',
    'src/channels': 'Messaging channels — Telegram, Discord, Slack, WhatsApp, 15+ platforms',
    'src/server': 'HTTP/WebSocket server — REST API, real-time streaming, authentication',
    'src/knowledge': 'Knowledge graph — code analysis, PageRank, community detection, impact analysis',
    'src/commands': 'Command system — CLI commands, slash commands, dev workflows',
    'src/config': 'Configuration — TOML config, model settings, hot-reload',
    'src/memory': 'Memory — persistent memory, ICM bridge, decision memory, consolidation',
    'src/daemon': 'Background daemon — health monitoring, cron, heartbeat',
    'src/ui': 'Terminal UI — Ink/React components, themes, chat interface',
    'src/skills': 'Skills — registry, marketplace, SKILL.md loading',
    'src/workflows': 'Workflows — DAG engine, approval gates, variable resolution',
    'src/observability': 'Observability — run store, OpenTelemetry, Sentry, tool metrics',
    'src/deploy': 'Deployment — Fly.io, Railway, Render, Hetzner, GCP, Nix',
    'src/sandbox': 'Sandboxing — Docker containers, OS-level isolation',
  };

  const layers = new Map<string, string[]>();
  for (const mod of modules) {
    const name = mod.replace(/^mod:/, '');
    const parts = name.split('/');
    const layer = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    const list = layers.get(layer) ?? [];
    list.push(name);
    layers.set(layer, list);
  }

  lines.push('## Layer Breakdown', '');
  lines.push('| Layer | Modules | Description |', '|-------|---------|-------------|');
  const sortedLayers = [...layers.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [layer, mods] of sortedLayers.slice(0, 25)) {
    const desc = layerDescriptions[layer] ?? inferModuleDescription(layer);
    lines.push(`| \`${layer}/\` | ${mods.length} | ${desc} |`);
  }
  lines.push('');

  // Core flow
  lines.push('## Core Agent Flow', '');
  lines.push('```');
  lines.push('User Input → CLI/Chat/Voice/Channel');
  lines.push('  → CodeBuddyAgent.processUserMessage()');
  lines.push('    → AgentExecutor (ReAct loop)');
  lines.push('      1. RAG Tool Selection (~15 from 110+)');
  lines.push('      2. Context Injection (lessons, decisions, graph)');
  lines.push('      3. Middleware Before-Turn (cost, turn limit, reasoning)');
  lines.push('      4. LLM Call (multi-provider)');
  lines.push('      5. Tool Execution (parallel read / serial write)');
  lines.push('      6. Result Processing (masking, TTL, compaction)');
  lines.push('      7. Middleware After-Turn (auto-repair, metrics)');
  lines.push('      8. Loop or Return');
  lines.push('```');
  lines.push('');

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
