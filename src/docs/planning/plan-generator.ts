/**
 * Phase 2 — Documentation Plan Generator
 *
 * Generates an adaptive documentation plan from the ProjectProfile.
 * The plan determines which pages to generate, their hierarchy,
 * and cross-references. Uses LLM for intelligent planning,
 * with a deterministic fallback for offline use.
 */

import type { ProjectProfile, ModuleCluster, RankedModule } from '../discovery/project-discovery.js';
import type { LLMCall, ThinkingLevel } from '../llm-enricher.js';

// ============================================================================
// Types
// ============================================================================

export type PageType =
  | 'overview'
  | 'getting-started'
  | 'key-concepts'
  | 'architecture'
  | 'component'
  | 'subsystem'
  | 'api-reference'
  | 'configuration'
  | 'security'
  | 'troubleshooting';

export interface DocPage {
  id: string;
  slug: string;
  title: string;
  description: string;
  sourceFiles: string[];
  parentId?: string;
  relatedPages: string[];
  pageType: PageType;
}

export interface ConceptEntry {
  pageId: string;
  file: string;
  anchor: string;
  description: string;
}

export interface DocPlan {
  projectProfile: ProjectProfile;
  pages: DocPage[];
  conceptIndex: Record<string, ConceptEntry>;
}

// ============================================================================
// Plan Generation
// ============================================================================

/**
 * Generate a documentation plan using LLM intelligence.
 * Falls back to deterministic plan if LLM is unavailable.
 */
export async function generateDocPlan(
  profile: ProjectProfile,
  llmCall?: LLMCall,
): Promise<DocPlan> {
  let pages: DocPage[];

  if (llmCall) {
    try {
      pages = await generateLLMPlan(profile, llmCall);
    } catch {
      pages = generateDeterministicPlan(profile);
    }
  } else {
    pages = generateDeterministicPlan(profile);
  }

  // Build initial concept index from pages
  const conceptIndex: Record<string, ConceptEntry> = {};
  for (const page of pages) {
    conceptIndex[page.title] = {
      pageId: page.id,
      file: `${page.slug}.md`,
      anchor: '',
      description: page.description,
    };
  }

  return { projectProfile: profile, pages, conceptIndex };
}

// ============================================================================
// LLM-based Plan
// ============================================================================

async function generateLLMPlan(profile: ProjectProfile, llmCall: LLMCall): Promise<DocPage[]> {
  const prompt = buildPlanPrompt(profile);
  const systemPrompt = `You are a documentation architect. Analyze the project profile and generate a documentation plan as a JSON array of page objects. Return ONLY valid JSON, no markdown fences or commentary.`;

  const result = await llmCall(systemPrompt, prompt, 'high' as ThinkingLevel);

  // Extract JSON from response (handle markdown fences)
  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON array');

  const parsed = JSON.parse(jsonMatch[0]) as DocPage[];
  return validateAndFixPlan(parsed, profile);
}

