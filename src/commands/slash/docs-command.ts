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
import type { GeminiThinkingLevel } from '../../codebuddy/client.js';
import { detectProviderFromEnv, selectModelForDetectedProvider } from '../../utils/provider-detector.js';

export interface DocsCommandResult {
  output: string;
  success: boolean;
}

async function createDocsLlmCall(
  thinkingLevelOverride?: GeminiThinkingLevel,
): Promise<((sys: string, user: string, thinking?: string) => Promise<string>) | undefined> {
  const provider = detectProviderFromEnv();
  if (!provider) return undefined;

  const { CodeBuddyClient } = await import('../../codebuddy/client.js');
  const model = selectModelForDetectedProvider(provider);
  const client = new CodeBuddyClient(provider.apiKey, model, provider.baseURL);

  return async (systemPrompt: string, userPrompt: string, thinkingLevel?: string): Promise<string> => {
    const response = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      [],
      {
        model,
        temperature: 0.2,
        thinkingLevel: (thinkingLevel || thinkingLevelOverride) as GeminiThinkingLevel | undefined,
      },
    );
    return response.choices[0]?.message?.content ?? '';
  };
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
    const withLLM = parts.includes('--with-llm');
    const useV2 = parts.includes('--v2');

    // Parse --thinking level
    const thinkingIdx = parts.indexOf('--thinking');
    const thinkingLevel = thinkingIdx >= 0 ? parts[thinkingIdx + 1] as 'minimal' | 'low' | 'medium' | 'high' : undefined;

    // V2 pipeline — generic DeepWiki-style
    if (useV2) {
      return handleGenerateV2(withLLM, thinkingLevel);
    }

    if (withLLM) {
      return handleGenerateWithLLM(thinkingLevel);
    }
    return handleGenerate(noDiagrams, noMetrics);
  }

  return {
    output: 'Usage: /docs generate [--v2] [--with-llm] [--thinking level] [--no-diagrams] [--no-metrics] | /docs status',
    success: false,
  };
}

