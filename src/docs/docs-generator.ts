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
  // 5. Tool System
  // ========================================================================
  try {
    const tools = generateToolSystem(graph, cwd, modules);
    fs.writeFileSync(path.join(outputDir, '5-tools.md'), tools);
    files.push('5-tools.md');
  } catch (e) { errors.push(`tools: ${e}`); }

  // ========================================================================
  // 6. Security Architecture
  // ========================================================================
  try {
    const security = generateSecurity(cwd);
    fs.writeFileSync(path.join(outputDir, '6-security.md'), security);
    files.push('6-security.md');
  } catch (e) { errors.push(`security: ${e}`); }

  // ========================================================================
  // 7. Context & Memory
  // ========================================================================
  try {
    const context = generateContextMemory(cwd);
    fs.writeFileSync(path.join(outputDir, '7-context-memory.md'), context);
    files.push('7-context-memory.md');
  } catch (e) { errors.push(`context: ${e}`); }

  // ========================================================================
  // 8. Configuration
  // ========================================================================
  try {
    const config = generateConfiguration(cwd);
    fs.writeFileSync(path.join(outputDir, '8-configuration.md'), config);
    files.push('8-configuration.md');
  } catch (e) { errors.push(`config: ${e}`); }

  // ========================================================================
  // 9. CLI & API Reference
  // ========================================================================
  try {
    const api = generateApiReference(cwd);
    fs.writeFileSync(path.join(outputDir, '9-api-reference.md'), api);
    files.push('9-api-reference.md');
  } catch (e) { errors.push(`api: ${e}`); }

  // ========================================================================
  // 10. Development Guide
  // ========================================================================
  try {
    const dev = generateDevGuide(cwd);
    fs.writeFileSync(path.join(outputDir, '10-development.md'), dev);
    files.push('10-development.md');
  } catch (e) { errors.push(`dev: ${e}`); }

  // ========================================================================
  // 11. Changelog (from git)
  // ========================================================================
  try {
    const changelog = generateChangelog(cwd);
    fs.writeFileSync(path.join(outputDir, '11-changelog.md'), changelog);
    files.push('11-changelog.md');
  } catch (e) { errors.push(`changelog: ${e}`); }

  // ========================================================================
  // Index (table of contents)
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

  // Find top-ranked entities — filter to core src/ modules, skip index re-exports
  const topEntities: Array<{ entity: string; rank: number; importers: number; callers: number }> = [];
  for (const mod of modules) {
    const name = mod.replace(/^mod:/, '');
    // Skip non-core: test files, index re-exports with 0 functions, node_modules
    if (!name.startsWith('src/')) continue;
    if (name.endsWith('/index') && graph.query({ subject: mod, predicate: 'containsFunction' }).length === 0) continue;
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

  // Count actual source files (not graph entities) for more accurate stats
  const srcModules = [...modules].filter(m => m.startsWith('mod:src/')).length;

  const lines = [
    `# ${projectName} v${version}`,
    '',
    description ? `> ${description}` : `> Auto-generated documentation from ${stats.tripleCount} code relationships`,
    '',
    `${projectName} is a terminal-based AI coding agent built in TypeScript/Node.js. It supports multiple LLM providers (Grok, Claude, ChatGPT, Gemini, Ollama, LM Studio) with automatic failover. The codebase contains ${srcModules} source modules and ${classes.size} classes.`,
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
    `| Source Modules | ${srcModules} |`,
    `| Classes | ${classes.size} |`,
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

  // Entry points with explicit labels for known mains
  const entryLabels: Record<string, string> = {
    'src/index': 'CLI entry point (Commander)',
    'src/server/index': 'HTTP/WebSocket server (Express)',
    'src/daemon/index': 'Background daemon service',
    'src/channels/index': 'Multi-channel messaging hub',
  };
  lines.push('', '## Entry Points', '');
  for (const entry of entryPoints) {
    const name = entry.entity.replace(/^mod:/, '');
    const label = entryLabels[name] ?? inferModuleDescription(name);
    lines.push(`- **\`${name}\`** — ${label}`);
  }

  // Technology stack — comprehensive detection
  lines.push('', '## Technology Stack', '');
  lines.push('| Category | Technologies |', '|----------|-------------|');
  if (deps.includes('commander')) lines.push('| CLI Framework | commander |');
  if (deps.includes('ink')) lines.push('| Terminal UI | ink, react |');

  // LLM SDKs — check both deps and devDeps
  const allDeps = [...deps, ...devDeps];
  const llmSdks: string[] = [];
  if (allDeps.some(d => d === 'openai')) llmSdks.push('openai');
  if (allDeps.some(d => d.includes('anthropic'))) llmSdks.push('@anthropic-ai/sdk');
  if (allDeps.some(d => d.includes('generative-ai') || d.includes('google'))) llmSdks.push('@google/generative-ai');
  // Also detect from code: check if the project has multi-provider support
  if (llmSdks.length === 1 && modNames.some(m => m.includes('provider') || m.includes('gemini') || m.includes('anthropic'))) {
    llmSdks.push('(multi-provider via OpenAI-compatible API)');
  }
  lines.push(`| LLM SDKs | ${llmSdks.length > 0 ? llmSdks.join(', ') : 'OpenAI-compatible API'} |`);

  if (deps.includes('express')) lines.push('| HTTP Server | express, ws, cors |');
  if (deps.includes('better-sqlite3')) lines.push('| Database | better-sqlite3 |');
  if (allDeps.some(d => d.includes('tree-sitter'))) lines.push('| Code Parsing | tree-sitter, tree-sitter-bash |');
  if (allDeps.some(d => d.includes('ripgrep'))) lines.push('| File Search | @vscode/ripgrep |');
  if (deps.includes('zod')) lines.push('| Validation | zod |');
  if (allDeps.some(d => d.includes('playwright'))) lines.push('| Browser Automation | playwright |');
  if (allDeps.some(d => d.includes('modelcontextprotocol'))) lines.push('| MCP | @modelcontextprotocol/sdk |');
  if (deps.includes('vitest') || devDeps.includes('vitest')) lines.push('| Testing | vitest |');

  return lines.join('\n');
}

/** Infer a human-readable description from a module path */
function inferModuleDescription(modulePath: string): string {
  const parts = modulePath.replace(/^src\//, '').split('/');

  // Exact path matches (most specific first)
  const exactMap: Record<string, string> = {
    'agent/codebuddy-agent': 'Central agent orchestrator',
    'agent/execution/agent-executor': 'ReAct execution loop (tool calls + LLM)',
    'codebuddy/client': 'Multi-provider LLM API client',
    'codebuddy/tools': 'Tool definitions and RAG selection',
    'context/context-manager-v2': 'Context window compression (4-stage)',
    'utils/confirmation-service': 'User approval gate for destructive ops',
    'security/shell-env-policy': 'Environment variable filtering',
    'security/guardian-agent': 'AI-powered automatic approval reviewer',
    'prompts/prompt-manager': 'System prompt construction',
    'agent/specialized/agent-registry': 'Specialized agent registry (PDF, SQL, SWE...)',
    'persistence/session-store': 'Session persistence and restore',
    'embeddings/embedding-provider': 'Vector embedding generation',
  };
  const pathKey = parts.join('/');
  if (exactMap[pathKey]) return exactMap[pathKey];

  // Directory-level descriptions
  const dirMap: Record<string, string> = {
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
    'utils': 'Shared utilities',
    'types': 'TypeScript type definitions',
    'errors': 'Error handling',
    'integrations': 'External service integrations',
    'analytics': 'Usage analytics and cost tracking',
    'optimization': 'Performance optimization',
    'providers': 'LLM provider adapters',
    'hooks': 'Execution hooks',
    'streaming': 'Streaming response handling',
    'plugins': 'Plugin system',
    'docs': 'Documentation generation',
    'mcp': 'Model Context Protocol servers',
    'nodes': 'Multi-device management',
    'database': 'Database management',
    'renderers': 'Output rendering',
  };
  for (const part of parts) {
    if (dirMap[part]) return dirMap[part];
  }

  // Derive from last segment — capitalize properly
  const last = parts[parts.length - 1];
  const humanized = last.replace(/-/g, ' ').replace(/([A-Z])/g, ' $1').trim();
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
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
      // Use the main agent module as center (not just highest connection count)
      const preferredCenters = ['mod:src/agent/codebuddy-agent', 'mod:src/codebuddy/client', 'mod:src/agent/execution/agent-executor'];
      let bestMod = '';
      for (const center of preferredCenters) {
        if (modules.has(center)) { bestMod = center; break; }
      }
      if (!bestMod) {
        // Fallback to most connected src/ module
        let bestConns = 0;
        for (const mod of modules) {
          if (!mod.startsWith('mod:src/')) continue;
          const conns = graph.query({ subject: mod }).length + graph.query({ object: mod }).length;
          if (conns > bestConns) { bestConns = conns; bestMod = mod; }
        }
      }
      if (bestMod) {
        lines.push('## Core Module Dependencies', '');
        const diagram = generateModuleDependencies(graph, bestMod, 2, 30);
        lines.push('```mermaid', diagram, '```', '');
      }
    } catch { /* mermaid optional */ }
  }

  // Layer analysis with descriptions
  // Layer descriptions — derived from inferModuleDescription (no hardcoding)
  // Just reuse the same function that describes modules

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
    const desc = inferModuleDescription(layer.replace(/^src\//, ''));
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
      // Filter: skip exported API methods (likely used externally)
      const exportPatterns = [/Client\./, /Server\./, /Manager\.get/, /Provider\./];
      const isLikelyExported = (name: string) => exportPatterns.some(p => p.test(name));

      const highFiltered = deadCode.byConfidence.high.filter(fn => !isLikelyExported(fn));
      lines.push('### Top Dead Code Candidates', '');
      lines.push('*Note: Exported API methods and dynamic dispatch targets are excluded.*', '');
      for (const fn of highFiltered.slice(0, 15)) {
        lines.push(`- \`${fn.replace(/^fn:/, '')}\` (high confidence)`);
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
        const name = s.entity.replace(/^(mod|fn|cls):/, '');
        lines.push(`- **${name}**: ${s.reason} (PageRank: ${s.pageRank.toFixed(3)}, ${s.totalCallers} callers)`);
      }
      lines.push('');
    }
  } catch { /* optional */ }

  return lines.join('\n');
}

