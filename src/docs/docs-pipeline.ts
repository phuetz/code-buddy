/**
 * Docs Pipeline — Generic DeepWiki-style documentation generator
 *
 * 4-phase pipeline:
 *   Phase 1: DISCOVER  → Analyze code graph for project profile
 *   Phase 2: PLAN      → Generate adaptive doc plan (LLM or deterministic)
 *   Phase 3: GENERATE  → Produce pages using type-specific templates
 *   Phase 4: LINK      → Create hyperlinks between concepts
 *
 * Works on any project — not hardcoded to Code Buddy.
 */

import * as path from 'path';
import { KnowledgeGraph } from '../knowledge/knowledge-graph.js';
import { logger } from '../utils/logger.js';
import { discoverProject } from './discovery/project-discovery.js';
import { generateDocPlan } from './planning/plan-generator.js';
import { generatePages } from './generation/page-generator.js';
import { buildConceptIndex, linkConcepts } from './linking/concept-linker.js';
import { loadDocsConfig } from './config.js';
import type { LLMCall } from './llm-enricher.js';
import type { DocsConfig } from './config.js';

// ============================================================================
// Types
// ============================================================================

export interface PipelineResult {
  files: string[];
  pagesGenerated: number;
  conceptsLinked: number;
  durationMs: number;
  errors: string[];
}

export interface PipelineOptions {
  /** Project root */
  cwd?: string;
  /** LLM function for enrichment (optional — works without it) */
  llmCall?: LLMCall;
  /** Config overrides */
  config?: Partial<DocsConfig>;
  /** Progress callback */
  onProgress?: (phase: string, detail: string) => void;
}

// ============================================================================
// Pipeline
// ============================================================================

export async function runDocsPipeline(
  graph: KnowledgeGraph,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const config = { ...loadDocsConfig(cwd), ...options.config };
  const errors: string[] = [];

  // Phase 1: DISCOVER
  options.onProgress?.('discover', 'Analyzing project...');
  logger.info('Docs pipeline: Phase 1 — Discovery');
  const profile = await discoverProject(graph, cwd, config.repoUrl, config.commit);
  logger.info(`  → ${profile.name} v${profile.version}: ${profile.metrics.totalModules} modules, ${profile.architecture.type} architecture`);

  // Phase 2: PLAN
  options.onProgress?.('plan', 'Generating documentation plan...');
  logger.info('Docs pipeline: Phase 2 — Planning');
  const plan = await generateDocPlan(profile, options.llmCall);
  logger.info(`  → ${plan.pages.length} pages planned`);

  // Phase 3: GENERATE
  options.onProgress?.('generate', `Generating ${plan.pages.length} pages...`);
  logger.info('Docs pipeline: Phase 3 — Generation');
  const genResult = await generatePages(plan, graph, config, options.llmCall, (page, current, total) => {
    options.onProgress?.('generate', `[${current}/${total}] ${page}`);
    logger.info(`  Generating [${current}/${total}] ${page}`);
  });
  errors.push(...genResult.errors);
  logger.info(`  → ${genResult.pages.length} pages generated in ${genResult.durationMs}ms`);

  // Phase 4: LINK
  options.onProgress?.('link', 'Linking concepts...');
  logger.info('Docs pipeline: Phase 4 — Linking');
  const outputDir = path.join(cwd, config.outputDir);
  const concepts = buildConceptIndex(plan, genResult.pages);
  const linked = linkConcepts(outputDir, genResult.pages, concepts);
  logger.info(`  → ${linked} concept links created from ${concepts.length} concepts`);

  const files = genResult.pages.map(p => `${p.page.slug}.md`);
  files.push('index.md');

  const totalMs = Date.now() - startTime;
  logger.info(`Docs pipeline: Done in ${(totalMs / 1000).toFixed(1)}s — ${files.length} files, ${linked} links`);

  return {
    files,
    pagesGenerated: genResult.pages.length,
    conceptsLinked: linked,
    durationMs: totalMs,
    errors,
  };
}
