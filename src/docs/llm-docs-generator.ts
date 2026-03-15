/**
 * LLM-Powered Documentation Generator
 *
 * Extends the raw graph-based docs generator with LLM prose generation.
 * Each section is enriched by passing the raw data + relevant source files
 * to the LLM, which produces narrative DeepWiki-style documentation.
 *
 * The generated docs serve dual purpose:
 * 1. Human-readable documentation (like DeepWiki)
 * 2. Project knowledge context for future agent sessions
 *
 * Output: .codebuddy/docs/ — same structure but with rich narrative content.
 * Also generates: .codebuddy/PROJECT_KNOWLEDGE.md — compact knowledge for injection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { KnowledgeGraph } from '../knowledge/knowledge-graph.js';

// ============================================================================
// Types
// ============================================================================

/** LLM call function — injected to avoid circular deps */
export type LLMDocCall = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface LLMDocsOptions {
  cwd?: string;
  outputDir?: string;
  /** LLM call function */
  llmCall: LLMDocCall;
  /** Maximum tokens per section (controls LLM output length) */
  maxTokensPerSection?: number;
  /** Skip sections (by number) */
  skipSections?: number[];
  /** Progress callback */
  onProgress?: (section: string, current: number, total: number) => void;
}

export interface LLMDocsResult {
  files: string[];
  durationMs: number;
  entityCount: number;
  tokensUsed: number;
  knowledgeFilePath: string;
  errors: string[];
}

// ============================================================================
// Section Definitions (DeepWiki-style, 12 sections)
// ============================================================================

interface SectionDef {
  id: number;
  filename: string;
  title: string;
  systemPrompt: string;
  /** Function that builds the data context for this section */
  buildContext: (graph: KnowledgeGraph, cwd: string) => Promise<string>;
}

const DOC_SYSTEM_PROMPT = `You are a technical documentation writer generating DeepWiki-style project documentation.

Rules:
- Write clear, concise technical prose (not bullet-point dumps)
- Explain WHY things are designed the way they are, not just WHAT they are
- Use markdown headers (##, ###) for structure
- Include code snippets where relevant (short, illustrative)
- Reference specific file paths when mentioning components
- Use tables for comparisons and quick-reference data
- Add mermaid diagrams in fenced blocks when they clarify architecture
- Keep each section focused and self-contained
- Write as if explaining to a new developer joining the project`;

