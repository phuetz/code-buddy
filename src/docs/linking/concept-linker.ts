/**
 * Phase 4 — Concept Linker
 *
 * After all pages are generated, this module:
 * 1. Builds a concept index from all page titles and H2/H3 headings
 * 2. Links first mentions of known concepts to their definition pages
 * 3. Adds "See also" footers with contextual descriptions
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DocPlan } from '../planning/plan-generator.js';
import type { GeneratedPage } from '../generation/page-generator.js';

// ============================================================================
// Types
// ============================================================================

export interface ConceptEntry {
  concept: string;
  pageSlug: string;
  file: string;
  anchor: string;
  description: string;
}

// ============================================================================
// Concept Index Builder
// ============================================================================

/**
 * Build concept index from generated pages.
 * Extracts page titles + H2/H3 headings + class/function names.
 */
export function buildConceptIndex(
  plan: DocPlan,
  pages: GeneratedPage[],
): ConceptEntry[] {
  const entries: ConceptEntry[] = [];
  const seen = new Set<string>();

  for (const { page, content } of pages) {
    // Page title as concept
    if (!seen.has(page.title.toLowerCase())) {
      seen.add(page.title.toLowerCase());
      entries.push({
        concept: page.title,
        pageSlug: page.slug,
        file: `${page.slug}.md`,
        anchor: '',
        description: page.description,
      });
    }

    // H2 headings as sub-concepts
    for (const match of content.matchAll(/^## (.+)$/gm)) {
      const heading = match[1].replace(/\s*\(.*\)$/, '').trim();
      if (heading.length < 3 || heading.length > 60) continue;
      if (seen.has(heading.toLowerCase())) continue;
      // Skip generic headings
      if (/^(overview|summary|introduction|sources|see also|relevant)/i.test(heading)) continue;
      seen.add(heading.toLowerCase());
      const anchor = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      entries.push({
        concept: heading,
        pageSlug: page.slug,
        file: `${page.slug}.md`,
        anchor,
        description: '',
      });
    }
  }

  // Sort by concept length descending (longer concepts first to avoid partial matches)
  entries.sort((a, b) => b.concept.length - a.concept.length);

  return entries;
}

// ============================================================================
// Linker
// ============================================================================

/**
 * Link concepts across all generated pages.
 * First mention of each concept in a page becomes a hyperlink.
 */
export function linkConcepts(
  outputDir: string,
  pages: GeneratedPage[],
  concepts: ConceptEntry[],
): number {
  let totalLinked = 0;

  for (const genPage of pages) {
    const page = genPage.page;
    const filePath = path.join(outputDir, `${page.slug}.md`);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf-8');
    const linkedInThisPage = new Set<string>();

    for (const concept of concepts) {
      // Don't link to self
      if (concept.pageSlug === page.slug) continue;
      // Only first occurrence per page
      if (linkedInThisPage.has(concept.concept)) continue;

      // Build regex for whole-word match (avoid matching inside links or code)
      const escaped = concept.concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\b(' + escaped + ')\\b', 'i');

      const match = content.match(regex);
      if (match && match.index !== undefined) {
        // Check we're not inside a code block or existing link
        const before = content.substring(Math.max(0, match.index - 10), match.index);
        if (before.includes('[') || before.includes('`') || before.includes('```')) continue;

        const link = concept.anchor
          ? `[${match[1]}](./${concept.file}#${concept.anchor})`
          : `[${match[1]}](./${concept.file})`;

        content = content.substring(0, match.index) + link + content.substring(match.index + match[0].length);
        linkedInThisPage.add(concept.concept);
        totalLinked++;
      }
    }

    // Add "See also" footer with related pages
    const relatedPages = pages
      .filter(p => page.relatedPages.includes(p.page.id) && p.page.slug !== page.slug)
      .slice(0, 4);

    if (relatedPages.length > 0) {
      const seeAlso = relatedPages.map(p => `[${p.page.title}](./${p.page.slug}.md)`).join(' · ');
      content += `\n\n---\n\n**See also:** ${seeAlso}\n`;
    }

    fs.writeFileSync(filePath, content);
  }

  return totalLinked;
}
