/**
 * LLM Documentation Enricher — V2 (DeepWiki Quality)
 *
 * Post-processes raw generated markdown docs by passing each section
 * through the LLM for narrative enrichment. The raw data stays as-is
 * but prose paragraphs, explanations, and cross-links are added.
 *
 * V2 improvements:
 * - Chunked enrichment: large files split by ## headers, each enriched independently
 * - Cross-validation: post-enrichment scan for hallucinated identifiers
 * - Multi-pass: overview and architecture get 2 LLM passes (enrich + review)
 * - Blueprint context: verified entity list injected into each LLM call
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
  '7-context-memory.md': 'medium',    // Explain strategies
  '6-security.md': 'medium',          // Explain security layers
  '1-overview.md': 'high',            // Narrate the full project story
  '2-architecture.md': 'high',        // Explain architectural decisions
};

/** Files that get multi-pass enrichment (improvement D) */
const MULTI_PASS_FILES = new Set(['1-overview.md', '2-architecture.md']);

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
  /** Blueprint context to inject into LLM prompts (improvement E) */
  blueprintContext?: string;
  /** Verified entity set for cross-validation (improvement C) */
  verifiedEntities?: Set<string>;
}

export interface EnrichResult {
  filesEnriched: number;
  tokensUsed: number;
  durationMs: number;
  knowledgePath: string;
  errors: string[];
  hallucinationsFixed: number;
}

// ============================================================================
// System Prompt
// ============================================================================

const ENRICHER_SYSTEM_PROMPT = `You are a senior technical writer documenting a complex open-source project in DeepWiki style.

CRITICAL: Output the COMPLETE document — include ALL original tables, lists, and data. Your output REPLACES the file, so nothing can be lost.

## Narration Style

- NEVER start two consecutive paragraphs the same way
- Explain the WHY before the HOW: "When the agent encounters X, it does Y because Z"
- Use storytelling, not spec-sheet language
- Vary sentence structure and vocabulary
- Each section must feel like a chapter in a technical book

Bad: "This section details the subsystems responsible for..."
Good: "When Code Buddy needs to understand a large codebase, it doesn't read files line by line — it builds a semantic map. Here's how that map is constructed..."

## What to ADD

1. **Opening paragraph** under the title: 2-3 sentences explaining WHAT, WHY, and WHO should read this.

2. **Transition paragraphs** between subsections: 1-2 sentences summarizing what the reader just learned and why the next section is the logical continuation.

Example: "Now that we understand how the agent orchestrates tool calls, we need to examine the security layer that governs which tools can execute and under what conditions."

3. **One Mermaid diagram** per document showing the key data flow or component relationship. Use graph TD or flowchart LR. Keep it under 10 nodes.

4. **"Key Concepts" callout** for complex sections:
> **Key concept:** The RAG tool selector reduces prompt size from 110+ tools to ~15, saving approximately 8,000 tokens per LLM call.

5. **One developer tip** per section — a practical "watch out for" note:
> **Developer tip:** When adding a new tool, always register it in both \`metadata.ts\` and \`tools.ts\` — missing either causes silent failures.

6. **Method signatures** when discussing components: mention \`ClassName.methodName()\` in backticks. ONLY use names from the verified entities list.

## Rules
- Output the FULL enriched document (title through footer)
- KEEP every table, list, and data point from the original
- Write like MDN Web Docs: precise, technical, no marketing fluff
- Each section gets 1-2 paragraphs of prose, not more
- Total output should be 20-50% longer than input, not shorter
- NEVER invent class or method names — only use names from the verified entities list`;

const REVIEW_SYSTEM_PROMPT = `You are a technical documentation reviewer. Review the enriched document for accuracy:

1. Check that ALL tables and data from the raw version are preserved
2. Verify that method/class names in backticks are plausible (no obvious hallucinations)
3. Fix any factual inconsistencies between the prose and the data tables
4. Improve clarity of transition paragraphs
5. Ensure Mermaid diagrams are syntactically valid

Output the CORRECTED full document. If the document is already good, output it as-is.`;

// ============================================================================
// Enricher
// ============================================================================