function buildSections(): SectionDef[] {
  return [
    {
      id: 1,
      filename: '1-overview.md',
      title: 'Project Overview',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Write a comprehensive project overview including:
- What the project does and who it's for
- Key capabilities and differentiators
- Technology stack with rationale
- Project statistics from the code graph
- Getting started guide (installation, first run)`,
      buildContext: async (graph, cwd) => {
        const stats = graph.getStats();
        const pkg = readJsonSafe(path.join(cwd, 'package.json'));
        const readme = readFileSafe(path.join(cwd, 'README.md'), 3000);
        const claudeMd = readFileSafe(path.join(cwd, 'CLAUDE.md'), 3000);
        const topModules = getTopModules(graph, 20);

        return [
          `# Raw Data for Overview Section`,
          ``,
          `## package.json`,
          `Name: ${pkg?.name ?? 'unknown'}`,
          `Version: ${pkg?.version ?? '?'}`,
          `Description: ${pkg?.description ?? '?'}`,
          `Dependencies: ${Object.keys(pkg?.dependencies ?? {}).length}`,
          `DevDependencies: ${Object.keys(pkg?.devDependencies ?? {}).length}`,
          ``,
          `## Code Graph Statistics`,
          `Triples: ${stats.tripleCount}`,
          `Modules: ${stats.subjectCount}`,
          `Predicates: ${stats.predicateCount}`,
          ``,
          `## Top Modules by PageRank`,
          topModules.map(m => `- ${m.name} (rank: ${m.rank.toFixed(3)}, ${m.importers} importers)`).join('\n'),
          ``,
          `## README.md (first 3000 chars)`,
          readme || '(not found)',
          ``,
          `## CLAUDE.md (first 3000 chars)`,
          claudeMd || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 2,
      filename: '2-architecture.md',
      title: 'Core Architecture',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Write an architecture document including:
- High-level architecture diagram (mermaid flowchart)
- Layer-by-layer description (what each layer does)
- Core component descriptions with responsibilities
- Data flow from user input to response
- Key design decisions and their rationale`,
      buildContext: async (graph, cwd) => {
        const layers = getModuleLayers(graph);
        const topModules = getTopModules(graph, 30);
        const indexTs = readFileSafe(path.join(cwd, 'src', 'index.ts'), 2000);
        const agentTs = readFileSafe(path.join(cwd, 'src', 'agent', 'codebuddy-agent.ts'), 2000);

        return [
          `# Raw Data for Architecture Section`,
          ``,
          `## Module Layers (by directory)`,
          ...layers.slice(0, 20).map(([layer, count]) => `- ${layer}: ${count} modules`),
          ``,
          `## Top 30 Modules`,
          topModules.map(m => `- ${m.name} (rank: ${m.rank.toFixed(3)}, ${m.importers} importers, ${m.callers} callers)`).join('\n'),
          ``,
          `## Entry Point (src/index.ts, first 2000 chars)`,
          indexTs || '(not found)',
          ``,
          `## Main Agent (src/agent/codebuddy-agent.ts, first 2000 chars)`,
          agentTs || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 3,
      filename: '3-core-components.md',
      title: 'Core Components',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document each core component:
- Purpose and responsibilities
- Key methods and their behavior
- Dependencies (what it imports/calls)
- How it integrates with other components
Use a consistent format for each component.`,
      buildContext: async (graph, _cwd) => {
        const topModules = getTopModules(graph, 15);
        const details: string[] = ['# Raw Data for Core Components'];
        for (const mod of topModules) {
          const entity = `mod:${mod.name}`;
          const fns = graph.query({ subject: entity, predicate: 'containsFunction' });
          const imports = graph.query({ subject: entity, predicate: 'imports' });
          const importedBy = graph.query({ predicate: 'imports', object: entity });
          details.push(`\n## ${mod.name}`);
          details.push(`PageRank: ${mod.rank.toFixed(3)}`);
          details.push(`Functions: ${fns.map(f => f.object.replace(/^fn:/, '')).join(', ')}`);
          details.push(`Imports: ${imports.map(i => i.object.replace(/^mod:/, '')).slice(0, 10).join(', ')}`);
          details.push(`Imported by: ${importedBy.map(i => i.subject.replace(/^mod:/, '')).slice(0, 10).join(', ')}`);
        }
        return details.join('\n');
      },
    },
    {
      id: 4,
      filename: '4-subsystems.md',
      title: 'Architectural Subsystems',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document the architectural subsystems (clusters) detected by community detection:
- Name each subsystem based on its modules
- Describe what each subsystem does
- Show how subsystems interact
- Include a mermaid diagram of subsystem interactions
- Identify the key module in each subsystem`,
      buildContext: async (graph, _cwd) => {
        try {
          const { detectCommunities } = await import('../knowledge/community-detection.js');
          const communities = detectCommunities(graph);
          const lines = [`# Detected ${communities.communitySizes.size} subsystems (modularity: ${communities.modularity.toFixed(3)})\n`];
          for (const [id, members] of communities.communityMembers) {
            if (members.length < 3) continue;
            const names = members.map(m => m.replace(/^mod:/, ''));
            const topMember = members.reduce((best, m) =>
              graph.getEntityRank(m) > graph.getEntityRank(best) ? m : best, members[0]);
            lines.push(`## Community ${id} (${members.length} modules)`);
            lines.push(`Top module: ${topMember.replace(/^mod:/, '')} (rank: ${graph.getEntityRank(topMember).toFixed(3)})`);
            lines.push(`Members: ${names.slice(0, 15).join(', ')}${names.length > 15 ? ` +${names.length - 15} more` : ''}`);
            lines.push('');
          }
          return lines.join('\n');
        } catch {
          return 'Community detection not available.';
        }
      },
    },
    {
      id: 5,
      filename: '5-tools.md',
      title: 'Tool System',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document the tool system:
- How tools are registered and selected
- Tool categories with examples
- The RAG-based tool selection process
- How to add a new tool
- Key tools and their purposes`,
      buildContext: async (_graph, cwd) => {
        const metadata = readFileSafe(path.join(cwd, 'src', 'tools', 'metadata.ts'), 4000);
        const toolsTs = readFileSafe(path.join(cwd, 'src', 'codebuddy', 'tools.ts'), 2000);
        return [
          `# Tool System Raw Data`,
          `\n## Tool Metadata (src/tools/metadata.ts)`,
          metadata || '(not found)',
          `\n## Tool Registration (src/codebuddy/tools.ts)`,
          toolsTs || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 6,
      filename: '6-security.md',
      title: 'Security Architecture',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document the security architecture:
- Security layers and their purposes
- How file operations are validated
- Bash command security (tree-sitter parsing)
- SSRF protection
- Confirmation service and approval flow
- The Guardian sub-agent (AI-powered approval)
- Environment variable filtering`,
      buildContext: async (_graph, cwd) => {
        const guardian = readFileSafe(path.join(cwd, 'src', 'security', 'guardian-agent.ts'), 2000);
        const shellPolicy = readFileSafe(path.join(cwd, 'src', 'security', 'shell-env-policy.ts'), 2000);
        const policyAmend = readFileSafe(path.join(cwd, 'src', 'security', 'policy-amendments.ts'), 2000);
        return [
          `# Security Raw Data`,
          `\n## Guardian Agent`, guardian || '(not found)',
          `\n## Shell Env Policy`, shellPolicy || '(not found)',
          `\n## Policy Amendments`, policyAmend || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 7,
      filename: '7-context-memory.md',
      title: 'Context & Memory Management',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document context and memory management:
- How the context window is managed (ContextManagerV2)
- Compression strategies (4 stages)
- The attention bias pattern (todo at END)
- Memory consolidation pipeline
- Lessons tracker and self-improvement
- JIT context discovery
- Tool output masking and TTL expiry`,
      buildContext: async (_graph, cwd) => {
        const ctxMgr = readFileSafe(path.join(cwd, 'src', 'context', 'context-manager-v2.ts'), 2000);
        const masking = readFileSafe(path.join(cwd, 'src', 'context', 'tool-output-masking.ts'), 1500);
        const jit = readFileSafe(path.join(cwd, 'src', 'context', 'jit-context.ts'), 1500);
        return [
          `# Context & Memory Raw Data`,
          `\n## ContextManagerV2`, ctxMgr || '(not found)',
          `\n## Tool Output Masking`, masking || '(not found)',
          `\n## JIT Context`, jit || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 8,
      filename: '8-code-quality.md',
      title: 'Code Quality Metrics',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Analyze the code quality metrics and write a report:
- Dead code analysis with recommendations
- Module coupling hotspots
- Refactoring suggestions with rationale
- Overall code health assessment
Be specific — reference actual module names and numbers.`,
      buildContext: async (graph, _cwd) => {
        const lines = ['# Code Quality Raw Data\n'];
        try {
          const { detectDeadCode, computeCoupling, suggestRefactoring } = await import('../knowledge/graph-analytics.js');
          const dead = detectDeadCode(graph);
          lines.push(`## Dead Code: ${dead.totalDead} candidates (${dead.byConfidence.high.length} high, ${dead.byConfidence.medium.length} medium, ${dead.byConfidence.low.length} low)`);
          lines.push(`Top high-confidence: ${dead.byConfidence.high.slice(0, 10).join(', ')}`);
          lines.push(`Unused modules: ${dead.unimportedModules.slice(0, 10).join(', ')}`);
          const coupling = computeCoupling(graph, 10);
          lines.push(`\n## Coupling Hotspots (avg: ${coupling.averageCoupling.toFixed(1)})`);
          for (const h of coupling.hotspots.slice(0, 10)) {
            lines.push(`- ${h.moduleA.replace(/^mod:/, '')} ↔ ${h.moduleB.replace(/^mod:/, '')}: ${h.total} (${h.calls} calls, ${h.imports} imports)`);
          }
          const refactors = suggestRefactoring(graph);
          lines.push(`\n## Refactoring Suggestions`);
          for (const r of refactors.slice(0, 10)) {
            lines.push(`- ${r.entity}: ${r.reason} (${r.totalCallers} callers, rank ${r.pageRank.toFixed(3)})`);
          }
        } catch (e) { lines.push(`Error: ${e}`); }
        return lines.join('\n');
      },
    },
    {
      id: 9,
      filename: '9-configuration.md',
      title: 'Configuration System',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document the configuration system:
- Configuration file locations and hierarchy
- Key configuration options with defaults
- Environment variables
- Model and provider configuration
- How to customize behavior`,
      buildContext: async (_graph, cwd) => {
        const claudeMd = readFileSafe(path.join(cwd, 'CLAUDE.md'), 5000);
        const configTs = readFileSafe(path.join(cwd, 'src', 'config', 'model-tools.ts'), 2000);
        return [
          `# Configuration Raw Data`,
          `\n## CLAUDE.md (contains env vars, config)`, claudeMd || '(not found)',
          `\n## Model Configuration`, configTs || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 10,
      filename: '10-cli-reference.md',
      title: 'CLI & Command Reference',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Write a comprehensive CLI reference:
- Main CLI commands with examples
- Slash commands available in chat
- Flags and options
- Usage patterns and workflows`,
      buildContext: async (_graph, cwd) => {
        const indexTs = readFileSafe(path.join(cwd, 'src', 'index.ts'), 4000);
        const slashCmds = readFileSafe(path.join(cwd, 'src', 'commands', 'slash', 'builtin-commands.ts'), 3000);
        return [
          `# CLI Reference Raw Data`,
          `\n## src/index.ts (CLI definitions)`, indexTs || '(not found)',
          `\n## Slash Commands`, slashCmds || '(not found)',
        ].join('\n');
      },
    },
    {
      id: 11,
      filename: '11-api-reference.md',
      title: 'API Reference',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Document the HTTP/WebSocket API:
- REST endpoints with methods, parameters, responses
- WebSocket protocol and events
- Authentication requirements
- Example requests`,
      buildContext: async (_graph, cwd) => {
        // Scan for route definitions
        const serverDir = path.join(cwd, 'src', 'server');
        let routeFiles = '';
        try {
          const files = fs.readdirSync(path.join(serverDir, 'routes'));
          for (const f of files.slice(0, 5)) {
            routeFiles += `\n## ${f}\n` + readFileSafe(path.join(serverDir, 'routes', f), 2000);
          }
        } catch { /* optional */ }
        return `# API Reference Raw Data\n${routeFiles || 'No route files found.'}`;
      },
    },
    {
      id: 12,
      filename: '12-contributing.md',
      title: 'Development Guide',
      systemPrompt: `${DOC_SYSTEM_PROMPT}

Write a development guide for contributors:
- How to set up the development environment
- Project structure and conventions
- How to add a new tool
- How to add a new channel
- Testing strategy and how to run tests
- Coding conventions`,
      buildContext: async (graph, cwd) => {
        const pkg = readJsonSafe(path.join(cwd, 'package.json'));
        const claudeMd = readFileSafe(path.join(cwd, 'CLAUDE.md'), 4000);
        const stats = graph.getStats();
        return [
          `# Development Guide Raw Data`,
          `\n## Scripts: ${JSON.stringify(pkg?.scripts ?? {}, null, 2)}`,
          `\n## Graph: ${stats.tripleCount} triples, ${stats.subjectCount} entities`,
          `\n## CLAUDE.md (conventions)`, claudeMd || '(not found)',
        ].join('\n');
      },
    },
  ];
}