function buildPlanPrompt(profile: ProjectProfile): string {
  // Compact profile for LLM — only what matters for planning
  const compact = {
    name: profile.name,
    language: profile.language,
    framework: profile.framework,
    modules: profile.metrics.totalModules,
    classes: profile.metrics.totalClasses,
    functions: profile.metrics.totalFunctions,
    archType: profile.architecture.type,
    layers: profile.architecture.layers.slice(0, 15).map(l => `${l.directory} (${l.moduleCount})`),
    coreModules: profile.architecture.coreModules.slice(0, 10).map(m => m.path),
    clusters: profile.architecture.clusters.slice(0, 10).map(c => `${c.label} (${c.size} modules)`),
    patterns: profile.patterns.slice(0, 10).map(p => `${p.name}: ${p.location}`),
    hasEntryPoints: profile.architecture.entryPoints.length,
    hasSecurity: profile.architecture.layers.some(l => l.name === 'security'),
    hasCLI: profile.scripts.start !== undefined || profile.dependencies.includes('commander'),
    hasAPI: profile.dependencies.includes('express') || profile.dependencies.includes('fastify'),
    envVarCount: profile.envVars.length,
  };

  return `Project profile:
${JSON.stringify(compact, null, 2)}

Generate a documentation plan following these rules:

1. HIERARCHY: Use numbered sections (1, 1.1, 1.2, 2, 2.1...)
2. ALWAYS include:
   - "1" overview (what is this project?)
   - "1.1" getting-started (install and run)
   - "1.2" key-concepts (glossary of 10-20 core concepts)
   - Last page: troubleshooting

3. ADAPTIVE sections based on project:
   - Central orchestrator class → dedicated component page
   - 5+ tools/plugins → tool-system subsystem with sub-pages
   - Authentication/security modules → security page
   - Multiple providers → providers section
   - CLI → CLI reference
   - Adapt depth to project size:
     * < 50 modules → flat (no sub-pages)
     * 50-200 modules → 2 levels max
     * 200+ modules → 3 levels

4. For each page:
   - id: section number ("1", "1.1", "2", etc.)
   - slug: kebab-case filename without extension
   - title: human-readable title
   - description: 1 sentence
   - sourceFiles: 3-10 relevant source file paths
   - parentId: parent section id (optional)
   - relatedPages: 2-3 related page ids
   - pageType: one of overview|getting-started|key-concepts|architecture|component|subsystem|api-reference|configuration|security|troubleshooting

Return a JSON array of DocPage objects.`;
}

/** Validate LLM output and fix common issues */
function validateAndFixPlan(pages: DocPage[], profile: ProjectProfile): DocPage[] {
  // Ensure required pages exist
  const hasOverview = pages.some(p => p.pageType === 'overview');
  const hasGettingStarted = pages.some(p => p.pageType === 'getting-started');
  const hasTroubleshooting = pages.some(p => p.pageType === 'troubleshooting');

  if (!hasOverview) {
    pages.unshift({
      id: '1', slug: '1-overview', title: 'Overview',
      description: `What is ${profile.name}?`, sourceFiles: [],
      relatedPages: ['1.1'], pageType: 'overview',
    });
  }

  if (!hasGettingStarted) {
    pages.splice(1, 0, {
      id: '1.1', slug: '1-1-getting-started', title: 'Getting Started',
      description: 'Installation and first steps', sourceFiles: [],
      parentId: '1', relatedPages: ['1'], pageType: 'getting-started',
    });
  }

  if (!hasTroubleshooting && profile.metrics.totalModules > 20) {
    const lastId = String(Math.max(...pages.map(p => parseInt(p.id) || 0)) + 1);
    pages.push({
      id: lastId, slug: `${lastId}-troubleshooting`, title: 'Troubleshooting',
      description: 'Common issues and solutions', sourceFiles: [],
      relatedPages: ['1.1'], pageType: 'troubleshooting',
    });
  }

  // Ensure all pages have valid slugs
  for (const page of pages) {
    if (!page.slug) page.slug = page.id.replace(/\./g, '-') + '-' + page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!page.sourceFiles) page.sourceFiles = [];
    if (!page.relatedPages) page.relatedPages = [];
  }

  return pages;
}

// ============================================================================
// Deterministic Fallback Plan
// ============================================================================

/**
 * Generate a deterministic plan without LLM — works offline.
 * Adapts structure to project size and detected features.
 */
