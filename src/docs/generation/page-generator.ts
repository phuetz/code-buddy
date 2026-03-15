/**
 * Phase 3 — Page Generator
 *
 * Generates markdown pages from a DocPlan using type-specific templates.
 * Each PageType has its own prompt template. Raw pages are generated first
 * (data extraction), then optionally enriched by LLM.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import type { ProjectProfile } from '../discovery/project-discovery.js';
import type { DocPage, DocPlan, PageType } from '../planning/plan-generator.js';
import type { LLMCall, ThinkingLevel } from '../llm-enricher.js';
import type { DocsConfig } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export interface GeneratedPage {
  page: DocPage;
  content: string;
  filePath: string;
}

export interface GenerationResult {
  pages: GeneratedPage[];
  errors: string[];
  durationMs: number;
}

// ============================================================================
// Page Templates (LLM prompts per page type)
// ============================================================================

const PAGE_TEMPLATES: Record<PageType, string> = {
  'overview': `Generate an overview page that answers:
- What problem does this project solve?
- Who is it for?
- What are the 5 key capabilities?
- What is the high-level architecture? (Mermaid diagram, max 10 nodes)
- What is the tech stack?
- How to get started quickly? (3-step summary)
NEVER start with "This section details...". Use storytelling.`,

  'getting-started': `Generate a getting started guide:
- Prerequisites (runtime, tools)
- Installation steps (copy-paste commands)
- Minimal working example
- Common configuration options
- "Next steps" links to deeper docs`,

  'key-concepts': `Generate a key concepts glossary:
- 10-20 core concepts of this project
- Each concept: **Bold name** — 1-sentence definition
- Group related concepts together
- Add a Mermaid diagram showing how concepts relate (max 10 nodes)`,

  'architecture': `Generate an architecture page:
- High-level system overview
- "How it works" narrative: user action → system flow → result
- Layer diagram (Mermaid, max 10 nodes)
- Core flow explained step by step
- Key design decisions and trade-offs
- Data flow description`,

  'component': `Generate a component page:
- What is this component and why does it exist?
- Architecture diagram showing relationships (max 10 nodes)
- Key methods grouped by category in tables
- Important patterns used (Facade, Singleton, etc.)
- Developer tip: what to watch out for
- Sources citations`,

  'subsystem': `Generate a subsystem overview:
- What problem does this subsystem solve?
- How do the components relate? (Mermaid diagram, max 10 nodes)
- Table of modules with descriptions
- Data flow within the subsystem
- Entry points for developers`,

  'api-reference': `Generate an API reference:
- All public endpoints/commands grouped by category
- Each entry: name, params, description
- Example usage per category
- Error handling notes`,

  'configuration': `Generate a configuration reference:
- All configuration options grouped by category
- Each option: name, type, default, description
- Environment variables table
- Config file format examples
- Configuration hierarchy (precedence order)`,

  'security': `Generate a security page:
- Security model overview
- Authentication/Authorization mechanisms
- What is protected and how
- Security checklist for contributors
- Threat model summary`,

  'troubleshooting': `Generate a troubleshooting guide:
- 10 most common issues (inferred from the codebase patterns)
- Each: **Symptom** → **Cause** → **Solution**
- Debug mode instructions
- How to report issues`,
};

/** Thinking level per page type */
const THINKING_LEVELS: Record<PageType, ThinkingLevel> = {
  'overview': 'high',
  'architecture': 'high',
  'key-concepts': 'medium',
  'component': 'medium',
  'subsystem': 'medium',
  'security': 'medium',
  'api-reference': 'low',
  'configuration': 'low',
  'getting-started': 'low',
  'troubleshooting': 'medium',
};

// ============================================================================
// Generator
// ============================================================================