// ============================================================================
// Main Generator
// ============================================================================

export async function generateLLMDocs(
  graph: KnowledgeGraph,
  options: LLMDocsOptions,
): Promise<LLMDocsResult> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const outputDir = options.outputDir ?? path.join(cwd, '.codebuddy', 'docs');
  const maxTokens = options.maxTokensPerSection ?? 2000;
  const skipSections = new Set(options.skipSections ?? []);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const sections = buildSections();
  const files: string[] = [];
  const errors: string[] = [];
  let tokensUsed = 0;
  const knowledgeChunks: string[] = [];

  for (const section of sections) {
    if (skipSections.has(section.id)) continue;

    options.onProgress?.(section.title, section.id, sections.length);
    logger.info(`Docs: generating section ${section.id}/${sections.length} — ${section.title}`);

    try {
      // Build context data from graph + source files
      const context = await section.buildContext(graph, cwd);

      // Call LLM to generate prose
      const prompt = [
        `Generate the "${section.title}" section for this project's documentation.`,
        ``,
        `Here is the raw data and source code context:`,
        ``,
        context.substring(0, 12000), // Cap context to ~3K tokens
        ``,
        `Write a comprehensive, well-structured markdown document.`,
        `Start with # ${section.title}`,
        `Maximum ~${maxTokens} tokens of output.`,
      ].join('\n');

      const llmResponse = await options.llmCall(section.systemPrompt, prompt);
      tokensUsed += estimateTokens(prompt) + estimateTokens(llmResponse);

      // Write section file
      const filePath = path.join(outputDir, section.filename);
      fs.writeFileSync(filePath, llmResponse);
      files.push(section.filename);

      // Extract key insights for the knowledge file
      const summary = extractSummary(llmResponse, 500);
      knowledgeChunks.push(`## ${section.title}\n\n${summary}`);

    } catch (err) {
      errors.push(`Section ${section.id} (${section.title}): ${err instanceof Error ? err.message : String(err)}`);
      logger.debug(`Docs section ${section.id} failed: ${err}`);
    }
  }

  // Generate index
  const index = generateLLMIndex(files, sections, graph.getStats());
  fs.writeFileSync(path.join(outputDir, 'index.md'), index);
  files.push('index.md');

  // Generate PROJECT_KNOWLEDGE.md — compact knowledge for context injection
  const knowledgePath = path.join(cwd, '.codebuddy', 'PROJECT_KNOWLEDGE.md');
  const knowledgeContent = [
    `# Project Knowledge`,
    ``,
    `> Auto-generated project understanding. Injected into agent context for better decisions.`,
    `> Last generated: ${new Date().toISOString()}`,
    `> Source: ${graph.getStats().tripleCount} code relationships across ${getModuleCount(graph)} modules`,
    ``,
    ...knowledgeChunks,
  ].join('\n');
  fs.writeFileSync(knowledgePath, knowledgeContent.substring(0, 15000)); // Cap at ~3750 tokens

  return {
    files,
    durationMs: Date.now() - startTime,
    entityCount: graph.getStats().subjectCount,
    tokensUsed,
    knowledgeFilePath: knowledgePath,
    errors,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function readFileSafe(filePath: string, maxChars: number = 5000): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.substring(0, maxChars);
  } catch { return null; }
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const content = readFileSafe(filePath, 50000);
    return content ? JSON.parse(content) : null;
  } catch { return null; }
}

