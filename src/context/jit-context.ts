/**
 * JIT (Just-In-Time) Context Discovery
 *
 * When a tool accesses a path, this loads the instruction files in that
 * subtree that weren't already injected at startup (delegated to the unified
 * `project-context` loader, sharing its dedup registry), plus two JIT-only
 * concerns: auto-discovered doc pages (DOC_DIR_MAP) and path-scoped rules.
 *
 * Inspired by Gemini CLI's jit-context.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { discoverRulesForPath } from './rules-loader.js';
import { resolveJitContext, getActiveContextRegistry } from './project-context.js';

/**
 * Map of source directory prefixes → relevant doc page slugs.
 * When a tool accesses a path under a key, the matching doc is auto-discovered.
 */
const DOC_DIR_MAP: Record<string, string[]> = {
  'src/tools': ['tools'],
  'src/security': ['security'],
  'src/channels': ['channels', 'communication'],
  'src/agent': ['agent', 'architecture'],
  'src/knowledge': ['knowledge'],
  'src/config': ['configuration', 'config'],
  'src/docs': ['knowledge', 'docs'],
  'src/context': ['memory', 'context'],
  'src/server': ['api-reference', 'api'],
  'src/deploy': ['deploy', 'tools'],
  'src/daemon': ['daemon', 'agent'],
  'src/sandbox': ['security', 'sandbox'],
  'src/plugins': ['tools', 'plugin'],
  'src/memory': ['memory', 'context'],
  'src/checkpoints': ['architecture'],
  'tests': ['testing'],
};

/** Set of already-loaded doc paths (instruction files dedup via the registry). */
const loadedPaths = new Set<string>();

/** Maximum context size per discovery (chars) */
const MAX_JIT_CONTEXT_CHARS = 4000;

export const JIT_CONTEXT_PREFIX = '\n\n--- Discovered Context ---\n';
export const JIT_CONTEXT_SUFFIX = '\n--- End Context ---';

/**
 * Truncate discovered context to a char budget WITHOUT leaving broken markdown.
 * A blind substring can cut mid-code-fence, so everything after the outer
 * delimiter reads as if still inside a ``` block. Prefer a structural boundary
 * (blank line / heading) near the cut, then close any code fence left open.
 */
export function truncateJitContent(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 3));
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n## '), cut.lastIndexOf('\n# '));
  if (boundary > max * 0.5) {
    cut = cut.slice(0, boundary);
  }
  cut += '...';
  // Odd number of fences ⇒ one is unterminated ⇒ close it.
  if (((cut.match(/```/g) || []).length) % 2 === 1) {
    cut += '\n```';
  }
  return cut;
}

/**
 * Clear caches (for testing / `/context reload`). Resets both the doc dedup set
 * and the active context registry so the next pass re-scans from scratch.
 */
export function clearJitCache(): void {
  loadedPaths.clear();
  getActiveContextRegistry().clear();
}

/**
 * Discover and load JIT context for a given accessed path.
 *
 * @param accessedPath - The file/directory path being accessed by a tool
 * @param projectRoot - The project root directory (stop walking here)
 * @returns Concatenated context content, or empty string if nothing new found
 */
export function discoverJitContext(
  accessedPath: string,
  projectRoot: string = process.cwd(),
): string {
  try {
    const normalizedRoot = path.resolve(projectRoot);
    const normalizedPath = path.resolve(accessedPath);

    const discoveredContent: string[] = [];

    // 1. Instruction files in the accessed subtree, via the unified loader.
    //    The shared active registry skips anything already injected at startup,
    //    so the same AGENTS.md/CODEBUDDY.md is never duplicated.
    const ctx = resolveJitContext(accessedPath, {
      projectRoot: normalizedRoot,
      registry: getActiveContextRegistry(),
    });
    if (ctx.text) {
      discoveredContent.push(ctx.text);
    }

    // 2. Auto-discover relevant doc pages based on the accessed path.
    const relativePath = path.relative(normalizedRoot, normalizedPath).replace(/\\/g, '/');
    for (const [prefix, slugPatterns] of Object.entries(DOC_DIR_MAP)) {
      if (!relativePath.startsWith(prefix)) continue;
      const docsDir = path.join(normalizedRoot, '.codebuddy', 'docs');
      if (!fs.existsSync(docsDir)) break;
      try {
        const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
        for (const pattern of slugPatterns) {
          const match = docFiles.find((f) => f.includes(pattern));
          if (!match) continue;
          const docPath = path.join(docsDir, match);
          if (loadedPaths.has(docPath)) continue;
          const content = fs.readFileSync(docPath, 'utf-8');
          // Only inject the first 2 sections (title + first H2) to stay compact.
          const sections = content.split(/(?=^## )/m);
          const compact = sections.slice(0, 2).join('').trim();
          if (compact) {
            const relDoc = path.relative(normalizedRoot, docPath).replace(/\\/g, '/');
            discoveredContent.push(`[${relDoc}]\n${compact}`);
            loadedPaths.add(docPath);
            logger.debug(`JIT context: auto-discovered doc ${relDoc} for ${prefix}`);
          }
          break; // One doc per prefix
        }
      } catch {
        /* docs dir not readable */
      }
      break; // One prefix match
    }

    // 3. Path-scoped rules matching this access.
    const rulesContext = discoverRulesForPath(accessedPath, projectRoot);
    if (rulesContext) {
      discoveredContent.push(rulesContext);
    }

    if (discoveredContent.length === 0) return '';

    const result = truncateJitContent(discoveredContent.join('\n\n'), MAX_JIT_CONTEXT_CHARS);

    return `${JIT_CONTEXT_PREFIX}${result}${JIT_CONTEXT_SUFFIX}`;
  } catch (err) {
    logger.debug('JIT context discovery failed', { error: String(err) });
    return '';
  }
}