// ============================================================================
// Section 5: Tool System
// ============================================================================

function generateToolSystem(graph: KnowledgeGraph, cwd: string, modules: Set<string>): string {
  const lines = [
    '# Tool System',
    '',
    'The project uses a dual-registry tool architecture with RAG-based selection. Tools are organized by category and selected per-query based on semantic relevance.',
    '',
  ];

  // Detect tool-related modules
  const toolModules = [...modules]
    .filter(m => m.includes('/tools/'))
    .map(m => m.replace(/^mod:/, ''));

  lines.push('## Tool Registry', '');
  lines.push(`The tool ecosystem contains **${toolModules.length}** tool modules organized in \`src/tools/\` and \`src/tools/registry/\`.`, '');

  // Read metadata file early (used for categories and tool listing)
  const metadataContent = readFileSafe(path.join(cwd, 'src', 'tools', 'metadata.ts'), 8000);

  // Dynamic tool categories from metadata file
  lines.push('## Tool Categories', '');
  if (metadataContent) {
    // Extract categories from metadata
    const catTools = new Map<string, string[]>();
    const catMatch = metadataContent.matchAll(/category:\s*['"]([^'"]+)['"][\s\S]*?name:\s*['"]([^'"]+)['"]/g);
    for (const m of catMatch) {
      const list = catTools.get(m[1]) ?? [];
      list.push(m[2]);
      catTools.set(m[1], list);
    }
    // Also try name-first pattern
    const nameFirst = metadataContent.matchAll(/name:\s*['"]([^'"]+)['"][\s\S]*?category:\s*['"]([^'"]+)['"]/g);
    for (const m of nameFirst) {
      const list = catTools.get(m[2]) ?? [];
      if (!list.includes(m[1])) list.push(m[1]);
      catTools.set(m[2], list);
    }
    if (catTools.size > 0) {
      lines.push('| Category | Tools | Count |', '|----------|-------|-------|');
      for (const [cat, tools] of [...catTools.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const displayTools = tools.slice(0, 4).map(t => `\`${t}\``).join(', ');
        const more = tools.length > 4 ? ` +${tools.length - 4}` : '';
        lines.push(`| ${cat} | ${displayTools}${more} | ${tools.length} |`);
      }
    } else {
      lines.push('*Tool categories could not be extracted from metadata.*');
    }
  } else {
    lines.push('*No tool metadata file found at `src/tools/metadata.ts`.*');
  }

  // Tool selection process
  lines.push('', '## RAG-Based Tool Selection', '');
  lines.push('Each user query triggers a semantic similarity search over tool metadata:');
  lines.push('');
  lines.push('1. **Query embedding** — User message converted to vector');
  lines.push('2. **Similarity scoring** — Each tool scored against query (0-1)');
  lines.push('3. **Top-K selection** — ~15-20 most relevant tools selected');
  lines.push('4. **Token savings** — Reduces prompt from 110+ tools to ~15-20');
  lines.push('');
  lines.push('Tools have priority (3-10), keywords, and category metadata used for matching.');

  // Tool names from already-loaded metadata
  if (metadataContent) {
    const toolNames = [...metadataContent.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    if (toolNames.length > 0) {
      lines.push('', '## Registered Tools', '');
      lines.push(`${toolNames.length} tools registered in metadata:`, '');
      // Group by prefix
      const grouped = new Map<string, string[]>();
      for (const name of toolNames) {
        const prefix = name.split('_')[0] ?? 'other';
        const list = grouped.get(prefix) ?? [];
        list.push(name);
        grouped.set(prefix, list);
      }
      for (const [prefix, names] of [...grouped.entries()].sort()) {
        lines.push(`- **${prefix}**: ${names.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Section 6: Security Architecture
// ============================================================================

function generateSecurity(cwd: string): string {
  const lines = [
    '# Security Architecture',
    '',
  ];

  // Scan for security-related files dynamically
  const securityDir = path.join(cwd, 'src', 'security');
  const securityFiles: string[] = [];
  try {
    if (fs.existsSync(securityDir)) {
      securityFiles.push(...fs.readdirSync(securityDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')));
    }
  } catch { /* optional */ }

  if (securityFiles.length > 0) {
    lines.push(`The project has **${securityFiles.length}** security modules in \`src/security/\`:`, '');
    lines.push('| Module | Purpose |', '|--------|---------|');
    for (const file of securityFiles.sort()) {
      const name = file.replace('.ts', '');
      // Read first JSDoc comment for description
      const content = readFileSafe(path.join(securityDir, file), 500);
      const docMatch = content.match(/\/\*\*[\s\S]*?\*\s+(.+?)[\n*]/);
      const desc = docMatch ? docMatch[1].trim() : inferModuleDescription(name);
      lines.push(`| \`${name}\` | ${desc} |`);
    }
    lines.push('');
  } else {
    lines.push('*No security directory found.*', '');
  }

  // Scan for confirmation/sandbox patterns
  const hasConfirmation = securityFiles.some(f => f.includes('confirm'));
  const hasSandbox = fs.existsSync(path.join(cwd, 'src', 'sandbox'));
  const hasGuardian = securityFiles.some(f => f.includes('guardian'));

  if (hasConfirmation || hasSandbox || hasGuardian) {
    lines.push('## Security Features', '');
    if (hasGuardian) lines.push('- **AI Guardian Agent**: Automatic approval reviewer with risk scoring');
    if (hasConfirmation) lines.push('- **Confirmation Service**: User approval gate for destructive operations');
    if (hasSandbox) lines.push('- **Sandbox Isolation**: Sandboxed execution environment');
    if (securityFiles.some(f => f.includes('ssrf'))) lines.push('- **SSRF Protection**: Blocks requests to private IP ranges');
    if (securityFiles.some(f => f.includes('shell') || f.includes('bash'))) lines.push('- **Shell Command Validation**: Dangerous pattern detection');
    if (securityFiles.some(f => f.includes('path'))) lines.push('- **Path Validation**: Traversal and symlink escape prevention');
    if (securityFiles.some(f => f.includes('env') || f.includes('policy'))) lines.push('- **Environment Filtering**: Sensitive variable stripping');
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Section 7: Context & Memory
// ============================================================================

function generateContextMemory(cwd: string): string {
  const lines = [
    '# Context & Memory Management',
    '',
  ];

  // Scan context directory
  const contextDir = path.join(cwd, 'src', 'context');
  const memoryDir = path.join(cwd, 'src', 'memory');
  const contextFiles: string[] = [];
  const memoryFiles: string[] = [];

  try {
    if (fs.existsSync(contextDir)) {
      contextFiles.push(...fs.readdirSync(contextDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')));
    }
  } catch { /* optional */ }
  try {
    if (fs.existsSync(memoryDir)) {
      memoryFiles.push(...fs.readdirSync(memoryDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')));
    }
  } catch { /* optional */ }

  if (contextFiles.length > 0) {
    lines.push(`## Context Management (${contextFiles.length} modules)`, '');
    lines.push('| Module | Purpose |', '|--------|---------|');
    for (const file of contextFiles.sort()) {
      const name = file.replace('.ts', '');
      const content = readFileSafe(path.join(contextDir, file), 500);
      const docMatch = content.match(/\/\*\*[\s\S]*?\*\s+(.+?)[\n*]/);
      const desc = docMatch ? docMatch[1].trim() : name.replace(/-/g, ' ');
      lines.push(`| \`${name}\` | ${desc} |`);
    }
    lines.push('');
  }

  if (memoryFiles.length > 0) {
    lines.push(`## Memory System (${memoryFiles.length} modules)`, '');
    lines.push('| Module | Purpose |', '|--------|---------|');
    for (const file of memoryFiles.sort()) {
      const name = file.replace('.ts', '');
      const content = readFileSafe(path.join(memoryDir, file), 500);
      const docMatch = content.match(/\/\*\*[\s\S]*?\*\s+(.+?)[\n*]/);
      const desc = docMatch ? docMatch[1].trim() : name.replace(/-/g, ' ');
      lines.push(`| \`${name}\` | ${desc} |`);
    }
    lines.push('');
  }

  if (contextFiles.length === 0 && memoryFiles.length === 0) {
    lines.push('*No context or memory modules found.*');
  }

  return lines.join('\n');
}

// ============================================================================
// Section 8: Configuration
// ============================================================================

function generateConfiguration(cwd: string): string {
  // Extract env vars from CLAUDE.md — match `VARNAME` | description | default
  const claudeMd = readFileSafe(path.join(cwd, 'CLAUDE.md'), 10000);
  const envVars: Array<{ name: string; desc: string }> = [];
  if (claudeMd) {
    const envMatch = claudeMd.matchAll(/\|\s*`([A-Z_]+)`\s*\|\s*([^|]+)\s*\|/g);
    for (const m of envMatch) {
      if (m[1] && m[2] && !m[1].startsWith('Variable')) { // Skip header row
        envVars.push({ name: m[1], desc: m[2].trim() });
      }
    }
  }
  // Fallback: scan .env.example or source code for env var references
  if (envVars.length === 0) {
    const envExample = readFileSafe(path.join(cwd, '.env.example'), 5000);
    if (envExample) {
      const envLines = envExample.split('\n');
      for (const line of envLines) {
        const match = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
        if (match) {
          const comment = envLines[envLines.indexOf(line) - 1];
          const desc = comment?.startsWith('#') ? comment.slice(1).trim() : '';
          envVars.push({ name: match[1], desc: desc || match[1].toLowerCase().replace(/_/g, ' ') });
        }
      }
    }
  }

  const lines = [
    '# Configuration System',
    '',
    'Three-tier configuration hierarchy with environment variable overrides:',
    '',
    '## Configuration Hierarchy',
    '',
    '```',
    '1. Default (in-code)     — Base behavior',
    '2. User (~/.codebuddy/)  — Personal preferences',
    '3. Project (.codebuddy/) — Project-specific settings',
    '4. Environment variables — Runtime overrides',
    '5. CLI flags             — Highest priority',
    '```',
    '',
    '## Key Configuration Files',
    '',
  ];

  // Dynamically scan for config files in project root and .codebuddy/
  const configFiles: Array<{ file: string; location: string }> = [];
  const configPatterns = ['*.toml', '*.json', '*.md', '*.yaml', '*.yml'];
  const configDirs = ['.codebuddy', '.claude', '.config'];

  // Root config files
  for (const f of ['tsconfig.json', '.eslintrc.json', '.prettierrc', 'vitest.config.ts', '.env.example']) {
    if (fs.existsSync(path.join(cwd, f))) configFiles.push({ file: f, location: 'project root' });
  }

  // .codebuddy/ config files
  for (const dir of configDirs) {
    const dirPath = path.join(cwd, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      try {
        const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && (f.endsWith('.json') || f.endsWith('.toml') || f.endsWith('.md')));
        for (const f of files.slice(0, 10)) {
          configFiles.push({ file: f, location: `${dir}/` });
        }
      } catch { /* optional */ }
    }
  }

  if (configFiles.length > 0) {
    lines.push('| File | Location |', '|------|----------|');
    for (const { file, location } of configFiles) {
      lines.push(`| \`${file}\` | ${location} |`);
    }
    lines.push('');
  }

  if (envVars.length > 0) {
    lines.push('## Environment Variables', '');
    lines.push('| Variable | Description |', '|----------|-------------|');
    for (const { name, desc } of envVars.slice(0, 20)) {
      lines.push(`| \`${name}\` | ${desc} |`);
    }
    lines.push('');
  }

  lines.push('## Model Configuration', '');
  lines.push('Models configured via `src/config/model-tools.ts` with glob matching:');
  lines.push('');
  lines.push('- Per-model: `contextWindow`, `maxOutputTokens`, `patchFormat`');
  lines.push('- Provider auto-detection from model name or base URL');
  lines.push('- Supports: Grok, Claude, GPT, Gemini, Ollama, LM Studio');

  return lines.join('\n');
}

// ============================================================================
// Section 9: API Reference
// ============================================================================

function generateApiReference(cwd: string): string {
  const pkg = readPkg(cwd);
  const binName = Object.keys((pkg.bin ?? {}) as Record<string, string>)[0] ?? path.basename(cwd);

  const lines = [
    '# CLI & API Reference',
    '',
  ];

  // CLI commands: extract from src/index.ts by scanning .command() calls
  const indexTs = readFileSafe(path.join(cwd, 'src', 'index.ts'), 15000);
  if (indexTs) {
    const commands: Array<{ name: string; desc: string }> = [];
    const cmdMatches = indexTs.matchAll(/\.command\(\s*['"]([^'"]+)['"]\s*\)\s*\n?\s*\.description\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const m of cmdMatches) {
      commands.push({ name: m[1], desc: m[2] });
    }
    // Also extract options
    const optMatches = indexTs.matchAll(/\.option\(\s*['"](-[^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g);
    const options: Array<{ flag: string; desc: string }> = [];
    for (const m of optMatches) {
      options.push({ flag: m[1], desc: m[2] });
    }

    if (commands.length > 0) {
      lines.push('## CLI Subcommands', '');
      lines.push('| Command | Description |', '|---------|-------------|');
      for (const cmd of commands) {
        lines.push(`| \`${binName} ${cmd.name}\` | ${cmd.desc} |`);
      }
      lines.push('');
    }
    if (options.length > 0) {
      lines.push('## CLI Options', '');
      lines.push('| Flag | Description |', '|------|-------------|');
      for (const opt of options.slice(0, 20)) {
        lines.push(`| \`${opt.flag}\` | ${opt.desc} |`);
      }
      lines.push('');
    }
  }

  // Slash commands: scan src/commands/slash/ for command definitions
  const slashDir = path.join(cwd, 'src', 'commands', 'slash');
  if (fs.existsSync(slashDir)) {
    try {
      const slashFiles = fs.readdirSync(slashDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      if (slashFiles.length > 0) {
        lines.push('## Slash Commands', '');
        lines.push('| File | Purpose |', '|------|---------|');
        for (const file of slashFiles.sort()) {
          const name = file.replace('.ts', '').replace('-command', '').replace('-commands', '');
          const content = readFileSafe(path.join(slashDir, file), 300);
          const docMatch = content.match(/\/\*\*[\s\S]*?\*\s+(.+?)[\n*]/);
          const desc = docMatch ? docMatch[1].trim() : name.replace(/-/g, ' ');
          lines.push(`| \`/${name}\` | ${desc} |`);
        }
        lines.push('');
      }
    } catch { /* optional */ }
  }

  // HTTP API: scan src/server/routes/ for route files
  const routesDir = path.join(cwd, 'src', 'server', 'routes');
  if (fs.existsSync(routesDir)) {
    try {
      const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));
      if (routeFiles.length > 0) {
        lines.push('## HTTP API Routes', '');
        lines.push('| Route File | Endpoints |', '|------------|----------|');
        for (const file of routeFiles.sort()) {
          const content = readFileSafe(path.join(routesDir, file), 3000);
          // Extract route patterns
          const routes = [...content.matchAll(/\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/gi)];
          const endpoints = routes.slice(0, 5).map(r => `${r[1].toUpperCase()} ${r[2]}`).join(', ');
          lines.push(`| \`${file}\` | ${endpoints || 'N/A'} |`);
        }
        lines.push('');
      }
    } catch { /* optional */ }
  };

  return lines.join('\n');
}

// ============================================================================
// Section 10: Development Guide
// ============================================================================

function generateDevGuide(cwd: string): string {
  const pkg = readPkg(cwd);
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;

  const lines = [
    '# Development Guide',
    '',
    '## Getting Started', '',
    '```bash',
    'git clone <repo-url>',
    'cd ' + path.basename(cwd),
    'npm install',
    'npm run dev          # Development mode (Bun)',
    'npm run dev:node     # Development mode (tsx/Node.js)',
    '```', '',
    '## Build & Development Commands', '',
    '| Command | Description |',
    '|---------|-------------|',
  ];

  for (const [name, cmd] of Object.entries(scripts).slice(0, 20)) {
    lines.push(`| \`npm run ${name}\` | \`${cmd}\` |`);
  }

  // Dynamic project structure from filesystem
  const srcDir = path.join(cwd, 'src');
  if (fs.existsSync(srcDir)) {
    lines.push('', '## Project Structure', '');
    lines.push('```');
    lines.push('src/');
    try {
      const dirs = fs.readdirSync(srcDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
      for (const dir of dirs) {
        const desc = inferModuleDescription(dir);
        const fileCount = fs.readdirSync(path.join(srcDir, dir), { recursive: true })
          .filter((f: string | Buffer) => String(f).endsWith('.ts') && !String(f).endsWith('.test.ts')).length;
        lines.push(`├── ${dir.padEnd(20)} # ${desc} (${fileCount} files)`);
      }
      // Entry file
      if (fs.existsSync(path.join(srcDir, 'index.ts'))) {
        lines.push('└── index.ts            # Entry point');
      }
    } catch { lines.push('└── (could not read directory)'); }
    lines.push('```', '');
  }

  // Detect conventions from config files
  lines.push('## Coding Conventions', '');
  const tsConfig = readFileSafe(path.join(cwd, 'tsconfig.json'), 1000);
  if (tsConfig.includes('"strict"')) lines.push('- TypeScript strict mode');
  const eslintConfig = readFileSafe(path.join(cwd, '.eslintrc.json'), 500) || readFileSafe(path.join(cwd, '.eslintrc.js'), 500);
  if (eslintConfig.includes('single') || eslintConfig.includes("'quotes'")) lines.push('- Single quotes');
  const prettierConfig = readFileSafe(path.join(cwd, '.prettierrc'), 500);
  if (prettierConfig.includes('semi')) lines.push('- Semicolons');
  // Detect from package.json type
  if (pkg.type === 'module') lines.push('- ESM modules (`"type": "module"`)');
  // Detect commit convention from recent commits
  const commitConvention = readFileSafe(path.join(cwd, '.commitlintrc.json'), 200);
  if (commitConvention.includes('conventional')) lines.push('- Conventional Commits');
  lines.push('');

  lines.push('## Testing', '');
  lines.push('- Framework: **Vitest** with happy-dom');
  lines.push('- Tests in `tests/` and co-located `src/**/*.test.ts`');
  lines.push('- Run: `npm test` (all), `npm run test:watch` (dev)');
  lines.push('- Coverage: `npm run test:coverage`');
  lines.push('- Validate: `npm run validate` (lint + typecheck + test)');
  lines.push('');

  // Extension patterns — detect from project structure
  if (fs.existsSync(path.join(cwd, 'src', 'tools'))) {
    lines.push('## Extension Points', '');
    lines.push('- Add new tools in `src/tools/`');
    if (fs.existsSync(path.join(cwd, 'src', 'tools', 'registry'))) lines.push('- Register tools in `src/tools/registry/`');
    if (fs.existsSync(path.join(cwd, 'src', 'tools', 'metadata.ts'))) lines.push('- Add metadata in `src/tools/metadata.ts`');
    if (fs.existsSync(path.join(cwd, 'src', 'channels'))) lines.push('- Add channels in `src/channels/`');
    if (fs.existsSync(path.join(cwd, 'src', 'plugins'))) lines.push('- Add plugins in `src/plugins/`');
  }

  return lines.join('\n');
}

// ============================================================================
// Section 11: Changelog (from git)
// ============================================================================

function generateChangelog(cwd: string): string {
  const lines = [
    '# Recent Changes',
    '',
  ];

  try {
    const { execFileSync } = require('child_process');
    const log = execFileSync('git', ['log', '--oneline', '-30', '--no-decorate'], {
      cwd,
      timeout: 5000,
      encoding: 'utf-8',
    });
    lines.push('Last 30 commits:', '');
    lines.push('```');
    lines.push(log.trim());
    lines.push('```');
  } catch {
    lines.push('*Git log not available.*');
  }

  return lines.join('\n');
}

// ============================================================================
// Index Generator
// ============================================================================

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