function getTopModules(graph: KnowledgeGraph, count: number): Array<{ name: string; rank: number; importers: number; callers: number }> {
  const modules = new Set<string>();
  for (const t of graph.toJSON()) {
    if (t.subject.startsWith('mod:')) modules.add(t.subject);
    if (t.object.startsWith('mod:')) modules.add(t.object);
  }
  const ranked = [...modules].map(m => ({
    name: m.replace(/^mod:/, ''),
    rank: graph.getEntityRank(m),
    importers: graph.query({ predicate: 'imports', object: m }).length,
    callers: graph.query({ predicate: 'calls', object: m }).length,
  }));
  return ranked.sort((a, b) => b.rank - a.rank).slice(0, count);
}

function getModuleLayers(graph: KnowledgeGraph): Array<[string, number]> {
  const modules = new Set<string>();
  for (const t of graph.toJSON()) {
    if (t.subject.startsWith('mod:')) modules.add(t.subject.replace(/^mod:/, ''));
  }
  const layers = new Map<string, number>();
  for (const m of modules) {
    const parts = m.split('/');
    const layer = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    layers.set(layer, (layers.get(layer) ?? 0) + 1);
  }
  return [...layers.entries()].sort((a, b) => b[1] - a[1]);
}

function getModuleCount(graph: KnowledgeGraph): number {
  const modules = new Set<string>();
  for (const t of graph.toJSON()) {
    if (t.subject.startsWith('mod:')) modules.add(t.subject);
  }
  return modules.size;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractSummary(markdown: string, maxChars: number): string {
  // Extract first paragraph after the title
  const lines = markdown.split('\n');
  const contentLines: string[] = [];
  let pastTitle = false;
  for (const line of lines) {
    if (line.startsWith('#')) { pastTitle = true; continue; }
    if (pastTitle && line.trim()) contentLines.push(line);
    if (contentLines.join('\n').length > maxChars) break;
  }
  return contentLines.join('\n').substring(0, maxChars);
}

function generateLLMIndex(
  files: string[],
  sections: SectionDef[],
  stats: { tripleCount: number; subjectCount: number },
): string {
  const lines = [
    '# Documentation',
    '',
    `> Generated with LLM from ${stats.tripleCount} code relationships`,
    `> ${new Date().toISOString()}`,
    '',
    '## Sections',
    '',
  ];
  for (const file of files.filter(f => f !== 'index.md')) {
    const section = sections.find(s => s.filename === file);
    lines.push(`- [${section?.title ?? file}](./${file})`);
  }
  lines.push('', '---', '', '*Generated by Code Buddy `/docs generate --with-llm`*');
  return lines.join('\n');
}
