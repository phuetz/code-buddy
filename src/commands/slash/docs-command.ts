/**
 * /docs slash command — Generate DeepWiki-style documentation
 *
 * Usage:
 *   /docs generate           — Generate full documentation
 *   /docs generate --no-diagrams  — Skip mermaid diagrams
 *   /docs generate --no-metrics   — Skip code quality metrics
 *   /docs status             — Show generation status
 */

import { logger } from '../../utils/logger.js';

export interface DocsCommandResult {
  output: string;
  success: boolean;
}

/**
 * Handle /docs command
 */
export async function handleDocsCommand(args: string): Promise<DocsCommandResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] || 'generate';

  if (subcommand === 'status') {
    return handleStatus();
  }

  if (subcommand === 'generate') {
    const noDiagrams = parts.includes('--no-diagrams');
    const noMetrics = parts.includes('--no-metrics');
    return handleGenerate(noDiagrams, noMetrics);
  }

  return {
    output: 'Usage: /docs generate [--no-diagrams] [--no-metrics] | /docs status',
    success: false,
  };
}

async function handleGenerate(noDiagrams: boolean, noMetrics: boolean): Promise<DocsCommandResult> {
  try {
    // Load and populate the graph
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      // Try to populate the graph first
      try {
        const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
        const added = populateDeepCodeGraph(graph, process.cwd());
        logger.info(`Docs: populated code graph with ${added} triples`);
      } catch (e) {
        return {
          output: `Code graph is empty and could not be populated: ${e instanceof Error ? e.message : String(e)}. Run the code_graph tool first.`,
          success: false,
        };
      }
    }

    const { generateDocs } = await import('../../docs/docs-generator.js');
    const result = await generateDocs(graph, {
      includeDiagrams: !noDiagrams,
      includeMetrics: !noMetrics,
    });

    const output = [
      `Documentation generated in ${result.durationMs}ms:`,
      `  Files: ${result.files.join(', ')}`,
      `  Entities documented: ${result.entityCount}`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { output, success: true };
  } catch (err) {
    return {
      output: `Documentation generation failed: ${err instanceof Error ? err.message : String(err)}`,
      success: false,
    };
  }
}

async function handleStatus(): Promise<DocsCommandResult> {
  const fs = await import('fs');
  const path = await import('path');
  const docsDir = path.join(process.cwd(), '.codebuddy', 'docs');

  if (!fs.existsSync(docsDir)) {
    return {
      output: 'No documentation generated yet. Run /docs generate first.',
      success: true,
    };
  }

  const files = fs.readdirSync(docsDir).filter((f: string) => f.endsWith('.md'));
  const totalSize = files.reduce((sum: number, f: string) => {
    return sum + fs.statSync(path.join(docsDir, f)).size;
  }, 0);

  return {
    output: [
      `Documentation directory: .codebuddy/docs/`,
      `Files: ${files.length}`,
      `Total size: ${(totalSize / 1024).toFixed(1)} KB`,
      `Files: ${files.join(', ')}`,
    ].join('\n'),
    success: true,
  };
}
