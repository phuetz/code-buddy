/**
 * LLM Documentation Enricher
 *
 * Post-processes raw generated markdown docs by passing each section
 * through the LLM for narrative enrichment. The raw data stays as-is
 * but prose paragraphs, explanations, and cross-links are added.
 *
 * This is the "hybrid" approach:
 * 1. Raw generator produces data (fast, 300ms, no LLM needed)
 * 2. Enricher adds narrative quality (slower, needs LLM, much better docs)
 *
 * Also generates PROJECT_KNOWLEDGE.md for context injection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** LLM call with optional thinking level */
export type LLMCall = (systemPrompt: string, userPrompt: string, thinkingLevel?: ThinkingLevel) => Promise<string>;

/** Thinking strategy per enrichment task */
const THINKING_STRATEGY: Record<string, ThinkingLevel> = {
  '11-changelog.md': 'minimal',       // Mechanical — just format the log
  '5-tools.md': 'minimal',            // Data extraction, no reasoning needed
  '8-configuration.md': 'low',        // Describe configs
  '9-api-reference.md': 'low',        // Describe endpoints
  '10-development.md': 'low',         // Describe setup
  '4-metrics.md': 'medium',           // Analyze metrics, suggest actions
  '3-subsystems.md': 'medium',        // Describe clusters
  '7-context-memory.md': 'medium',    // Explain strategies
  '6-security.md': 'medium',          // Explain security layers
  '1-overview.md': 'high',            // Narrate the full project story
  '2-architecture.md': 'high',        // Explain architectural decisions
};

export interface EnrichOptions {
  /** Directory containing raw .md files */
  docsDir: string;
  /** LLM call function */
  llmCall: LLMCall;
  /** Project root */
  cwd?: string;
  /** Override thinking level for all sections */
  thinkingLevel?: ThinkingLevel;
  /** Progress callback */
  onProgress?: (file: string, current: number, total: number) => void;
}

export interface EnrichResult {
  filesEnriched: number;
  tokensUsed: number;
  durationMs: number;
  knowledgePath: string;
  errors: string[];
}

// ============================================================================
// System Prompt
// ============================================================================

const ENRICHER_SYSTEM_PROMPT = `You are a senior technical writer creating DeepWiki-style documentation. You receive a raw auto-generated markdown document. Your job is to transform it into professional documentation.

CRITICAL: You must output the COMPLETE document — include ALL original tables, lists, and data. Your output REPLACES the file, so nothing can be lost.

## What to ADD

1. **Opening paragraph** under the title: 2-3 sentences explaining what this section covers, why it matters, and who should read it.

Example:
# Security Architecture

The security architecture implements defense-in-depth with seven distinct layers, each targeting different attack vectors. Understanding these layers is essential for contributors modifying tool execution or adding new integrations, as security violations will block deployment.

2. **Transition paragraphs** between subsections: 1-2 sentences linking the previous section to the next.

Example:
Beyond input validation, the system enforces strict path boundaries to prevent filesystem escapes.

3. **One Mermaid diagram** per document showing the key data flow or component relationship. Use graph TD or flowchart LR. Keep it under 15 nodes.

4. **"Key Concepts" callout** for complex sections:

> **Key concept:** The RAG tool selector reduces prompt size from 110+ tools to ~15, saving approximately 8,000 tokens per LLM call.

5. **Method signatures** when discussing components: mention \`ClassName.methodName()\` in backticks.

## Rules
- Output the FULL enriched document (title through footer)
- KEEP every table, list, and data point from the original
- Write like MDN Web Docs: precise, technical, no marketing fluff
- Each section gets 1-2 paragraphs of prose, not more
- Total output should be 20-50% longer than input, not shorter`;

// ============================================================================
// Enricher
// ============================================================================

export async function enrichDocs(options: EnrichOptions): Promise<EnrichResult> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const errors: string[] = [];
  let tokensUsed = 0;
  let filesEnriched = 0;
  const knowledgeChunks: string[] = [];

  // Find all .md files in the docs directory
  const mdFiles = fs.readdirSync(options.docsDir)
    .filter(f => f.endsWith('.md') && f !== 'index.md')
    .sort();

  for (let i = 0; i < mdFiles.length; i++) {
    const file = mdFiles[i];
    options.onProgress?.(file, i + 1, mdFiles.length);
    logger.info(`Enriching [${i + 1}/${mdFiles.length}] ${file}`);

    const filePath = path.join(options.docsDir, file);
    const rawContent = fs.readFileSync(filePath, 'utf-8');

    // Skip very small files (changelog, etc.)
    if (rawContent.length < 200) continue;

    try {
      const prompt = [
        `Transform this raw document into professional DeepWiki-style documentation.`,
        `IMPORTANT: Output the COMPLETE document with ALL original content preserved plus your additions.`,
        ``,
        `--- RAW DOCUMENT ---`,
        rawContent.substring(0, 10000),
        `--- END ---`,
        ``,
        `Output the full enriched markdown now. Remember: keep ALL tables/lists, add prose and one mermaid diagram.`,
      ].join('\n');

      // Select thinking level: override > per-file strategy > default medium
      const thinkingLevel = options.thinkingLevel ?? THINKING_STRATEGY[file] ?? 'medium';
      const enriched = await options.llmCall(ENRICHER_SYSTEM_PROMPT, prompt, thinkingLevel);
      tokensUsed += Math.ceil((prompt.length + enriched.length) / 4);

      // Validate: enriched should be at least 50% of raw (LLM may compress large tables)
      if (enriched.length >= rawContent.length * 0.5 && enriched.length > 200) {
        fs.writeFileSync(filePath, enriched);
        filesEnriched++;

        // Extract summary for knowledge file
        const firstParagraphs = enriched.split('\n\n').slice(0, 3).join('\n\n');
        knowledgeChunks.push(firstParagraphs.substring(0, 500));
      } else {
        logger.debug(`Enriched ${file} was shorter than raw — keeping original`);
        errors.push(`${file}: enriched output too short, kept original`);
      }
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Generate PROJECT_KNOWLEDGE.md from enriched content
  const knowledgePath = path.join(cwd, '.codebuddy', 'PROJECT_KNOWLEDGE.md');
  const knowledgeContent = [
    '# Project Knowledge',
    '',
    `> Auto-generated project understanding from ${filesEnriched} documentation sections.`,
    `> Last updated: ${new Date().toISOString()}`,
    '',
    ...knowledgeChunks,
  ].join('\n');
  fs.writeFileSync(knowledgePath, knowledgeContent.substring(0, 15000));

  return {
    filesEnriched,
    tokensUsed,
    durationMs: Date.now() - startTime,
    knowledgePath,
    errors,
  };
}