export async function enrichDocs(options: EnrichOptions): Promise<EnrichResult> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const errors: string[] = [];
  let tokensUsed = 0;
  let filesEnriched = 0;
  let hallucinationsFixed = 0;
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
      let enriched: string;

      // Improvement B: Chunked enrichment for large files
      if (rawContent.length > 8000) {
        enriched = await enrichChunked(rawContent, file, options);
      } else {
        enriched = await enrichSingle(rawContent, file, options);
      }

      tokensUsed += Math.ceil((rawContent.length + enriched.length) / 4);

      // Improvement D: Multi-pass for critical sections
      if (MULTI_PASS_FILES.has(file)) {
        logger.info(`  Review pass for ${file}`);
        const reviewed = await reviewPass(enriched, rawContent, options);
        if (reviewed.length >= enriched.length * 0.8) {
          enriched = reviewed;
          tokensUsed += Math.ceil((enriched.length + reviewed.length) / 4);
        }
      }

      // Improvement C: Cross-validation — fix hallucinated identifiers
      if (options.verifiedEntities && options.verifiedEntities.size > 0) {
        const { fixed, fixCount } = crossValidateIdentifiers(enriched, options.verifiedEntities);
        enriched = fixed;
        hallucinationsFixed += fixCount;
        if (fixCount > 0) {
          logger.info(`  Fixed ${fixCount} hallucinated identifiers in ${file}`);
        }
      }

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
    hallucinationsFixed,
  };
}

// ============================================================================
// Single-file enrichment
// ============================================================================

async function enrichSingle(rawContent: string, file: string, options: EnrichOptions): Promise<string> {
  const blueprintBlock = options.blueprintContext
    ? `\n\n${options.blueprintContext}\n`
    : '';

  const prompt = [
    `Transform this raw document into professional DeepWiki-style documentation.`,
    `IMPORTANT: Output the COMPLETE document with ALL original content preserved plus your additions.`,
    blueprintBlock,
    `--- RAW DOCUMENT ---`,
    rawContent.substring(0, 12000),
    `--- END ---`,
    ``,
    `Output the full enriched markdown now. Remember: keep ALL tables/lists, add prose and one mermaid diagram.`,
  ].join('\n');

  // Determine thinking level from file name base (handle split subsystem files)
  const thinkingLevel = options.thinkingLevel ?? getThinkingLevel(file);
  const result = await options.llmCall(ENRICHER_SYSTEM_PROMPT, prompt, thinkingLevel);
  return stripLLMNoise(result);
}

// ============================================================================
// Improvement B: Chunked enrichment for large files
// ============================================================================

async function enrichChunked(rawContent: string, file: string, options: EnrichOptions): Promise<string> {
  // Split by ## headers
  const chunks = splitByHeaders(rawContent);

  if (chunks.length <= 1) {
    // Can't split — enrich as single (truncated)
    return enrichSingle(rawContent, file, options);
  }

  logger.info(`  Chunked enrichment: ${chunks.length} sections`);

  const enrichedChunks: string[] = [];
  const thinkingLevel = options.thinkingLevel ?? getThinkingLevel(file);
  const blueprintBlock = options.blueprintContext
    ? `\n\n${options.blueprintContext}\n`
    : '';

  for (const chunk of chunks) {
    // Skip tiny chunks (< 100 chars, probably just whitespace)
    if (chunk.trim().length < 100) {
      enrichedChunks.push(chunk);
      continue;
    }

    const prompt = [
      `Enrich this section of a larger document. Add prose, transitions, and key concepts.`,
      `IMPORTANT: Output the COMPLETE section with ALL original content preserved.`,
      blueprintBlock,
      `--- SECTION ---`,
      chunk.substring(0, 8000),
      `--- END ---`,
      ``,
      `Output the enriched section. Keep ALL data, add prose only.`,
    ].join('\n');

    try {
      const enriched = await options.llmCall(ENRICHER_SYSTEM_PROMPT, prompt, thinkingLevel);
      // Validate chunk wasn't destroyed
      if (enriched.length >= chunk.length * 0.4 && enriched.length > 50) {
        enrichedChunks.push(enriched);
      } else {
        enrichedChunks.push(chunk); // keep original
      }
    } catch {
      enrichedChunks.push(chunk); // keep original on error
    }
  }

  return enrichedChunks.join('\n\n');
}

/** Split markdown content by ## headers */
function splitByHeaders(content: string): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ') && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }

  return chunks;
}

// ============================================================================
// Improvement D: Review pass for critical sections
// ============================================================================