export async function generatePages(
  plan: DocPlan,
  graph: KnowledgeGraph,
  config: DocsConfig,
  llmCall?: LLMCall,
  onProgress?: (page: string, current: number, total: number) => void,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const outputDir = path.join(process.cwd(), config.outputDir);
  const errors: string[] = [];
  const generatedPages: GeneratedPage[] = [];

  // Ensure output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Clean old docs
  for (const f of fs.readdirSync(outputDir)) {
    if (f.endsWith('.md')) fs.unlinkSync(path.join(outputDir, f));
  }

  const profile = plan.projectProfile;

  for (let i = 0; i < plan.pages.length; i++) {
    const page = plan.pages[i];
    onProgress?.(page.title, i + 1, plan.pages.length);

    try {
      let content: string;

      if (llmCall) {
        content = await generatePageWithLLM(page, profile, graph, config, llmCall);
      } else {
        content = generatePageRaw(page, profile, graph, config);
      }

      // Add source file links header (DeepWiki style)
      if (page.sourceFiles.length > 0 && config.repoUrl) {
        const sourceLinks = page.sourceFiles.slice(0, 5).map(f =>
          `- [${f}](${config.repoUrl}/blob/${config.commit || 'main'}/${f}.ts)`
        ).join('\n');
        content = content.replace(/^(# .+\n)/, `$1\n## Relevant source files\n${sourceLinks}\n\n`);
      }

      const filePath = path.join(outputDir, `${page.slug}.md`);
      fs.writeFileSync(filePath, content);
      generatedPages.push({ page, content, filePath });
    } catch (err) {
      errors.push(`${page.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Generate index page
  const indexContent = generateIndexPage(plan, generatedPages);
  fs.writeFileSync(path.join(outputDir, 'index.md'), indexContent);

  return {
    pages: generatedPages,
    errors,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// LLM-based Page Generation
// ============================================================================

async function generatePageWithLLM(
  page: DocPage,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
  llmCall: LLMCall,
): Promise<string> {
  const template = PAGE_TEMPLATES[page.pageType];
  const context = buildPageContext(page, profile, graph, config);
  const thinkingLevel = THINKING_LEVELS[page.pageType];

  const systemPrompt = `You are a senior technical writer documenting "${profile.name}".

Rules:
- NEVER start two consecutive paragraphs the same way
- Explain WHY before HOW
- Use storytelling: "When X happens, the system does Y because Z"
- Add ONE developer tip per section
- Mermaid diagrams: max ${config.maxNodesPerDiagram} nodes
- Output complete markdown — your output IS the final page`;

  const userPrompt = `${template}

Project: ${profile.name} (${profile.language}${profile.framework ? ', ' + profile.framework : ''})
${profile.metrics.totalModules} modules, ${profile.metrics.totalFunctions} functions

Page: "${page.title}" (${page.description})

Context data:
${context}

Generate the full markdown page. Start with # ${page.title}`;

  const result = await llmCall(systemPrompt, userPrompt, thinkingLevel);

  // Strip LLM noise
  return stripNoise(result);
}

// ============================================================================
// Raw Page Generation (no LLM)
// ============================================================================

function generatePageRaw(
  page: DocPage,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
): string {
  switch (page.pageType) {
    case 'overview': return rawOverview(profile);
    case 'getting-started': return rawGettingStarted(profile);
    case 'key-concepts': return rawKeyConcepts(profile, graph);
    case 'architecture': return rawArchitecture(profile, graph, config);
    case 'subsystem': return rawSubsystem(page, profile, graph);
    case 'component': return rawComponent(page, profile, graph);
    case 'configuration': return rawConfiguration(profile);
    case 'security': return rawSecurity(profile, graph);
    case 'api-reference': return rawApiReference(profile);
    case 'troubleshooting': return rawTroubleshooting(profile);
    default: return `# ${page.title}\n\n${page.description}\n`;
  }
}

// ============================================================================
// Raw Templates
// ============================================================================

function rawOverview(p: ProjectProfile): string {
  const lines = [
    `# ${p.name} v${p.version}`,
    '',
    p.description ? `> ${p.description}` : '',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Modules | ${p.metrics.totalModules} |`,
    `| Classes | ${p.metrics.totalClasses} |`,
    `| Functions | ${p.metrics.totalFunctions} |`,
    `| Relationships | ${p.metrics.totalRelationships.toLocaleString()} |`,
    '',
    '## Core Modules',
    '',
    '| Module | PageRank | Functions |',
    '|--------|----------|-----------|',
  ];
  for (const m of p.architecture.coreModules.slice(0, 15)) {
    lines.push(`| \`${m.path}\` | ${m.rank.toFixed(3)} | ${m.functions} |`);
  }
  lines.push('', '## Technology Stack', '');
  lines.push(`- Language: ${p.language}`);
  if (p.framework) lines.push(`- Framework: ${p.framework}`);
  lines.push(`- Dependencies: ${p.dependencies.length}`);

  // Getting Started
  lines.push('', '## Getting Started', '', '```bash', 'npm install');
  if (p.scripts.build) lines.push('npm run build');
  if (p.scripts.dev) lines.push('npm run dev');
  if (p.scripts.start) lines.push('npm start');
  lines.push('```');

  return lines.join('\n');
}

function rawGettingStarted(p: ProjectProfile): string {
  const lines = [
    '# Getting Started', '',
    '## Prerequisites', '',
    `- ${p.language === 'typescript' || p.language === 'javascript' ? 'Node.js 18+' : p.language} runtime`,
    '',
    '## Installation', '',
    '```bash',
    `git clone ${p.repoUrl || '<repo-url>'}`,
    `cd ${p.name}`,
    'npm install',
    '```', '',
    '## First Run', '',
    '```bash',
  ];
  if (p.scripts.dev) lines.push('npm run dev');
  else if (p.scripts.start) lines.push('npm start');
  lines.push('```', '', '## Available Scripts', '', '| Script | Command |', '|--------|---------|');
  for (const [name, cmd] of Object.entries(p.scripts).slice(0, 15)) {
    lines.push(`| \`npm run ${name}\` | \`${cmd}\` |`);
  }
  return lines.join('\n');
}

function rawKeyConcepts(p: ProjectProfile, graph: KnowledgeGraph): string {
  const lines = ['# Key Concepts', ''];
  // Top 15 entities as concepts
  for (const m of p.architecture.coreModules.slice(0, 15)) {
    const name = m.path.split('/').pop() ?? m.path;
    lines.push(`- **${name}** — Core module (${m.functions} functions, PageRank ${m.rank.toFixed(3)})`);
  }
  // Patterns as concepts
  for (const pat of p.patterns.slice(0, 5)) {
    lines.push(`- **${pat.name}** — Design pattern found in \`${pat.location}\``);
  }
  return lines.join('\n');
}

function rawArchitecture(p: ProjectProfile, graph: KnowledgeGraph, config: DocsConfig): string {
  const lines = [
    '# Architecture', '',
    `Architecture type: **${p.architecture.type}**`, '',
    '## Layers', '',
    '| Layer | Modules |',
    '|-------|---------|',
  ];
  for (const l of p.architecture.layers.slice(0, 15)) {
    lines.push(`| \`${l.directory}\` | ${l.moduleCount} |`);
  }
  lines.push('', '## Entry Points', '');
  for (const ep of p.architecture.entryPoints.slice(0, 5)) {
    lines.push(`- \`${ep.path}\``);
  }
  return lines.join('\n');
}

function rawSubsystem(page: DocPage, p: ProjectProfile, graph: KnowledgeGraph): string {
  const lines = [`# ${page.title}`, '', page.description, '', '## Modules', ''];
  for (const src of page.sourceFiles.slice(0, 20)) {
    const fns = graph.query({ subject: `mod:${src}`, predicate: 'containsFunction' }).length;
    lines.push(`- **\`${src}\`** (${fns} functions)`);
  }
  return lines.join('\n');
}

function rawComponent(page: DocPage, p: ProjectProfile, graph: KnowledgeGraph): string {
  const mod = page.sourceFiles[0];
  const lines = [`# ${page.title}`, '', page.description, ''];
  if (mod) {
    const fns = graph.query({ subject: `mod:${mod}`, predicate: 'containsFunction' });
    if (fns.length > 0) {
      lines.push('## Functions', '', '| Function | Module |', '|----------|--------|');
      for (const fn of fns.slice(0, 20)) {
        lines.push(`| \`${fn.object.replace(/^fn:/, '')}\` | \`${mod}\` |`);
      }
    }
  }
  return lines.join('\n');
}

function rawConfiguration(p: ProjectProfile): string {
  const lines = ['# Configuration', ''];
  if (p.envVars.length > 0) {
    lines.push('## Environment Variables', '', '| Variable | Description |', '|----------|-------------|');
    for (const v of p.envVars) {
      lines.push(`| \`${v.name}\` | ${v.desc} |`);
    }
  }
  return lines.join('\n');
}

function rawSecurity(p: ProjectProfile, graph: KnowledgeGraph): string {
  const lines = ['# Security', ''];
  const secLayer = p.architecture.layers.find(l => l.name === 'security');
  if (secLayer) {
    lines.push(`The project has **${secLayer.moduleCount}** security modules in \`${secLayer.directory}/\`.`);
  }
  return lines.join('\n');
}

function rawApiReference(p: ProjectProfile): string {
  const lines = ['# API Reference', ''];
  const hasCLI = p.dependencies.includes('commander');
  if (hasCLI) lines.push('## CLI', '', 'See `--help` for available commands.', '');
  const hasHTTP = p.dependencies.includes('express') || p.dependencies.includes('fastify');
  if (hasHTTP) lines.push('## HTTP API', '', 'See route files for endpoints.', '');
  return lines.join('\n');
}

function rawTroubleshooting(p: ProjectProfile): string {
  return [
    '# Troubleshooting', '',
    '## Common Issues', '',
    '| Symptom | Cause | Solution |',
    '|---------|-------|----------|',
    '| Module not found | Missing build step | Run `npm run build` |',
    '| API key error | Missing env var | Set required API key in `.env` |',
    '| Tests fail | Outdated deps | Run `npm install` |',
  ].join('\n');
}

// ============================================================================
// Index Page
// ============================================================================

function generateIndexPage(plan: DocPlan, pages: GeneratedPage[]): string {
  const p = plan.projectProfile;
  const lines = [
    `# ${p.name} — Documentation`,
    '',
    p.description ? `> ${p.description}` : '',
    '',
    `*Generated: ${new Date().toISOString().split('T')[0]}*`,
    '',
    '## Where to start?',
    '',
    '| I want to... | Go to... |',
    '|-------------|----------|',
  ];

  // Smart routing table
  const pageMap = new Map(plan.pages.map(p => [p.pageType, p]));
  const link = (type: PageType, label: string) => {
    const pg = pageMap.get(type);
    return pg ? `[${pg.title}](./${pg.slug}.md)` : label;
  };

  lines.push(`| Understand the project | ${link('overview', 'Overview')} |`);
  lines.push(`| Get started quickly | ${link('getting-started', 'Getting Started')} |`);
  if (pageMap.has('architecture')) lines.push(`| Understand the architecture | ${link('architecture', 'Architecture')} |`);
  if (pageMap.has('configuration')) lines.push(`| Configure the project | ${link('configuration', 'Configuration')} |`);
  if (pageMap.has('security')) lines.push(`| Understand security | ${link('security', 'Security')} |`);
  if (pageMap.has('api-reference')) lines.push(`| Use the CLI or API | ${link('api-reference', 'API Reference')} |`);
  if (pageMap.has('troubleshooting')) lines.push(`| Fix an issue | ${link('troubleshooting', 'Troubleshooting')} |`);

  lines.push('', '## Project at a Glance', '', '| Metric | Value |', '|--------|-------|');
  lines.push(`| Modules | ${p.metrics.totalModules.toLocaleString()} |`);
  lines.push(`| Functions | ${p.metrics.totalFunctions.toLocaleString()} |`);
  lines.push(`| Relationships | ${p.metrics.totalRelationships.toLocaleString()} |`);

  // All pages grouped by hierarchy
  lines.push('', '## All Sections', '');
  const topLevel = plan.pages.filter(p => !p.parentId);
  const children = plan.pages.filter(p => p.parentId);

  for (const page of topLevel) {
    lines.push(`- [${page.id}. ${page.title}](./${page.slug}.md)`);
    const kids = children.filter(c => c.parentId === page.id);
    for (const kid of kids) {
      lines.push(`  - [${kid.id}. ${kid.title}](./${kid.slug}.md)`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

function buildPageContext(
  page: DocPage,
  profile: ProjectProfile,
  graph: KnowledgeGraph,
  config: DocsConfig,
): string {
  const contextParts: string[] = [];

  // Add source file data
  for (const src of page.sourceFiles.slice(0, config.maxModulesPerPage)) {
    const mod = `mod:${src}`;
    const fns = graph.query({ subject: mod, predicate: 'containsFunction' }).map(t => t.object.replace(/^fn:/, ''));
    const cls = graph.query({ subject: mod, predicate: 'containsClass' }).map(t => t.object.replace(/^cls:/, ''));
    const importedBy = graph.query({ predicate: 'imports', object: mod }).length;
    contextParts.push(`Module: ${src} (${fns.length} functions, ${cls.length} classes, ${importedBy} importers)`);
    if (fns.length > 0) contextParts.push(`  Functions: ${fns.slice(0, 15).join(', ')}`);
    if (cls.length > 0) contextParts.push(`  Classes: ${cls.join(', ')}`);
  }

  // Add relevant metrics
  if (page.pageType === 'overview' || page.pageType === 'architecture') {
    contextParts.push('');
    contextParts.push(`Architecture: ${profile.architecture.type}`);
    contextParts.push(`Layers: ${profile.architecture.layers.slice(0, 10).map(l => `${l.name}(${l.moduleCount})`).join(', ')}`);
    contextParts.push(`Patterns: ${profile.patterns.slice(0, 5).map(p => `${p.name}@${p.location}`).join(', ')}`);
  }

  // Add env vars for config page
  if (page.pageType === 'configuration') {
    contextParts.push('');
    contextParts.push('Environment variables:');
    for (const v of profile.envVars.slice(0, 20)) {
      contextParts.push(`  ${v.name}: ${v.desc}`);
    }
    contextParts.push(`Scripts: ${Object.entries(profile.scripts).slice(0, 10).map(([k, v]) => `${k}="${v}"`).join(', ')}`);
  }

  return contextParts.join('\n').substring(0, 6000);
}

function stripNoise(content: string): string {
  let result = content;
  // Remove ```markdown wrapper
  const mdFenceMatch = result.match(/```markdown\n([\s\S]*?)```\s*$/);
  if (mdFenceMatch) result = mdFenceMatch[1];
  // Remove preamble before first heading
  const firstHeading = result.indexOf('\n# ');
  if (firstHeading > 0 && firstHeading < 500) result = result.substring(firstHeading + 1);
  else if (!result.startsWith('# ')) {
    const idx = result.indexOf('# ');
    if (idx > 0 && idx < 500) result = result.substring(idx);
  }
  return result.trim();
}