export function generateDeterministicPlan(profile: ProjectProfile): DocPage[] {
  const pages: DocPage[] = [];
  const m = profile.metrics.totalModules;
  let nextId = 1;

  // 1. Overview (always)
  pages.push({
    id: '1', slug: '1-overview', title: 'Overview',
    description: `Project overview of ${profile.name}`,
    sourceFiles: profile.architecture.coreModules.slice(0, 5).map(m => m.path),
    relatedPages: ['1.1', '2'], pageType: 'overview',
  });

  // 1.1 Getting Started (always)
  pages.push({
    id: '1.1', slug: '1-1-getting-started', title: 'Getting Started',
    description: 'Installation, setup, and first run',
    sourceFiles: profile.architecture.entryPoints.slice(0, 3).map(e => e.path),
    parentId: '1', relatedPages: ['1'], pageType: 'getting-started',
  });

  // 1.2 Key Concepts (if >20 modules)
  if (m > 20) {
    pages.push({
      id: '1.2', slug: '1-2-key-concepts', title: 'Key Concepts',
      description: 'Core terminology and concepts',
      sourceFiles: [],
      parentId: '1', relatedPages: ['1', '2'], pageType: 'key-concepts',
    });
  }

  nextId = 2;

  // 2. Architecture (if >30 modules)
  if (m > 30) {
    pages.push({
      id: String(nextId), slug: `${nextId}-architecture`, title: 'Architecture',
      description: 'System design and component relationships',
      sourceFiles: profile.architecture.coreModules.slice(0, 10).map(m => m.path),
      relatedPages: ['1'], pageType: 'architecture',
    });
    nextId++;
  }

  // 3+. Subsystems from clusters (if >50 modules)
  if (m > 50) {
    const subsystemStart = nextId;
    const maxClusters = m > 200 ? 15 : m > 100 ? 10 : 5;
    for (const cluster of profile.architecture.clusters.slice(0, maxClusters)) {
      if (cluster.size < 5) continue;
      pages.push({
        id: String(nextId), slug: `${nextId}-${cluster.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        title: capitalize(cluster.label),
        description: `${cluster.size} modules in the ${cluster.label} subsystem`,
        sourceFiles: cluster.members.slice(0, 10),
        relatedPages: [String(subsystemStart)], pageType: 'subsystem',
      });
      nextId++;
    }
  }

  // Component pages for top core modules (if >100 modules, up to 5)
  if (m > 100) {
    for (const mod of profile.architecture.coreModules.slice(0, 5)) {
      const modName = mod.path.split('/').pop() ?? mod.path;
      pages.push({
        id: String(nextId), slug: `${nextId}-${modName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        title: capitalize(modName.replace(/-/g, ' ')),
        description: `Core component: ${mod.path}`,
        sourceFiles: [mod.path],
        relatedPages: ['2'], pageType: 'component',
      });
      nextId++;
    }
  }

  // Metrics (if >30 modules)
  if (m > 30) {
    pages.push({
      id: String(nextId), slug: `${nextId}-metrics`, title: 'Code Quality Metrics',
      description: 'Dead code, coupling, and health score',
      sourceFiles: [], relatedPages: ['2'], pageType: 'architecture',
    });
    nextId++;
  }

  // Security (if security layer detected)
  if (profile.architecture.layers.some(l => l.name === 'security')) {
    pages.push({
      id: String(nextId), slug: `${nextId}-security`, title: 'Security',
      description: 'Security model and access control',
      sourceFiles: profile.architecture.layers.filter(l => l.name === 'security').map(l => l.directory),
      relatedPages: ['1'], pageType: 'security',
    });
    nextId++;
  }

  // Configuration (if env vars found)
  if (profile.envVars.length > 0) {
    pages.push({
      id: String(nextId), slug: `${nextId}-configuration`, title: 'Configuration',
      description: 'Environment variables and settings',
      sourceFiles: [], relatedPages: ['1.1'], pageType: 'configuration',
    });
    nextId++;
  }

  // API Reference (if CLI or HTTP)
  const hasCLI = profile.dependencies.includes('commander') || profile.scripts.start;
  const hasAPI = profile.dependencies.includes('express') || profile.dependencies.includes('fastify');
  if (hasCLI || hasAPI) {
    pages.push({
      id: String(nextId), slug: `${nextId}-api-reference`, title: 'API Reference',
      description: 'CLI commands and HTTP endpoints',
      sourceFiles: [], relatedPages: ['1'], pageType: 'api-reference',
    });
    nextId++;
  }

  // Troubleshooting (if >20 modules)
  if (m > 20) {
    pages.push({
      id: String(nextId), slug: `${nextId}-troubleshooting`, title: 'Troubleshooting',
      description: 'Common issues and solutions',
      sourceFiles: [], relatedPages: ['1.1'], pageType: 'troubleshooting',
    });
  }

  return pages;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