async function reviewPass(enriched: string, rawContent: string, options: EnrichOptions): Promise<string> {
  const prompt = [
    `Review this enriched document against the original raw data.`,
    `Fix any hallucinated method/class names, factual errors, or missing data.`,
    ``,
    `--- ENRICHED DOCUMENT ---`,
    enriched.substring(0, 12000),
    `--- END ENRICHED ---`,
    ``,
    `--- ORIGINAL RAW DATA (for fact-checking) ---`,
    rawContent.substring(0, 6000),
    `--- END RAW ---`,
    ``,
    `Output ONLY the corrected full markdown document. No commentary, no code fences.`,
  ].join('\n');

  let result = await options.llmCall(REVIEW_SYSTEM_PROMPT, prompt, 'medium');

  // Strip LLM commentary noise — some models add preamble before the actual document
  result = stripLLMNoise(result);

  return result;
}

/** Strip LLM meta-commentary and code fence wrappers from output */
function stripLLMNoise(content: string): string {
  let result = content;

  // Remove ```markdown wrapper if present
  const mdFenceMatch = result.match(/```markdown\n([\s\S]*?)```\s*$/);
  if (mdFenceMatch) {
    result = mdFenceMatch[1];
  }

  // Remove preamble before the first # heading
  const firstHeading = result.indexOf('\n# ');
  if (firstHeading > 0 && firstHeading < 500) {
    result = result.substring(firstHeading + 1);
  } else if (result.startsWith('# ')) {
    // Already clean
  } else {
    // Check for heading without newline prefix
    const headingIdx = result.indexOf('# ');
    if (headingIdx > 0 && headingIdx < 500) {
      result = result.substring(headingIdx);
    }
  }

  return result.trim();
}

// ============================================================================
// Improvement C: Cross-validation of identifiers
// ============================================================================

/**
 * Scan enriched text for backtick-quoted identifiers that look like
 * ClassName.methodName() and verify them against the verified entity set.
 * Replace hallucinations with the closest match or strip the () suffix.
 */
function crossValidateIdentifiers(
  content: string,
  verifiedEntities: Set<string>,
): { fixed: string; fixCount: number } {
  let fixCount = 0;

  // Match `SomeIdentifier.someMethod()` or `SomeClass.method()` patterns
  const result = content.replace(/`([A-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*)\(\)`/g, (match, identifier: string) => {
    const [className, methodName] = identifier.split('.');

    // Check if class exists
    const classExists = verifiedEntities.has(className) ||
      verifiedEntities.has(`cls:${className}`) ||
      [...verifiedEntities].some(e => e.endsWith(`.${className}`) || e === className);

    if (classExists) {
      // Class exists — check if method name is plausible
      const fullName = `${className}.${methodName}`;
      if (verifiedEntities.has(fullName) || verifiedEntities.has(methodName)) {
        return match; // verified, keep as-is
      }

      // Try to find closest method match
      const closest = findClosestMethod(methodName, className, verifiedEntities);
      if (closest) {
        fixCount++;
        return `\`${className}.${closest}()\``;
      }

      // Method not verifiable — keep class name but strip method call notation
      // Leave as `ClassName.methodName()` since the class exists
      return match;
    }

    // Class doesn't exist — might be hallucinated
    fixCount++;
    // Strip to just the name without ()
    return `\`${identifier}\``;
  });

  return { fixed: result, fixCount };
}

/** Find the closest matching method name for a class */
function findClosestMethod(methodName: string, className: string, entities: Set<string>): string | null {
  const lower = methodName.toLowerCase();
  let bestMatch = '';
  let bestScore = 0;

  for (const entity of entities) {
    const entityLower = entity.toLowerCase();
    // Look for methods that belong to this class
    if (entityLower.startsWith(className.toLowerCase() + '.')) {
      const method = entity.split('.').slice(1).join('.');
      const methodLower = method.toLowerCase();

      // Score similarity
      let common = 0;
      for (let i = 0; i < Math.min(lower.length, methodLower.length); i++) {
        if (lower[i] === methodLower[i]) common++;
        else break;
      }
      const score = common / Math.max(lower.length, methodLower.length);
      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = method;
      }
    }
  }

  return bestMatch || null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Get thinking level for a file, handling split subsystem files (3a-, 3b-, etc.) */
function getThinkingLevel(file: string): ThinkingLevel {
  if (THINKING_STRATEGY[file]) return THINKING_STRATEGY[file];

  // Handle split subsystem files
  if (file.match(/^3[a-z]-subsystem/)) return 'medium';

  return 'medium';
}