async function handleGenerate(noDiagrams: boolean, noMetrics: boolean): Promise<DocsCommandResult> {
  try {
    // Load and populate the graph
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();

    // Load cached graph from disk if empty
    if (graph.getStats().tripleCount === 0) {
      try {
        const { loadCodeGraph, codeGraphExists } = await import('../../knowledge/code-graph-persistence.js');
        if (codeGraphExists(process.cwd())) {
          loadCodeGraph(graph, process.cwd());
          logger.info(`Docs: loaded ${graph.getStats().tripleCount} cached triples`);
        }
      } catch { /* persistence optional */ }
    }

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

    // Migrated from the deprecated V1 docs-generator.ts (deleted) to the V2
    // docs-pipeline.ts implementation (DISCOVER → PLAN → GENERATE → LINK).
    // The V2 API returns `pagesGenerated` instead of V1's `entityCount`;
    // the rest of the output format is equivalent.
    const { runDocsPipeline } = await import('../../docs/docs-pipeline.js');
    const result = await runDocsPipeline(graph);

    const output = [
      `Documentation generated in ${result.durationMs}ms:`,
      `  Files: ${result.files.join(', ')}`,
      `  Pages generated: ${result.pagesGenerated}`,
      `  Concepts linked: ${result.conceptsLinked}`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    // Keep a hint about the unused flags so users upgrading to V2 know they
    // are now handled via config (loadDocsConfig) rather than per-call flags.
    if (noDiagrams || noMetrics) {
      logger.debug('docs-command: --no-diagrams / --no-metrics ignored under V2 pipeline (set via .codebuddy/docs.config.json).');
    }

    return { output, success: true };
  } catch (err) {
    return {
      output: `Documentation generation failed: ${err instanceof Error ? err.message : String(err)}`,
      success: false,
    };
  }
}

async function handleGenerateWithLLM(thinkingLevelOverride?: 'minimal' | 'low' | 'medium' | 'high'): Promise<DocsCommandResult> {
  try {
    // Step 1: Generate raw docs first (fast, no LLM needed)
    const rawResult = await handleGenerate(false, false);
    if (!rawResult.success) return rawResult;

    // Step 2: Set up LLM client for enrichment via the active Code Buddy provider.
    const llmCall = await createDocsLlmCall(thinkingLevelOverride);
    if (!llmCall) {
      return {
        output: rawResult.output + '\n\n(LLM enrichment skipped — no provider. Run `buddy login chatgpt` or configure a provider API key.)',
        success: true,
      };
    }

    // Step 3: Build blueprint for verified entity context (improvement A + E)
    let blueprintContext: string | undefined;
    let verifiedEntities: Set<string> | undefined;
    try {
      const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
      const graph = getKnowledgeGraph();
      const { buildProjectBlueprint, serializeBlueprintForLLM } = await import('../../docs/blueprint-builder.js');
      const blueprint = buildProjectBlueprint(graph);
      blueprintContext = serializeBlueprintForLLM(blueprint);
      verifiedEntities = blueprint.allEntities;
      logger.info(`Blueprint: ${blueprint.moduleCount} modules, ${blueprint.functionCount} functions, ${blueprint.classCount} classes`);
    } catch (e) {
      logger.debug(`Blueprint build skipped: ${e}`);
    }

    // Step 4: Enrich raw docs with LLM prose
    const path = await import('path');
    const docsDir = path.join(process.cwd(), '.codebuddy', 'docs');
    const { enrichDocs } = await import('../../docs/llm-enricher.js');
    const result = await enrichDocs({
      docsDir,
      llmCall,
      thinkingLevel: thinkingLevelOverride,
      blueprintContext,
      verifiedEntities,
      onProgress: (file, current, total) => {
        logger.info(`Enriching [${current}/${total}] ${file}`);
      },
    });

    const output = [
      `Documentation generated and enriched with LLM:`,
      `  LLM enrichment: ${result.filesEnriched} files enriched in ${(result.durationMs / 1000).toFixed(1)}s`,
      `  Tokens used: ~${result.tokensUsed}`,
      `  Hallucinations fixed: ${result.hallucinationsFixed}`,
      `  Knowledge file: ${result.knowledgePath}`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { output, success: true };
  } catch (err) {
    return { output: `LLM docs generation failed: ${err instanceof Error ? err.message : String(err)}`, success: false };
  }
}

async function handleGenerateV2(withLLM: boolean, thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'): Promise<DocsCommandResult> {
  try {
    // Populate graph
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();
    // Load cached graph from disk
    if (graph.getStats().tripleCount === 0) {
      try {
        const { loadCodeGraph, codeGraphExists } = await import('../../knowledge/code-graph-persistence.js');
        if (codeGraphExists(process.cwd())) {
          loadCodeGraph(graph, process.cwd());
        }
      } catch { /* persistence optional */ }
    }
    if (graph.getStats().tripleCount === 0) {
      try {
        const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
        populateDeepCodeGraph(graph, process.cwd());
      } catch (e) {
        return { output: `Code graph empty: ${e instanceof Error ? e.message : String(e)}`, success: false };
      }
    }

    // Set up LLM if requested
    let llmCall: ((sys: string, user: string, thinking?: string) => Promise<string>) | undefined;
    if (withLLM) {
      llmCall = await createDocsLlmCall(thinkingLevel);
    }

    // Run the V2 pipeline
    const { runDocsPipeline } = await import('../../docs/docs-pipeline.js');
    const result = await runDocsPipeline(graph, {
      cwd: process.cwd(),
      llmCall,
      config: thinkingLevel ? { thinkingLevel } : undefined,
      onProgress: (phase, detail) => {
        logger.info(`[${phase}] ${detail}`);
      },
    });

    const output = [
      `Documentation V2 generated:`,
      `  Pages: ${result.pagesGenerated}`,
      `  Concepts linked: ${result.conceptsLinked}`,
      `  Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.slice(0, 5).join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { output, success: true };
  } catch (err) {
    return { output: `V2 pipeline failed: ${err instanceof Error ? err.message : String(err)}`, success: false };
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
